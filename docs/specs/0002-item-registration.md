# 0002 · 2번 AI 물품 등록

| 항목           | 값                                                                                |
| -------------- | --------------------------------------------------------------------------------- |
| 상태           | **implemented** (모듈 간 경로 이름·3번 조회 계약은 9절 미결정)                    |
| 작성·갱신일    | 2026-11-04                                                                        |
| 대상 모듈      | 2 (공용: contracts·db migration·ai export·api 등록·App 라우트 추가)               |
| 기준 코드      | `3c3d03f`                                                                         |
| 관련·대체 명세 | [0001 3모듈 연동 준비](0001-module-integration.md)의 "물품 원장" 행을 구체화      |
| 1번 영향       | 없음. 기존 `items` 원장에 호환 투영을 추가할 뿐 1번 파일·프롬프트·라우트는 그대로 |

## 1. 개요 (문제와 목표)

빌려주는 이웃이 **사진 한 장**을 올리면 AI가 제목·분류·설명 초안과 "사진으로 확인할 수 없는 항목"을 만든다. 사람이 확인·수정하고 하루 대여료·주고받을 장소·대여 가능 기간을 넣은 뒤 **직접 게시**한다. 게시 물품은 수정·비활성화·재게시할 수 있다. AI는 자동 게시하지 않는다.

- 기술: Fastify 플러그인(`apps/api/src/listings`), PostgreSQL(`listings`, `item_images`), OpenAI Responses API 이미지 입력 + JSON schema 출력(`packages/ai/src/registration.ts`), React PWA 화면(`apps/web/src/features/listing`).
- 모델: `OPENAI_VISION_MODEL`이 있으면 그것, 없으면 `OPENAI_AGENT_MODEL`(기본 `gpt-6.1-terra`). `AI_MODE=fixture`면 고정 초안.
- 제외: 무료 나눔(대여료 0원), 이미지 삭제·용량 정리, "이거 있는 이웃?" 요청형 응답(3번 대기/알림과 함께 별도 명세), 반납 사진 비교.

## 2. 실행 방법

`.env`의 `OPENAI_API_KEY`만 있으면 된다. 추가 환경 변수는 선택 사항 `OPENAI_VISION_MODEL` 하나다. 실행은 [README](../../README.md)의 `npm run up`과 같다. 앱 하단 탭 **빌려주기** → **사진으로 등록하기**.

## 3. 기존 기능과 겹침

| 기존 기능·파일·API                      | 새 기능                                | 결정 | 최종 위치                     | 기존 호출자 처리                                                         |
| --------------------------------------- | -------------------------------------- | ---- | ----------------------------- | ------------------------------------------------------------------------ |
| `items` 테이블(seed 전용), `GET /items` | 게시 시 `items`에 RESIDENT 행을 upsert | 통합 | 원장 `listings`, 투영 `items` | 변경 없음. 1번 검색(`runSearch`)·가용성 검사가 게시 물품을 그대로 찾는다 |
| 없음 (등록 기능 없었음)                 | `/images`, `/listings` API, 등록 화면  | 신규 | 2번                           | 해당 없음                                                                |

`items` 행은 `listings`에서만 파생된다(id 동일, `lst_` 접두사). 3번이 자체 catalog를 만들면 투영을 3번 쪽 어댑터로 옮기고 이 코드(`save()`의 upsert)를 지운다.

## 4. 1번 보존과 공용 코드 영향

- 1번 전용 파일 변경 없음 (`npm run check:boundaries` 통과).
- 공용 파일 변경은 모두 추가만 했다: `packages/contracts/src/index.ts`(export 1줄), `packages/ai/src/index.ts`(export 1블록), `apps/api/src/index.ts`(플러그인 등록 1줄), `apps/web/src/App.tsx`(라우트 3개·탭 1개), `app.css`(전용 클래스), migration `002`.
- 1번 검색은 `items`를 category로 읽는다. 투영 행은 기존 `ItemSchema`를 `parse`로 통과한 것만 쓰므로 형식이 같다. 비활성화는 `enabled=false`이며, 기존 `availability()`가 `ITEM_DISABLED`로 제외한다. 대여 가능 기간은 `unavailableIntervals`의 앞뒤 두 구간으로 변환한다.
- 새 AI 역할은 접수 runner·프롬프트·스키마를 쓰지 않는 별도 파일이다.

## 5. 소유 데이터 모델

| 데이터        | 소유 | 읽기                               | 쓰기         | 수명                       |
| ------------- | ---- | ---------------------------------- | ------------ | -------------------------- |
| `item_images` | 2    | 로그인 사용자 (`GET /images/{id}`) | 업로더 본인  | 삭제 없음 (TBD)            |
| `listings`    | 2    | 본인 전체, 타인은 PUBLISHED만      | 소유자만     | 삭제 없음, 비활성화로 대체 |
| `items` 투영  | 2    | 1번 검색, 기존 화면                | 2번 `save()` | listing 상태를 따라감      |

`Listing` (`packages/contracts/src/listing.ts`)

| 필드                           | 타입                                        | 비고                                |
| ------------------------------ | ------------------------------------------- | ----------------------------------- |
| `id`                           | string `lst_…`                              | 투영 item id와 동일                 |
| `ownerId`                      | string                                      | 서버 세션에서 결정                  |
| `status`                       | `DRAFT` / `PUBLISHED` / `INACTIVE`          |                                     |
| `version`                      | int ≥1                                      | 변경마다 +1, `expectedVersion` 검사 |
| `imageIds`                     | string[1..5]                                | 첫 장이 대표 사진                   |
| `aiStatus`                     | `DONE` / `FAILED`                           | FAILED면 빈 초안 + 직접 입력        |
| `title`, `description`         | string (≤120, ≤2000)                        | 초안은 빈 문자열 가능               |
| `category`                     | `CLEANING`/`TOOLS`/`TRAVEL`/`HOBBY` \| null |                                     |
| `unknowns`                     | string[≤10]                                 | AI가 사진으로 확인 못한 항목        |
| `dailyRateKrw`                 | int 1..1,000,000 \| null                    |                                     |
| `placeId`                      | string \| null                              | `/places`의 id                      |
| `availableFrom`, `availableTo` | UTC ISO \| null                             | null이면 제한 없음                  |
| `createdAt`, `updatedAt`       | UTC ISO                                     |                                     |

상태 전이: `DRAFT --publish--> PUBLISHED --deactivate--> INACTIVE --publish--> PUBLISHED`. 게시 조건: 제목·분류·대여료·실재하는 장소, 기간이 있으면 시작 < 끝. PUBLISHED 상태에서 PATCH하면 같은 조건을 다시 검사하고 투영을 갱신한다.

## 6. 제공 API

모두 `/api/v1` 아래, 응답은 기존 envelope `{data, meta}` / 오류 `{error:{code,message,retryable,details}, meta}`. 인증은 기존 데모 세션 쿠키. 쓰기 요청은 `Origin`, `X-CSRF-Token`, `Idempotency-Key` 필요(기존 규칙).

| 메서드·경로                      | 입력                                                                                                        | 출력·상태                     | 오류                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `POST /images`                   | `{contentType: image/jpeg\|png\|webp, dataBase64}` (≤5MB)                                                   | 201 `{id, url}`               | 400 크기, 422 형식                                          |
| `GET /images/{id}`               | –                                                                                                           | 200 이미지 바이트             | 404                                                         |
| `POST /listings`                 | `{imageIds[1..5], userNotes?}`                                                                              | 201 `Listing`(DRAFT, AI 초안) | 404 남의/없는 사진                                          |
| `GET /listings?mine=true`        | 페이지네이션 `cursor`, `limit`, `category?`                                                                 | 200 내 전체 상태              |                                                             |
| `GET /listings`                  | 같음                                                                                                        | 200 PUBLISHED만 (3번 조회용)  |                                                             |
| `GET /listings/{id}`             | –                                                                                                           | 200 `Listing`                 | 404 (남의 비게시 물품 포함)                                 |
| `PATCH /listings/{id}`           | `{expectedVersion, title?, category?, description?, dailyRateKrw?, placeId?, availableFrom?, availableTo?}` | 200 `Listing`                 | 404, 409 `VERSION_CONFLICT`, 422                            |
| `POST /listings/{id}/publish`    | `{expectedVersion}`                                                                                         | 200 PUBLISHED                 | 409, 409 `INVALID_STATE`(이미 게시), 422 `{details.fields}` |
| `POST /listings/{id}/deactivate` | `{expectedVersion}`                                                                                         | 200 INACTIVE                  | 409, 409 `INVALID_STATE`(게시 아님)                         |

정상 예시 (합성 데이터)

```http
POST /api/v1/listings
{"imageIds":["img_7f3c"],"userNotes":"충전기 포함"}

201 {"data":{"id":"lst_91ab","ownerId":"u_hana","status":"DRAFT","version":1,
 "imageIds":["img_7f3c"],"aiStatus":"DONE","title":"무선 청소기","category":"CLEANING",
 "description":"스틱형 무선 청소기입니다. 본체와 기본 흡입 헤드가 보입니다.",
 "unknowns":["배터리 지속 시간","충전기 포함 여부"],"dailyRateKrw":null,"placeId":null,
 "availableFrom":null,"availableTo":null,"createdAt":"…","updatedAt":"…"},"meta":{…}}
```

실패 예시

```http
POST /api/v1/listings/lst_91ab/publish
{"expectedVersion":1}

422 {"error":{"code":"VALIDATION_ERROR","message":"요청을 처리할 수 없습니다.",
 "retryable":false,"details":{"fields":["dailyRateKrw","placeId"]}},"meta":{…}}
```

## 7. 사용하는 타 모듈 API

`GET /places`(기존, 장소 선택용)만 사용한다. 3번 API는 호출하지 않는다.

## 8. 프론트 연동

| 라우트           | 화면                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| `/listings`      | 내 물품 목록(상태·대여료), 하단 탭 "빌려주기"                           |
| `/listings/new`  | 사진 선택(최대 5장, 기기에서 긴 변 1280px JPEG로 축소) + 메모 → AI 초안 |
| `/listings/{id}` | AI 초안 확인·수정, 미확인 항목 안내, 저장·게시·비활성화                 |

공통 `api`(CSRF·멱등 키), `useAction`, `ActionButton`, `ErrorNotice`, `PeriodFields`, react-query를 그대로 쓴다.

## 9. 이벤트·알림

발생·수신 이벤트 없음. 게시/비활성화는 `items` 투영으로 1번 검색에 즉시 반영된다.

## 10. 상태·동시성·실패

- 동시 수정: 행 잠금(`FOR UPDATE`) + `expectedVersion`. 재시도는 기존 `idempotency_records`가 같은 응답을 돌려준다.
- AI 실패·타임아웃·잘못된 출력: 초안을 빈 값으로 만들고 `aiStatus=FAILED`. 사용자는 직접 작성해 게시할 수 있다.
- AI 호출은 멱등 트랜잭션 안에서 수 초 걸린다(코드 `ponytail:` 주석). 동시 등록이 많아지면 비동기 작업으로 분리한다.
- 사용자 메모는 프롬프트에서 "지시 아님"으로 표시하고, 출력은 JSON schema + zod로 검증하며 사람이 확인하기 전에는 게시되지 않는다.

## 11. 수용 기준과 검증 결과

| 시나리오                                                                | 테스트                                                                                                                     | 결과                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 사진→초안→게시 거부(필수 누락)→수정→409 충돌→게시→`items` 투영→비활성화 | `apps/api/src/listings/listings.test.ts` (PostgreSQL)                                                                      | 미실행 (Docker 미기동)                                                                                                                                                                                                                                                                                                                                                    |
| 남의 사진·남의 초안 접근 404                                            | 같은 테스트                                                                                                                | 미실행 (Docker 미기동)                                                                                                                                                                                                                                                                                                                                                    |
| 실제 모델 이미지 입력                                                   | 수동: Wikimedia Commons 실물 사진 8장(청소기·드릴·여행 가방·텐트·프로젝터·선풍기·사다리·다리미)을 `gpt-6.1-terra`로 호출   | 8/8 성공, 장당 4.6~5.8초. 보이는 브랜드(Bosch·Panasonic·Russell Hobbs·InFocus)와 표기(18V 3.0Ah)만 사용, 모델명 추측 없음. 선풍기·다리미가 CLEANING으로 분류됨(분류 4종 한계) (2026-11-04)                                                                                                                                                                                |
| 실제 모델 이미지 입력 (확대)                                            | 수동: Wikimedia Commons 사진 33장, 공구·가전·캠핑·취미 30종 + 물품 아닌 사진 3장(고양이·풍경·어지러운 책상), 4개 동시 호출 | 33/33 응답 성공, 장당 2.5~7.4초. 제목의 브랜드·모델(Stanley GR35K, DJI Phantom Advanced 등)은 모두 사진에 인쇄된 표기. 오분류: 선풍기·핸드믹서·다리미 CLEANING, 자전거 HOBBY(분류 4종 한계). 물품 없는 사진은 "물품 확인 필요" 제목으로 `aiStatus=DONE` 반환 → 사람이 제목을 고쳐야 함. 어지러운 책상은 머그컵을 고르고 unknowns에 "대여할 물건 확인"을 남김 (2026-11-04) |
| OpenAPI에 2번 경로 노출                                                 | `npm run openapi`, contracts 테스트                                                                                        | `/images`·`/listings` 6개 경로 추가, 기존 경로·스키마 변화 없음, 52개 통과 (2026-11-04)                                                                                                                                                                                                                                                                                   |
| 1번 보존                                                                | `npm run check:boundaries`                                                                                                 | 통과, 기존 테스트 129개·typecheck·build 통과 (2026-11-04)                                                                                                                                                                                                                                                                                                                 |

## 12. 미결정·모듈 간 합의

| 질문                                                             | 영향 | 현재 처리                                               |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| 경로 이름: 분담도의 `/item-drafts`+`/items` vs 구현 `/listings`  | 2↔3  | 기존 `GET /items`와 충돌을 피해 `/listings`로 구현. TBD |
| 3번 catalog가 `GET /listings`를 읽을지, `items` 투영을 계속 쓸지 | 2↔3  | 둘 다 제공. 3번 결정 후 하나 제거                       |
| 무료 나눔(0원), 캠퍼스 물품(`CAMPUS` 출처)                       | 2,3  | 미구현. 기존 `KrwSchema`가 양수만 허용                  |
| 이미지 삭제·보관 기간                                            | 2    | 미구현                                                  |
