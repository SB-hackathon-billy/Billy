# 음성 에이전트 0.3.0 

현재 동작은 [공통 계약 §17](../../../../docs/COMMON_CONTRACT.md#17-에이전트-역할-분리수집-완료-자동-종료-030)을 따른다. 업무 기능·화면 추가 없이 역할 분리와 요청된 수집 완료 자동 종료만 반영했다.

| 모듈                      | 책임                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `@sb/ai` agents           | 역할·지시문·모델·시간 한도·결과 가드·실패 정책                            |
| `bindings.ts`             | 서버 세션으로 요청 조회·요약 제안, 비동기 조회 후 최신성 재검사           |
| `guards.ts`               | 현재 발화·수집 완료 판정, 선택 예산 제외                                  |
| `completion-audio.ts`     | 고정 종료 안내 전사와 Live PCM 시간 범위 연결, 30초 메모리 상한, 유한 WAV |
| `index.ts`                | 세션·revision·중복 방지·정리, 기존 finish 도메인 명령 연결                |
| web `voice-completion.ts` | 안내 WAV의 자연스러운 재생 종료 확인, 중단·오류 시 자동 종료 금지         |

새 발화는 후보와 재생을 취소한다. 자동 finish는 최신 taskId/inputRevision/requestVersion과 전달된 안내를 검사하며 같은 body만 재시도한다. 모델 발화나 도구 이름으로 종료·DB 변경을 실행하지 않는다. 자동 종료 뒤에도 승인·전송·선택·결제는 수행하지 않는다.

원문과 사용자 오디오를 로그에 남기지 않는다. 사용자 원음은 캡처하지 않으며 에이전트 종료 안내만 메모리에 잠시 두고 정정·종료 시 제거한다. 실제 사람/휴대폰 검증은 아직 별도다. 구조적 검증 결과는 [에이전트 개편 검증](../../../../docs/AGENT_REFACTOR_QA.md)에 기록한다.

이하 기록은 0.2.0 및 0.1.0 당시의 검증 이력이다.

---

# 음성 통화 0.2.0 변경 

QA 로그에서 통화 시작 시 `thinking`만 전달되고, 검색이 카테고리만 사용하며, 웹이 무작위 작업 ID 순서를 최신 순서로 오인하는 것을 확인했다.

- 통화 중에는 DRAFT를 유지하고 신청서 항목 추출만 한다. GPT-Live의 시작 developer 메시지와 null delegation commentary로 먼저 인사한다.
- 마지막 입력 뒤 900ms 후 `gpt-6-luna` Decisions로 완료·범위를 판단한다. 이는 단순 무음 판정을 대신하는 의미 검사이며 실패 시 WAITING을 유지한다. 새 입력과 맞지 않는 판단을 폐기한다.
- 브라우저 음량 관측과 전사 입력은 답변 재생을 닫는다. GET `/voice-sessions/:id`에서 최신 입력 revision의 완료를 확인하고 재생을 연 뒤 POST `.../respond`로 상담 재개를 요청한다. 서버는 동일 revision에 한 번만 발화 지시를 보낸다. 이 왕복은 답변 앞부분이 잘리지 않게 하기 위한 것이다.
- GET은 현재 통화의 완료된 form taskId만 반환한다. 원문과 공급자 세션 ID는 응답하지 않는다. 최신 완료 작업의 구조화 결과가 신청서에 표시된다.
- POST `.../finish`는 사용자의 종료·조회 버튼 전용이다. 서버 원문을 범위 검사한 후 종료하고, 요청 버전을 검사해 durable EXTRACT_NEED를 만든다. 서버 전용 finalizeAfterCall 표식으로만 최종 초안 저장·검색을 실행한다. 모델 출력은 이 표식을 설정할 수 없다.
- DELETE·연결 손실·백그라운드 이동은 조회를 시작하지 않는다. 종료 POST의 결과를 잃으면 같은 멱등 키로 재시도한다. 다른 키여도 동일 음성 세션의 최종 작업은 하나다.
- 원문은 일반 로그에 남기지 않는다. 통화 중 작업 입력은 close에서 지우며, 최종 추출 입력은 완료 시 또는 615초 privacy sweep에서 지운다. 종료 재시도를 위한 메모리 원문도 615초 이후 지운다.
- 신청서가 불완전하면 DRAFT로 저장해 요청함에서 보완한다. 완전하면 기존 검색 worker가 조회한다. SSE·snapshot으로 앱 알림과 요청함에 결과를 표시하며 푸시·SMS는 사용하지 않는다.

공식 근거: [Live 첫 인사·세션 관리](https://developers.openai.com/api/docs/guides/live-conversations), [Decisions](https://developers.openai.com/api/docs/guides/decisions). 첫 인사 append 확인은 가청 재생 보장이 아니다. 실제 사람 발화·휴대폰·스크린리더·대화 지연은 별도 실기기 검증이 필요하다.

아래는 0.1.0 구현 당시 기록이며 현재 동작은 위 개정과 공통 계약 §16을 따른다.

---

# W2 Voice 구현·실제 검증 보고

계약 0.1.0. `POST /voice-sessions`와 `DELETE /voice-sessions/:id`를 실제 VoiceGateway에 연결했다. API 진입점에 이미 있던 플러그인 등록 경로를 사용했으며 web·worker·AI 어댑터·계약 파일은 수정하지 않았다.

## 구현

- 생성은 기존 Origin·세션·CSRF·멱등성 검사와 요청자 권한 검사를 사용한다. 외부 Live ID를 메모리의 내부 `voice_…` ID로 감싸며, 외부 ID·API 키·자막을 일반 API 응답이나 로그에 내보내지 않는다. sideband 준비 실패는 `503 AI_UNAVAILABLE`이다. 게이트웨이가 이미 생성된 공급자 세션 정리를 담당한다.
- 자막·음성 상태는 기존 웹의 WebRTC data channel 경로를 그대로 사용한다. 추가 SSE 타입을 만들지 않았다. 브라우저 peer 연결 손실은 기존 웹에서 `RECONNECT_REQUIRED`로 처리한다.
- 입력 자막은 2,000자 범위에서 임시 조합한다. `session.delegation.created`만 서버 세션 권한과 현재 DB 상태를 검사하여 기존 `agentTurn` 명령을 호출한다. 실제 worker가 ROUTE_INTENT → EXTRACT_NEED를 처리하고 기존 task·SSE·REST 경로가 요약 제안을 웹에 전달한다. 중복 delegation은 한 번만 처리하고 새 입력 뒤에 도착한 이전 결과는 음성으로 설명하지 않는다.
- 일반 DB 문맥과 진행 사실은 `thinking.append`, 검증된 요약 결과는 원래 delegation ID의 `commentary.append`로 보낸다. 새 세션에는 delegation ID가 없는 DB 문맥만 넣는다. AI의 승인·선택·결제 명령 경로는 없다.
- 기존 게이트웨이의 최대 10분·무음 60초·종료 확인 최대 15초 정책을 사용한다. 명시적 삭제·provider 종료·연결 손실·오류·데모 세션 폐기·API 종료에서 정리한다. 종료 확인 여부만 로그로 남기고 요청·분기 상태는 유지한다.

## 승인받은 DB 범위 확장

coordinator의 질문 응답으로 다음 변경을 승인받았다. 공개 HTTP 스키마와 업무 상태 전이 계약은 바꾸지 않았다.

| 함수                          | 변경                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Commands.agentTurn`          | 서버 전용 optional `{voiceSessionId}`로 일시 보관할 음성 입력을 표시                                     |
| `Database.recordTaskResult`   | ROUTE → EXTRACT 생성 시 해당 보관 표시만 전달                                                            |
| `Database.getTaskInput`       | 내부 보관 표시를 제거하여 기존 strict AI 입력 스키마 유지                                                |
| `Database.scrubVoiceTurnText` | 지정 turn 또는 10분 15초가 지난 음성 원문 제거, 해당 최신 turn 무효화, 결과·구조화 요구·텍스트 입력 보존 |

플러그인은 모든 종료 경로와 API 시작 시, 이후 30초마다 원문 정리를 호출한다. 요청 잠금과 최신 turn 검사로 종료 후 늦은 worker가 원문을 EXTRACT 작업에 다시 복사하지 못하게 했다. 프로세스 강제 종료 뒤에도 API 재기동/주기 정리가 남은 음성 입력을 제거한다. 원시 오디오는 앱 서버에 저장하지 않는다. 아래 WAV는 검증용으로 별도 생성한 합성 음성이다.

## 실행한 검증 명령

저장소 루트에서 실제 실행했다.

```sh
npm run -w @sb/api typecheck -w @sb/db -w @sb/worker
npm test -w @sb/db -w @sb/api -w @sb/worker
npm test -w @sb/api
node --env-file=.env --import tsx apps/api/test/voice-live.ts
```

- strict TypeScript: api·db·worker 모두 종료 코드 0.
- 전체 재검증: DB 22개, API 22개, worker 15개, 총 **59/59 통과**. DB의 음성 원문 정리 테스트 1개와 API의 음성 테스트 7개를 추가했다.
- 음성 결과 수신의 snapshot 경합 보완 후 API **22/22 재통과**.
- API 테스트는 실제 PostgreSQL과 fake VoiceGateway를 사용한다. 권한·CSRF·동시 멱등 생성·503·중복 위임·요약 제안·AT16·현재 데모 세션만 삭제·로그아웃·연결 손실·종료 후 원문 제거를 검사했다.
- DB 테스트는 음성 입력 제거, 텍스트 입력과 결과 보존, strict AI 입력, crash 시간 경과 정리, 늦은 원문 재복제 방지를 검사했다. 기존 worker 텍스트 입력 경로도 전체 재검증에 포함됐다.

## 실제 Live 검증 결과

`voice-live.ts`는 매 실행마다 별도 PostgreSQL DB를 만들어 마이그레이션·seed 후 삭제한다. 실제 API `127.0.0.1:3102`, 실제 live worker, Vite `127.0.0.1:5174`와 Chrome for Testing 156.0.8078.4를 사용했다. 공유 개발 DB는 초기화하지 않았다. `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=…`로 합성 한국어 WAV를 실제 WebRTC 오디오 입력에 연결했다. localhost 개발 쿠키 설정을 사용했으며 인증서 경고를 무시하는 옵션은 사용하지 않았다.

TTS fixture 생성만 `gpt-4o-mini-tts`/`coral`을 사용했다. 업무 모델은 지정된 `gpt-live-1`, `gpt-6.1-terra`, `gpt-6-luna`를 그대로 사용했다. WAV에는 SDP 연결 전 발화 손실을 방지하는 12초 시작 무음과 반복 입력을 방지하는 종료 무음이 들어 있으므로 버튼부터 요약까지의 시간은 모델 응답 지연만을 뜻하지 않는다.

| 항목                                     | 첫 실행        | 최종 실행                    |
| ---------------------------------------- | -------------- | ---------------------------- |
| HTTP 음성 세션                           | 201 / 2,449ms  | 201 / **1,833ms**            |
| 사용자 / 에이전트 자막 delta             | 33 / 12        | **34 / 13**                  |
| 서버에 접수된 delegation                 | 1              | **1**                        |
| ROUTE_INTENT / EXTRACT_NEED              | 모두 SUCCEEDED | 모두 SUCCEEDED               |
| 버튼 → 요약 표시                         | 32,264ms       | 34,879ms                     |
| 원래 delegation으로 commentary 수신 확인 | 별도 집계 없음 | **확인됨**                   |
| R02                                      | URL 이동 확인  | **렌더링된 입력값까지 확인** |
| 종료 뒤 원문 context 개수                | 0              | **0**                        |
| 요청 상태 / 전송된 분기                  | DRAFT / 0      | **DRAFT / 0**                |
| 공급자 session.closed 확인               | 별도 집계 없음 | **confirmed=true**           |

최종 요약은 **프로젝터, 2026. 11. 7. (토) 10:00–16:00**, 장소는 미정으로 남겼다. 센터 앞·도서관 앞·역 앞 중 원하는 장소를 묻는 보완 질문을 반환했다. 사용자 확인 전 draft의 내용과 version=1은 바뀌지 않았다. 최종 실행의 delegation 접수 → 요약 준비는 7,504ms였고, 이후 commentary append 확인까지 1,065ms였다. append 수신 확인은 음성 재생 완료와 구별한다.

증거: 최종 실행 JSON (실행 산출물은 공유본에서 제외), 첫 실행 JSON (실행 산출물은 공유본에서 제외), R02 화면 (실행 산출물은 공유본에서 제외), [합성 입력 WAV](../../test/fixtures/voice/korean-request.wav), [재현 스크립트](../../test/voice-live.ts). 보고서는 실시간 자막 원문을 보존하지 않으며, 사전 작성한 합성 입력 문장과 구조화 결과·카운트만 기록한다.

이번 검증은 데스크톱 Chrome 합성 음성 경로다. 실제 사람의 한국어 음성 품질, 갤럭시 Chrome·Samsung Internet, iPhone Safari·홈 화면, 신뢰된 LAN HTTPS·실기기 설치·스크린리더는 검증하지 않았다. AT21·AT22 실기기 관문과 정상 흐름 10회 중 9회 기준의 완료를 주장하지 않는다.

공급자 동작 근거는 [OpenAI client delegation 문서](https://developers.openai.com/api/docs/guides/live-delegation)와 설치된 OpenAI SDK 7.47.0을 확인했다. TTS fixture 형식은 [OpenAI Text to speech 문서](https://developers.openai.com/api/docs/guides/text-to-speech)를 따랐다.
