# PostgreSQL domain and API integration

계약 `0.1.0`, PostgreSQL 16. `@sb/db`는 API와 worker가 공유하는 상태 전이·권한·이력·이벤트 구현이다. 데이터는 실제 PostgreSQL에 저장하며 AI가 승인·선택·결제를 실행하는 경로는 없다.

## 실행

```sh
npm run db:up
npm run -w @sb/db migrate
npm run seed -- --scenario default
PORT=3001 npm run -w @sb/api dev
npm test -w @sb/db -w @sb/api
npm run -w @sb/db typecheck
npm run -w @sb/api typecheck
```

`DATABASE_URL` 기본값은 로컬 compose의 `postgres://sb:sb@127.0.0.1:54329/sb`다. migrate는 SQL 파일을 순서대로 적용하며 트랜잭션·advisory lock·적용 이력을 사용한다. `seed`는 **대상 DB의 업무 데이터를 초기화**한다. 공유 개발 DB에 실행하기 전에 다른 작업자의 사용 여부를 확인해야 한다. `--scenario default|expiry-fast|ineligible`, `--now 2026-11-01T01:00:00Z`를 지원한다. HTTP 초기화 경로는 없다.

API는 기본 `127.0.0.1:3000`에 바인딩하며 W1 검증 포트는 `PORT=3001`이다. `APP_ORIGIN` 기본값은 `https://localhost:8443`이다. CLI `dev`/`start`는 루트 `.env`를 출력 없이 로드하고 `@sb/ai.createAiPorts()`의 `FeeRecommender`를 DB에 주입한다. `AI_MODE` 기본값은 live이고 fixture는 명시적으로 설정한다. DB 패키지는 AI 구현에 의존하지 않고 `@sb/contracts` 포트만 사용한다. 테스트의 `buildApi({db})`는 공급한 DB/결정적 포트를 사용한다.

```sh
curl -i -H 'Content-Type: application/json' \
  -H 'Origin: https://localhost:8443' \
  --data '{"handle":"demo-hana"}' \
  http://127.0.0.1:3001/api/v1/demo-sessions
```

기본 쿠키는 `__Host-demo_session; Secure; HttpOnly; SameSite=Lax; Path=/`이며 8시간 유효하다. 위 HTTP 요청은 201 생성 확인용이다. 브라우저 쿠키·마이크 시연은 신뢰된 Caddy HTTPS origin에서 수행한다. HTTP 개발 전용으로 `COOKIE_NAME=demo_session_dev COOKIE_SECURE=false APP_ORIGIN=http://127.0.0.1:5173`를 함께 지정할 수 있다. `__Host-` 이름에 Secure를 끄면 서버 시작을 거절한다.

## API에서 도메인 호출

```ts
import { Database } from '@sb/db';

const db = new Database({ feeRecommender });
const view = await db.transaction((commands) => commands.create(actorUserId, need));
// actorUserId는 검증된 세션에서 가져온다.
```

`db.transaction(callback, now?: Date)`는 `Commands`를 전달한다. callback이 성공하면 상태·이력·작업 outbox·이벤트를 함께 commit한다. `DomainError`에는 `code`, `status`, `details`, `commit`이 있다. 만료나 가용성 충돌의 `commit=true` 오류는 상태를 commit한 후 오류로 반환한다. API는 오류를 envelope로 감싼 뒤 멱등 기록까지 같은 트랜잭션에 저장한다.

`Commands` 공개 업무 명령:

| 함수                                                                 | 결과                                       |
| -------------------------------------------------------------------- | ------------------------------------------ |
| `create(actor, need: NeedDraft)`                                     | RequestView, 빈 초안 허용                  |
| `patchDraft(actor, requestId, body: PatchDraftBody)`                 | RequestView                                |
| `confirmAndSearch(actor, requestId, expectedVersion)`                | `{request: RequestView, taskId}`           |
| `cancel(actor, requestId, expectedVersion)`                          | RequestView                                |
| `issueQuote(actor, body: PriceQuoteBody, feeRecommender?)`           | PricingQuote                               |
| `submit(actor, requestId, body: SubmitRequestBody)`                  | RequestView                                |
| `ownerResponse(actor, negotiationId, body: OwnerResponseBody)`       | OwnerCard                                  |
| `requesterCounter(actor, negotiationId, body: RequesterCounterBody)` | RequestView                                |
| `withdraw(actor, negotiationId, expectedVersion)`                    | RequestView 또는 OwnerCard                 |
| `select(actor, requestId, body: SelectOfferBody)`                    | `{request: RequestView, paymentPreview}`   |
| `getRequest(actor, requestId)`                                       | RequestView, 읽기 시 지연 만료 적용        |
| `getNegotiation(actor, negotiationId)`                               | 요청자 Negotiation / 해당 소유자 OwnerCard |
| `paymentPreview(actor, requestId)`                                   | PaymentPreview, 지연 hold 만료 적용        |
| `agentTurn(actor, body: AgentTurnBody)`                              | `{taskId}`, ROUTE_INTENT 작업 생성         |
| `createSession(handle, oldToken?)`                                   | `{token, session, data}`                   |
| `session(token)` / `sessionData(session)`                            | 검증된 Session / DemoSessionData           |
| `revokeSession(sessionId, userId)`                                   | 세션 폐기와 session.revoked 이벤트         |

`Database.idempotent({session,method,path,key,body}, callback)`는 `StoredResponse={status,body}` 전체를 24시간 보존한다. 세션·리소스 권한 검사가 재현보다 먼저, 재현이 version 검사보다 먼저다. 실제 resource 경로를 사용하며 JSONB에서 읽은 첫 응답부터 동일한 직렬화 순서를 사용한다. 같은 키·다른 body는 `IDEMPOTENCY_KEY_REUSED`다.

`buildApi`/`createApp`는 Fastify factory다. 음성 구현이 존재하면 `apps/api/src/voice/index.ts`의 default export 또는 `voicePlugin`을 등록한다. 아직 파일이 없으면 음성 라우트를 노출하지 않는다. Voice plugin에서는 `app.demo`의 `{db,cookieName,envelope,requireSession,mutation}`을 이용한다. `request.demoSession`은 공통 세션·CSRF·Origin hook에서 채워진다. `app.demo.mutation(method,path,status,handler)`의 path는 `/voice-sessions`처럼 `/api/v1`을 제외한다. handler는 `(commands, request)`를 받아 반환한다. 외부 음성 연결을 만드는 동안의 멱등성·세션 폐기 정리는 W2에서 이 경계에 연결한다.

## W2 worker 인터페이스

모든 함수는 `Database` 인스턴스 메서드다. `InputVersion`은 숫자가 아니라 계약의 `NEED/TERMS/TURN/NEGOTIATION/FEE/COMPARE` 객체다. worker는 DB의 `task.inputVersion`을 그대로 전달한다.

```ts
runSearch(
  requestId: string,
  inputVersion: InputVersion,
  deps?: { feeRecommender?: FeeRecommender; now?: Date },
): Promise<boolean>
applyPublicDecision(taskId: string, inputVersion: InputVersion): Promise<boolean>
expireDue(now?: Date): Promise<number>
startTask(taskId: string): Promise<AgentTask | null>
failTask(taskId: string, errorCode: string, final?: boolean): Promise<void>
recordTaskResult(taskId: string, inputVersion: InputVersion, result: AiResult): Promise<boolean>
getTask(taskId: string, actor?: string): Promise<AgentTaskDetail>
getTaskInput(taskId: string): Promise<AiTaskInput | null>
enqueueTask(requestId, kind, inputVersion, context?, actor?, negotiationId?): Promise<AgentTask>
pendingOutbox(limit?: number): Promise<OutboxRow[]>
markOutboxDelivered(outboxId: string): Promise<void>
```

조건 변경은 EXPLAIN_TERMS, 유효 Offer 집합 변경은 COMPARE_OFFERS를 자동 enqueue한다. 설명·비교의 최종 실패 결과에는 저장된 조건으로 만든 서버 템플릿이 남는다. 동기 가격 추천도 RECOMMEND_FEE 작업·효과 이력을 기록하며, 이미 완료된 inline 작업의 outbox는 worker의 startTask가 실행하지 않는다.

`runSearch`는 카테고리·자기 물품 제외·자격·기간·장소·현재 hold를 검사하고 초기 quote와 후보를 저장한다. 사용 가능한 후보가 없으면 NO_MATCH다. `deps.feeRecommender`는 인스턴스 포트를 덮어쓴다. 주민 추천의 8초 제한·잘못된 옵션·근거 없는 결과·예외는 BASELINE으로 처리하며 반환한 quote를 나중에 덮어쓰지 않는다. 공공 quote는 PUBLIC_FIXED다.

`applyPublicDecision`은 DB의 공공 fixture를 재검증해 PUBLIC_DEMO Offer 또는 PUBLIC_DEMO_DECLINED를 저장한다. **worker가 1–2초 시연 지연을 둔 다음 호출한다.** 오류 재시도 한도 초과 시 `failTask(..., true)`가 PUBLIC_DEMO_ERROR/UNAVAILABLE로 닫는다. 주민 응답을 자동으로 만들지 않는다.

worker 처리 순서:

1. `pendingOutbox()`의 `kind='TASK'` payload는 `{taskId,kind}`다. pg-boss에 taskId 기반 singleton job을 전송한 뒤 `markOutboxDelivered(id)`를 호출한다. `kind='EVENT'`는 이미 commit된 사용자 이벤트의 알림 기록이므로 전달 완료 처리한다. 이벤트 실제 전송은 API의 PostgreSQL LISTEN/NOTIFY와 durable log가 담당한다.
2. job에서 `startTask(taskId)`를 호출한다. null이면 이미 종료됐거나 입력이 낡았으므로 중단한다. RUNNING 상태의 작업은 재시작 후 다시 실행할 수 있다. attempt는 최대 3이다.
3. SEARCH는 `runSearch`, PUBLIC_SUBMIT은 `applyPublicDecision`을 호출한다. 나머지는 `getTaskInput`으로 AI 포트 입력을 받고 결과의 `result`를 `recordTaskResult`에 전달한다. ROUTE_INTENT가 RENTAL_REQUEST 또는 UNCLEAR이고 요청이 DRAFT이면 EXTRACT_NEED 작업과 outbox가 자동으로 추가된다. 추출 결과는 task.result에만 저장되고 초안은 바뀌지 않는다.
4. 일시적 실패는 `failTask(taskId, safeErrorCode)` 후 pg-boss에서 1초·4초와 jitter로 재시도한다. 영구 실패는 `final=true`다. provider 예외 원문·비밀값을 errorCode에 넣지 않는다. 세 번째 작업이 중단된 채 복구되면 다음 startTask가 실패 종결한다.
5. cron은 `expireDue()`를 호출한다. 사용자 이벤트와 멱등 기록의 24시간 보존 정리도 수행한다. 재시작 시 미전달 outbox와 QUEUED/RUNNING 작업을 재개하는 queue 운영은 W2 책임이다.

`task_effects(task_id,step,input_hash)`의 unique key와 상태·입력 참조 재검사가 중복 효과를 막는다. 다른 분기 변경만으로 설명 작업을 폐기하지 않으며 취소·만료·변경된 요구/조건·최신 turn 교체 뒤의 결과는 폐기한다. `getTask`의 actor를 생략하는 호출은 **서버 worker 전용**이다. API는 세션 actor를 항상 전달한다.

음성 플러그인은 `Commands.agentTurn(actor, body, {voiceSessionId})`의 서버 전용 optional 인자로 음성 입력을 표시한다. 표시 정보는 ROUTE → EXTRACT로만 이어지며 `getTaskInput`은 이를 제거하여 기존 strict AI 입력 계약을 유지한다. `Database.scrubVoiceTurnText({turnIds?, olderThan?})`는 표시된 음성 작업의 원문 `context.text`만 지우고 결과·구조화 요구·텍스트 입력은 보존한다. 요청 잠금 아래에서 해당 최신 turn을 무효화하므로 늦은 결과가 원문을 다시 복사하지 않는다. Voice API는 모든 종료 경로에서 이를 호출하고, 시작 시와 30초마다 생성 후 10분 15초가 지난 음성 입력도 정리하여 비정상 종료를 복구한다.

## 저장과 동시성

엔터티 JSONB는 계약의 camelCase 구조를 보존하고, 조회·외래 키·물품 점유에 쓰는 컬럼은 generated column 또는 정규 컬럼으로 둔다. 조건·Offer·quote·need 이력은 UPDATE를 거절하는 DB trigger로 불변이다. 세션 bearer token은 SHA-256 해시만 저장한다.

잠금은 request → 정렬된 negotiation → 정렬된 item → 정렬된 이벤트 수신자 순서다. 수신자 잠금은 업무 변경이 끝난 후 flush에서 획득하며 사용자별 cursor를 증가시킨다. 점유는 item 행 잠금과 PostgreSQL GiST exclusion constraint의 이중 보호를 받으며 `[startAt,endAt)`를 사용한다. 가용성 충돌 시 UNAVAILABLE와 알림을 commit하고 409를 반환한다.

`db.sync(actor)`는 먼저 해당 사용자의 지연 만료를 적용한 후 REPEATABLE READ 한 스냅샷에서 요청 요약·자기 소유 카드·허용 작업·eventCursor를 읽는다. `eventsAfter(actor,cursor)`는 24시간 이내 이벤트를 cursor 순서로 반환한다. SSE는 Last-Event-ID를 우선하고 15초마다 id 없는 named heartbeat를 보내며, cursor 손실과 세션 폐기를 명시적으로 알린다. NOTIFY 누락에 대비해 1초 간격으로 durable log도 확인한다. 서버 종료의 preClose에서 SSE와 LISTEN 연결을 정리한 후 DB pool을 닫는다.

## 검증 기록

2026-11-01 로컬 PostgreSQL 16에서 실행:

- `npm run db:up`: 기존 공유 db 서비스 Running 확인.
- `npm run -w @sb/db migrate`: 마이그레이션 성공. 반복 실행도 성공.
- `npm run seed -- --scenario default`: 사용자 4명·장소 3곳·물품 10개 적재.
- `PORT=3001 npm run -w @sb/api dev` 후 위 curl: HTTP **201**.
- `npm test -w @sb/db -w @sb/api`: 도메인 **21개**, API **15개**, 총 **36개**. AT07–AT12는 Fastify inject + 실제 PostgreSQL이며 AT11·AT12는 실제 동시 Promise 실행이다.
- DB/API strict TypeScript typecheck 통과.

각 테스트 파일은 별도 `sb_test_<uuid>` database를 생성·마이그레이션·seed하고 종료 시 삭제한다. 개발용 sb DB는 테스트에서 초기화하지 않는다. 테스트에는 상태 경로, 3회 변경 한도, 금액 경계, quote scope/불변성/8초 timeout, 늦은 AI 결과, 요청·제안·hold 만료 경계, 작업 중복·실패·취소, 권한·세션·멱등성, 비교 정렬, outbox, 실제 TCP SSE 순서·재연결·heartbeat·cursor 만료·세션 폐기가 포함된다.

W1 검증은 worker queue 실행·실제 모델 음성·휴대폰 HTTPS/설치 검증을 포함하지 않는다. W2와 W3에서 해당 경로를 연결·검증해야 한다.
