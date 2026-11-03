> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `tests/acceptance/REPORT.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../../../README.md)을 먼저 확인하세요.

# W3 Acceptance — AT01–AT20 서버 통합 수용 보고

계약 `0.1.0` · Node.js `26.8.2` · npm `11.19.1` · PostgreSQL `16.15` · Vitest `5.0.5`.

수용 프로젝트 **36/36**, 전체 워크스페이스 회귀 테스트 **180/180**가 통과했다. 기본 다자 흐름은 **10/10 성공(실패율 0%)**했고, SSE 372건의 지연 p95는 **20.882ms**, 보수적 상한 p95는 **23.758ms**였다. 동일 사용자의 동시 요청 생성에서 재현한 DB 교착상태를 수정했다.

## 재현과 실행 결과

공유 compose DB 서비스가 실행된 저장소 루트에서 다음 명령을 실행한다. `test:acceptance`는 자체 Vitest 프로젝트를 사용하므로 전체 워크스페이스 테스트와 별도로 실행한다.

```sh
npm run test:acceptance
npm test
npm run typecheck
npx tsc -p tests/acceptance/tsconfig.json
```

이번 작업에서 실제 실행한 최종 검증 명령과 증거:

| 명령                                                                                                                                                         | 결과                               | 증거                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| `npm run test:acceptance -- --reporter=verbose`                                                                                                              | 종료 0, 4개 파일 / 36개 통과       | 전체 수용 출력 (실행 산출물은 공유본에서 제외)             |
| `npm test -- --reporter=verbose`                                                                                                                             | 종료 0, 18개 파일 / 180개 통과     | 전체 회귀 출력 (실행 산출물은 공유본에서 제외)             |
| `npm run typecheck`                                                                                                                                          | 전체 workspace 종료 0              | 출력 (실행 산출물은 공유본에서 제외)                        |
| `npm run -w @sb/db typecheck -w @sb/api`                                                                                                                     | 최종 서버 수정 후 종료 0           | 출력 (실행 산출물은 공유본에서 제외)                 |
| `npx tsc -p tests/acceptance/tsconfig.json`                                                                                                                  | 수용 코드 strict TypeScript 종료 0 | 직접 실행                                            |
| `npm test -- --project @sb/db src/locking.test.ts --reporter=verbose`                                                                                        | 수정 전 실패 / 수정 후 1개 통과    | [재현 테스트](../../../../../packages/db/src/locking.test.ts) |
| `npm test -- --project @sb/api src/sse.test.ts --reporter=verbose`                                                                                           | 2개 통과                           | 전체 회귀에도 포함                                   |
| `npx prettier --check tests/acceptance/*.ts tests/acceptance/tsconfig.json packages/db/src/unit.ts packages/db/src/locking.test.ts apps/api/src/sse.test.ts` | 종료 0                             | 직접 실행                                            |

API는 실제 Fastify `inject`로 Origin·쿠키·CSRF·멱등 키·권한·스키마·도메인 명령까지 실행한다. SSE는 실제 `127.0.0.1` 임의 포트의 HTTP 스트림을 `fetch`로 읽는다. 각 사례/반복은 별도 `sb_test_<uuid>` PostgreSQL DB를 생성·마이그레이션·seed하고 종료 시 삭제하며, 공유 개발 DB를 초기화하지 않는다.

worker는 실제 `RentalWorker`와 pg-boss 큐·outbox를 구동한다. 재시작 사례는 별도 Node 프로세스를 실제 `SIGKILL`하고 다시 시작한다. AI는 명시적 `AI_MODE=fixture`이며, 주민 승인·거절·변경은 각각 두리/슬의 별도 세션 HTTP 요청으로만 보낸다. `injectOwnerResponse`와 mock DB/HTTP/worker는 사용하지 않는다.

## AT별 결과

아래 PASS는 W3의 **서버 자동화 범위**다. 음성 및 화면에 관한 한계는 아래 별도로 기록했다.

| ID   | 결과            | 실행·검증                                                                                                                                                                     |
| ---- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT01 | PASS            | 준비된 handle만 진입, 미등록 422, `demo_session; HttpOnly; SameSite=Lax; Path=/` 쿠키, CSRF, actor 위조 필드 거절                                                            |
| AT02 | PASS, 서버 경로 | 빈 draft → agent-turns → 실제 worker ROUTE/EXTRACT; 모레 10시~다음날 16시를 서울 기준 절대 UTC로 확인, 장소 보완 질문, DRAFT/version/전송 0건 유지                            |
| AT03 | PASS            | 공공 PENDING_PUBLIC → 실제 1–2초 어댑터 지연 → PUBLIC_DEMO Offer → 3,000원 preview, 실제 접수번호 없음                                                                        |
| AT04 | PASS            | 하나·두리·슬 각 세션, OwnerCard 격리와 다른 소유자 404, 요청자는 두 주민 응답과 대기를 비교                                                                                   |
| AT05 | PASS            | 한 분기 거절 후 다른 분기 승인·선택 가능, 거절 이력 보존                                                                                                                      |
| AT06 | PASS            | 소유자 4,500원/library 변경 → 요청자 24시간/center/2,000원 변경 → 재승인, termsRevision 1→2→3, 이전 Offer 무효, 불변 이력·가격 재계산                                         |
| AT07 | PASS            | 정확한 Offer 선택, SELECTED 1개·SUPERSEDED·hold 1개·미리보기, 이벤트 동일 트랜잭션 확인                                                                                       |
| AT08 | PASS            | 슬이 두리 분기 승인 시도 → 404, 요청/분기 snapshot 및 이벤트 cursor 불변                                                                                                      |
| AT09 | PASS            | 오래된 request/negotiation/terms 버전, 만료 quote, 실제 시간 경과 Offer 만료 거절; 기존 조건 APPROVE는 quote 만료와 독립                                                      |
| AT10 | PASS            | 같은 키 submit 동시 재전송/선택 재전송의 응답 전체 동일, 변경 body 409, 중복 분기/hold 없음                                                                                   |
| AT11 | PASS            | 하나의 두 독립 세션이 서로 다른 Offer 동시 선택 → 200 1개/409 1개, SELECTED·hold 각각 1개                                                                                     |
| AT12 | PASS            | 하나·준이 같은 물품/겹친 기간 동시 선택 → hold 1개, 패자 UNAVAILABLE, 다른 제안은 유지·선택 가능                                                                              |
| AT13 | PASS, 복구 경로 | SSE/데모 세션 종료 → 실제 소유자 HTTP 응답 → 같은 사용자 재진입·sync·비교 복원; Live 종료는 W2 증거와 결합                                                                    |
| AT14 | PASS            | 실제 SSE replay/누락 복구, Last-Event-ID 우선, heartbeat 무 ID, 생산 EventGate 중복/낮은 버전 거절, cursor 만료 sync.required, 사용자 회전/이전 세션 401/다른 사용자 자료 404 |
| AT15 | PASS            | failure/timeout/invalid-option fixture → BASELINE, 실제 8초 deadline 후 늦은 결과 무시, 공공 PUBLIC_FIXED 유지                                                                |
| AT16 | PASS            | 악성 SELECTED/PAID/결제 완료 결과 거절, draft 및 업무 상태 유지, 실제 소유자 승인은 유지되고 자동 선택/hold/결제 없음                                                         |
| AT17 | PASS            | outbox/큐 중복 효과 1회, 처리 중 worker SIGKILL 후 durable job 재개, 취소 중 공공 어댑터의 늦은 결과 폐기                                                                     |
| AT18 | PASS            | 후보 없음 NO_MATCH, 주민/공공 거절 NO_OFFERS, 무응답 root 90초 EXPIRED, 일시적 검색 실패 3회 후 FAILED, 자동 주민 승인 없음                                                   |
| AT19 | PASS            | PREVIEW_ONLY/chargeable=false/NOT_APPLICABLE, 실제 hold 만료 후에도 요약·결제 상태 유지, 재점유 거절, payments/token route 없음                                               |
| AT20 | PASS, API 경계  | Fastify 등록 route 목록 검사와 POST 호출에서 프로그램·동아리·공간 신청/예약/회원/결제/reset 경로 없음                                                                         |

[흐름 테스트](../../../../../tests/acceptance/flows.test.ts), [SSE·실패·재시작 테스트](../../../../../tests/acceptance/recovery.test.ts), [반복 테스트](../../../../../tests/acceptance/repetition.test.ts), [실제 만료 테스트](../../../../../tests/acceptance/expiry.test.ts), [테스트 실행 기반](../../../../../tests/acceptance/harness.ts).

## 기본 다자 흐름 10회 및 SSE

각 실행은 새 DB의 기본 seed 날짜 D를 사용했다. 30시간은 청구 2일이다. 공공은 1,500×2=3,000원으로 고정, 두리는 B/L/U=4,000/3,000/5,000원, 슬은 3,000/2,000/4,000원으로 단정했다. 두리는 실제 소유자 세션으로 4,500원·library COUNTER, 슬은 이미 제시된 3,000원·station을 APPROVE했다. 하나는 두리를 선택하고 공공·슬은 SUPERSEDED가 되며, 4,500원 미리보기에서 끝난다.

| 반복 | 결과 | 전체 시나리오 시간 |
| ---- | ---- | ------------------ |
| 1    | PASS | 2.837초            |
| 2    | PASS | 2.649초            |
| 3    | PASS | 3.546초            |
| 4    | PASS | 3.301초            |
| 5    | PASS | 3.482초            |
| 6    | PASS | 2.788초            |
| 7    | PASS | 3.317초            |
| 8    | PASS | 2.654초            |
| 9    | PASS | 3.138초            |
| 10   | PASS | 2.480초            |

10회 중 9회 이상 도달 기준을 통과했다. 위 시간은 DB/API/worker 준비부터 선택·SSE 수신까지 포함한다.

SSE 지연은 같은 Node monotonic clock으로 실제 SQL `COMMIT` 호출 직전·응답 직후와 TCP SSE frame 파싱 시각을 기록했다. SQL이나 반환 데이터를 대체하지 않았으며, 측정 observer는 연결이 pool로 돌아가기 전에 제거한다. 실제 commit은 송신~응답 구간 안에 있으므로 `수신−COMMIT 응답`은 하한 추정이며, `수신−COMMIT 송신`을 보수적 상한으로 함께 기록했다. 응답 확인보다 SSE가 먼저 도착하는 경우 하한은 0으로 둔다. heartbeat는 제외했다.

- 표본: **372건**.
- 하한 추정 p95: **20.882ms**, 최대 **52.264ms**.
- 보수적 상한 p95: **23.758ms**, 모든 표본의 상한 2,000ms 미만을 단정.
- 원자료: repetition.json (실행 산출물은 공유본에서 제외).

이 수치는 PC loopback 서버→SSE 수신 지연이다. 휴대폰 Wi-Fi, 화면 렌더링, 실제 음성 품질/지연의 실기기 검증을 대신하지 않는다.

## 실제 시간 경과 만료

`expiry-fast` 원본 정책(응답/root 90초, Offer/hold 30초)을 그대로 사용하고 fake timer나 DB 기한 수정 없이 기다렸다. API GET의 지연 만료 처리에 의존하지 않도록 먼저 DB 저장 행을 읽어 worker의 실제 만료 처리를 확인했다.

hold 만료 관측은 시나리오 시작 후 **31.632초**, root 만료 관측은 **90.119초**였다. Offer 선택은 `410 OFFER_EXPIRED`, 무응답 root는 `EXPIRED`, 선택했던 요청의 결제 상태는 `NOT_APPLICABLE`을 유지했다. 만료된 선택을 새 키로 다시 선택하면 `ALREADY_SELECTED`이며, 새 hold가 생성되지 않았다. 원자료 (실행 산출물은 공유본에서 제외).

## 발견·수정한 결함

1. **서버 교착상태** — 같은 사용자의 두 요청 INSERT가 사용자 FK의 KEY SHARE 잠금을 가진 상태에서 이벤트 cursor 처리의 `FOR UPDATE`로 동시에 승격하며 deadlock이 발생했다. [Unit.flush](../../../../../packages/db/src/unit.ts)는 변경하는 필드가 `event_cursor`뿐이므로 `FOR NO KEY UPDATE`를 사용하도록 수정했다. 정렬된 수신자 잠금과 cursor 직렬화·트랜잭션 순서는 유지한다. [결정적 재현](../../../../../packages/db/src/locking.test.ts)은 두 실제 트랜잭션을 INSERT 직후 barrier에서 만나게 한다. 수정 전 하나가 거절됐고, 수정 후 둘 모두 commit되며 연속 cursor와 두 요청 snapshot을 확인했다.
2. **기존 SSE 회귀 테스트의 타이밍 가정** — 전체 병렬 실행에서 40ms heartbeat가 durable replay보다 먼저 와 `id=undefined`로 실패했다. [sse.test.ts](../../../../../apps/api/src/sse.test.ts)는 heartbeat를 건너뛴 뒤 기존 정확한 이벤트 ID·내용 및 sync.required를 검사하도록 보완했다. 서버 이벤트 계약과 기대 업무 결과는 변경하지 않았다.
3. **수용 시나리오 작성 오류** — 처음에는 슬의 기존 3,000원·station과 똑같은 COUNTER를 보냈고 서버가 계약대로 `NO_CHANGES`를 반환했다. 동일 조건의 의사 표현은 APPROVE로 고쳤으며, 서버 검증이나 요금 기대값을 완화하지 않았다.

공개 계약, 모델 ID, 앱 화면, 인프라, 의존성은 변경하지 않았다. 루트 `package.json`에는 `test:acceptance` 스크립트만 추가했다.

## 음성·화면 검증 범위와 남은 관문

AT02의 실제 Live 음성은 W2 Voice 보고 (공유본 미포함: `../../apps/api/src/voice/README.md`)와 최종 Live 실행 JSON (실행 산출물은 공유본에서 제외)을 인용한다. 이 증거는 실제 Chrome WebRTC·지정 모델·합성 한국어 입력으로 HTTP 201, 추출 성공, DRAFT/전송 0건, `voice.closed confirmed=true`, 종료 후 원문 0건을 기록한다.

AT13의 이번 자동화는 종료된 SSE/데모 세션 뒤 소유자 응답이 DB에 남고 새 세션에서 복원되는 서버 경로를 검증했다. 같은 테스트에서 실제 Live를 새로 열어 종료시키지는 않았으며, Live 종료가 업무를 삭제하지 않는 경계는 W2의 실제 종료 증거와 기존 음성 통합 테스트를 함께 사용했다. 가짜 VoiceGateway를 추가해 실제 음성 시험으로 표시하지 않았다.

AT14의 브라우저 cache 정리와 AT20의 화면 문구·미리보기 동작은 W3 E2E가 담당한다. 이번 보고는 서버 projection 격리와 신청 API 부재를 확인한다. AT21(갤럭시·아이폰 마이크/설치), AT22의 실기기·스크린리더, 실제 사람 음성 품질은 미검증이며 사람이 기기에서 확인해야 한다.
