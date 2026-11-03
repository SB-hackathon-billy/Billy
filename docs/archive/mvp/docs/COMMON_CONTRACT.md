> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `docs/COMMON_CONTRACT.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../../README.md)을 먼저 확인하세요.

# 성북 공유대여 프론트엔드 서버 AI 공통 컨트랙트

계약 버전: `0.3.0`

이 계약은 [PRD](MVP_PRD.md)의 동작 범위를 세 작업 영역이 병렬 구현하기 위한 기준이다. **요청 하나에 여러 물품·소유자의 조율 분기가 연결되고, 요청자가 비교 후 하나만 선택한다.** 결제 화면 준비가 종점이며 실제 결제·예약·수령·반납·보상 상태는 없다. 표의 API·타입·이벤트는 설계 명세이며 이번 작업에서 서버를 구현하거나 호출한 것은 아니다.

## 1. 기술과 로컬 실행 경계

| 영역      | 구성                                                                            | 책임                                                  |
| --------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| web       | React·TypeScript·Vite, React Router·TanStack Query, React Aria, vite-plugin-pwa | 음성 UI·센터 화면·요청/소유자 카드·비교·결제 미리보기 |
| api       | Node.js 지원 LTS·Fastify, JSON Schema/Zod                                       | 데모 세션·권한·검증·업무 상태·REST·SSE                |
| worker    | TypeScript·pg-boss·OpenAI 공식 SDK/HTTP 어댑터                                  | 검색·가격 추천·설명·공공 데모 응답·만료·재시도        |
| db        | PostgreSQL                                                                      | 요청·조건 이력·제안·점유·작업·이벤트·멱등 결과        |
| contracts | 버전이 붙은 스키마·타입·fixture                                                 | 세 영역이 같은 의미를 사용하도록 단일 정의 유지       |

**사용자 확정 배포 대상은 로컬이다.** 한 PC에서 정적 web 빌드·api·worker·DB와 프록시를 실행한다. `/api/v1/*`와 정적 web을 `http://localhost:8000`의 같은 origin으로 제공한다. DB는 외부 기기에 직접 노출하지 않는다. 로컬 PC가 잠자거나 프로세스가 종료되면 즉시 진행할 수 없으며, 재시작 후 DB의 미완료 작업을 재개한다.

OpenAI 키는 저장소에 넣지 않는다. OpenAI 호출에는 로컬 PC와 음성 클라이언트의 외부 인터넷 접속이 필요하다. 오프라인 AI·클라우드 호스팅·공개 터널은 기본 구성에 포함하지 않는다. [배포·PWA 근거](research/pwa-and-stack.md)

권고 경로는 `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/demo-data`다. 정확한 패키지 버전과 lockfile, OS별 실행 명령은 구현 착수 시 고정한다. 이번 문서가 설치 검증을 대체하지 않는다.

## 2. 공통 불변 규칙

1. 사용자의 실제 클릭과 서버 검증이 신청·승인·최종 선택의 근거다. AI 발화·분류·도구 제안은 동의가 아니다.
2. 사용자 ID는 세션에서 결정한다. 요청 body의 `ownerId`, `requesterId`, `actingUserId`로 권한을 변경할 수 없다.
3. `RentalRequest`는 요청자 한 명, `Negotiation`은 물품 하나와 그 소유자 한 명 또는 공공 데모 어댑터에 대응한다. 한 요청 안의 같은 물품 분기는 중복 생성하지 않는다.
4. 후보별 조건과 승인은 독립이다. A 소유자의 승인은 B 소유자에게 적용되지 않는다. 요청자는 모든 분기, 소유자는 자신의 분기만 본다.
5. 모든 조건은 불변 이력과 `termsRevision`을 가진다. 조건이 달라지면 이전 동의·제안으로 선택할 수 없다.
6. 한 요청의 `selectedNegotiationId`는 최대 하나다. 선택과 다른 활성 분기 종료, 데모 점유 생성을 한 DB 트랜잭션으로 처리한다.
7. 금액은 KRW 정수, 시간은 RFC 3339 UTC 문자열이다. 화면과 자연어 해석은 `ko-KR`·`Asia/Seoul`을 사용한다.
8. 공공 신청·자격·요금·일정은 데모 fixture다. 주민의 승인 버튼은 실제 테스트 사용자가 누른다.
9. 무응답·거절·만료·충돌·모델 실패·결제 화면 표시는 실제 대여 확정이 아니다.
10. SSE·큐·네트워크 재시도는 중복될 수 있다. 명령·작업·이벤트는 각각 중복을 처리한다.

## 3. 식별자와 공통 데이터 규칙

런타임 ID는 prefix를 붙인 불투명 문자열로 생성한다. 예: `req_…`, `neg_…`, `offer_…`, `quote_…`, `task_…`, `voice_…`. 프론트가 ID를 해석하거나 사용자 입력으로 만들어 권한을 추정하지 않는다. 픽스처 ID만 14절의 고정 이름을 쓴다.

`version`·`termsRevision`은 1부터 시작하는 양의 정수다. `requestVersion`은 자식 분기를 포함한 업무 상태 변경마다 증가한다. 작업의 RUNNING 표시나 음성 상태 변경만으로는 증가하지 않는다. `needRevision`은 초안 내용이 바뀔 때만 증가한다. `negotiationVersion`은 해당 분기 변경마다 증가한다. 다른 소유자가 응답해도 자신의 `negotiationVersion`은 바뀌지 않는다. `termsRevision`은 기간·장소·금액이 바뀔 때만 증가한다.

기간은 `[startAt, endAt)`이며 시작은 서버 현재 시각 이후, 1시간 이상 7일 이하, 30분 단위다. `quantity=1`로 고정하며 재고 한 개당 Item ID 하나를 사용한다. 금액은 안전한 정수 범위에서 검사하고 소수·음수·NaN을 거절한다. 일반 문자열은 trim·길이 제한을 적용하고 알 수 없는 필드는 쓰기 요청에서 거절한다.

### 3.1 엔터티

| 엔터티        | 필수 필드와 의미                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DemoUser      | `id`, `handle`, `displayName`, `demoEligible:boolean`. 실명·연락처·센터 회원번호 없음                                                                                                                                                                                        |
| Place         | `id`, `label`, `description`, `isDemo:true`. 허용된 가상 만남 장소 목록                                                                                                                                                                                                      |
| Item          | `id`, `source:PUBLIC/RESIDENT`, `ownerId:string/null`, `title`, `category`, `image:{url,alt,isIllustration}`, `enabled`, `allowedPlaceIds`, `dailyRateKrw`, `pricingFacts:{registeredExtraEffort:boolean}`, `unavailableIntervals`, `publicScenario:null/APPROVE/DECLINE`    |
| RentalRequest | `id`, `requesterId`, `version`, `needRevision`, `status`, `need`, `createdAt`, `updatedAt`, `expiresAt`, `selectedNegotiationId:null/string`                                                                                                                                 |
| Candidate     | `id`, `requestId`, `itemId`, `itemSummary`, `quoteId`, `suggestedTerms`, `availability:AVAILABLE/UNAVAILABLE`, `unavailableReason:null/string`                                                                                                                               |
| PricingQuote  | `id`, `itemId`, `requestId`, `negotiationId:null/string`, `conditionsHash`, `startAt`, `endAt`, `billingDays`, `baselineKrw`, `minKrw`, `maxKrw`, `recommendedKrw`, `recommendationSource:AI/BASELINE/PUBLIC_FIXED`, `reasonCode`, `policyVersion`, `createdAt`, `expiresAt` |
| Negotiation   | `id`, `requestId`, `itemId`, `ownerId:null/string`, `source`, `version`, `status`, `termsRevision`, `terms`, `changeCount`, `responseDueAt:null/time`, `offer:null/Offer`, `closedReason:null/string`, `updatedAt`                                                           |
| Terms         | `startAt`, `endAt`, `placeId`, `totalFeeKrw`, `currency:KRW`, `quoteId`                                                                                                                                                                                                      |
| Offer         | `id`, `negotiationId`, `termsRevision`, `terms`, `endorsedBy:OWNER/PUBLIC_DEMO`, `createdAt`, `validUntil`. 불변 레코드                                                                                                                                                      |
| DemoHold      | `id`, `requestId`, `negotiationId`, `itemId`, `startAt`, `endAt`, `expiresAt`, `status:ACTIVE/EXPIRED/RELEASED`                                                                                                                                                              |
| AgentTask     | `id`, `kind`, `requestId:null/string`, `negotiationId:null/string`, `inputVersion`, `status:QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED`, `attempt`, `errorCode:null/string`                                                                                                   |

`Need`는 `{category, queryText, startAt, endAt, preferredPlaceIds, maxBudgetKrw}`다. 모든 키를 항상 포함한다. 빈 NeedDraft는 `{category:null,queryText:"",startAt:null,endAt:null,preferredPlaceIds:[],maxBudgetKrw:null}`다. DRAFT에서는 queryText 0~200자·장소 0~3개·미확정 값 null을 허용한다. 검색 전에는 category·날짜가 non-null, queryText 1~200자, 장소 1~3개여야 한다. maxBudgetKrw는 양의 정수 또는 null이다. category enum은 `CLEANING/TOOLS/TRAVEL/HOBBY`다. 수량이 여러 개인 발화에는 이번 데모는 물품 1개씩 요청한다고 설명한다.

물품의 `source=PUBLIC`이면 `ownerId=null`, 주민이면 실제 seed 사용자의 ID가 필수다. Item의 dailyRateKrw는 주민의 기준 일요금 또는 공공의 고정 데모 일요금이다. 서버만 수정할 수 있다.

### 3.2 화면 projection

`RequestView={request, candidates, negotiations, comparison, tasks, allowedActions}`를 요청자에게 반환한다. `comparison`의 행은 분기 하나이며 최신 조건·최초 조건 대비 차이·가격·유효기한·선택 가능 여부를 담는다. 소유자에게는 `OwnerCard={requestId, requesterDisplayName, negotiation, itemSummary, allowedActions}`만 반환한다. 소유자가 다른 소유자의 물품·가격·응답·요청자의 전체 대화에 접근할 수 없다.

`ItemSummary={id,title,category,source,ownerDisplayName:null/string,image}`다. `RequestSummary={id,status,version,needSummary:{category,queryText,startAt,endAt},activeBranchCount,offeredCount,selectedNegotiationId,updatedAt}`를 요청함에서 사용한다. 비교 행은 `{negotiationId,status,itemSummary,terms,changedFields,validUntil,selectable,unavailableReason}`이며 changedFields는 `START_AT/END_AT/PLACE/TOTAL_FEE` 배열이다. `/sync`의 data는 `{requestSummaries,ownerCards,tasks,eventCursor}`다.

`allowedActions`는 서버가 계산한 enum 배열이다. UI 편의를 위한 값이며 서버가 실행 시 다시 검증한다. enum은 `EDIT_DRAFT/SEARCH/SUBMIT_CANDIDATES/OWNER_APPROVE/OWNER_DECLINE/OWNER_COUNTER/REQUESTER_COUNTER/WITHDRAW_BRANCH/SELECT_OFFER/CANCEL_REQUEST/OPEN_PAYMENT_PREVIEW`다. 응답의 날짜·금액·소유자 이름이 authoritative하며 모델 문장으로 덮어쓰지 않는다.

## 4. 상태와 전이

### 4.1 요청 전체

| 현재 상태             | 의미                                    | 허용 전이                                            |
| --------------------- | --------------------------------------- | ---------------------------------------------------- |
| DRAFT                 | 사용자 확인 전 초안                     | SEARCHING, CANCELLED, EXPIRED                        |
| SEARCHING             | 확인된 요구로 후보·가격 조회 중         | MATCHES_READY, NO_MATCH, FAILED, CANCELLED, EXPIRED  |
| MATCHES_READY         | 검색 결과가 있고 아직 소유자에게 미전송 | COLLECTING_OFFERS, DRAFT, CANCELLED, EXPIRED         |
| COLLECTING_OFFERS     | 독립 분기들에서 응답·조율·비교 중       | PAYMENT_PREVIEW_READY, NO_OFFERS, CANCELLED, EXPIRED |
| PAYMENT_PREVIEW_READY | 제안 하나 선택, 결제 화면 열람 가능     | 종점. 점유 만료는 별도 표시                          |
| NO_MATCH              | 가용 후보 없음                          | 종점. 조건 변경은 새 요청                            |
| NO_OFFERS             | 모든 분기가 종료되어 선택할 제안 없음   | 종점. 새 요청 가능                                   |
| FAILED                | 검색 작업의 재시도 한도 초과            | 종점. 새 요청 가능                                   |
| CANCELLED             | 요청자가 전체 취소                      | 종점                                                 |
| EXPIRED               | 요청 유효시간 종료                      | 종점                                                 |

`expiresAt=createdAt+24시간`이 기본값이다. MATCHES_READY에서 초안 변경 시 후보·가격 참조를 제거하고 DRAFT로 되돌린다. COLLECTING_OFFERS에서는 전체 need를 수정하지 않고 분기별 조건 변경 또는 새 요청을 사용한다. 후보 전송은 요청당 한 번, 최대 3개다. 추가 소유자에게 무한 전송하지 않는다.

### 4.2 소유자 또는 공공별 분기

| 현재 상태                                                  | actor·동작                        | 다음 상태·규칙                                                           |
| ---------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| 신규                                                       | 주민 후보 전송                    | AWAITING_OWNER, termsRevision=1, 소유자 카드 생성                        |
| 신규                                                       | 공공 후보 전송                    | PENDING_PUBLIC, 데모 어댑터 작업 생성                                    |
| PENDING_PUBLIC                                             | 어댑터 승인/거절                  | OFFERED 또는 DECLINED. 직원 승인이 아니라 데모 결과                      |
| AWAITING_OWNER                                             | 소유자 승인                       | OFFERED, 같은 조건 버전의 Offer 생성                                     |
| AWAITING_OWNER                                             | 소유자 조건 변경                  | OFFERED, 새 조건 버전·Offer 생성. 변경 자체가 그 조건에 대한 소유자 의사 |
| AWAITING_OWNER                                             | 소유자 거절                       | DECLINED                                                                 |
| OFFERED                                                    | 요청자 조건 변경                  | AWAITING_OWNER. 이전 Offer는 즉시 선택 불가                              |
| OFFERED                                                    | 소유자 조건 변경                  | OFFERED, 새 조건 버전·Offer. 요청자 다시 비교                            |
| OFFERED                                                    | 요청자 최종 선택                  | SELECTED. root=PAYMENT_PREVIEW_READY, 다른 활성 분기=SUPERSEDED          |
| AWAITING_OWNER/OFFERED                                     | 해당 분기 요청자 또는 소유자 철회 | WITHDRAWN                                                                |
| 활성 상태                                                  | root 취소/만료, 분기 기한 초과    | WITHDRAWN/EXPIRED. 원인 코드 함께 기록                                   |
| 활성 상태                                                  | 확정 검증에서 재고·가용성 상실    | UNAVAILABLE                                                              |
| DECLINED/WITHDRAWN/EXPIRED/SUPERSEDED/UNAVAILABLE/SELECTED | 추가 승인·변경                    | 거절. 종점 재개 없음                                                     |

활성은 `PENDING_PUBLIC/AWAITING_OWNER/OFFERED`다. 요청자 철회는 PENDING_PUBLIC에도 가능하다. 공공 분기에는 OWNER 명령·조건 협상이 없다. 다른 기간·장소가 필요하면 새 요청을 만든다.

소유자 응답 기한은 `min(now+24시간, request.expiresAt, terms.startAt)`, Offer 기한은 `min(now+30분, request.expiresAt, terms.startAt)`이다. 수정 후에도 root 만료를 연장하지 않는다. `now >= deadline`이면 만료다. cron/worker가 늦어도 읽기·명령 처리 시 같은 조건으로 만료를 판단한다. 모든 분기가 종료되면 NO_OFFERS, root 시간 한도가 도래한 경우 EXPIRED가 우선한다.

`changeCount`는 최초 조건 이후 소유자·요청자의 기간/장소/금액 변경 횟수 합계다. 3회를 넘는 변경은 거절한다. 승인·거절·최종 선택은 변경 횟수에 포함하지 않는다. 원래 조건과 같은 변경은 `NO_CHANGES`다. 제안 기한 갱신만을 위한 의미 없는 수정은 허용하지 않는다.

### 4.3 음성과 업무 상태 분리

`voiceStatus=IDLE/CONNECTING/LISTENING/SPEAKING/RECONNECT_REQUIRED/CLOSED/ERROR`와 `agentActivity=IDLE/CLARIFYING/SEARCHING/PRICING/SUMMARIZING/WAITING_FOR_OWNER/WAITING_FOR_REQUESTER/FAILED`는 UI 상태다. 대여 상태를 대체하지 않는다. `WAITING_FOR_OWNER`에는 진행률을 표시하지 않는다. 대화 종료는 요청 취소가 아니며 raw 음성 연결의 종료가 DB 업무를 삭제하지 않는다.

## 5. 기간과 요금 계약

정책 ID는 `demo-fee-v1`이다. 주민 물품의 기준 일요금은 500~10,000원, 500원 단위로 seed한다. 다음 계산은 서버가 한다.

```text
billingDays = ceil((endAt - startAt) / 24시간)
B = dailyRateKrw * billingDays
L = max(500, floor(B * 0.8 / 500) * 500)
U = ceil(B * 1.2 / 500) * 500
feeOptions = { LOWER: L, STANDARD: B, UPPER: U }
```

Terra는 세 옵션 중 하나를 반환한다. 모델의 임의 숫자·할인율은 저장하지 않는다. 근거 코드는 `BASELINE/FLEXIBLE_HANDOFF/REGISTERED_EXTRA_EFFORT`다. flexible은 요청자가 선택한 복수 장소/기간의 조율 편의, extra effort는 Item.pricingFacts.registeredExtraEffort=true로 seed에 기재된 운반 부담 등 근거가 있을 때만 사용한다. 초기 추천 근거의 장소 선택 개수는 request.need에서 읽는다. 다른 개인정보·상대 소유자의 가격을 입력하여 차등 가격을 만들지 않는다. 근거가 없거나 AI가 실패하면 STANDARD와 `recommendationSource=BASELINE`을 사용한다.

가격 quote는 서버가 확정한 뒤 불변이며 5분 유효하다. 새 조건을 보낼 때 해당 기간·물품·요청·분기에 맞는 유효 quote가 필요하다. 소유자가 입력한 금액은 L~U의 500원 단위여야 한다. quote의 만료는 이미 저장된 요청 조건이나 승인된 Offer를 취소하지 않는다. 소유자의 APPROVE는 저장된 Terms에 대한 승인이라 새 quote가 필요하지 않다. 새 COUNTER와 최초 submit만 fresh quote를 요구한다. Offer 선택은 별도의 validUntil과 저장된 조건·정책을 검사한다.

기간이 바뀌면 quote를 다시 만들고 총액을 명시적으로 확인한다. 장소만 바뀌어도 제출에 사용할 quote 유효성은 검사하되 금액 범위는 동일하다. public은 `L=B=U`, recommendationSource=PUBLIC_FIXED다. 공공 자동 결과는 제출 시 저장된 요금을 그대로 사용한다.

가격 조회 endpoint는 최대 8초 동안 AI 결과를 기다리고 시간 초과·거부·형식 오류면 기준액 quote를 반환한다. 반환 후 늦은 모델 결과로 quote나 조건을 덮어쓰지 않는다. 계산·모델 추천 결과만 `item+기간+policyVersion+추천근거` 기준으로 캐시한다. 이 입력의 canonical JSON 해시를 conditionsHash로 기록한다. PricingQuote resource는 별도로 requestId+negotiationId+conditionsHash 범위에서 발급/재사용하며 다른 요청·분기의 quote를 반환하지 않는다. 후보 단계의 negotiationId는 null이다. submit은 같은 requestId·itemId의 후보 quote를 새 분기의 초기 Terms에서 참조하고 quote 자체의 필드는 수정하지 않는다. 이후 변경 quote에는 negotiationId가 필수다. 구체 금액의 출처는 모델 아닌 검증된 옵션이다.

## 6. HTTP와 세션

Base URL은 같은 origin의 `/api/v1`이다. JSON UTF-8을 사용한다. ID 조회 실패와 권한 없는 ID 조회는 모두 404를 반환한다. 새 resource 생성은 201, 동기 변경은 200, 작업 접수는 202, 세션 삭제는 204다.

성공 envelope는 `{data:T, meta:{contractVersion:"0.3.0",serverTime:string,traceId:string}}`다. 목록은 `data:{items:T[],nextCursor:string|null}`이며 기본 20개·최대 50개, stable opaque cursor를 쓴다. GET `/sync`만 스냅샷과 이벤트 커서를 추가한다. 날짜와 카운트다운은 serverTime을 기준으로 보정한다.

준비된 handle의 정확한 일치를 검사해 `demo_session; HttpOnly; SameSite=Lax; Path=/` 쿠키를 발급한다. 세션은 8시간, 새 사용자 진입 시 기존 세션을 폐기하고 쿠키를 회전한다. 이 세션은 **사전 데모 계정을 선택하는 장치이며 신원 인증이 아니다**. 다른 사람이 같은 데모 아이디를 입력하면 같은 합성 계정으로 들어갈 수 있다는 한계를 진입 화면에 표시한다.

`POST /demo-sessions`도 허용된 APP_ORIGIN 검사와 속도 제한을 적용한다. 이후 mutation은 세션과 `X-CSRF-Token`을 확인한다. 토큰은 세션 생성 및 `/me` 응답으로 제공한다. CORS는 별도 외부 origin을 허용하지 않는다. 브라우저 프로필을 공유하는 탭은 쿠키를 공유하므로 실제 다자 시연에는 별도 기기/프로필을 사용한다.

### 6.1 endpoint 목록

| 메서드·경로                                | 입력                                                                      | 반환·주체                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| POST `/demo-sessions`                      | `{handle}`                                                                | 201 `{user,csrfToken,sessionExpiresAt}`. 미등록은 422 UNKNOWN_DEMO_ID                              |
| GET `/me`                                  | 없음                                                                      | `{user,csrfToken,sessionExpiresAt}`                                                                |
| DELETE `/demo-sessions/current`            | 없음                                                                      | 204. 자신의 session·SSE·voice 종료                                                                 |
| GET `/places`                              | 없음                                                                      | Place 목록                                                                                         |
| GET `/items`                               | `category?,source?,cursor?,limit?`                                        | Item 요약 목록. 실시간 가용 확정 아님                                                              |
| GET `/items/:id`                           | 없음                                                                      | Item 상세. 공개 seed 데이터                                                                        |
| POST `/requests`                           | `{need:NeedDraft}`                                                        | 201 RequestView, 현재 세션 requester. 빈 초안 가능                                                 |
| PATCH `/requests/:id/draft`                | `{expectedRequestVersion,need}`                                           | DRAFT 또는 MATCHES_READY에서 전체 need 대체, RequestView                                           |
| POST `/requests/:id/search`                | `{expectedRequestVersion}`                                                | 202 `{request:RequestView,taskId}`. 요약 확인 기록과 검색 작업                                     |
| GET `/requests/:id`                        | 없음                                                                      | 요청자만 RequestView                                                                               |
| GET `/requests/:id/candidates`             | 없음                                                                      | 검색 결과 목록. 요청자만                                                                           |
| POST `/requests/:id/submit`                | `{expectedRequestVersion,selections:[{candidateId,quoteId,totalFeeKrw}]}` | 201 RequestView. 1~3개 후보를 원자적으로 전송                                                      |
| POST `/requests/:id/cancel`                | `{expectedRequestVersion}`                                                | RequestView. 선택 전 전체 취소                                                                     |
| POST `/price-quotes`                       | `{requestId,negotiationId:null/string,itemId,startAt,endAt}`              | 200 PricingQuote. 요청자 또는 해당 분기 소유자                                                     |
| GET `/negotiations/:id`                    | 없음                                                                      | 요청자는 분기 상세, 소유자는 OwnerCard                                                             |
| POST `/negotiations/:id/owner-response`    | 6.2절 응답 명령                                                           | 소유자 OwnerCard. 해당 주민 소유자만                                                               |
| POST `/negotiations/:id/requester-counter` | 6.2절 변경 명령                                                           | 요청자 RequestView                                                                                 |
| POST `/negotiations/:id/withdraw`          | `{expectedNegotiationVersion}`                                            | actor에 맞는 RequestView/OwnerCard                                                                 |
| POST `/requests/:id/select`                | 6.2절 선택 명령                                                           | RequestView와 paymentPreview                                                                       |
| GET `/requests/:id/payment-preview`        | 없음                                                                      | 선택된 요청자만 6.3절 PaymentPreview                                                               |
| GET `/inbox`                               | `role=REQUESTER/OWNER,cursor?,limit?`                                     | role에 따른 RequestSummary 또는 OwnerCard 목록                                                     |
| GET `/sync`                                | 없음                                                                      | 8절 사용자별 snapshot+eventCursor                                                                  |
| GET `/events`                              | `after?` 또는 Last-Event-ID                                               | 사용자별 SSE                                                                                       |
| POST `/voice-sessions`                     | `{requestId:string,sdpOffer}`                                             | 201 `{voiceSessionId,sdpAnswer}`                                                                   |
| GET `/voice-sessions/:id`                  | 없음                                                                      | 200 `{inputRevision,turnStatus:WAITING/READY/BLOCKED,taskId,active,completion}` · 현재 데모 세션만 |
| GET `/voice-sessions/:id/completion-audio` | `taskId,inputRevision`                                                    | 200 `{completion,audioWav:null/base64}` · 현재 세션·최신 revision, 일시적 종료 안내 WAV            |
| POST `/voice-sessions/:id/respond`         | `{inputRevision,completionTaskId?}`                                       | 204 · 발화 완료·최신 revision 검사 후 재생 준비 확인                                               |
| POST `/voice-sessions/:id/finish`          | `{expectedRequestVersion,completion?}`                                    | 202 `{taskId}` · 통화 종료 후 신청서 저장·조회                                                     |
| DELETE `/voice-sessions/:id`               | 없음                                                                      | 204, 현재 세션 소유 음성만 종료                                                                    |
| POST `/agent-turns`                        | `{requestId,text,expectedRequestVersion}`                                 | 202 `{taskId}`. 텍스트 대체 입력 1~2,000자                                                         |
| GET `/tasks/:id`                           | 없음                                                                      | 사용자에게 허용된 AgentTask와 `result`                                                             |

price-quotes에서 negotiationId가 있으면 requestId·itemId가 그 분기와 일치하고 현재 세션이 당사자인지 검사한다. negotiationId가 없으면 요청자만 자신의 MATCHES_READY 후보 item에 대해 호출할 수 있다. 검색 worker의 초기 가격 생성은 내부 경로로 수행한다. 다른 물품·분기의 quote를 승인 명령에 사용할 수 없다.

음성 연결·조회·양식 미리보기는 대여 상태 mutation이 아니다. 센터 전용 신청/공간 예약/회원인증/결제 POST endpoint는 만들지 않는다. 센터 콘텐츠는 버전이 붙은 정적 JSON으로 제공한다.

### 6.2 조건 명령의 공통 형식

모든 아래 명령은 Idempotency-Key header가 필수다. owner-response의 action은 `APPROVE/DECLINE/COUNTER`다. APPROVE/DECLINE은 `terms=null`, COUNTER는 완전한 Terms가 필수다. requester's counter도 patch가 아닌 완전한 Terms를 제출한다. DECLINE은 reasonCode가 필수이고 나머지는 선택 사유 코드만 받는다.

```json
{
  "action": "COUNTER",
  "expectedNegotiationVersion": 2,
  "expectedTermsRevision": 1,
  "terms": {
    "startAt": "2026-11-07T01:00:00Z",
    "endAt": "2026-11-08T07:00:00Z",
    "placeId": "place-library",
    "totalFeeKrw": 4500,
    "currency": "KRW",
    "quoteId": "quote_example"
  },
  "reasonCode": "PRICE_ADJUSTMENT"
}
```

소유자 사유 enum은 `SCHEDULE_ADJUSTMENT/PLACE_ADJUSTMENT/PRICE_ADJUSTMENT/UNAVAILABLE/OTHER_CONDITION`다. requester-counter는 action 없이 동일한 expected 필드와 terms·reasonCode를 쓴다. 사유 코드로 임의 대화나 연락처를 전달하지 않는다.

최종 선택은 정확한 Offer와 조건을 확인한다. 다른 소유자 응답으로 비교 목록이 바뀌어 requestVersion이 달라지면 최신 목록을 다시 보여준다.

```json
{
  "expectedRequestVersion": 8,
  "negotiationId": "neg_example_b",
  "expectedNegotiationVersion": 3,
  "offerId": "offer_example_b_2",
  "termsRevision": 2,
  "acknowledgeCloseOtherBranches": true
}
```

`submit`은 화면에 제시된 후보와 추천/수정 금액을 명시적으로 전달한다. candidate의 suggestedTerms 기간·장소와 quote가 일치해야 한다. 최초 장소·기간을 바꾸려면 초안을 수정하거나 조율 단계로 이동한다. 초기 suggestedTerms의 기간은 확인된 need와 같고 장소는 preferredPlaceIds 순서에서 Item.allowedPlaceIds와 처음 일치하는 장소다. 교집합이 없으면 선택 불가 후보로 표시한다. 후보 중 하나라도 잘못되면 전체 submit을 실패시키고 `details.candidateErrors`를 반환한다. 부분 전송 후 UI가 전부 성공했다고 오인하게 하지 않는다.

### 6.3 결제 화면 응답

```json
{
  "mode": "PREVIEW_ONLY",
  "requestId": "req_example",
  "negotiationId": "neg_example_b",
  "offerId": "offer_example_b_2",
  "termsRevision": 2,
  "totalFeeKrw": 4500,
  "currency": "KRW",
  "chargeable": false,
  "paymentStatus": "NOT_APPLICABLE",
  "demoHoldStatus": "ACTIVE",
  "demoHoldExpiresAt": "2026-11-06T10:10:00Z",
  "notice": "실제 결제와 예약이 이루어지지 않습니다."
}
```

응답에는 선택한 물품 요약과 Terms도 포함한다. `데모 확인 완료`는 화면 이동만 수행한다. `/payments`, 결제 토큰, PG webhook, `PAID/RENTED/RETURNED/REWARDED` 상태를 정의하지 않는다.

## 7. 오류와 재시도

오류 envelope는 아래 형식이다. `details`는 코드별 구조이며 사용자에게 내부 stack·키·원문 프롬프트를 노출하지 않는다.

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "조건이 변경됐어요. 최신 제안을 확인해 주세요.",
    "retryable": false,
    "details": { "currentRequestVersion": 9, "currentNegotiationVersion": 4 }
  },
  "meta": {
    "contractVersion": "0.3.0",
    "serverTime": "2026-11-06T10:00:00Z",
    "traceId": "trace_example"
  }
}
```

| HTTP | code                                                                                        | 화면·호출자 행동                                           |
| ---- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 400  | BAD_REQUEST                                                                                 | JSON·필드 형태 수정                                        |
| 401  | SESSION_EXPIRED                                                                             | 아이디 진입으로 이동. 요청 데이터 삭제 안 함               |
| 403  | CSRF_REJECTED                                                                               | /me 갱신 후 사용자가 다시 실행                             |
| 404  | NOT_FOUND                                                                                   | 접근 불가 또는 존재하지 않음                               |
| 409  | VERSION_CONFLICT                                                                            | snapshot 재조회, 최신 조건 다시 확인                       |
| 409  | INVALID_STATE / ALREADY_SELECTED                                                            | 현재 상태로 이동, 자동 재시도 금지                         |
| 409  | AVAILABILITY_CONFLICT                                                                       | 해당 분기 UNAVAILABLE로 반영, 다른 제안 비교               |
| 409  | QUOTE_EXPIRED / IDEMPOTENCY_KEY_REUSED                                                      | 새 quote 확인 / 잘못 재사용한 키 수정                      |
| 410  | REQUEST_EXPIRED / OFFER_EXPIRED                                                             | 종료 안내, 새 요청 가능                                    |
| 422  | VALIDATION_ERROR / UNKNOWN_DEMO_ID / PRICE_OUT_OF_RANGE / CHANGE_LIMIT_REACHED / NO_CHANGES | 해당 입력과 한도 안내                                      |
| 429  | RATE_LIMITED                                                                                | Retry-After에 따라 기다린 뒤 명시적 재시도                 |
| 503  | AI_UNAVAILABLE / TEMPORARILY_UNAVAILABLE                                                    | 기존 저장 상태 유지. 텍스트·기준 가격 fallback 또는 재시도 |

네트워크 오류로 응답을 못 받으면 **같은 키·같은 body**로 조회/재전송한다. 새 키로 동일 동작을 자동 재전송하지 않는다. 화면의 낙관적 표시는 대기까지만 가능하며 승인·선택 성공은 commit된 응답 이후 표시한다.

## 8. 인앱 이벤트와 복구

SSE는 업무 상태 갱신용이며 음성 오디오 전송용이 아니다. `/sync`는 현재 사용자의 요청 요약·소유자 카드·작업·`eventCursor`를 동일 DB 스냅샷 기준으로 반환한다. 상세 화면은 RequestView를 다시 읽는다. 이벤트 cursor는 사용자별 단조 증가 정수의 문자열이며 보존 기간은 24시간이다.

```text
id: 108
event: negotiation.updated
data: {"eventId":"108","eventVersion":1,"type":"negotiation.updated","requestId":"req_example","requestVersion":8,"negotiationId":"neg_example_b","negotiationVersion":3,"occurredAt":"2026-11-06T10:00:00Z","reason":"OWNER_COUNTERED"}
```

공통 payload는 `eventId,eventVersion,type,occurredAt,requestId?,requestVersion?,negotiationId?,negotiationVersion?,taskId?,reason?`다. 이벤트는 invalidation 신호이며 전체 요청·다른 소유자의 조건·음성 원문을 담지 않는다. 소유자 이벤트에서는 전체 requestVersion을 생략하고 자기 분기의 negotiationVersion만 보낼 수 있다.

| event type          | 의미·프론트 처리                                     |
| ------------------- | ---------------------------------------------------- |
| request.updated     | 자신의 요청 snapshot 재조회                          |
| negotiation.created | 소유자 요청함 새 카드 조회                           |
| negotiation.updated | 권한에 맞는 분기·비교 snapshot 갱신                  |
| agent.task.updated  | task 조회, 진행/오류/결과 표시                       |
| demo_hold.expired   | 결제 미리보기의 점유 표시 갱신                       |
| session.revoked     | SSE 종료, 사용자별 cache 비우고 진입 화면            |
| sync.required       | cursor 손실·기한 경과. 연결 닫고 /sync부터 다시 시작 |

동일 트랜잭션에서 생성되는 event cursor는 사용자별 순서를 직렬화해 commit 이전 번호가 나중에 도착하는 누락을 막는다. `/sync`의 cursor는 같은 스냅샷에 보이는 마지막 commit 이벤트다. 클라이언트는 그 이후부터 `/events?after=cursor`를 연결한다. 재연결 시 Last-Event-ID를 사용하고 둘 다 있으면 header를 우선한다.

중복 eventId는 버린다. 새로운 eventId라도 snapshot보다 낮은 version이면 상태를 되돌리지 않는다. 연결 유지를 위해 15초마다 named event `heartbeat`와 `{serverTime}`을 보내고, 전경에서 마지막 수신 후 30초 이상 무응답이면 재연결한다. heartbeat는 비영속 이벤트로 id를 붙이지 않고 업무 cursor를 바꾸지 않는다. EventSource에서 보이지 않는 comment만으로 watchdog을 구현하지 않는다. SSE 실패 시 전경에서만 5초 polling으로 제한적으로 대체한다. 앱 복귀·사용자 전환 시 전체 sync를 수행한다. 사용자 전환 때 query cache·이전 음성·이전 SSE를 모두 정리한다.

## 9. 동시성·점유·지속 작업

세션 생성 이외의 모든 mutation은 `(sessionId,HTTP method,실제 resource 경로,Idempotency-Key)`와 actorUserId·body hash를 저장한다. route template의 :id가 아닌 실제 ID 포함 경로를 사용한다. POST /demo-sessions는 아직 세션이 없으므로 이 규칙의 예외이며 재시도 시 새 세션을 발급하고 이전 쿠키를 회전한다. 중복 진입은 대여 업무를 생성하지 않는다. 같은 키·같은 body는 최초 commit 응답을 재현하고, 같은 키·다른 body는 409다. 키 결과는 최소 24시간 보존한다. 종료된 세션이나 다른 아이디에는 재현하지 않는다. 중복 결과 재현은 version 검사보다 먼저 수행하되 세션·권한은 항상 먼저 확인한다.

모든 업무 mutation은 request → 영향받는 negotiation ID 정렬 → item ID 정렬 → 이벤트 수신자 ID 정렬 순서로 잠근다. owner-response·select·취소·만료·공공 worker도 같은 순서를 따른다. 소유자 응답은 부모 request를 잠근 뒤 활성 여부와 해당 negotiation을 검사한다. 서로 다른 분기의 DB commit은 짧게 직렬화하되 다른 분기 응답 때문에 VERSION_CONFLICT가 나지 않게 expectedNegotiationVersion만 요구한다. 요청자의 최종 select는 비교 결과가 바뀌지 않았는지 expectedRequestVersion도 요구한다.

선택 트랜잭션의 순서는 다음과 같다.

1. request 행 잠금 → selected가 없음, root 활성, requestVersion 일치 확인.
2. 선택된 negotiation·Offer의 ID·version·termsRevision·소유자 승인·validUntil 확인.
3. item 행 잠금 → 종료된 DemoHold를 만료 처리 → enabled·허용 장소·자격·정비/불가 일정과 겹치는 ACTIVE hold 확인.
4. `[startAt,endAt)`가 겹치는 활성 점유가 없으면 10분 DemoHold 생성. 선택되지 않은 원래 Offer만으로는 점유하지 않는다.
5. 선택 branch=SELECTED, root=PAYMENT_PREVIEW_READY, 다른 활성 branch=SUPERSEDED. 기존 거절/만료 이력은 유지.
6. root/branch version, 이벤트·outbox를 함께 commit하고 응답.

별도 request들이 같은 물품을 선택해도 item 잠금을 동일 순서로 잡아 한 건만 성공한다. 모든 점유 생성/해제 경로는 이 잠금 규칙을 사용한다. 재고 충돌이면 branch=UNAVAILABLE와 알림을 commit하고 409를 반환한다. 다른 유효 제안이 있으면 root는 COLLECTING_OFFERS를 유지한다. 대여 시작 시각이나 소유자 자격이 바뀌어도 선택 단계에서 다시 검사한다.

DemoHold 만료는 결과 요약을 삭제하거나 결제 성공으로 전이시키지 않는다. 만료된 선택을 재사용해 다시 점유하지 않는다. SELECTED 이후 취소/재협상은 이번 범위에 포함하지 않으며 새 요청으로 시험한다.

상태 변경·작업 outbox·이벤트는 같은 트랜잭션에 기록한다. outbox dispatcher가 pg-boss로 전달하고 중복 전달을 허용한다. 작업 효과의 키는 `(taskId,step,canonicalHash(inputVersion))`이고 동일 효과를 한 번만 commit한다. inputVersion은 10.2절의 작업별 입력 참조 구조이며 단일 root version 숫자가 아니다. worker는 시작·종료 시 root의 종료 여부와 작업 종류에 해당하는 입력 참조를 확인해 취소·만료·실제 입력 변경 후 도착한 결과를 폐기한다. 다른 분기 응답이나 작업 상태 표시만으로 자신의 결과를 폐기하지 않는다.

네트워크/429/5xx 작업은 최초 포함 최대 3회, 1초·4초 간격과 jitter로 재시도한다. 기간·금액 검증 실패나 사용자 거절은 재시도하지 않는다. 가격 조회는 5절의 8초 제한과 fallback이 우선이다. 설명 생성 실패는 이미 저장된 승인·제안을 롤백하지 않고 서버 템플릿 문장으로 표시한다. 검색 자체가 실패하면 FAILED이고, 공개 어댑터 작업 실패는 해당 분기 UNAVAILABLE/`PUBLIC_DEMO_ERROR`로 구분한다.

## 10. OpenAI와 앱 내부 AI 계약

선정 모델은 음성 `gpt-live-1`, 조율 `gpt-6.1-terra`, 빠른 분류 `gpt-6-luna`다. 환경 변수는 `OPENAI_VOICE_MODEL`, `OPENAI_AGENT_MODEL`, `OPENAI_DECISION_MODEL`로 분리한다. 아래 내부 타입은 OpenAI wire schema와 다르며 AI 어댑터가 변환한다. [모델과 공식 근거](research/openai-models.md)

### 10.1 실시간 음성 연결

음성 시작 전에 빈 POST /requests 또는 기존 요청 조회로 requestId를 확보한다. requestId=null로 음성을 만들지 않는다. 사용자 버튼 → 마이크 권한 → WebRTC와 data channel 리스너 준비 → SDP offer → 앱 POST `/voice-sessions` → 서버의 OpenAI `POST /v1/live/sessions` 순서다. 외부 생성 요청에 `session.model=gpt-live-1`, `session.delegation={type:"client"}`, `transport={type:"webrtc",sdp:offer}`를 사용한다. 반환되는 `session.id`를 내부 voiceSessionId에 매핑하고 `transport.sdp`를 sdpAnswer로 반환한다. HTTP 생성 후 data channel로 `session.start`를 중복 전송하지 않는다. [공식 WebRTC 연결](https://developers.openai.com/api/docs/guides/voice-webrtc)

서버는 `wss://api.openai.com/v1/live/sessions/{session_id}/attach`에 sideband로 연결한다. 서버만 위임·도구를 실행한다. 브라우저는 입력 오디오·출력 재생·자막 표시를 담당하며 OpenAI 프로젝트 키를 받지 않는다. 외부 session.id는 원문 그대로 보존하고 일반 API 응답에서는 내부 voiceSessionId로 감싼다. sideband 연결에 실패하면 생성 세션을 닫고 503으로 처리한다. session.started와 서버 준비를 확인하기 전 오디오 전송·앱 위임 명령을 시작하지 않는다. 소유자 화면 버튼은 음성 연결이 없어도 작동한다. [서버 제어](https://developers.openai.com/api/docs/guides/voice-server-controls)

`session.started`, `session.input_transcript.delta`, `session.output_transcript.delta`, `session.delegation.created`, `session.closed`를 어댑터에서 처리한다. delegation 이벤트는 task text 전체가 아니므로 서버가 발화 조각과 현재 DB 상태로 입력을 구성한다. 중간 자막과 “네”만으로 submit/approve/select를 실행하지 않는다. 결과 설명은 `session.commentary.append`, 조용한 사실 전달은 `session.thinking.append`로 보낸다. 전달 payload는 `{type,event_id,delegation_id,content}`로 구성하며 event.delegation.id의 원본 ID를 연결한다. 일반 문맥은 delegation_id=null로 보낸다. 새 Live 세션에는 이전 세션의 delegation_id를 재사용하지 않고 DB 요약을 일반 문맥으로 전달한다. append 수신 확인은 발화 완료나 업무 성공이 아니다. [위임](https://developers.openai.com/api/docs/guides/live-delegation), [대화 관리](https://developers.openai.com/api/docs/guides/live-conversations)

앱 내부 voice는 최대 10분, 또는 사용자·AI 발화와 안내 재생이 모두 없는 상태가 60초 지속되면 종료하도록 설계한다. 이 수치는 데모 비용·세션 관리 정책이며 모델 자체 한도가 아니다. 종료 명령은 session.close를 보내고 session.closed를 최대 15초 기다린 뒤 transport를 정리한다. 마이크 track은 종료 조작 즉시 멈춘다. 확인 실패는 종료 미확인으로 기록하고 서버가 연결과 세션을 정리한다. 앱 강제 종료도 서버 연결 감지와 idle 종료 정책으로 수습한다. 연결 손실은 RECONNECT_REQUIRED로 표시하고 사용자 동작으로 새 세션을 만든다. root/branch 상태는 DB에 남는다. 공식 SDK 버전과 실제 계정 접근은 구현 첫 관문에서 확인한다.

### 10.2 AI task 입출력

공통 task 입력은 `{taskId,kind,actorUserId,requestId,negotiationId,inputVersion,locale:"ko-KR",timeZone:"Asia/Seoul",serverNow,context}`다. actorUserId는 서버가 주입하며 외부 사용자 텍스트에서 받지 않는다. AI 결과는 `{taskId,kind,inputVersion,result}`다. 참조 ID·입력 버전이 아래 기준과 다르면 저장하지 않는다. inputVersion은 종류별 객체로 직렬화하며 root version을 모든 task에 일괄 적용하지 않는다.

| 작업           | inputVersion 구조·검사                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| ROUTE_INTENT   | `{kind:"TURN",turnId}`. 해당 대화의 최신 처리 대상 turn인지 검사                                                 |
| EXTRACT_NEED   | `{kind:"NEED",needRevision,turnId}`. 같은 초안·최신 turn에만 제안 표시                                           |
| SEARCH         | `{kind:"NEED",needRevision}`. 확인한 요구 버전이 유지되는지 검사                                                 |
| PUBLIC_SUBMIT  | `{kind:"TERMS",negotiationId,termsRevision}`. 해당 분기가 PENDING_PUBLIC인지 검사                                |
| RECOMMEND_FEE  | `{kind:"FEE",conditionsHash,policyVersion}`. immutable quote 입력과 deadline 검사                                |
| EXPLAIN_TERMS  | `{kind:"NEGOTIATION",negotiationId,negotiationVersion,termsRevision}`. 해당 분기만 검사                          |
| COMPARE_OFFERS | `{kind:"COMPARE",offers:[{negotiationId,offerId,termsRevision}]}`. 정렬된 최신 유효 Offer 집합과 일치하는지 검사 |

| kind           | 입력 context                             | 검증된 result                                                                |
| -------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| ROUTE_INTENT   | 입력 문장·현재 화면·허용 경로            | `{intent:RENTAL_REQUEST/CHANGE_CONDITIONS/STATUS_QUERY/CENTER_INFO/UNCLEAR}` |
| EXTRACT_NEED   | 발화·현재 draft·서버 날짜·장소 후보      | `{proposedNeed,missingFields,clarificationQuestion:null/string}`             |
| RECOMMEND_FEE  | item·기간·LOWER/STANDARD/UPPER·허용 근거 | `{feeOptionId,reasonCode,reasonText}`. 금액 직접 출력 없음                   |
| EXPLAIN_TERMS  | 해당 분기 old/new terms                  | `{summary,changedFields}`                                                    |
| COMPARE_OFFERS | 요청자에게 허용된 최신 Offer 배열        | `{summary,rows:[{negotiationId,termsRevision,explanation}]}`                 |

EXTRACT_NEED는 불완전한 조건을 null로 남기고 DB draft를 직접 제출하지 않는다. `/tasks/:id`의 result로 요약 제안을 보여준 뒤 프론트가 PATCH draft를 명시적으로 요청한다. 음성 요약도 같은 경로를 쓴다. 자연어만 입력한 상태로 후보 전송이 일어나지 않는다.

Decisions API의 `POST /v1/decisions`에는 고정 choices와 고유 question name을 사용하고 `answers`를 name으로 매칭한다. refusal·알 수 없는 값·시간 초과는 UNCLEAR 또는 Terra 보완 질문으로 처리한다. 승인 버튼은 재분류하지 않는다. Terra의 `POST /v1/responses`는 Structured Outputs로 위 result를 받는다. [Decisions](https://developers.openai.com/api/docs/guides/decisions), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)

### 10.3 AI 도구와 권한

| 내부 도구                 | 입력                       | 반환                    | 허용 효과             |
| ------------------------- | -------------------------- | ----------------------- | --------------------- |
| `read_request`            | requestId                  | actor 권한의 projection | 읽기                  |
| `search_inventory`        | 확인된 need·requestVersion | 검증된 후보             | 검색 작업 내부 읽기   |
| `propose_request_summary` | proposedNeed·inputVersion  | 요약 후보               | 사용자 확인용 결과만  |
| `recommend_fee`           | quote context              | 옵션 ID·이유            | quote 후보, 서버 계산 |
| `explain_terms_diff`      | negotiationId·revisions    | 변경 설명               | 설명 저장             |

AI 도구에 owner-response·select·payment·DB SQL·임의 URL 호출 권한을 주지 않는다. 실제 요청 전달은 명시적으로 승인된 submit command 후 서버 상태 기계가 수행하고, AI가 전달 문구와 후속 조율을 맡는다. 물품 설명·주민 발화는 신뢰할 수 없는 데이터로 취급해 프롬프트의 권한 규칙을 바꾸지 못하게 한다. 실패 시 서버 템플릿으로 카드가 유지되며 모델 성공 여부 때문에 소유자의 실제 응답을 잃지 않는다.

원시 음성은 앱 서버 영구 저장 대상이 아니다. Live 자막의 임시 문맥은 세션 종료 후 폐기하고, 선택된 구조화 요구·조건·사용자 행동·간결한 결과만 데모 DB에 보존한다. 외부 공급자의 로그/보관 설정은 계정별로 확인하며 앱 정책과 동일하다고 가정하지 않는다.

## 11. 공공 데모 어댑터와 센터 화면

`PublicInventoryAdapter.search(need)`는 공공 seed Item을 반환하고 `submit(application)`은 `PENDING_PUBLIC` 작업을 만든다. worker는 1~2초 시연 지연 후 eligibility·enabled·기간·장소·publicScenario를 확인한다. 승인 시 `endorsedBy=PUBLIC_DEMO`의 Offer, 거절 시 `closedReason=PUBLIC_DEMO_DECLINED`를 저장한다. externalApplicationId 대신 `demoApplicationId`를 사용한다. 이 값은 실제 센터 접수번호로 표시하지 않는다.

주민 소유자는 seed만 하고 응답은 자동화하지 않는다. 연구용 테스트 fixture가 응답을 주입하는 경우 automated-test 모드에서만 사용하며 대면 시연의 실제 참여 흐름과 구분한다.

센터 화면 데이터는 `CenterContent={id,type,title,summary,body,images,sourceUrl,isDemo,updatedAt}`를 기본으로 한다. type은 `ABOUT/PROGRAM/CLUB/SPACE/NOTICE/PRESS/GALLERY/GUIDE`다. 프로그램·공간 등의 필요한 표시 필드는 콘텐츠별 정적 확장으로 두고 대여 API에 섞지 않는다. 관심·양식 미리보기는 탭 내 메모리 상태이며 종료하면 초기화한다. 실제 신청내역 조회라고 표현하지 않는다.

## 12. 디자인 토큰·에셋·화면 계약

프론트는 PRD의 색 토큰·한국어 날짜·통화 규칙과 React Aria의 접근성 동작을 사용한다. 공통 에셋 metadata는 `{id,src,width,height,alt,decorative,license,creator,format,byteSize}`다. 장식 SVG는 접근성 트리에서 제외하고 물품 이미지는 대체텍스트를 제공한다. 에셋 URL은 로컬 빌드 정적 경로로 관리하며 외부 이미지 핫링크에 시연을 의존하지 않는다.

server의 상태 enum과 버튼 의미는 고정한다. UI 라벨·수채화 표현은 상태 의미를 바꾸지 않는 범위에서 개선할 수 있다. `OFFERED`는 `조건 도착`, `SELECTED`는 `선택됨`, root `PAYMENT_PREVIEW_READY`는 `결제 화면 준비 완료`로 표시한다. `대여 확정`, `결제 완료`로 바꾸지 않는다.

비교 정렬은 선택 가능한 최신 Offer 우선 → 원래 요구 기간/장소 일치 우선 → totalFeeKrw 오름차순 → Offer createdAt 오름차순이다. 대기·거절 분기도 끝에 상태를 남긴다. 거리·평점·신뢰도를 실제 데이터 없이 계산하지 않는다. 사용자가 선택하기 전 자동 선택을 하지 않는다.

## 13. 작업 분담과 변경 관리

| 산출 책임 | 독립 구현 범위                                                     | 다른 영역에 제공할 것                                 |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| 프론트    | PRD 화면·PWA·마이크·자막·소유자 카드·다자 비교                     | API 호출 규격 준수, fixture 기반 화면, 기기 시험 기록 |
| 서버      | 스키마·마이그레이션·세션·권한·상태·가격 계산·SSE·queue·공공 어댑터 | OpenAPI/JSON Schema, seed·오류 사례, mock과 동일 응답 |
| AI        | Live/Responses/Decisions 어댑터·추출·추천·비교 설명·한국어 평가    | strict output schema·정상/실패 fixture·모델 설정      |
| 공동      | contracts 버전·정합성·로컬 실행·통합 시연                         | 하나의 승인된 계약과 재현 가능한 시연 절차            |

계약 우선순위는 이 문서의 구조화 규칙 → 예시 → 연구 문서 순서다. 예시의 ID·날짜는 설명용이며 운영 값이 아니다. 구현 시작 시 이 정의를 `packages/contracts`의 타입과 OpenAPI로 옮기고 mock/서버/AI schema를 거기서 생성한다. 현재 산출물에는 별도의 실행 가능한 스키마 파일을 만들지 않았다.

상태·필수 필드·명령 의미를 바꾸면 계약 버전을 올리고 세 영역을 함께 갱신한다. 새 optional 표시 필드는 하위 호환 변경이다. 미지의 enum을 프론트가 승인으로 처리하지 않고 `상태 확인 필요`로 표시한다. 모델 ID 교체는 AI 설정·근거·평가 기록을 함께 갱신한다.

## 14. 공통 데모 fixture

`D`는 seed 실행일의 서울 날짜다. 기본 요청 기간은 D+2 10:00부터 D+3 16:00까지 30시간이다. 저장 시 UTC로 변환한다. 각 요청은 quantity=1이다.

| 사용자 ID / handle | 가명 | 소유 물품                            |
| ------------------ | ---- | ------------------------------------ |
| u_hana / demo-hana | 하나 | res-tool-hana, res-case-hana         |
| u_duri / demo-duri | 두리 | res-projector-duri, res-cleaner-duri |
| u_seul / demo-seul | 슬   | res-projector-seul, res-case-seul    |
| u_jun / demo-jun   | 준   | 없음. 경쟁 요청자 역할               |

| 물품 ID            | source·분류       | 일요금 | 주요 fixture                 |
| ------------------ | ----------------- | ------ | ---------------------------- |
| pub-projector      | PUBLIC·HOBBY      | 1,500  | APPROVE, place-center        |
| pub-cleaner        | PUBLIC·CLEANING   | 1,000  | APPROVE, place-center        |
| pub-ladder         | PUBLIC·TOOLS      | 500    | DECLINE, 공공 거절 시험      |
| pub-case           | PUBLIC·TRAVEL     | 1,000  | 기간 불가 block              |
| res-projector-duri | RESIDENT·HOBBY    | 2,000  | 비교 분기 B, center/library  |
| res-cleaner-duri   | RESIDENT·CLEANING | 1,000  | 주민 일반 흐름               |
| res-projector-seul | RESIDENT·HOBBY    | 1,500  | 비교 분기 C, station/library |
| res-case-seul      | RESIDENT·TRAVEL   | 1,000  | 비활성 item fixture          |
| res-tool-hana      | RESIDENT·TOOLS    | 1,000  | 하나가 소유자로 참여 가능    |
| res-case-hana      | RESIDENT·TRAVEL   | 1,000  | 자기 물품 요청 제외 시험     |

장소 ID는 `place-center/place-station/place-library`이며 표의 축약명도 이 ID를 뜻한다. 모든 사용자는 기본 demoEligible=true다. 별도 `ineligible` seed 시나리오에서 준만 false로 바꾼다. 공개 대여 장소 사용을 실제로 허가받았다는 의미가 아니다.

기본 다자 흐름은 하나 요청 → 두리·슬·공공 프로젝터 3개 전송 → 공공 3,000원 제안, 두리 4,500원·library로 변경, 슬 3,000원·station 제안 → 하나가 각 기간·장소·금액 비교 → 두리 제안 선택 → 두리 SELECTED, 슬·공공 SUPERSEDED → 4,500원 결제 미리보기다. 공공 center와 슬 station 중 어느 장소가 원래 선호인지에 따라 비교 차이를 표시한다.

`expiry-fast`는 root/응답 90초·Offer 30초·hold 30초로 줄이는 개발 seed 시나리오다. 일반 정책과 혼동하지 않게 앱 상단에 `빠른 만료 시연`을 표시한다. 개발 명령으로 fixture를 재적재하며 앱에 관리자 reset 버튼·공개 초기화 endpoint를 만들지 않는다.

## 15. 수용 시나리오

아래는 구현 후 수행할 테스트 계약이다. 이번 문서 작업에서 실행 완료한 앱 테스트가 아니다.

| ID   | 실행                                                | 기대 결과                                                  |
| ---- | --------------------------------------------------- | ---------------------------------------------------------- |
| AT01 | 준비된/미등록 아이디 진입                           | 준비된 사용자만 세션 생성, 신원인증 완료로 표시 안 함      |
| AT02 | 한국어 상대 날짜·누락 장소로 음성 요청              | 확인 질문·절대 날짜 요약, 확인 전 전송 0건                 |
| AT03 | 공공 프로젝터 선택·신청 확인                        | 공공 데모 승인→비교→결제 화면. 실제 접수번호 없음          |
| AT04 | 서로 다른 실제 사용자 3명으로 주민 분기 두 개 응답  | 각 소유자의 카드만 보임, 요청자는 두 제안과 대기 상태 비교 |
| AT05 | 한 소유자 거절, 다른 소유자 승인                    | 전체 거절로 전이하지 않고 남은 제안 선택 가능              |
| AT06 | 소유자 변경→요청자 다시 변경→소유자 승인            | 버전 증가·이전 Offer 무효·가격 재산출·재확인               |
| AT07 | 요청자가 정확한 Offer 하나 선택                     | 단일 선택·점유·다른 활성 분기 종료가 함께 commit           |
| AT08 | A 아이디로 B 소유자 승인 API 호출                   | 404, 상태·이벤트 변경 없음                                 |
| AT09 | 오래된 version·termsRevision·만료 quote/Offer 전송  | 해당 오류, 새 snapshot/quote 확인 필요                     |
| AT10 | 같은 키로 submit/select 재전송                      | 최초 응답 재현, 중복 분기·점유 0건                         |
| AT11 | 다른 키/두 기기에서 같은 요청의 다른 제안 동시 선택 | 한 선택만 성공, 나머지는 충돌                              |
| AT12 | 두 요청자가 같은 item·겹친 기간 동시 선택           | 한 hold만 생성, 패자는 UNAVAILABLE 후 다른 후보 비교       |
| AT13 | 음성 종료·앱 닫기→소유자 응답→요청자 복귀           | DB 상태·조건·비교 복원, 음성은 새 사용자 동작으로 재연결   |
| AT14 | SSE 중복·누락·cursor 만료·사용자 전환               | 버전 역행 없음, 재동기화, 다른 사용자 cache 노출 없음      |
| AT15 | AI 가격 오류·타임아웃·없는 옵션 반환                | 기준금액 fallback, AI추천으로 오표시 안 함                 |
| AT16 | 모델이 승인·결제 완료를 출력                        | 업무 상태 변경 없음, 서버 카드가 기준                      |
| AT17 | worker 재시작·outbox 중복·취소 후 늦은 결과         | 미완료 재개, 효과 중복·취소 복구 없음                      |
| AT18 | 후보 없음·전부 거절·무응답 기한 초과                | NO_MATCH/NO_OFFERS/EXPIRED 구별, 자동 승인 없음            |
| AT19 | 결제 화면 버튼·점유 만료                            | 실제 청구·PG 요청 없음, NOT_APPLICABLE 유지                |
| AT20 | 센터 프로그램/동아리/공간 미리보기                  | 실제 접수 API 없음, 허위 신청 완료 표시 없음               |
| AT21 | 갤럭시·아이폰 실제 접속                            | 마이크·오디오·브라우저/설치 모드 흐름 통과                |
| AT22 | 마이크 거부·오프라인·잠금·키보드·스크린리더         | 텍스트 대체/복구 안내, 조작·상태 식별 가능                 |

AT04·07·11·12는 다자 모델의 필수 통합 검증이다. AT21에서 OS·브라우저를 기록한다. 로컬 단일 PC의 브라우저 mock 통과만으로 실제 다중 기기·음성 완료를 선언하지 않는다.

## 16. 음성 QA 개정 (0.2.0)

- 통화는 상담형 채팅 UI와 신청서(물품, 시작·종료 시각, 장소, 선택 예산) 수집 단계다. 실시간 추출 결과는 미확정 제안이며 통화 중 재고 조회·주민 전송·예약 처리를 하지 않는다. 서버가 현재 통화에서 완료한 taskId를 전달하므로 임의 ID 순서를 최신 순서로 해석하지 않는다.
- 첫 인사는 Live `session.input` developer 메시지와 한 번의 `session.commentary.append`로 요청한다. append 수신 확인을 실제 재생 성공으로 간주하지 않는다.
- 입력이 안정된 뒤 `gpt-6-luna` Decisions로 발화 완료와 범위를 판단한다. 새 입력이 오면 이전 판단·추출 결과를 버린다. WAIT·실패 때는 재생과 작업을 열지 않는다. 브라우저 마이크 음량 관측도 재생을 즉시 차단한다. 실제 사람 음성에서 끼어들기·지연은 별도 검증한다.
- `통화 종료·조회` 버튼은 종료 후 신청서 저장 및 검색을 요청하는 명시적 사용자 명령이다. 서버가 보관한 발화만 사용하며 `finish` body에서 발화·도구·권한 플래그를 받지 않는다. 요청 버전·세션·CSRF·멱등성을 검사한다. 같은 음성 세션의 완료 작업은 하나다. 일반 DELETE·연결 손실·모델 발화는 검색을 시작하지 않는다.
- 종료 후 EXTRACT_NEED 작업은 DB 큐에 남아 브라우저 이탈 후에도 진행된다. 서버 전용 `finalizeAfterCall` 표식이 있을 때만 최신 결과를 초안에 저장한다. 필수 항목·기간 검사가 통과하면 서버 명령으로 SEARCHING에 진입한다. 부족한 정보는 DRAFT로 남겨 요청함에서 보완한다. 다른 화면에서 수정한 초안을 늦은 결과가 덮어쓰지 않는다.
- 따라서 음성 흐름에서는 §4·§10의 별도 요약 확인 화면을 종료·조회 버튼과 실시간 신청서가 대체한다. 텍스트 입력 흐름은 기존 확인을 유지한다. 승인·선택·결제·주민 전송은 여전히 사용자 명령이며 모델에 권한을 주지 않는다.
- 조회는 물품명 일치와 명시적인 동의어를 확인한 뒤 카테고리·기간·장소·자격을 적용한다. 드라이버를 사다리나 구성 미상의 공구 세트로 대체하지 않는다. 일치 물품이 없으면 NO_MATCH다.
- 결과 알림은 기존 SSE와 REST snapshot에서 복원하는 앱 안 알림과 요청함이다. 푸시·SMS는 추가하지 않는다. 원시 음성은 저장하지 않으며, 통화 중 작업 입력은 종료 시 지우고 종료 후 작업 입력은 완료 또는 최대 615초 정리에서 지운다.
- 서비스 밖 요청과 프롬프트·키·타인 정보·도구·승인 권한 우회는 거절하고 신청서 수집으로 안내한다. 프롬프트 규칙 외에 서버 작업 허용 범위·버전·권한 검사를 유지한다.

## 17. 에이전트 역할 분리·수집 완료 자동 종료 (0.3.0)

이 절은 §16의 버튼 전용 종료 조건을 확장한다. 업무 상태 기계·요금·승인·선택·결제·주민 전송 규칙은 유지한다. 화면을 추가하지 않는다.

- 역할은 `packages/ai/src/agents/definitions.ts`에서 프롬프트 버전·모델 설정 키·결과 스키마·시간 한도·실패 정책을 정의한다. 고정 업무 5종은 공통 입력/결과 검증 경로를 사용한다. 모델 도구·자율 실행 루프는 추가하지 않으며, 서버에서 실행 가능한 음성 capability는 요청 조회와 신청서 제안뿐이다.
- 자동 종료 후보는 현재 세션의 최신 발화가 READY이고 최신 EXTRACT_NEED가 성공했을 때만 만든다. `ConfirmedNeedSchema`, 현재 서버 시각 기준 `validatePeriod`, `missingFields=[]`, `clarificationQuestion=null`, DRAFT의 needRevision을 모두 검사한다. 물품·시작/종료 시각·장소는 필수, 예산은 선택이다. 모델의 완료 발화는 후보를 만들지 못한다.
- `completion`은 null 또는 `{taskId,inputRevision,requestVersion}`다. 후보가 생기면 브라우저가 `/respond`에 `completionTaskId`를 포함해 종료 안내를 요청한다. 서버는 최신 후보를 다시 검사한다. 안내는 “필요한 정보를 모두 모았어요. 이제 통화를 종료하고 물품을 조회할게요. 결과는 요청함에서 확인해 주세요.”다.
- 종료 안내를 생성하는 동안 Live 직접 출력은 브라우저에서 음소거한다. 서버는 동일 Live 모델의 출력 전사와 sideband PCM 시간 범위를 연결해 고정 안내에 해당하는 유한 WAV를 만든다. 전사 누락·다른 문구·타임스탬프 누락·오디오 구간 누락·30초 상한 초과 때는 안내를 완료로 간주하지 않는다. 추가 모델이나 TTS 제공자는 사용하지 않는다.
- `/completion-audio`는 현재 데모 세션과 최신 후보의 조회만 허용한다. 준비 중이면 audioWav=null이며, 요청자의 발화 원음은 수집하지 않는다. 에이전트 안내 오디오만 최대 30초 분량을 메모리에 두고 정정·종료 시 폐기하며 DB·파일·로그·PWA 캐시에 저장하지 않는다. 인증·세션 응답과 동일하게 no-store다.
- 브라우저는 반환된 유한 음성을 재생한다. 해당 오디오의 자연스러운 ended 이벤트만 완료 신호다. append 수신 확인·전사 도착·무음·재생 시작만으로 종료하지 않는다. 재생 중단·차단·연결 끊김에는 수동 종료를 유지한다. 새 발화·정정은 후보와 오디오를 취소한다.
- 재생 완료 후 최신 snapshot을 확인해 기존 `/finish`에 completion 참조를 함께 보낸다. 서버가 입력 revision·요청 버전·후보·안내 전달을 재검사한다. 동일 자동 종료 body의 재시도만 허용하며 최종 작업의 중복 방지는 기존 음성 세션별 DB 규칙을 따른다. 수동과 자동 종료는 클라이언트에서 단일 실행으로 합친다.
- 이후 처리와 요청함 이동은 기존 종료·조회 흐름 그대로다. 최종 EXTRACT_NEED가 초안 저장과 검색 가능 여부를 다시 검증한다. 일반 DELETE·모델 발화·연결 손실은 검색하지 않는다. 승인·선택·결제·주민 전송 권한은 여전히 사람에게만 있다.
- 기존 브라우저/앱은 strict 계약 버전 때문에 API와 함께 갱신해야 한다. 실제 사람 음성, 휴대폰 재생, 스크린리더 검증은 별도 관문이다.
