# 0003 · 음성 접수 통화 화면 · 승인 후 예약 신청 도구 · 센터 서비스 시연

| 항목           | 값                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 상태           | **implemented** (실제 사람 음성·휴대폰 통화는 미검증, 10절)                                                                                                                  |
| 작성·갱신일    | 2026-11-04                                                                                                                                                                   |
| 대상 모듈      | 1 (사용자 명시 요청) · 3 호환 호출 · 기타(센터 시연)                                                                                                                         |
| 기준 코드      | `7c931f1`                                                                                                                                                                    |
| 관련·대체 명세 | [0001](0001-module-integration.md)의 "요청"·"대여" 행 중 접수→예약 연결을 구체화. 대체 명세 없음                                                                             |
| 1번 영향       | **1번 기능 변경(사용자 요청)**. 1번 전용 파일 22개는 이 환경의 Edit deny 때문에 수정하지 않고, 새 파일로 새 통화 화면·예약 도구를 추가했다. 구 화면은 `/rental/classic` 유지 |

## 1. 문제와 목표

1번 담당자 작업으로 다음을 만든다.

1. **음성 접수 통화 화면** (`/rental`): 화면 중앙보다 약간 위의 캐릭터, 캐릭터 위의 상태 enum 텍스트, 캐릭터 바로 아래 칸 없는 체크리스트. 통화 중 추출 결과로 체크가 하나씩 채워진다. 필수 정보가 모두 모이면 체크리스트가 사라지고 캐릭터가 위로 이동해 `WAITING_APPROVAL` 상태가 되며, 정리된 신청 내용과 **최종 승인** 버튼이 있는 바텀시트가 올라온다.
2. **승인 후 예약 신청 도구** (`request_reservation`): 사람이 승인 버튼을 누른 경우에만 서버가 통화 중 수집한 추출 결과로 기존 예약 API 계약(신청서 확정·조회 → 후보 견적 → `submit`)을 순서대로 호출한다. 호출 후 통화를 종료한다. 호출이 실패하면 통화를 먼저 종료하고 백그라운드에서 재시도한다. 계속 실패하는 경우의 처리(알림·포기 기준)는 범위 밖이다.
3. **센터 서비스 시연** (`/center/board`, `/center/services`): 센터에 실제로 공개된 게시글·소식과 센터가 이미 제공하는 서비스(물품대여·마음점검·성북곳간·동아리 지원·회원가입)를 리디자인한 앱의 탭처럼 보여준다. 실제 센터 시스템과 연동하지 않는다.

제외: 실제 결제, 기관 예약 시스템 연동, 3D 캐릭터 모델 자체, 재시도 영구 실패 처리, 센터 회원 인증.

## 2. 접수 정보 항목 (물품 대여 정책 조사)

공식 사이트(sb1in.or.kr)는 이 작업 환경의 네트워크 정책으로 직접 열 수 없었다. 공개 보도·구청 안내 검색 결과로 확인한 성북구 1인가구 물품대여 정책(시기별로 장소·기간 표기가 다름):

| 정책(공개 자료)                                                               | 접수 항목·처리                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 성북구에 주민등록된 1인가구 누구나 이용                                       | **이용 자격** — 데모 세션의 `demoEligible`로 표시(통화로 묻지 않음, 개인정보 미수집)             |
| 품목: 캐리어·카메라·미니빔·마사지기·가습기·에어랩·전기히터·캠핑용품·청소기 등 | **빌릴 물품** — `queryText`·`category` (필수)                                                    |
| 1회 7일, 예약자가 없으면 1회 연장(최대 14일). 당일 대여 대신 사전 예약 권장   | **대여 시작(수령) 일시**·**반납 일시** — `startAt`·`endAt` (필수, 기존 1시간~7일·30분 단위 검사) |
| 센터(장위로8길 20, 1층) 평일 9:30–17:30 수령                                  | **수령 장소** — `preferredPlaceIds` (필수)                                                       |
| 물품별 1개, 1회 최대 2개                                                      | 한 통화에 물품 1개(기존 추출 규칙 유지). 바텀시트에 정책 안내                                    |
| 무료(일부 시기 물품당 1천 원)                                                 | **예산** — 선택 항목. 체크리스트에서 "선택"으로 표시, 완료 판정에서 제외                         |

체크리스트 완료 판정은 서버 `collectionComplete()`(`apps/api/src/voice/guards.ts`)와 같은 규칙을 웹에서 재사용한다: `missingFields`가 비고 `clarificationQuestion=null`이며 `ConfirmedNeedSchema`·기간 검사를 통과.

## 3. 기존 기능과 겹침

| 기존 기능·파일·API                                               | 새 기능                                                             | 결정                | 최종 위치                                        | 기존 호출자 처리                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `VoicePage.tsx` (`/rental`): 자막·신청서 카드·자동 종료 후 조회  | `features/voice-call/VoiceCallPage.tsx`: 캐릭터·체크리스트·바텀시트 | 대체(라우트 전환)   | `/rental` → 새 화면, 구 화면은 `/rental/classic` | 구 화면은 텍스트 입력·직접 작성 경로로 유지. 1번 전용 파일 잠금 해제 시 삭제(7절)             |
| `lib/voice.ts` `VoiceClient`: 완료 시 종료 안내 재생 → 자동 종료 | `voice-call/call-client.ts` `VoiceCallClient`: 완료 시 승인 대기    | 임시 이중 구현      | 새 클라이언트                                    | 같은 `/voice-sessions` API 사용. 종료 안내 재생 경로(`completionTaskId`)는 호출하지 않음      |
| 종료 후 `finishVoice` → 최종 추출 → 검색 → 요청함에서 수동 제출  | 승인 시 `POST /intake-approvals` → 확정·검색·견적·`submit`          | 신규(호환 어댑터)   | `apps/api/src/intake-approvals`                  | 기존 `/requests/*`·`submit` 계약을 그대로 호출. 3번 `/reservations`가 생기면 이 어댑터만 교체 |
| `features/center` 합성 콘텐츠 탭                                 | `features/center-board` 실제 게시글·서비스 탭                       | 통합(같은 레이아웃) | `/center/board`, `/center/services`              | 기존 탭·오프라인 캐시 유지. 센터 첫 화면만 `board`로 전환                                     |

## 4. 1번 보존과 공용 코드 영향

- 1번 전용 파일 22개는 변경하지 않았다(`npm run check:boundaries`). 서버 음성 세션 로직(최신성·턴 판정·권한·원문 정리)은 그대로 쓰며, 새 클라이언트는 같은 `GET/POST/DELETE /voice-sessions*` 계약만 호출한다.
- 새 클라이언트는 서버가 `completion`을 알려도 종료 안내 지시(`respond` + `completionTaskId`)를 보내지 않고 일반 `respond`로 답변을 이어가게 한다. 따라서 완료 후 에이전트가 "통화를 종료하고 조회할게요" 대신 화면 확인을 안내한다(`VOICE_RULES` 갱신).
- 공용 `packages/ai/src/agents/instructions.ts`·`definitions.ts`: `VOICE_RULES.conversation/request/respond` 문구를 승인 흐름으로 바꾸고 `promptVersion`을 `voice-intake/2`로 올렸다. `VOICE_CAPABILITIES`에 `request_reservation`(사람 승인 뒤 서버만 실행) 설명을 추가했다. 게이트웨이 허용 목록은 이 배열에서 만들어지므로 구 화면에도 같은 문구가 적용된다(사용자 요청 범위).
- 공용 `apps/api/src/index.ts`: 플러그인 등록 1줄. `packages/contracts`: `intake.ts` 추가·export. `packages/db/migrations/003_intake_approvals.sql` 추가.
- `apps/web/src/App.tsx`: `/rental` 대상 전환, `/rental/classic` 추가. 기존 경로는 그대로.
- 회귀: 기존 테스트 전체(음성 API 테스트 포함)와 새 테스트를 실행한다(10절).

## 5. 모듈·데이터 소유권

| 데이터                              | 소유        | 읽기                                     | 쓰기                                                        | 수명                                           |
| ----------------------------------- | ----------- | ---------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `intake_approvals` (도구 실행 이력) | 1           | 요청자 본인 `GET /intake-approvals/{id}` | 1번 플러그인만                                              | 요청 1건당 1행(unique `request_id`), 삭제 없음 |
| 신청 초안 `rental_requests.need`    | 1           | 기존                                     | 도구가 기존 `patchDraft`/`confirmAndSearch` 명령으로만 변경 | 기존                                           |
| 후보·견적·협상(예약)                | 3(MVP 코드) | 기존                                     | 도구는 기존 `issueQuote`·`submit` 명령만 호출               | 기존                                           |

타 모듈 테이블에 직접 쓰지 않는다. 도구는 `Commands`의 공개 명령만 사용한다.

## 6. API 계약 (`/api/v1`, 기존 envelope·세션·CSRF·Idempotency-Key)

### `POST /intake-approvals` → 202

```json
{
  "requestId": "req_x",
  "extractionTaskId": "task_y",
  "expectedRequestVersion": 3,
  "voiceSessionId": "voice_z"
}
```

서버 검증: 요청자 본인, 요청 `DRAFT`, 추출 작업이 같은 요청의 `EXTRACT_NEED`·`SUCCEEDED`이며 수집 완료 규칙 통과. 같은 요청에 이미 도구 실행이 있으면 그 행을 반환(멱등). 같은 트랜잭션의 savepoint 안에서 첫 단계(초안 반영 → 확정·검색 요청)를 시도하고, 실패하면 행을 `RETRYING`으로 남긴다.

```json
{
  "data": {
    "id": "iap_1",
    "requestId": "req_x",
    "tool": "request_reservation",
    "status": "SEARCHING",
    "attempts": 0,
    "lastErrorCode": null,
    "negotiationIds": [],
    "nextAttemptAt": null,
    "need": {
      "category": "HOBBY",
      "queryText": "프로젝터",
      "startAt": "2026-11-06T01:00:00.000Z",
      "endAt": "2026-11-07T01:00:00.000Z",
      "preferredPlaceIds": ["place-center"],
      "maxBudgetKrw": null
    },
    "createdAt": "…",
    "updatedAt": "…"
  },
  "meta": { "…": "…" }
}
```

오류: 404(남의 요청·작업), 409 `INVALID_STATE`(DRAFT 아님·추출 미완료), 422 `VALIDATION_ERROR`(수집 미완료·잘못된 본문). 네트워크·5xx 실패는 클라이언트가 **같은 Idempotency-Key로** 재시도한다.

### `GET /intake-approvals/{id}` → 200 `IntakeApproval`

상태: `QUEUED → SEARCHING → SUBMITTED` | `NO_MATCH` | `CLOSED`(요청 취소·만료) , 실패 단계는 `RETRYING`(다음 시도 `nextAttemptAt`).

## 7. 상태·동시성·실패·전환

- 사람의 확인 시점: 바텀시트 **최종 승인** 버튼. 그 전에는 도구가 호출되지 않는다(에이전트가 자동 예약하지 않음).
- 백그라운드 진행: API 프로세스의 1초 주기 루프가 `FOR UPDATE SKIP LOCKED`로 행을 잡아 `SEARCHING` 행은 요청이 `MATCHES_READY`가 되면 가용 후보(공공 우선, 낮은 금액 순, 최대 3개)마다 새 견적을 발급해 `submit`한다. 실패 시 `RETRYING`, 지수 백오프(2s·4s·…최대 60s). 재시작 후에도 DB 행으로 이어간다.
- 클라이언트: 승인 → 마이크 음소거 → 도구 호출 → 통화 종료. 호출 실패 시 통화를 먼저 종료하고 `localStorage` 대기열(같은 Idempotency-Key)로 백그라운드 재시도(2s부터 최대 60s, 앱 재시작 시 재개).
- 중복 방지: 요청당 1행 unique, mutation 멱등 키, `submit`은 기존 버전 검사.
- 전환·롤백: `/rental`을 `App.tsx`에서 `VoicePage`로 되돌리면 구 흐름 복귀. migration 003은 새 테이블만 추가하므로 그대로 두어도 무해. 구 `VoicePage`·`VoiceClient`는 1번 전용 파일 잠금(`.claude/settings.json` deny·기준 해시)을 담당자가 해제하는 작업에서 삭제하고 `call-client.ts`로 단일화한다.

## 8. 3D 캐릭터 준비

- `CharacterState` enum(`IDLE`, `CONNECTING`, `GREETING`, `LISTENING`, `THINKING`, `SPEAKING`, `WAITING_APPROVAL`, `RESERVING`, `DONE`, `RETRYING`, `ERROR`)과 `deriveCharacterState()`를 화면과 분리했다.
- 렌더러 인터페이스 `CharacterRenderer`(props: `state`, `progress`, `reducedMotion`)로 현재 2D SVG를 구현했다. 3D는 같은 props로 `React.lazy` 렌더러를 꽂는다(three/R3F 번들은 통화 화면 진입 시에만 로드).
- Vite `assetsInclude`에 `glb/gltf/ktx2/hdr`를 추가하고 `public/models/character/`를 예약했다. PWA precache 대상에서 모델 파일은 제외(용량), 런타임 CacheFirst로 캐시.

## 9. 센터 서비스 시연 데이터

`features/center-board/posts.ts`: 공개 보도·구청 공지에서 확인한 실제 게시 내용(물품대여 안내, 마음점검 상시 모집, 성북곳간 개소, 복 떡국 데이, 어르신 보양식 나눔, 동아리 지원 등)을 제목·날짜·요약·출처 URL과 함께 담았다. 원본 사진은 네트워크 제한으로 가져오지 못해 각 글에 맞춘 자체 SVG 일러스트를 쓰고 "일러스트" 대체 텍스트를 단다. 서비스 탭의 신청 버튼은 "시연 화면 · 실제 센터 시스템과 연동되지 않음" 시트를 연다. 물품대여만 실제 앱 통화 접수(`/rental`)로 연결한다.

## 10. 검증 (2026-11-05, 로컬 PostgreSQL 16·Node 22)

| 항목                    | 명령·방법                                                       | 결과                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1번 전용 파일 보존      | `npm run check:boundaries`                                      | 통과 (22개 변경 없음)                                                                                                                       |
| 타입                    | `npm run typecheck`                                             | 통과                                                                                                                                        |
| 전체 테스트             | `npm test`                                                      | 28파일·222개 통과 (신규: API 도구 4개, 웹 체크리스트·캐릭터·재시도 6개)                                                                     |
| OpenAPI                 | `npm run openapi` + contracts 테스트                            | 41 operations 재생성, 통과                                                                                                                  |
| 수용 테스트             | `npm run test:acceptance`                                       | 35/36 통과. AT13은 저장소에 없는 `apps/api/test/fixtures/voice/live-2026-10-31T15-50-15.138Z.json`을 읽어 실패(이번 변경과 무관, 기존 상태) |
| 웹 빌드                 | `npm run build`, `scripts/verify-build.mjs`                     | 통과                                                                                                                                        |
| 화면                    | Playwright 390×844, 모의 API, `/rental?demo=script`·`/center/*` | 대기→인사→체크→승인 시트→신청 완료, 가로 넘침 없음, 센터 화면 쓰기 요청 0건                                                                 |
| e2e(`npm run test:e2e`) | Docker 스택 필요                                                | **미실행**. 메뉴 8개·`/rental/classic` 경로로 기대값만 갱신                                                                                 |
| 실제 음성·휴대폰 통화   | 사람 음성·OpenAI Live                                           | **미검증**(API 키·마이크 없음)                                                                                                              |

## 11. 알려진 한계

- 보호 파일 `apps/api/src/voice/bindings.ts`의 서버 문맥 안내 문구에는 아직 "자동 종료 후 조회"가 남아 있다. Edit deny로 이번 작업에서 바꾸지 않았고, 프롬프트 규칙(`VOICE_RULES`)이 승인 흐름을 우선 안내한다. 잠금 해제 작업에서 함께 정리한다.
- 새 1번 파일(`features/voice-call/*`, `apps/api/src/intake-approvals/*`)은 아직 기준 해시 목록에 없다. 보호 목록 갱신은 담당자가 별도로 결정한다.
- `tests/acceptance`의 AT19/AT20은 라우트 이름에 `reservations`를 금지한다. 새 경로는 승인 리소스(`/intake-approvals`)로 이름 지었고 센터 예약·결제 경로는 추가하지 않았다. 3번이 `/reservations`를 만들 때 이 검사를 함께 조정해야 한다.
- 센터 원본 사진은 네트워크 정책으로 가져오지 못했다. `sb1in.or.kr` 접근을 허용하면 이미지를 받아 `public/content/center/`에 추가할 수 있다.
