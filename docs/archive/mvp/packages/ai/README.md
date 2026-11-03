> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `packages/ai/README.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../../../README.md)을 먼저 확인하세요.

# @sb/ai — OpenAI 어댑터와 결정적 fixture

계약 `0.3.0`의 AI 포트 5개와 GPT-Live 음성 게이트웨이를 구현한다. 서버 전용 패키지이며 브라우저 번들에 import하지 않는다. 업무 DB, 승인·선택·결제 명령, 임의 URL 도구에 접근하는 코드는 없다.

## 역할과 실행 경계 (0.3.0)

- `src/agents/definitions.ts`: 고정 작업 5개, 음성 상담, 발화 판정의 목적·모델 키·프롬프트 버전·시간 한도·실패 정책. `instructions.ts`에 공유 권한 규칙과 역할별 지시문을 모았다. 음성에는 JSON 출력 규칙을 강요하지 않는다.
- `src/agents/task-runner.ts`: 모델 호출 전 입력 검증, 응답의 스키마·참조·의미 검증, 기존 요금 null 및 의도 UNCLEAR fallback. 입력 오류에는 fallback을 적용하지 않는다. 관측 이벤트에는 역할·taskId·프롬프트 버전·시간·실패 단계만 남긴다. 원문·provider 오류·결과는 로깅하지 않는다.
- `transport.ts`: 역할 설정에서 모델·시간 한도·출력 스키마를 읽는다. 기존 Decisions/Responses API와 총 deadline 안의 제한 재시도를 유지한다. 새 모델·SDK·자율 루프는 없다.
- 음성 capability는 `read_request`, `propose_request_summary`만 선언한다. 실제 핸들러는 API `voice/bindings.ts`가 세션·리소스·최신 발화를 검사한 뒤 연결한다. Live wire에는 function tools를 보내지 않는다. 승인·전송·선택·결제 도구는 없다.
- 필수 수집 완료와 종료는 API/브라우저가 통제한다(계약 §17). 게이트웨이는 종료 안내의 전사/출력 PCM 시간 범위를 전달할 뿐 DB를 호출하지 않는다. 일시적인 안내 WAV를 같은 Live 출력에서 만들며 다른 음성 모델로 교체하지 않는다.

아래 0.2.0 기록의 수동 종료만 허용하는 부분은 계약 §17의 검증된 자동 종료로 확장되었다.

## 음성 0.2.0 개정

`createVoiceTurnChecker`는 지정된 Decisions 모델로 발화 완료와 지원 범위를 함께 분류한다. 실패·답 누락·중복은 권한이나 완료로 간주하지 않는다. Live는 첫 인사 developer input을 받으며 서버 API가 한 번의 greeting commentary를 추가한다. 서버 전용 `session.instructions.append`도 ack를 확인한다. 브라우저는 이 이벤트를 직접 송신할 수 없다. 통화 중 모델의 역할은 신청서 수집이며 재고 조회·초안 저장은 명시적인 종료·조회 명령 이후다.

아래 실제 호출 결과와 테스트 개수는 0.1.0 당시 기록이다. 최신 QA 기록은 `docs/VOICE_QA.md`를 참고한다.

## 실행과 검증 결과

저장소 루트에서 실행한다. `smoke:live`만 루트 `.env`를 Node의 `--env-file`로 읽으며 실제 OpenAI 호출 비용이 발생한다. 키·요청 헤더는 출력하거나 fixture에 저장하지 않는다.

```sh
npm run -w @sb/ai typecheck
npm test -w @sb/ai
npm run -w @sb/ai smoke:live
# Live만 다시 확인할 때
npm run -w @sb/ai smoke:live -- --only-live
```

실행일: **2026-11-01 Asia/Seoul**. TypeScript strict 검사와 **36개 테스트**가 통과했다. 테스트는 fixture/SDK HTTP 경계 및 로컬 실제 WebSocket 서버로 실패 경로를 검사하며, 업무 DB·휴대폰 검증을 대신하지 않는다.

전체 실제 호출 결과: [2026-10-31T15-32-03.770Z/summary.json](../../../../../packages/ai/fixtures/live-runs/2026-10-31T15-32-03.770Z/summary.json).

브라우저 HTTP 흐름과 동일하게 **게이트웨이 준비 완료 후 SDP answer를 적용**하는 추가 Live 스모크도 4,081ms에 통과했다. [2026-10-31T15-33-33.674Z/summary.json](../../../../../packages/ai/fixtures/live-runs/2026-10-31T15-33-33.674Z/summary.json)

| 실제 호출                         | 모델            | 결과                                                                       | 경과 시간 |
| --------------------------------- | --------------- | -------------------------------------------------------------------------- | --------- |
| Decisions 의도 분류               | `gpt-6-luna`    | HTTP 200, `RENTAL_REQUEST`                                                 | 925 ms    |
| Responses 한국어 상대 날짜 추출   | `gpt-6.1-terra` | HTTP 200, 계약 스키마·장소·절대 시각 검사 통과                             | 3,927 ms  |
| Responses 가격 추천               | `gpt-6.1-terra` | HTTP 200, 8초 이내 유효 옵션·근거                                          | 2,484 ms  |
| Live 세션·sideband·문맥 전달·종료 | `gpt-live-1`    | HTTP 201, `session.started`, `session.thinking.appended`, `session.closed` | 3,540 ms  |

각 실행 디렉터리에 입력, 검증된 결과, 원본 JSON wire 응답, 지연, Live 이벤트를 저장했다. 원시 오디오는 저장하지 않았다. `werift@0.25.2`로 실제 SDP와 WebRTC 연결을 만들고 Opus 무음 RTP를 보냈다. 실제 사람의 음성 인식·음질, delegation의 발화 기반 생성, 휴대폰 Chrome/Samsung Internet/Safari 및 PWA 동작은 **미검증**이다. W2 Voice는 API 연결과 실제 음성 대화를, AT21·AT22는 실기기를 검증해야 한다.

첫 구현 검증에서 `allowed_server_events`에 문자열을 전달해 HTTP 400을 받았으며, SDK 타입과 공식 형식에 맞게 `{type: ...}` 객체로 수정했다. 두 번째 검증에서는 미디어를 보내지 않는 WebRTC peer의 thinking append가 8초 내 완료되지 않았고, 종료 시 공급자가 `context_injection_incomplete`를 반환했다. 무음 RTP로 미디어 시계를 진행한 이후 append 확인까지 성공했다. 이 실패 기록도 `fixtures/live-runs/`에 보존했다. 모델 변경이나 mock으로 실제 호출 실패를 대체하지 않았다.

## 설정

| 환경 변수                    | 기본값 / 의미                                  |
| ---------------------------- | ---------------------------------------------- |
| `AI_MODE`                    | `live`; 자동 테스트에서는 명시적으로 `fixture` |
| `OPENAI_API_KEY`             | live 모드 필수, 서버에서만 제공                |
| `OPENAI_AGENT_MODEL`         | `gpt-6.1-terra`                                |
| `OPENAI_DECISION_MODEL`      | `gpt-6-luna`                                   |
| `OPENAI_VOICE_MODEL`         | `gpt-live-1`                                   |
| `OPENAI_TIMEOUT_MS`          | `30000`, 양의 정수 ms                          |
| `OPENAI_DECISION_TIMEOUT_MS` | `8000`, 양의 정수 ms                           |

환경 변수로 명시된 모델을 그대로 사용하며 접근 실패 시 다른 모델로 대체하지 않는다. SDK는 `openai@7.47.0`, WebSocket은 `ws@8.22.1`, 스키마는 `zod@4.6.7`로 고정했다. SDK에 `responses.create`, `decisions.create`, `live.create`가 있어 별도 비공식 HTTP 구현이 필요하지 않았다. `npm install -w @sb/ai --save-exact zod@4.6.7` 및 `npm install -w @sb/ai --save-dev --save-exact werift`로 패키지 의존성과 공유 lockfile을 갱신했다.

## 텍스트 포트 사용

```ts
import { createAiPorts } from '@sb/ai';
import type { RecommendFeeInput, ExtractNeedInput } from '@sb/contracts';

const ai = createAiPorts(process.env);

async function recommend(input: RecommendFeeInput) {
  const recommendation = await ai.feeRecommender.recommend(input);
  // null이면 호출자가 STANDARD + recommendationSource=BASELINE을 사용한다.
  // 금액은 recommendation.feeOptionId에 대응하는 서버의 feeOptions에서만 읽는다.
  return recommendation;
}

async function extract(input: ExtractNeedInput) {
  const proposal = await ai.needExtractor.extract(input);
  // 사용자 확인용 결과다. PATCH draft / submit은 서버·UI의 명시적 경로가 수행한다.
  return proposal;
}

// 공통 task envelope가 필요한 worker:
// const envelope = await ai.runTask(taskInput);
// {taskId, kind, inputVersion, result} 또는 가격 실패일 때 null.
```

`createAiPorts`는 아래 5개 계약 포트와 `runTask`를 돌려준다.

| 프로퍼티         | 메서드                         | 실패 처리                                                            |
| ---------------- | ------------------------------ | -------------------------------------------------------------------- |
| `intentRouter`   | `route(RouteIntentInput)`      | refusal·없는 답·중복 name·미지값·오류·timeout → `{intent:"UNCLEAR"}` |
| `needExtractor`  | `extract(ExtractNeedInput)`    | 모델/형식 오류는 throw; 불완전 조건은 null/빈 장소와 보완 질문       |
| `feeRecommender` | `recommend(RecommendFeeInput)` | 실패·형식/근거 오류·8초 기한 초과 → null                             |
| `termsExplainer` | `explain(ExplainTermsInput)`   | 참조·버전·changedFields 불일치 또는 모델 오류는 throw                |
| `offerComparer`  | `compare(CompareOffersInput)`  | 분기·버전·입력 순서·행 집합 불일치 또는 모델 오류는 throw            |

입력 스키마/참조 불일치는 호출자 오류이므로 fallback으로 숨기지 않는다. Terra는 strict Structured Outputs로 공통 envelope를 생성하고, 결과를 다시 계약 Zod 스키마로 검사한다. `taskId`, `kind`, `inputVersion`과 비교 행의 `negotiationId/termsRevision`은 입력과 정확히 일치해야 한다. `EXPLAIN_TERMS` 결과 본문에는 계약상 참조 필드가 없으므로 envelope의 `NEGOTIATION` 버전으로 검사한다. 이 패키지는 DB 최신 버전을 알 수 없으므로 **저장 직전에 호출자가 최신 task/분기/Offer 버전을 다시 검사**해야 한다.

Decisions의 질문 name은 task와 turn에서 만들고 답을 배열 순서가 아닌 name으로 찾는다. choices는 계약의 5개 의도로 고정한다. 날짜는 `serverNow`·`Asia/Seoul`을 프롬프트에 제공하며, 반환된 과거/30분 단위가 아닌 시각·잘못된 기간은 미완성으로 처리한다. 장소는 제공된 ID만 허용한다. 수량 여러 개는 하나씩 요청하도록 보완 질문을 유지한다.

가격 근거는 `allowedReasonCodes`에 포함되어야 한다. `FLEXIBLE_HANDOFF`는 복수 장소 선택, `REGISTERED_EXTRA_EFFORT`는 등록된 물품 사실이 있어야 한다. `BASELINE`과 공공 추천은 `STANDARD`만 허용한다. 결과 스키마에는 금액 필드가 없으며, 근거 없는 추천은 null이다.

네트워크 오류·429·5xx만 **최초 호출 포함 최대 3회**, `1000ms + 0–250ms jitter`, `4000ms + jitter` 간격으로 시도한다. SDK 자체 재시도는 끈다. 하나의 전체 deadline에 호출과 backoff가 모두 포함되며, SDK timeout·400·스키마 오류·refusal은 재시도하지 않는다. 가격의 deadline은 항상 **8,000ms**이고 늦은 결과는 버린다.

## Fixture

```ts
import { createAiPorts } from '@sb/ai';
import { AI_FIXTURES } from '@sb/ai/fixtures';

const ai = createAiPorts({ AI_MODE: 'fixture' });
const result = await ai.runTask(AI_FIXTURES.EXTRACT_NEED.input);

const failing = createAiPorts({ AI_MODE: 'fixture' }, { scenario: 'invalid-option' });
// FeeRecommender에서는 null을 반환한다.
const timedOut = createAiPorts({ AI_MODE: 'fixture' }, { scenario: 'timeout' });
```

`fixtures/{route_intent,extract_need,recommend_fee,explain_terms,compare_offers}.json`은 고정 입력과 기대 envelope다. 동일 입력은 저장된 결과 그대로 반환한다. 다른 서버 task/ID/시각을 사용하는 통합 테스트에서는 참조와 날짜를 결정적으로 치환하고, terms 차이·비교 행은 입력 데이터로 구성한다. 추출 fixture의 의미 범위는 **프로젝터를 모레 10시부터 다음날 16시까지 요청하는 고정 시나리오**다. 일반 자연어 이해를 흉내 내지 않으며 live 모드에서 fixture로 자동 전환하지 않는다.

`scenario`는 `normal`, `failure`, `timeout`, `invalid-option`, `unsupported-reason`, `authority-injection`, `unclear`다. 시간 초과 fixture는 대기 없이 `TIMEOUT`을 발생시키며, 별도 fake-timer 테스트가 실제 8초 abort와 늦은 응답 무시를 검증한다. `results: {EXPLAIN_TERMS: rawEnvelope}`처럼 전체 출력을 덮어써 stale reference를 시험할 수도 있다. 음성은 실제 WebRTC가 필요하므로 fixture `VoiceGateway`를 제공하지 않으며 명시적으로 `LIVE_VOICE_REQUIRED`를 발생시킨다.

## 음성 게이트웨이 사용 (W2 연결용)

```ts
import { createVoiceGateway, voiceStatusForEvent } from '@sb/ai';

const gateway = createVoiceGateway(process.env); // AI_MODE=live
const voice = await gateway.createSession({
  requestId: 'req_example',
  actorUserId: 'u_hana', // API가 세션에서 주입하고 권한을 먼저 검사
  sdpOffer, // 브라우저가 만든 실제 SDP
  instructions: '저장된 요청 초안을 함께 확인해 주세요.',
  tools: [{ name: 'read_request', description: '현재 사용자의 요청 조회' }],
  onEvent: async (event) => {
    const status = voiceStatusForEvent(event);
    // UI 음성 상태만 갱신한다. 대여 상태 전이로 사용하지 않는다.
    if (event.type === 'session.delegation.created') {
      // event.delegationId를 보존한다. 발화 원문은 transcript delta로 별도 구성한다.
      // 권한 검사된 서버 작업 큐로 전달한다. 이벤트 수신을 장시간 막지 않는다.
    }
  },
});

// API는 sessionId를 내부 voice_ ID에 매핑하고 sdpAnswer만 클라이언트에 전달한다.
const sdpAnswer = voice.sdpAnswer;
await voice.appendThinking({ delegationId: null, content: '조건을 확인 중입니다.' });
// 현재 세션의 session.delegation.created에서 얻은 ID만 사용할 수 있다.
await voice.appendCommentary({ delegationId, content: '요청 요약을 화면에서 확인해 주세요.' });
const { confirmed } = await voice.close();
```

계약의 `append({type,eventId,delegationId,content})`도 지원한다. wire는 `{type,event_id,delegation_id,content}`다. `appendCommentary`/`appendThinking`은 event ID를 생성하고 **해당 `client_event_id`의 수신 확인**을 기다린다. 이 확인은 발화 완료·업무 성공이 아니다. 수신 확인이 8초 안에 오지 않으면 `LIVE_APPEND_TIMEOUT`이며 연결이 활성 상태이고 미디어가 흐르는지 확인한다.

`createSession`은 HTTP 생성과 sideband 연결 후 실제 `session.started`까지 기다린다. 브라우저에서 `session.start`를 추가 전송하지 않는다. 실호출에서 sideband 시작 이벤트는 브라우저가 SDP answer를 적용하기 전에도 수신되어 해당 계약이 동작했다. Node WebRTC peer를 사용하는 테스트는 `onTransportReady({externalSessionId,sdpAnswer})`를 전달해 준비 대기 전에 SDP answer를 적용할 수 있다. 외부 세션 ID는 원문 그대로 `sessionId`/`externalSessionId`에 보존한다.

client delegation의 공식 session schema에는 `tools` 필드가 없다. 게이트웨이의 선택적 `tools`는 서버 기능에 대한 프롬프트 설명이며, wire 도구 실행 권한을 만들지 않는다. 허용 이름은 `read_request`, `search_inventory`, `propose_request_summary`, `recommend_fee`, `explain_terms_diff`뿐이다. 브라우저 data channel의 송신 권한도 close·입력 mute/unmute로 제한하며 서버 sideband에서만 문맥을 추가한다.

세션은 최대 **10분**, 사용자/AI 발화·가청 PCM·안내 재생이 없는 상태 **60초** 후 종료한다. 연속 PCM 무음은 idle 타이머를 갱신하지 않는다. `setPlaybackActive(active)`와 `markActivity()`는 신뢰할 수 있는 서버/브라우저 재생 관측을 연결할 때 쓴다. 종료는 `session.close`를 보내고 **15초 이내** `session.closed`를 기다린다. 소켓 손실 시 별도 sideband를 한 번 연결해 종료만 시도하며, 종료를 확인하지 못하면 `{confirmed:false}` 또는 `SIDEBAND_FAILED_CLOSE_UNCONFIRMED`로 드러낸다. 네트워크 단절 중 원격 종료 확인을 보장하지 않는다. API는 sideband 생성 실패를 503으로 처리하고, 클라이언트 마이크 track은 종료 조작 즉시 중지해야 한다.

콜백 이벤트: `session.started`, `session.input_transcript.delta`, `session.output_transcript.delta`, `session.delegation.created`, `session.closed`, `error`, `disconnected`. `voiceStatusForEvent`는 계약의 상태만 반환하며 `CONNECTED`는 쓰지 않는다. `output.finished` 보조 이벤트는 UI 재생 종료를 `LISTENING`으로 매핑할 때 사용할 수 있다. 재연결 시 새 게이트웨이 세션에 기존 delegation ID를 재사용할 수 없다.

## Export 목록

- 포트: `createAiPorts`, `portsFromTransport`, `AiPorts`.
- 설정/진단: `AiAdapterError`, `readAiConfig`, `createOpenAIClient`, `errorSummary`, `AiConfig`, `AiEnvironment`.
- 전송/검증: `OpenAiTransport`, `AiTransport`, `taskResultJsonSchema`, `validateTaskResult`, `normalizeNeed`.
- fixture: `AI_FIXTURES`, `FixtureTransport`, `FixtureOptions`, `FixtureScenario` (`@sb/ai/fixtures`에서도 제공).
- 음성: `VoiceGateway`(클래스 별칭), `OpenAiVoiceGateway`, `createVoiceGateway`, `voiceStatusForEvent`, `VOICE_LIMITS`, `ManagedVoiceSession`, `CreateVoiceSessionInput`, `VoiceGatewayOptions`, `VoiceTool`.

`errorSummary(error)`는 코드와 HTTP status만 돌려준다. SDK 예외 전체에는 요청 정보가 포함될 수 있으므로 그대로 로깅하지 않는다.

## 공식 근거

2026-11-01에 공식 페이지와 설치된 SDK 타입을 확인하고 실제 호출로 검증했다. Responses는 `text.format={type:"json_schema",strict:true,schema}`를 사용한다. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Decisions는 이름을 가진 choice 질문과 고정 options를 받고 typed answers를 반환한다. [Decisions](https://developers.openai.com/api/docs/guides/decisions)

Live는 `POST /v1/live/sessions`의 session/transport JSON과 `.../{session_id}/attach` sideband를 사용한다. [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [Server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls)

client delegation의 ID와 commentary/thinking 이벤트, 종료 확인은 공식 수명 규칙을 따른다. [Delegation](https://developers.openai.com/api/docs/guides/live-delegation), [Managing sessions](https://developers.openai.com/api/docs/guides/live-conversations)
