# 0007 · 거점 QR 인계 · 반납 사진 비교

| 항목           | 값                                                                                  |
| -------------- | ----------------------------------------------------------------------------------- |
| 상태           | implemented (실제 휴대폰 카메라 스캔·실사진 AI 비교는 미검증, 8절)                  |
| 작성·갱신일    | 2026-11-06                                                                          |
| 대상 모듈      | 3 (예약·대여 관리) · 공용(contracts·App 라우트·데모 사용자)                         |
| 기준 코드      | `e48c31b`                                                                           |
| 관련·대체 명세 | [0004](0004-reservations-waitlist-notifications.md) 확정 예약 이후 단계를 추가한다. |
| 1번 영향       | 없음 (3절)                                                                          |

## 1. 문제와 목표

기획서 v2 3장 ②"가까운 거점에서 받기"·③"찍어서 돌려주기"와 시연 ③④장면을 구현한다.

1. 확정 예약의 빌리는 사람 화면에 **인계 QR**(8자리 코드)을 보여준다.
2. **거점 관리자**(`demo-hub`)가 QR을 휴대폰 카메라로 찍으면 `/hub?code=…`가 열린다. 앱 안 스캐너는 만들지 않는다(OS 카메라가 URL을 연다). PC 시연을 위해 코드 직접 입력도 받는다.
3. 인계: 관리자가 **대여 전 사진**을 찍고 인계를 기록한다.
4. 반납: 관리자가 **반납 사진**을 찍으면 AI가 대여 전 사진과 비교해 **달라진 부분 후보**를 보여준다. AI는 판정하지 않는다.
5. 관리자가 **문제 없음/파손 있음**(메모)을 최종 판정한다.
6. 단계마다 빌리는 사람·빌려준 이웃에게 앱 알림을 보내고, 예약 화면에 진행 상태와 사진·판정을 보여준다.

제외: 이웃의 거점 입고·회수 단계, 거점별 관리자 배정(관리자 1명이 모든 장소 담당), 후기·신뢰 배지, 파손 보증·보험 처리, 조기 반납 시 점유 해제, 앱 내 카메라 스캐너.

## 2. 기존 기능과 겹침

| 기존 기능·파일·API                             | 새 기능                                             | 결정   | 최종 위치                                        | 기존 호출자 처리                       |
| ---------------------------------------------- | --------------------------------------------------- | ------ | ------------------------------------------------ | -------------------------------------- |
| `reservations`(0004) 상태 `CONFIRMED`에서 끝남 | `Reservation.handover`(단계·코드·사진·AI 비교·판정) | 확장   | `packages/db/src/reservations.ts` 끝의 인계 명령 | 상태 enum·배타 제약·점유 검사는 그대로 |
| `POST /api/v1/images`(2번 사진 업로드)         | 관리자가 대여 전·반납 사진 업로드                   | 재사용 | 2번 경로 그대로                                  | 변경 없음                              |
| `createListingDrafter`(2번 사진 AI)            | `createReturnInspector`(사진 2장 비교)              | 신규   | `packages/ai/src/inspection.ts`                  | 같은 runtime·모델 설정 사용            |
| 예약 취소(`CANCEL`)                            | 인계 뒤에는 취소 불가                               | 변경   | `allowedActions`·`cancelReservation`             | 인계 전 동작은 그대로                  |

검색 경로: `rg -n 'QR|handover|인계|반납' apps packages` — 기존 구현 없음.

## 3. 1번 보존과 공용 코드 영향

- 1번 전용 파일 22개 변경 없음(`npm run check:boundaries`). 접수·음성·신청서·검색 도구 경로를 호출하거나 바꾸지 않는다.
- 공용 `packages/contracts`: `reservation.ts`에 인계 스키마·경로 본문, 알림 유형 2개(`HANDOVER_PICKED_UP`, `HANDOVER_RETURNED`) 추가. `ReservationSchema.handover`는 기본값 `null`이라 기존 행·소비자와 호환된다. 1번 계약(`intake.ts`, 음성·요청 스키마)은 변경 없음.
- 공용 `apps/web/src/App.tsx`: `/hub` 라우트 1줄 추가. 기존 경로 그대로.
- 데모 사용자 `u_hub`(`demo-hub`)를 `@sb/demo-data` seed와 migration 005에 추가한다. 1번은 사용자 수에 의존하지 않는다.
- 회귀: 예약 API 테스트(인계 흐름 추가)와 전체 테스트, contracts 테스트.

## 4. 모듈·데이터 소유권

| 데이터                        | 소유 | 읽기                                                 | 쓰기                        | 수명                 |
| ----------------------------- | ---- | ---------------------------------------------------- | --------------------------- | -------------------- |
| `reservations.data.handover`  | 3    | 빌리는 사람(코드 포함)·빌려준 이웃(코드 제외)·관리자 | 관리자의 인계 명령만        | 예약과 같음          |
| 인계·반납 사진(`item_images`) | 2    | 세션 사용자(`GET /images/:id`)                       | 관리자 업로드(기존 2번 API) | 삭제 없음(기존 정책) |

## 5. API 계약 (`/api/v1`, 기존 envelope·세션·CSRF·Idempotency-Key)

모든 경로는 관리자(`u_hub`)만 호출할 수 있다. 다른 사용자는 404. 잘못된 코드는 404.

| 메서드·경로                      | 본문                                              | 응답           | 오류                                      |
| -------------------------------- | ------------------------------------------------- | -------------- | ----------------------------------------- |
| `GET /handovers/{code}`          | —                                                 | `HandoverView` | 404                                       |
| `POST /handovers/{code}/pickup`  | `{ expectedVersion, photoId }`                    | `HandoverView` | 409 `VERSION_CONFLICT`·`INVALID_STATE`    |
| `POST /handovers/{code}/return`  | `{ expectedVersion, photoId }`                    | `HandoverView` | 409, AI 실패는 `comparison.status=FAILED` |
| `POST /handovers/{code}/inspect` | `{ expectedVersion, result: OK\|DAMAGED, note? }` | `HandoverView` | 409, 422(`DAMAGED`인데 메모 없음)         |

`HandoverView`: `{ reservation, requesterDisplayName, ownerDisplayName|null, placeLabel }`.

```json
{
  "handover": {
    "code": "K7Q2M9XP",
    "stage": "RETURNED",
    "pickedUpAt": "2026-11-06T03:00:00.000Z",
    "pickupPhotoId": "img_a",
    "returnedAt": "2026-11-07T03:00:00.000Z",
    "returnPhotoId": "img_b",
    "comparison": {
      "status": "DONE",
      "summary": "손잡이 부분에 달라진 점이 있어요.",
      "differences": ["손잡이 아래쪽 긁힘으로 보이는 자국"]
    },
    "inspection": null
  }
}
```

## 6. 상태·동시성·실패

- 단계: `READY → PICKED_UP → RETURNED → COMPLETED`. 예약 `status`는 `CONFIRMED`로 유지된다. 확정 예약만 인계할 수 있고, 종료 시각이 지난 예약도 반납·판정은 받는다(늦은 반납).
- 사람의 확인 시점: 인계·반납·판정 모두 관리자가 버튼을 누를 때만 기록한다. AI 비교 결과는 후보 표시일 뿐이며 판정은 관리자만 한다.
- 동시성: 기존 잠금 순서(물품 → 예약)와 `expectedVersion`. 같은 요청 재시도는 Idempotency-Key로 재생된다.
- 취소: `PICKED_UP` 이후에는 `CANCEL`을 허용하지 않는다.
- AI 실패·지연: 비교를 실패로 기록하고(`comparison.status=FAILED`) 관리자가 사진만 보고 판정한다. AI 호출은 반납 트랜잭션 안에서 실행한다(2번 등록과 같은 제약, `ponytail` 주석).
- 코드: 예약 생성 시 8자리(혼동 문자 제외) 코드를 만든다. 고유 인덱스로 충돌을 막는다. 빌려준 이웃 화면에는 코드를 내리지 않는다.

## 7. 전환·데이터 마이그레이션·롤백

1. migration `005_handover.sql`: 기존 예약 행에 `handover`를 채우고(코드 생성), 코드 고유 인덱스와 `u_hub` 사용자를 추가한다. 재실행 안전(`ON CONFLICT DO NOTHING`, `handover IS NULL`인 행만).
2. 롤백: `/hub` 라우트와 인계 플러그인을 빼면 0004 동작으로 돌아간다. `handover` 필드는 남아도 무해하다.

## 8. 수용 기준과 검증 결과

2026-11-06, 로컬 PostgreSQL 16(Docker)·Node 22, `AI_MODE=fixture`.

| 시나리오                                   | 기대 결과                               | 테스트/절차                                                                          | 실제 결과                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 확정 → 인계 → 반납(AI 후보) → 판정         | 단계·사진·비교·판정 저장, 양쪽 알림     | `apps/api/src/handovers/handovers.test.ts`                                           | 통과                                                                                                                                                                                                        |
| 관리자 아닌 사용자·잘못된 코드             | 404                                     | 같은 테스트                                                                          | 통과                                                                                                                                                                                                        |
| 인계 전 반납·버전 충돌·메모 없는 파손 판정 | 409·409·422                             | 같은 테스트                                                                          | 통과                                                                                                                                                                                                        |
| 인계 후 취소                               | `CANCEL` 없음, 취소 409                 | 같은 테스트                                                                          | 통과                                                                                                                                                                                                        |
| 이웃 화면에 코드 숨김                      | 소유자 view의 `handover.code` 없음      | 같은 테스트                                                                          | 통과                                                                                                                                                                                                        |
| 화면                                       | QR 표시, `/hub` 인계·반납·판정          | Chrome, Vite dev + 로컬 API, 실제 버튼·파일 업로드                                   | 통과 (QR·코드 표시, 사진 2장 비교 카드, "문제 없음" 판정 후 완료)                                                                                                                                           |
| 타입·빌드·계약                             | 오류 없음                               | `npm run typecheck`, `npm run build`, `npm run openapi` + contracts·demo-data 테스트 | 통과 (59 operations)                                                                                                                                                                                        |
| 1번 기존 동작                              | 보호 파일 변경 없음, 회귀 없음          | `npm run check:boundaries`, `npx vitest run`                                         | 보호 파일 22개 변경 없음. 전체 258개 중 255 통과. 실패 3개(`db/voice.test.ts` 2, `api/origins.test.ts` 1)는 전체 병렬 실행 시 5초 시간 초과이며, 변경 전 `main`에서도 같은 3개가 실패하고 단독 실행 시 통과 |
| 실제 휴대폰 카메라 스캔·실사진 AI 비교     | OS 카메라가 `/hub` 열기, 비교 후보 품질 | 배포 환경에서 수동                                                                   | **미검증**                                                                                                                                                                                                  |

## 9. 미결정·모듈 간 합의

| 질문                         | 결정 전 가능한 작업 | 결정·근거                                    |
| ---------------------------- | ------------------- | -------------------------------------------- |
| 거점별 관리자 배정·운영 시간 | 관리자 1명 시연     | TBD (캠퍼스 거점 공간 확보 후)               |
| 이웃의 입고·회수 단계        | 인계·반납만         | TBD                                          |
| 파손 판정 후 보증·분쟁 처리  | 판정 기록만         | TBD (기획서 5장 수수료 보증, 보험 확인 필요) |

## 10. 완료·대체 기록

- 구현: `packages/contracts/src/reservation.ts`(인계 스키마), `packages/db/migrations/005_handover.sql`, `packages/db/src/reservations.ts`(인계 명령), `packages/ai/src/inspection.ts`, `apps/api/src/handovers/`, `apps/web/src/features/reservation/handover.tsx`, `/hub` 라우트, 데모 사용자 `demo-hub`.
- 웹 의존성 `uqr@0.1.3`(QR 인코딩, MIT, 의존성 없음) 추가. 사진 축소 함수는 `apps/web/src/lib/photo.ts`로 옮겨 2번 등록과 함께 쓴다.
- 남은 제약: 9절 미결정 사항, 8절 미검증 항목.
