# 0008 · QA 기능·배포 결함 수정 (디자인 유지)

| 항목        | 값                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| 상태        | implemented                                                                                                                |
| 작성·갱신일 | 2026-11-06                                                                                                                 |
| 대상        | 2·3·공용                                                                                                                   |
| 기준 코드   | 76bfdce60d278b32def486a8808383800651b4ca                                                                                   |
| 관련        | 0002, 0004, 0007; `../qa-reports/2026-11-06/QA-REPORT.md` (저장소 외부)                                                    |
| 1번 영향    | 사용자의 QA 전체 수정 요청에 따라 기존 접수 계약의 장소 목록 상한 오류만 복구. 보호 파일·프롬프트·실행 권한·음성 동작 유지 |

## 문제와 범위

- QA-001: `ExtractNeedInput.context.places.max(3)`이 전체 장소 9개를 거절해 모델 호출 전에 ZodError → WORKER_TASK_FAILED. 선택 장소 3개 제한과 전체 장소 안내 목록을 혼동했다.
- QA-002: 업로드가 base64 디코딩·길이만 검사해 비이미지도 저장한다.
- QA-003: HTTPS 공개 배포 쿠키에 Secure 속성이 없다.
- QA-004: Caddy SPA fallback이 없는 정적 파일에도 HTML/200을 반환한다.
- 목록의 첫 50개 잘림, 카탈로그 재조회 중복 누적과 검색 URL 동기화를 수정한다.
- 유효 세션 사용자의 요청 한도가 한 프록시 IP에 합산되는 문제를 검증된 사용자 ID별로 분리한다. 익명·잘못된 세션은 IP 한도를 유지한다.

디자인·CSS·문구·배치·아이콘은 유지한다. 기존 API 경로·응답 구조·업무 상태·멱등·동시성 규칙을 바꾸지 않는다. 실제 서비스 인증, 외부 전송, DB 초기화와 프로덕션 배포는 범위 밖이다.

## 계약·호출자와 1번 보존

`ExtractNeedInput.context.places`만 개수 제한을 제거한다. 모든 항목은 기존 PlaceSchema로 검증한다. `NeedDraft.preferredPlaceIds.max(3)` 및 추출 결과 검증·허용 장소 검사, 사람 확인·최신성·원문 정리는 유지한다. DB는 현재와 같이 전체 places를 전달한다. 데이터 마이그레이션은 없다. 생산자: database의 ROUTE 결과 처리와 음성 최종 추출; 소비자: checkedInput, Fixture/OpenAI ports. 기존 3개 장소 입력은 그대로 유효하다. OpenAPI는 생성기로 갱신한다.

이미지는 정적 JPEG/PNG/WebP만 엄격한 base64·전체 픽셀 디코딩·실제 MIME·5MB/16MP 상한을 검증하고 기존 바이트를 저장한다. 애니메이션은 첫 프레임만 검증하는 일을 피하도록 거절한다. 기존 브라우저 사진 선택 흐름은 정적 JPEG로 축소해 전송하므로 유지된다. 잘못된 요청은 BAD_REQUEST(400), 기존 MIME 허용목록 거절은 422. 반환 DTO·이미지 URL은 유지한다. 모듈 2·3 사진 업로드만 영향받는다.

공개 설정 Origin에 HTTPS가 있으면 세션 생성·삭제의 Secure를 활성화한다. 로컬 HTTP 테스트는 기존 false 유지, 명시적 buildApi 옵션 우선. 프록시 전달 헤더는 신뢰하지 않는다.

Rate limit은 onRequest에서 세션 쿠키를 DB로 검증한 경우만 userId 키를 사용한다. 임의 헤더·가짜 쿠키로 사용자 버킷을 지정할 수 없다. 인증·CSRF·멱등 키 거절은 preParsing으로 옮겨 제한이 먼저 실행되고 본문 파싱은 그 뒤에 실행되도록 한다. 검증한 세션은 인증 훅에서 재사용한다. 익명 로그인은 독립적인 IP 단위 30/min 제한을 유지한다. reviewer가 발견한 훅 순서 문제를 이 구조로 해결했다.

웹의 각 기존 queryKey를 유지하고 같은 목록 API의 nextCursor를 끝까지 조회한다. AbortSignal·세션 종료 취소를 유지한다. 카탈로그는 React Query infinite pages로 기존 더 보기 버튼을 사용하고 재조회 때 페이지를 대체한다. 새 UI는 추가하지 않는다.

## 실패·전환·롤백

이미지 검증 실패는 저장 전에 종료한다. 페이지 커서 순환은 오류로 중단하고 일부 목록을 정상 전체 목록처럼 표시하지 않는다. 취소·세션 전환은 요청을 중단한다. 자산 404는 static 경로에만 적용하고 API proxy·SPA navigation은 유지한다.

기존 저장 이미지·예약·요청을 마이그레이션하거나 삭제하지 않는다. 코드 롤백 가능. 수정 전의 손상 업로드는 별도 운영 정리 대상이며 이번 작업에서 임의 삭제하지 않는다.

## 검증 계획·결과

| 기준                                                | 검증                                | 결과                                                     |
| --------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| 9개 장소 접수 → 추출 성공, 초안 자동 확정 없음      | 실제 DB/worker + fixture ports 회귀 | 통과, 3개/9개 장소 모두 성공                             |
| 정상 JPEG/PNG/WebP와 비이미지·잘린 파일·MIME 불일치 | decoder 단위 + API 저장 전 거절     | 통과, byte/pixel 상한·애니메이션·DB 행 미생성 포함       |
| HTTPS/HTTP 쿠키 발급·삭제                           | API 통합                            | 통과                                                     |
| 사용자별 버킷 분리·같은 사용자 합산·가짜 쿠키       | API 통합                            | 통과, 전달 헤더 위조·로그인 30/min·CSRF-before-JSON 포함 |
| 없는 파일 404·실제 MIME·SPA 경로                    | Caddy HTTP 검증                     | 통과                                                     |
| 50개 초과 전체 목록·커서 순환·중단                  | 웹 페이지 조회 회귀                 | 통과, nested 예약 ID·metadata·중단 포함                  |
| 카탈로그 더 보기 → 재조회 → 필터 변경               | 실제 InfiniteQueryObserver          | 통과, 페이지 대체·중복 없음                              |
| 전체 타입·단위·DB/worker·acceptance·빌드·보호 검사  | 아래 명령 및 경계 reviewer          | 통과, 실행별 범위는 아래 기록                            |

실제 모델·브라우저·마이크·프로덕션 재검증은 로컬 fixture 검증과 구분해서 기록한다.

## 실행 결과와 남은 범위

2026-11-06, 주 검증 환경: Docker Node 26.8.2 / npm 11.19.1, PostgreSQL 16. TEST_DATABASE_URL은 개발 DB 서버를 가리키되 각 테스트는 독립 `sb_test_*` DB를 생성·삭제한다. 공유 업무 데이터·프로덕션 데이터는 초기화하지 않았다.

- `npm test -- --maxWorkers=2`: **39개 파일 / 281개 테스트 통과**, 최종 실행 186.65초.
- `npm run typecheck`: 7개 workspace 통과.
- `npm run build`: 통과, 기존 500kB 청크 경고 유지. CSS 파일명은 이전과 동일하며 CSS·디자인 자산의 git diff 없음.
- `npm run openapi`: 실행, 장소 입력 maxItems 3 제약 두 곳만 제거된 생성 결과 확인. 계약 회귀 통과.
- `node infra/scripts/verify-static.mjs`: 임시 Caddy 컨테이너·샘플 파일로 SPA navigation 5개, 없는 정적 파일 7개, 실제 JS MIME·갱신 파일 cache header 통과. 빌드 출력물을 읽거나 기존 스택을 중단하지 않는다.
- `npm run check:boundaries`: 보호 파일 22개 변경 없음. 기준 해시·검사기 변경 없음.
- `git diff --check`, 변경 파일 Prettier 검사 통과.
- 수용 테스트 `npm run test:acceptance -- --maxWorkers=1`: 36개 중 35개 통과, AT13은 이미 없는 10월 31일 Live 실험 JSON을 읽어 ENOENT. 현재 상태 복원 검증과 무관한 과거 파일 의존을 제거한 뒤 AT13만 재실행해 **1개 통과**. 36개 항목 모두 검증했으나 수정 후 전체 36개를 한 번에 다시 실행한 것은 아니다. 실제 30/90초 만료·10회 반복·SSE·SIGKILL 복구는 최초 전체 실행에서 통과했다.
- AT13 수정 후 별도 재실행과 Windows 로컬 smoke 일부는 기존 Node 22.23.2에서도 수행했다. 주 타입·회귀·빌드는 위 Node 26 환경 결과다.
- 전체 검증 중 발견한 기존 테스트 타이밍 문제: intake approvals의 백그라운드가 이미 신청을 전송했으면 `COLLECTING_OFFERS`도 관찰될 수 있다. 이 경우 반드시 job=SUBMITTED를 확인하고 기존 최종 협상 검증은 그대로 유지하도록 테스트를 바로잡았다. 초기 무제한 병렬 실행의 DB hook timeout은 실행 병렬도를 2로 제한한 최종 실행에서 해소했다.
- AGENTS가 요구하는 별도 read-only reviewer의 최종 검토: 남은 구체적 회귀·보호 경계 위반·부적절한 테스트 약화 없음.

실제 모델 호출·브라우저/실기기 음성·시각 검증·프로덕션 재배포/재검증은 미실행이다. 로컬 수정 완료이며 커밋·push·배포하지 않았다. 이전 QA 보고서의 운영 사이트 실패 판정은 배포 후 재검증 전까지 유지한다.

참고 문서: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [sharp constructor](https://sharp.pixelplumbing.com/api-constructor/). 추출의 실제 수정은 OpenAI SDK·모델·프롬프트가 아니라 서버 장소 디렉터리 입력 계약에만 적용됐다.
