# 0004 · 3번 물품 탐색·예약·대기·앱 알림

| 항목           | 값                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 상태           | **implemented** (검증 결과 11절)                                                                                                                                                                                                                 |
| 작성·갱신일    | 2026-11-05                                                                                                                                                                                                                                       |
| 대상 모듈      | 3 (공용: contracts·db migration·`unit.ts` 가용성·worker 주기 작업·웹 앱 셸) · 1 호환(도구 영구 실패 처리, 새 파일·공용 파일만)                                                                                                                   |
| 기준 코드      | `8dee601`                                                                                                                                                                                                                                        |
| 관련·대체 명세 | [0001](0001-module-integration.md)의 "검색·가용성", "대여·협상", "알림·대기" 행을 구체화. [0002](0002-item-registration.md)의 "3번 조회 연결" 미결정을 결정. [0003](0003-voice-call-reservation.md)의 도구 영구 실패 처리를 추가. 대체 명세 없음 |
| 1번 영향       | 1번 보호 파일 22개는 변경하지 않는다(사용자 결정: 잠금 유지). 1번 검색이 쓰는 공용 가용성 검사에 확정 예약·대기 우선권이 추가된다(점유된 물품은 후보에서 `UNAVAILABLE`로 표시)                                                                   |

## 1. 문제와 목표

현재 대여 흐름은 다음 순서로 진행된다. 접수 → 검색 → 최대 3곳 동시 신청 → 조건 협상 → 제안 선택 → 10분 데모 점유와 결제 미리보기. 흐름이 끝나도 기간을 점유하는 예약이 남지 않는다. 분담도(개발 제안 v0.2)의 3번 기능도 없다. 목록·상세·필터·기간별 가용성, 단일 물품 대여 신청과 소유자 승인·거절, 예약 취소·만료, 대기 순서·재신청 알림, 앱 내 알림이 여기에 해당한다. 이번 작업에서 MVP를 완성한다.

사용자 결정 (2026-11-05):

1. **미리보기에서 확정**. 기존 협상 흐름은 그대로 둔다. 결제 미리보기 화면에 "예약 확정(결제 없음)"을 추가하면 확정 예약(`CONFIRMED`)이 만들어진다. 목록·상세에서 단일 물품을 바로 신청하는 경로(`PENDING` → 소유자 승인/거절)를 추가한다. 두 경로는 같은 예약 원장과 중복 점유 검사를 쓴다.
2. **대기 1순위 우선권**. 점유가 풀리면 대기 1순위에게만 알린다. 30분 동안 그 사람만 그 기간을 신청할 수 있다(`expiry-fast` 시연은 30초). 그 안에 신청하지 않으면 다음 순위에게 알린다. 자동 예약은 없고, 재신청할 때 가용성을 다시 검사한다.
3. **1번 잠금 유지**. 보호 파일·Claude deny·기준 해시는 바꾸지 않는다. 1번 쪽 추가는 0003처럼 새 파일과 공용 파일로 한다.
4. **제외 유지**. 이웃 요청 공개, 무료 나눔(0원), 분류 확장, 수령·반납과 사진 비교는 이번 범위에서 제외한다.

분담도에 합의된 원칙을 유지한다. AI는 자동으로 게시·예약·승인하지 않는다. 사람이 확인하고 서버가 검증한다. 로그인, 실제 결제, 실제 센터 서비스·사이트 API 연동은 하지 않는다. 예약은 앱 안의 데모 상태다. 공공 물품은 데모 데이터와 모의 응답, 주민 물품은 직접 등록과 소유자 응답이다.

포함:

- 카탈로그 조회 API·화면: 목록, 검색어·분류·출처·기간 필터, 상세(설명·점유 기간), 기간별 가용성.
- 예약 원장: 바로 신청(`PENDING`), 소유자 승인/거절, 공공 물품 모의 응답, 미리보기 확정(`CONFIRMED`), 요청자 취소, 응답 기한 만료, 응답 이력.
- 중복 점유 방지: 물품 행 잠금과 DB 배타 제약(확정 예약 기간 겹침 금지). 기존 10분 데모 점유와도 서로 검사한다.
- 대기열: 등록·조회·취소, 순번, 중복 대기 차단, 1순위 우선권과 다음 순위 승계.
- 앱 내 알림: 예약·대기·협상 주요 사건, 읽음 처리, 실시간 반영(SSE).
- 요청함에 예약·대기를 통합: 내 신청 내역, 소유자 요청함, 취소·만료 표시.
- 1번 도구(`request_reservation`) 영구 실패 처리. 서버는 `FAILED`와 알림, 클라이언트 재전송 대기열은 중단 조건.

제외: 위 4번의 항목, 로그인·실제 결제·기관 예약 연동, 1번 보호 파일 수정(구 음성 화면 정리, `bindings.ts` 안내 문구, 한 통화 물품 2개), 3D 캐릭터 모델, 대여 연장, 이미지 삭제·보관 정책(0002 제외 유지).

## 2. 기존 기능과 겹침

| 기존 기능·파일·API                                                        | 새 기능                                                               | 결정                                          | 최종 단일 구현 위치                                                 | 기존 호출자 처리                                                                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /items`, `/items/{id}` (seed+게시 투영 공개 조회)                    | `GET /catalog`, `/catalog/{itemId}`, `/catalog/{itemId}/availability` | 유지 + 신규(카탈로그는 세션 필요·가용성 결합) | 3번 `apps/api/src/reservations`, `packages/db/src/reservations.ts`  | `/items`는 그대로 둔다(기존 계약·공개 조회). 카탈로그는 같은 `items` 투영을 읽는다                                                                         |
| `unit.ts availability()` (비활성·본인·자격·장소·시작·불가 구간·데모 점유) | 확정 예약 겹침 `RESERVED`, 타인 대기 우선권 `WAITLIST_PRIORITY`       | 통합(공용 함수에 검사 추가)                   | `unit.ts` → `reservations.ts`의 점유 조회 호출                      | 1번 검색(`runSearch`)·제출·선택이 같은 검사를 쓴다. 기존 사유 코드·순서는 유지하고 마지막에 추가                                                           |
| 협상 선택 `select` → `demo_holds`(10분) → 결제 미리보기                   | 미리보기에서 `POST /reservations`(requestId 포함) → `CONFIRMED`       | 유지 + 연결                                   | 3번 예약 원장                                                       | 선택·점유·미리보기·"데모 확인 완료"는 그대로. 확정하면 점유가 `RELEASED`로 바뀌고 예약이 기간을 이어받는다. 확정하지 않으면 기존처럼 10분 뒤 만료          |
| `/inbox`(요청 요약·소유자 협상 카드), `/sync`, SSE                        | 예약·대기 목록, 알림                                                  | 통합(같은 화면에 구역 추가)                   | 웹 `features/reservation`, 3번 API                                  | `/sync`·`SyncData` 계약은 바꾸지 않는다. 예약·대기·알림은 별도 조회 + SSE 무효화                                                                           |
| 0003 `request_reservation` 도구(협상 `submit` 호출)                       | 영구 실패 `FAILED` + 알림                                             | 유지 + 보강                                   | `apps/api/src/intake-approvals`, `packages/contracts/src/intake.ts` | 도구가 호출하는 계약(협상 제출)은 그대로. 0003에 적힌 "`/reservations`가 생기면 어댑터 교체"는 하지 않는다. 다중 후보 협상이 사용자 결정 1로 유지되기 때문 |
| 수용 테스트 AT19/AT20의 `reservations` 라우트 금지                        | 앱 내 데모 예약 경로 `/reservations`                                  | 조정                                          | `tests/acceptance/flows.test.ts`                                    | 결제·웹훅·센터 프로그램/동아리/공간 신청·예약·초기화 경로 금지는 유지하고 `reservations` 단어만 허용                                                       |

## 3. 1번 보존과 공용 코드 영향

- 1번 보호 파일 22개는 변경하지 않는다(`npm run check:boundaries`). 1번이 쓰는 경로(`/agent-turns`, `/voice-sessions*`, `/requests*`, `/tasks/{id}`, `/intake-approvals`)의 입출력은 그대로다.
- `unit.ts availability()`: 기존 사유 검사 뒤에 확정 예약 겹침과 타인 대기 우선권 검사를 덧붙인다. 1번 검색 결과에서 이미 확정 예약이 있는 기간의 물품은 `UNAVAILABLE`(`RESERVED`)이 된다. 기존 seed·테스트에는 확정 예약이 없으므로 기존 결과는 같다. 함수에 선택 인자 `{ ignoreHoldRequestId }`를 추가하지만 기본 동작은 같다.
- `unit.ts makeOffer()`, `commands.ts submit()`: 알림 행을 추가한다(주민 소유자에게 새 신청, 요청자에게 조건 도착). 상태 전이·응답은 바꾸지 않는다.
- `database.ts expireDue()`: 끝에 3번 정리 작업을 호출한다. 응답 기한 만료, 공공 모의 응답, 대기 우선권 만료·승계가 여기에 해당한다. 기존 만료 처리 순서와 반환값은 같다.
- `contracts`: 새 파일 `reservation.ts`. `enums.ts`에 SSE 이벤트 3종과 오류 코드 3종을 추가한다(`TIMING.priorityMs` 포함). `http.ts`의 `SseEventSchema`에 선택 필드 3개를 추가한다. `intake.ts`에 `FAILED` 상태를 추가한다. 기존 필드와 값은 지우거나 바꾸지 않는다.
- 웹 공용: `App.tsx`에 라우트를 추가하고 탭을 재배치한다. `내 정보`는 머리말 링크로 옮기되 접근 이름 `내 정보`는 유지한다. 알림 버튼을 추가한다. `lib/session.ts` SSE 처리에 새 이벤트 무효화를 추가하고, `presentation.ts`에 상태·사유 표시를 추가한다. 접수 화면(`/rental`, `/rental/classic`)과 신청서 확인 화면은 바꾸지 않는다.
- `apps/api/src/server.ts`: `APP_MODE=automated-test`일 때만 요청 한도를 분당 1000회로 올린다(e2e가 세 사용자를 한 프록시 IP로 보내기 때문, 11절). 데모·운영 모드의 한도(분당 120회)와 다른 동작은 그대로다.
- 1번 기능 변경이 필요해 보류하는 항목: 음성 상태 안내에 예약 상태 포함(`apps/api/src/voice/bindings.ts`), 구 화면 정리, 분담도의 1번 경로 이름(`/requests/{id}/messages` 등).
- 회귀: 기존 전체 테스트(음성 API·도구 테스트 포함)와 수용 테스트를 실행하고, 새 DB·API 테스트를 추가한다(11절).

## 4. 모듈·데이터 소유권

| 데이터                                    | 소유                | 읽기                                                 | 쓰기                                                     | ID·수명                                                               |
| ----------------------------------------- | ------------------- | ---------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| `reservations` 예약 원장                  | 3                   | 요청자·소유자 본인 `GET /reservations*`, 가용성 검사 | 3번 명령만(신청·응답·확정·취소·만료)                     | `rsv_…`, 삭제 없음. 물품 수정·비활성화로 무효화하지 않음(스냅샷 보관) |
| `reservation_events` 응답 이력            | 3                   | 예약 상세                                            | 3번 명령만, 추가 전용(UPDATE 금지 트리거)                | 예약당 여러 행                                                        |
| `waitlist_entries` 대기열                 | 3                   | 본인 `GET /waitlist-entries`, 가용성 검사(우선권)    | 본인 등록·취소, 정리 작업(알림·만료·승계)                | `wl_…`, 삭제 없음(취소는 상태)                                        |
| `notifications` 앱 알림                   | 3                   | 수신자 본인 `GET /notifications`                     | 3번 알림 함수만(협상·도구 경로도 이 함수 호출)           | `ntf_…`, 30일 보관 후 정리                                            |
| `items` 게시 투영                         | 2                   | 3번 카탈로그·가용성, 1번 검색                        | 2번 게시·수정·비활성화만                                 | 기존                                                                  |
| `listings` 설명                           | 2                   | 3번 카탈로그 상세(2번이 제공하는 읽기 함수 경유)     | 2번만                                                    | 기존                                                                  |
| `demo_holds` 10분 데모 점유               | 3(MVP)              | 가용성 검사                                          | 협상 선택이 생성. 3번 확정이 `RELEASED`로 변경           | 기존                                                                  |
| `rental_requests`·협상·`intake_approvals` | 1(접수)·3(MVP 협상) | 기존                                                 | 기존. 3번 예약은 `requestId`·`negotiationId`로 참조만 함 | 기존                                                                  |

## 5. API·이벤트 계약 (`/api/v1`, 기존 envelope·세션 쿠키·CSRF·`Idempotency-Key`)

모든 경로에 데모 세션이 필요하다. 시각은 UTC ISO 문자열이고 금액은 KRW 정수다. 쓰기 요청은 기존 `mutation` 래퍼를 써서 같은 키 재전송이면 같은 응답을 돌려준다. 목록은 `{ items, nextCursor }`이고 `limit`은 1~50(기본 20)이다.

### 5.1 카탈로그

`GET /catalog?q=&category=&source=&startAt=&endAt=&cursor=&limit=` → 200 `{ items: CatalogItem[], nextCursor }`

- 활성 물품만 반환한다(`enabled=true`). `q`는 1번 검색과 같은 `matchesItem` 규칙을 쓴다. 기간을 주면 각 항목에 `availability`가 붙는다.

```json
{
  "data": {
    "items": [
      {
        "id": "res-projector-duri",
        "title": "두리의 프로젝터",
        "category": "HOBBY",
        "source": "RESIDENT",
        "image": {
          "url": "/assets/items/res-projector-duri.svg",
          "alt": "두리의 프로젝터 데모 일러스트",
          "isIllustration": true
        },
        "ownerDisplayName": "두리",
        "dailyRateKrw": 2000,
        "allowedPlaceIds": ["place-center", "place-library"],
        "mine": false,
        "availability": {
          "status": "AVAILABLE",
          "reason": null,
          "billingDays": 2,
          "totalFeeKrw": 4000
        }
      }
    ],
    "nextCursor": null
  },
  "meta": {
    "contractVersion": "0.3.0",
    "serverTime": "2026-11-05T01:00:00.000Z",
    "traceId": "trace_x"
  }
}
```

`GET /catalog/{itemId}` → 200 `CatalogItemDetail` = `CatalogItem` + `description`(주민 게시 물품의 2번 설명, 공공은 `null`) + `occupied: [{ startAt, endAt, kind: "RESERVED" | "HELD" | "UNAVAILABLE" }]`(현재 이후, 최대 20개, 누가 점유했는지는 숨김) + `waitingCount`. 비활성·없는 물품은 404 `NOT_FOUND`.

`GET /catalog/{itemId}/availability?startAt=&endAt=` → 200

```json
{
  "itemId": "pub-projector",
  "startAt": "2026-11-07T01:00:00.000Z",
  "endAt": "2026-11-08T07:00:00.000Z",
  "status": "UNAVAILABLE",
  "reason": "RESERVED",
  "billingDays": 2,
  "totalFeeKrw": 3000,
  "waitlistable": true,
  "waitingCount": 1
}
```

- 사유(`reason`): 기존 `ITEM_DISABLED`·`OWN_ITEM`·`OWNER_INELIGIBLE`·`DEMO_INELIGIBLE`·`PLACE_UNAVAILABLE`·`PERIOD_STARTED`·`PERIOD_UNAVAILABLE`·`ACTIVE_HOLD`에 `RESERVED`·`WAITLIST_PRIORITY`를 추가한다. `waitlistable`은 사유가 `RESERVED`·`ACTIVE_HOLD`·`WAITLIST_PRIORITY`처럼 점유가 풀릴 수 있는 경우에만 `true`다. 기간 형식 오류는 422 `VALIDATION_ERROR`를 낸다(30분 단위, 1시간~7일, 시작은 현재 이후).

### 5.2 예약

`Reservation`

```json
{
  "id": "rsv_1",
  "itemId": "res-projector-duri",
  "requesterId": "u_hana",
  "ownerId": "u_duri",
  "source": "RESIDENT",
  "origin": "CATALOG",
  "requestId": null,
  "negotiationId": null,
  "waitlistEntryId": null,
  "status": "PENDING",
  "version": 1,
  "startAt": "2026-11-07T01:00:00.000Z",
  "endAt": "2026-11-08T07:00:00.000Z",
  "placeId": "place-library",
  "totalFeeKrw": 4000,
  "currency": "KRW",
  "item": {
    "id": "res-projector-duri",
    "title": "두리의 프로젝터",
    "category": "HOBBY",
    "source": "RESIDENT",
    "ownerDisplayName": "두리",
    "image": {
      "url": "/assets/items/res-projector-duri.svg",
      "alt": "두리의 프로젝터 데모 일러스트",
      "isIllustration": true
    }
  },
  "responseDueAt": "2026-11-06T01:00:00.000Z",
  "closedReason": null,
  "createdAt": "2026-11-05T01:00:00.000Z",
  "updatedAt": "2026-11-05T01:00:00.000Z"
}
```

`ReservationView` = `{ reservation, requesterDisplayName, role: "REQUESTER" | "OWNER", allowedActions: ("OWNER_APPROVE" | "OWNER_DECLINE" | "CANCEL")[], history: ReservationEvent[] }` (목록에서는 `history`가 빈 배열).

| 메서드·경로                                                 | 본문                                                                                                          | 결과                                                  | 권한·오류                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /reservations` (바로 신청)                            | `{ itemId, startAt, endAt, placeId }`                                                                         | 201 `ReservationView` `PENDING`                       | 422 기간·장소 형식. 409 `AVAILABILITY_CONFLICT` `{ reason, waitlistable }`. 409 `DUPLICATE_RESERVATION`(같은 물품·겹치는 기간에 본인 `PENDING`/`CONFIRMED`). 404 비활성·없는 물품                                                 |
| `POST /reservations` (미리보기 확정)                        | `{ itemId, startAt, endAt, placeId, requestId, negotiationId }`                                               | 201 `ReservationView` `CONFIRMED`                     | 요청자 본인, 요청 `PAYMENT_PREVIEW_READY`, 선택 협상·조건이 본문과 일치, 데모 점유 `ACTIVE`이고 만료 전. 불일치 422. 점유 만료 410 `OFFER_EXPIRED`. 같은 요청의 재확정은 기존 예약 반환(요청당 1건)                               |
| `GET /reservations?role=&status=&requestId=&cursor=&limit=` | -                                                                                                             | 200 `{ items: ReservationView[], nextCursor }` 최신순 | `role` 기본 `REQUESTER`. 본인 것만                                                                                                                                                                                                |
| `GET /reservations/{id}`                                    | -                                                                                                             | 200 `ReservationView`(이력 포함)                      | 요청자·소유자 외 404                                                                                                                                                                                                              |
| `POST /reservations/{id}/respond`                           | `{ action: "APPROVE" \| "DECLINE", expectedVersion, reasonCode? }` (거절은 사유 필수, 기존 `OwnerReasonCode`) | 200 `ReservationView`                                 | 주민 물품 소유자만(그 외 404). `PENDING`만(409 `INVALID_STATE`). 버전 불일치 409 `VERSION_CONFLICT`. 기한 경과 410 `OFFER_EXPIRED`(예약은 `EXPIRED`로 기록). 승인 시 점유 충돌 409 `AVAILABILITY_CONFLICT`(예약은 `PENDING` 유지) |
| `POST /reservations/{id}/cancel`                            | `{ expectedVersion }`                                                                                         | 200 `ReservationView` `CANCELLED`                     | 요청자 본인만. `PENDING`이거나 시작 전 `CONFIRMED`만 가능(그 외 409 `INVALID_STATE`)                                                                                                                                              |

실패 예시:

```json
{
  "error": {
    "code": "AVAILABILITY_CONFLICT",
    "message": "다른 요청에서 물품을 선택했습니다.",
    "retryable": false,
    "details": { "reason": "RESERVED", "waitlistable": true }
  },
  "meta": {
    "contractVersion": "0.3.0",
    "serverTime": "2026-11-05T01:00:00.000Z",
    "traceId": "trace_y"
  }
}
```

### 5.3 대기열

`WaitlistEntry` = `{ id, itemId, userId, startAt, endAt, status: "WAITING" | "NOTIFIED" | "APPLIED" | "FULFILLED" | "EXPIRED" | "CANCELLED", position, priorityUntil, reservationId, closedReason, item: ItemSummary, createdAt, updatedAt }`. `position`은 같은 물품에서 아직 끝나지 않은 대기 중 순서(1부터)이고, 끝난 대기는 `null`이다.

| 메서드·경로                     | 본문                         | 결과                               | 권한·오류                                                                                                                                                                   |
| ------------------------------- | ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /waitlist-entries`        | `{ itemId, startAt, endAt }` | 201 `WaitlistEntry` `WAITING`      | 422 기간 형식. 409 `ALREADY_WAITLISTED`(본인의 진행 중 대기와 기간 겹침). 409 `NOT_WAITLISTABLE` `{ reason }`(지금 바로 신청 가능하거나, 점유가 풀려도 신청할 수 없는 사유) |
| `GET /waitlist-entries?status=` | -                            | 200 `{ items, nextCursor }` 최신순 | 본인 것만                                                                                                                                                                   |
| `DELETE /waitlist-entries/{id}` | 없음                         | 200 `WaitlistEntry` `CANCELLED`    | 본인만. 이미 끝난 대기는 409 `INVALID_STATE`. 우선권을 가진 대기를 취소하면 즉시 다음 순위를 검토한다                                                                       |

### 5.4 알림

`Notification` = `{ id, type, title, body, link, reservationId, waitlistEntryId, requestId, negotiationId, itemId, createdAt, readAt }`. `type`은 `RESERVATION_REQUESTED`, `RESERVATION_CONFIRMED`, `RESERVATION_DECLINED`, `RESERVATION_CANCELLED`, `RESERVATION_EXPIRED`, `WAITLIST_AVAILABLE`, `WAITLIST_EXPIRED`, `NEGOTIATION_REQUESTED`, `OFFER_RECEIVED`, `INTAKE_FAILED` 중 하나다. `link`는 앱 내부 경로다(예: `/reservations/rsv_1`).

| 메서드·경로                                 | 본문                                                       | 결과                                                             |
| ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /notifications?unread=&cursor=&limit=` | -                                                          | 200 `{ items, nextCursor, unreadCount }` 최신순                  |
| `POST /notifications/read`                  | `{ notificationIds: [...] }` (1~50개) 또는 `{ all: true }` | 200 `{ unreadCount }`. 남의 알림 ID는 무시(존재를 드러내지 않음) |

### 5.5 SSE 이벤트

기존 `/events` 스트림에 `reservation.updated`(`reservationId`), `waitlist.updated`(`waitlistEntryId`), `notification.created`(`notificationId`)를 추가한다. 웹은 해당 조회를 무효화한다. 기존 이벤트 형식은 그대로다.

## 6. 상태·동시성·실패

예약 상태:

```text
바로 신청 → PENDING ─(소유자 승인 / 공공 모의 승인, 점유 검사 통과)→ CONFIRMED ─(요청자 취소, 시작 전)→ CANCELLED
                    ├─(소유자 거절 / 공공 모의 거절)→ DECLINED
                    ├─(같은 기간이 다른 예약으로 확정)→ DECLINED (closedReason=PERIOD_TAKEN)
                    ├─(응답 기한 경과)→ EXPIRED
                    └─(요청자 취소)→ CANCELLED
미리보기 확정(협상 선택 + ACTIVE 데모 점유) → CONFIRMED  (점유는 RELEASED, 소유자 응답은 협상에서 이미 받음)
```

- 사람의 확인 시점: 요청자의 신청·확정·취소 버튼, 소유자의 승인·거절 버튼. AI와 1번 도구는 예약 원장에 쓰지 않는다. 1번 도구는 기존처럼 협상 제출까지만 한다.
- 응답 기한: `min(신청 + responseMs, 시작 시각)`. `responseMs`는 기본 24시간, `expiry-fast`는 90초다(기존 seed 타이밍).
- 중복 점유 방지: 확정·승인·확정 전환·데모 점유 생성은 모두 `items` 행을 `FOR UPDATE`로 잠근 뒤 가용성을 검사한다. 최종 보증은 DB 배타 제약이다. `reservations`는 `status='CONFIRMED'`에서 같은 물품의 기간 겹침을 금지하고, `demo_holds`는 기존 제약을 그대로 쓴다. 두 소유자가 동시에 승인하면 한쪽만 `CONFIRMED`가 되고 다른 쪽은 409를 받는다. 확정되는 순간 같은 기간의 다른 `PENDING`은 `DECLINED`(`PERIOD_TAKEN`)가 되고, 해당 요청자에게 대기 등록 안내 알림이 간다.
- 공공 물품: 바로 신청은 `PENDING`으로 저장된다. 이후 정리 작업(worker 1초 주기)이 물품의 `publicScenario`(`APPROVE`/`DECLINE`)에 따라 모의 응답한다. 점유 충돌이 있으면 `DECLINED`(`PUBLIC_DEMO_DECLINED`)다.
- 대기 우선권: 점유가 풀리면 정리 작업이 대기를 처리한다. 확정 취소, 데모 점유 만료, 우선권 만료, 우선권 대기 취소, 우선권으로 낸 신청의 거절·만료·취소가 이에 해당한다. 같은 물품의 `WAITING`을 순번대로 보고, 기간이 지금 가용하고 다른 우선권과 겹치지 않는 첫 대기를 `NOTIFIED`로 바꾼다(`priorityUntil = now + priorityMs`, 기본 30분, `expiry-fast` 30초). 우선권 동안 다른 사용자의 신청·승인·데모 점유는 `WAITLIST_PRIORITY`로 막힌다. 본인이 신청하면 `APPLIED`가 되고, 그 신청이 결정될 때까지 우선권을 유지한다. 확정되면 `FULFILLED`, 거절·만료·취소면 `EXPIRED` 후 다음 순위로 넘어간다. 본인의 어느 경로든 같은 물품·겹치는 기간이 확정되면 `FULFILLED`다. 시작 시각이 지난 대기는 `EXPIRED`(`PERIOD_STARTED`)다.
- 물품 수정·비활성화: 확정 예약은 유지한다. 예약은 물품 요약·금액·장소 스냅샷을 가진다. 비활성 물품의 `PENDING` 승인은 409 `AVAILABILITY_CONFLICT`(`ITEM_DISABLED`)이고, 소유자는 거절할 수 있다.
- 1번 도구 영구 실패: 연속 실패가 10회이거나 승인 후 30분이 지나도 진행되지 않으면 `FAILED`(종료 상태)다. 요청자에게 `INTAKE_FAILED` 알림을 보낸다("요청함에서 직접 진행해 주세요"). 클라이언트 재전송 대기열은 재시도할 수 없는 4xx 응답이거나 10회 실패하면 멈추고 실패를 표시한다.
- 늦은 응답·재시도: 모든 쓰기는 멱등 키를 쓴다. 응답·취소는 `expectedVersion`으로 늦은 화면의 명령을 막는다.
- 권한 없는 호출: 예약·대기·알림은 본인 것이 아니면 404다. 소유자만 응답, 요청자만 취소할 수 있다.

## 7. 전환·데이터 마이그레이션·롤백

1. 조사: 예약 원장이 없으므로 이관할 데이터는 없다. 기존 `demo_holds`·협상은 그대로 둔다.
2. `004_reservations.sql`: 새 테이블 4개(`reservations`, `reservation_events`, `waitlist_entries`, `notifications`)를 추가하고 기존 테이블은 바꾸지 않는다. seed의 `TRUNCATE … CASCADE`가 사용자·물품 FK를 따라 새 테이블도 비운다.
3. 전환: 화면 링크·버튼 추가로 시작한다. 기존 협상 흐름은 확정 버튼을 누르지 않으면 이전과 같다.
4. 롤백: 웹에서 확정 버튼·카탈로그 라우트를 숨기고 API 플러그인 등록 1줄을 지우면 이전 동작으로 돌아간다. `availability()`의 추가 검사는 확정 예약이 없으면 영향이 없다. 테이블은 남겨도 무해하다.
5. 임시 이중 구현 없음. `/items`(공개 조회)와 `/catalog`(세션·가용성 결합)는 용도가 달라 둘 다 유지한다.

## 8. 화면

- 하단 탭: 홈 · 둘러보기 · 공유대여 · 요청함 · 빌려주기 · 센터. `내 정보`는 머리말 아이콘 링크(접근 이름 `내 정보`)로 옮기고, 그 옆에 알림 버튼과 읽지 않은 수를 둔다.
- `/catalog`: 검색어·분류·출처 필터, 기간 선택(선택 시 가용 표시·총액), 카드 목록.
- `/catalog/:itemId`: 사진·설명·하루 대여료·장소·점유 기간. 기간·장소를 고르면 가용성을 확인한다. 가용하면 "대여 신청", 점유 중이면 "대기 신청"(순번 표시), 본인 물품이면 안내만 보여 준다.
- `/reservations/:id`: 상태·물품·기간·장소·금액·이력. 요청자는 취소, 소유자는 승인·거절(사유 선택)을 할 수 있다.
- `/inbox`: 빌리기 탭에 "내 예약", "대기 중", 기존 요청을 둔다. 빌려주기 탭에 "예약 신청"(소유자 응답)과 기존 협상 카드를 둔다.
- `/notifications`: 알림 목록(읽음 처리, 항목 이동).
- 결제 미리보기: 데모 점유가 유효하면 "예약 확정하기(결제 없음)"를 보여 준다. 기존 "데모 확인 완료"(쓰기 요청 없음)는 유지한다. 확정되면 예약 화면으로 이동하고, 같은 요청을 다시 열면 확정 예약 링크를 보여 준다.

## 9. 수용 기준

| 시나리오                                                             | 기대 결과                                                                                    | 테스트                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 2번 사진 게시 → 카탈로그 노출 → 바로 신청 → 소유자 승인              | 카탈로그에 게시 물품, `PENDING`→`CONFIRMED`, 소유자·요청자 알림                              | `apps/api/src/reservations/reservations.test.ts`  |
| 같은 기간 두 신청을 동시에 승인                                      | 하나만 `CONFIRMED`, 다른 쪽 409 또는 `PERIOD_TAKEN`, DB 겹침 없음                            | 같은 테스트(동시 실행) + `packages/db` 테스트     |
| 확정 기간에 신청                                                     | 409 `RESERVED`, 대기 등록 → 순번 1                                                           | API 테스트                                        |
| 확정 취소 → 1순위 우선권 → 타인 신청 차단 → 우선권 만료 → 2순위 알림 | `NOTIFIED`(30분), 타인 409 `WAITLIST_PRIORITY`, 만료 후 다음 순위 `NOTIFIED`, 자동 예약 없음 | API 테스트(시계 주입)                             |
| 우선권 보유자 신청 → 소유자 거절                                     | `APPLIED` → `EXPIRED`, 다음 순위 알림                                                        | API 테스트                                        |
| 공공 물품 바로 신청                                                  | 정리 작업 후 `APPROVE` 물품은 `CONFIRMED`, `DECLINE` 물품은 `DECLINED`                       | API 테스트                                        |
| 응답 기한 경과                                                       | `EXPIRED`, 이후 승인 410                                                                     | API 테스트                                        |
| 협상 선택 → 미리보기 확정                                            | `CONFIRMED`, 데모 점유 `RELEASED`, 재확정은 같은 예약, 점유 만료 후 확정 410                 | API 테스트                                        |
| 확정 예약 기간의 1번 검색                                            | 후보 `UNAVAILABLE`(`RESERVED`)                                                               | API 테스트                                        |
| 1번 도구 영구 실패                                                   | `FAILED` + `INTAKE_FAILED` 알림                                                              | `intake-approvals.test.ts`                        |
| 1번 기존 동작                                                        | 보호 파일 무변경, 기존 테스트·수용 테스트 통과                                               | `check:boundaries`, `npm test`, `test:acceptance` |
| 화면                                                                 | 390×844에서 카탈로그→신청→승인→알림→취소·대기, 가로 넘침 없음                                | Playwright(실제 API·DB·worker, AI fixture)        |

## 10. 미결정·모듈 간 합의

| 질문                                                 | 영향 | 결정·근거                                                                                                                              |
| ---------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 3번이 `GET /listings`와 `items` 투영 중 무엇을 읽나  | 2↔3  | `items` 투영. 1번 검색과 같은 원장을 쓰고, 설명만 2번 읽기 함수로 가져온다. 0002의 "둘 다 제공"은 2번 소유자 관리용 `/listings`로 유지 |
| 2번 경로 이름 `/item-drafts`+`/items` vs `/listings` | 2    | `/listings` 유지(0002 구현). 기존 `/items`는 공개 조회로 유지                                                                          |
| 1번 경로 이름(`/requests/{id}/messages` 등)          | 1    | 구현 보류. 같은 기능이 현행 경로에 있고, 음성 경로 변경은 보호 파일 수정이 필요하다(사용자 결정 3)                                     |
| 음성 통화의 예약 상태 안내                           | 1    | 구현 보류. `bindings.ts`(보호)가 통화 문맥을 만든다. 화면에서는 예약 상태와 알림을 제공한다                                            |

## 11. 완료·검증 기록

검증일 2026-11-05, 로컬 PostgreSQL 16·Node 22, `AI_MODE=fixture`.

| 항목                  | 명령·방법                                                                                              | 결과                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1번 전용 파일 보존    | `npm run check:boundaries`                                                                             | 통과 (22개 변경 없음)                                                                                                                                                                                                                                                                                                                                                                                 |
| 타입                  | `npm run typecheck`                                                                                    | 통과                                                                                                                                                                                                                                                                                                                                                                                                  |
| 전체 테스트           | `npm test`                                                                                             | 29파일·231개 통과. 변경 전 28파일·222개에 신규 9개 추가: 3번 API 7개, 도구 영구 실패 1개, 재전송 중단 1개                                                                                                                                                                                                                                                                                             |
| OpenAPI               | `npm run openapi` + contracts 테스트                                                                   | 54 operations(+13) 재생성, 통과. 오류 코드 수 검사는 20→23으로 갱신                                                                                                                                                                                                                                                                                                                                   |
| 수용 테스트           | `npm run test:acceptance`                                                                              | 35/36 통과. AT13은 저장소에 없는 음성 fixture(`apps/api/test/fixtures/voice/live-2026-10-31T15-50-15.138Z.json`)를 읽어 실패(0003과 같은 기존 상태). 조정한 AT19/AT20 통과                                                                                                                                                                                                                            |
| 웹 빌드               | `npm run build`, `npm run -w @sb/web test:build`                                                       | 통과                                                                                                                                                                                                                                                                                                                                                                                                  |
| e2e                   | Docker 대신 로컬 대체 스택(빌드 결과 `vite preview` :8000 + API·worker·PostgreSQL, 사전 설치 Chromium) | default: multiparty·AT20 통과. expiry-fast: AT19 통과(확정 버튼을 누르지 않으면 30초 점유가 그대로 만료). AT22(PWA)는 `in-incognito` 설치성 오류로 실패하며, 변경 전 기준 코드도 같은 환경에서 같은 실패(환경 요인)                                                                                                                                                                                   |
| e2e 요청 한도         | 같은 스택에서 변경 전 기준 코드와 비교                                                                 | e2e는 세 사용자를 한 IP(Caddy)로 보낸다. 기준 코드도 약 30초에 137회 요청해 분당 120회 한도를 넘었고 AT14 단계에서 429로 실패했다. 0004의 조회(알림·예약·대기)가 더해져 더 이른 단계에서 429가 났다. `APP_MODE=automated-test`에서만 한도를 1000으로 올렸고(`apps/api/src/server.ts`) 429 없이 통과했다. 데모·운영 모드 한도는 그대로다. 3번 조회는 주기 조회를 없애고 첫 동기화의 중복 조회를 줄였다 |
| 화면                  | Playwright 390×844, 실제 API·worker·DB                                                                 | 카탈로그 검색 → 상세(가용·총액) → 신청 → 소유자 알림 배지·요청함 승인 → 신청자 알림 → 다른 이웃 대기 등록 → 확정 취소 → 1순위 우선권 표시·신청 화면. 결제 미리보기 확정 → 예약 화면·소유자 알림. 페이지 오류·가로 넘침 없음                                                                                                                                                                           |
| 실제 사람 음성·휴대폰 | -                                                                                                      | 미검증(API 키·마이크 없음, 0003과 같음)                                                                                                                                                                                                                                                                                                                                                               |

남은 제약:

- 1번 잠금 유지로 보류한 항목: 음성 통화의 예약 상태 안내(`bindings.ts`), 구 음성 화면 정리, 분담도의 1번 경로 이름.
- 사용자 결정으로 제외한 항목: 이웃 요청 공개, 무료 나눔, 분류 확장, 수령·반납과 사진 비교, 3D 캐릭터, 대여 연장, 이미지 삭제·보관 정책.
- Docker 기반 `npm run test:e2e`는 이 환경에 Docker 데몬이 없어 실행하지 않았다(위 로컬 대체 스택으로 같은 spec 파일을 실행).
