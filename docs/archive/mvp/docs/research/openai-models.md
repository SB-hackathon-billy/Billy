> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `docs/research/openai-models.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../../../README.md)을 먼저 확인하세요.

# OpenAI 모델·음성 API 리서치

확인일: 2026-10-31 · 범위: 공식 공개 문서 확인 및 MVP 설계 권고 · API 실호출/프로젝트 권한/한국어 실기기 품질 검증은 미실시

이 문서는 PRD와 공통 컨트랙트의 근거 자료다. 아래 API 식별자는 공식 문서를 열어 확인했다. 사용자의 표현을 먼저 특정 모델로 가정하지 않았으며, 공개 문서상 지원과 해당 프로젝트에서 호출할 수 있는 권한은 구분한다.

## 1. 역할별 선정

| 사용자 표현·역할 | 선정 API·모델 ID | MVP에서 맡길 일 | 선정 근거와 한계 |
| --- | --- | --- | --- |
| “GPT 라이브 모델” · 실시간 대화 | GPT-Live API, `gpt-live-1` | 한국어 음성 입출력, 끼어들기 대응, 부족한 조건 질문, 서버 결과 설명 | 동시 듣기·말하기와 별도 백엔드 위임을 공식 지원. 음성 모델의 발화를 업무 성공의 증거로 사용하지 않는다. [모델](https://developers.openai.com/api/docs/models/gpt-live-1) |
| “테라” · LLM | Responses API, `gpt-6.1-terra` | 요청 구조화, 후보 설명, 소유자별 조건 차이 요약·대여료 추천, 허용된 도구 호출 제안 | 공식 Terra 모델 식별자 확인. 텍스트 입출력과 Structured Outputs를 지원하고 도구 호출은 Responses API를 사용해야 한다. 음성 입출력은 Live가 담당한다. [모델](https://developers.openai.com/api/docs/models/gpt-6.1-terra) |
| “GPT에서 제공하는 디시전 모델” · 빠른 판단 | Decisions API, `gpt-6-luna` | `RENTAL_REQUEST / CHANGE_CONDITIONS / STATUS_QUERY / CENTER_INFO / UNCLEAR` 등 제한된 의도 분류 | Decisions는 별도 모델명이 아니라 typed 판단 API다. 확인 시점 지원 모델은 `gpt-6-luna`. 자유 설명·조건 추출은 Terra, 자격·재고·금액·승인은 서버 규칙이 담당한다. [Decisions](https://developers.openai.com/api/docs/guides/decisions), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |

이는 역할에 따른 선정이며 모든 발화마다 세 모델을 순서대로 호출한다는 뜻은 아니다. 소유자의 승인·거절·조건 변경 버튼은 이미 구조화된 입력이므로 모델로 재분류하지 않는다. Decisions의 확률은 업무 사실이나 동의의 확률이 아니다. 분류 거부, 불명확한 답, 시간 초과에는 Terra 또는 추가 질문으로 이어가고 업무 상태를 그대로 둔다.

추가 인터뷰 반영: 사전 준비한 데모 아이디를 사용한다. 한 요청에 소유자가 여러 명일 수 있으므로 공통 `RentalRequest` 아래 물품·소유자별 `Negotiation`과 `Offer`를 구분한다. AI는 소유자별 조건을 따로 조율하고 비교 자료를 제공한다. 다른 소유자의 승인을 해당 분기의 승인으로 대체하거나 첫 승인만으로 거래를 선택하지 않는다.

환경 설정명 제안은 `OPENAI_VOICE_MODEL=gpt-live-1`, `OPENAI_AGENT_MODEL=gpt-6.1-terra`, `OPENAI_DECISION_MODEL=gpt-6-luna`다. SDK는 Live와 Decisions를 제공하는 공식 `openai` JavaScript SDK를 구현 시작 시 확인해 버전을 고정한다. 이 조사에서 특정 npm 버전의 설치·실행은 검증하지 않았다.

## 2. 음성 연결 선정

브라우저/PWA의 음성은 WebRTC, 업무 명령과 상태 조회는 앱 서버 HTTP, 서버의 Live 이벤트 수신은 sideband WebSocket으로 나눈다. 실제 전화·SIP 연동은 사용하지 않는다.

공식 연결 절차는 사용자 동작에서 마이크 권한 획득 → WebRTC data channel과 리스너 준비 → SDP offer 생성 → 앱 서버가 OpenAI `POST /v1/live/sessions` 호출 → 반환된 `transport.sdp`를 SDP answer로 적용 → `session.started` 수신 순서다. 생성 요청에는 `session.model`과 `transport: {type: "webrtc", sdp: "..."}`가 들어간다. 프로젝트 API 키와 세션 설정은 서버에 둔다. 이 WebRTC 생성 방식에서는 data channel로 `session.start`를 다시 보내지 않는다. [WebRTC 공식 절차](https://developers.openai.com/api/docs/guides/voice-webrtc)

MVP는 `session.delegation: {type: "client"}`를 선정한다. 서버가 Terra 호출과 도구 실행을 관리하면 소유자의 응답을 기다리는 작업을 음성 연결 수명과 분리할 수 있다. 여기서 client는 앱이 관리하는 위임이라는 뜻이며, 브라우저가 비밀키나 업무 권한을 가진다는 뜻이 아니다. 공식 문서도 자체 워크플로와 결과 검토가 필요한 경우 client delegation을 제시한다. [위임 방식](https://developers.openai.com/api/docs/guides/live-delegation)

서버는 생성 응답의 `session.id`를 내부 대화·사용자 ID와 매핑하고 `wss://api.openai.com/v1/live/sessions/{session_id}/attach`로 연결한다. sideband는 서버의 이벤트 수신·명령 경로다. 마이크와 스피커의 기본 오디오 경로는 WebRTC에 유지한다. 도구 실행과 결과 전달의 주체는 서버 한 곳으로 고정해 브라우저와 서버의 중복 처리를 막는다. [서버 제어](https://developers.openai.com/api/docs/guides/voice-server-controls)

## 3. 외부 이벤트와 앱 계약 경계

아래 앱 내부 이름은 구현 제안이며 OpenAI API 필드명으로 오인하지 않는다. 외부 이벤트는 AI 어댑터에서 앱 공통 이벤트로 변환한다.

| 외부 이벤트·호출 | AI/서버에서 처리할 내용 | 프론트엔드에 필요한 앱 정보 |
| --- | --- | --- |
| `session.started` | 내부 `voiceSessionId` 연결 완료 처리 | `voiceStatus=CONNECTED` |
| `session.input_transcript.delta`, `session.output_transcript.delta` | `delta`, `start_ms`, `end_ms`를 화자별로 보존·조합 | 사용자/에이전트 자막. 업무 완료 상태와 별도 |
| `session.delegation.created` | `delegation.id`, `offset_ms`와 현재 DB 상태·저장된 대화로 작업 생성 | `taskId`, `agentActivity` |
| 서버의 Terra `POST /v1/responses` | 필요한 조건 구조화 또는 허용 도구 요청을 생성하고 스키마 검증 | 검증된 요청 요약·후보·조건 비교 카드 |
| 서버의 `session.thinking.append` | 현재 작업에 관한 조용한 사실·진행 정보 전달 | 별도 앱 이벤트가 있을 때만 상태 표시 갱신 |
| 서버의 `session.commentary.append` | 검증된 결과를 Live가 설명하도록 짧게 전달 | 음성/자막 설명. 확정 상태는 서버 데이터로 판단 |
| `session.closed` | 음성 수명 종료·사용량 기록 | `voiceStatus=CLOSED`; 대여 업무 상태는 유지 |

`session.delegation.created`는 발화 원문이나 작업 지시 전체를 포함하지 않는다. 서버가 transcript와 앱 상태를 유지해야 한다. Transcript fragment는 완성된 발화가 아니므로 짧은 “네”나 부분 문장만으로 신청·승인을 실행하지 않는다. 대화 중 날짜 정정이 들어오면 기존 draft version을 무효화하고 새 요약을 제시한다. [위임 이벤트](https://developers.openai.com/api/docs/guides/live-delegation)

자막은 두 화자가 동시에 말할 수 있음을 표현해야 한다. append 확인 응답은 문맥 전달 확인이며 실제 발화나 재생 완료를 뜻하지 않는다. 음성의 “처리했어요”만으로 카드 상태를 바꾸지 않는다. [세션·자막 관리](https://developers.openai.com/api/docs/guides/live-conversations)

## 4. 서버 업무와 AI의 책임

이 절은 제품 설계 제안이다.

- **프론트엔드:** 마이크 제어, 자막, 요청 요약 확인, 소유자 카드, 조건 비교, 서버가 제공한 상태 표시. API 키·도구 실행·예약 판단을 맡지 않는다.
- **AI 어댑터:** 한국어 이해·정보 보완·조건 제안·읽기 쉬운 설명. 허용된 도구 입력을 구조화하고 결과만 설명한다. 주민 물품 설명이나 자유 입력은 데이터로 취급하고 시스템 권한을 바꾸는 지시로 실행하지 않는다.
- **업무 서버:** 사용자/소유자 권한, 데모 자격과 가용성, 상태 전이, 분기별 조건 버전, 금액 검증, 만료, 멱등성, 동시성. 요청자가 비교 후 선택한 정확한 제안 버전을 원자적으로 선택하고 다른 분기를 닫는다. 다른 사람의 동의나 실제 결제 완료를 AI가 대신 만들 수 없다.
- **영속 작업자:** DB에 기록한 작업과 소유자 응답 이벤트를 처리한다. 같은 `taskId + negotiationId + step + version`은 한 번만 반영한다. 모델의 재시도와 업무 명령 재시도는 분리한다.

AI에 노출할 도구는 `search_inventory`, `read_request`, `propose_request_summary`, `explain_terms_diff` 같은 좁은 범위로 제한하는 것을 권고한다. 실제 `submit_request`, `owner_respond`, `confirm_terms` 명령은 서버가 기록한 사용자 행위와 해당 버전을 검증하는 업무 계층에서 처리한다. 음성에서 신청 의사를 표현하면 요약 카드와 일치하는 명시적 확인을 받아야 한다. 승인 주체는 다른 아이디로 들어온 소유자이며 모델은 소유자의 응답을 생성하지 않는다.

**대여료 추천 제안:** 사용자 인터뷰에 따라 주민 물품의 대여료를 AI가 추천한다. 후보 탐색 단계에는 아직 조율 분기가 없으므로 추천 작업 context의 기본 식별자는 `quoteId`, `itemId`, `conditionsHash`로 두고 `negotiationId`는 nullable로 둔다. 분기 생성 이후에는 해당 분기와 `termsRevision`도 검증한다. 서버가 기간·가격 정책 버전에 대해 계산한 `LOWER / STANDARD / UPPER` 세 견적을 Terra에 입력한다. Terra의 Structured Output result는 `feeOptionId`, `reasonCode`, `reasonText`로 제한하고 작업 ID·입력 버전은 공통 task envelope로 전달한다. 서버는 옵션 ID를 검증해 정수 원 단위 금액과 총액을 확정한다. 모델이 새 금액이나 할인율을 만들어 저장할 수 없다. 추천은 제안이며 소유자의 조건 승인과 요청자의 비교·선택을 대신하지 않는다. 거부·스키마 실패 시 `STANDARD`를 규칙 기반 기본값으로 제시하고 “AI 추천”이라고 표시하지 않는다. 기간이 바뀌면 다시 계산하고 이전 추천은 폐기한다. 세 옵션 산식·상한·가중치는 공통 컨트랙트에서 정하며 이 연구 문서가 별도 값을 만들지 않는다.

**여러 소유자 비교 제안:** Terra는 각 분기의 최신 유효 `Offer`를 동일한 열(기간·장소·금액·응답 상태)로 설명한다. 무응답을 승낙으로 해석하지 않고, AI 추천 순위가 사용자의 실제 선택을 대체하지 않는다. 조건 수정 후 늦게 도착한 설명은 `negotiationId + termsRevision` 검사로 무효화한다.

Decisions의 최소 사용 예는 서버에서 정리한 대화 조각과 현재 화면 상태를 입력하고 `questions`에 `type: "choice"`, 고정된 `choices`, 고유 `name`을 지정하는 것이다. 응답은 `answers`의 해당 `name`으로 매칭한다. `refusal`과 누락·알 수 없는 분류를 정상적인 실패 경로로 처리한다. 이는 앱 라우팅 힌트이며 자격 판정이나 상태 변경 권한으로 사용하지 않는다. [Decisions 입력·응답](https://developers.openai.com/api/docs/guides/decisions)

## 5. 앱 종료·실패·재개

공식 문서는 client delegation에서 앱이 관리하는 백엔드 작업을 음성 종료 후에도 계속할 수 있다고 설명한다. 이 기능을 제품에서 제공하려면 작업 상태·승인 요청·이벤트를 자체 DB에 저장해야 한다. Live 세션이나 모델의 기억만으로 지속성을 구현하지 않는다. [장기 대기·재개](https://developers.openai.com/api/docs/guides/live-conversations#close-idle-sessions-and-resume)

MVP 동작 제안:

1. 음성을 닫아도 이미 사용자가 확인하여 제출한 요청과 승인 대기는 유지한다. 아직 확인되지 않은 초안은 자동 제출하지 않는다.
2. 각 소유자가 응답하면 서버가 해당 분기와 조건 버전을 검증하고 저장한 뒤 조율 작업을 실행한다. 요청자가 접속하지 않았으면 결과 카드와 비교 자료를 저장한다.
3. 요청자가 다시 들어오면 서버 상태를 새로 조회한다. 음성 재개 버튼을 누를 때 새 Live 세션에 필요한 요약만 제공한다.
4. 마이크 거부·연결 실패 시 동일한 필드를 가진 텍스트 입력으로 전환한다. 음성 연결 실패가 신청 실패나 성공으로 바뀌지 않는다.
5. 모델 실패 시 작업은 재시도 가능한 상태를 남기며 화면에 재시도 안내를 표시한다. 후보 없음, 소유자 거절, 만료, 충돌은 서로 구별한다.
6. 사용자 취소나 조건 변경 이후 도착한 오래된 모델 결과는 버전 확인으로 버린다. 모델 호출의 성공과 업무 트랜잭션 성공을 별도로 기록한다.

GPT-Live 음성 세션은 기간 단위로 과금하고 백엔드 모델 호출은 별도 과금한다. 확인 시점 Live는 분당 USD 0.05다. 데모 예산은 음성 길이, 동시 접속, Terra/Decisions 호출 수를 각각 제한하도록 구성하며 환율 환산값이나 실제 청구액을 확정하지 않는다. 소유자 승인 대기 동안 음성 연결을 유지할 필요가 없다. [Live 가격](https://developers.openai.com/api/docs/models/gpt-live-1)

## 6. 구현 시작 시 검증할 항목

다음은 문서 작성 후 앱 구현 단계의 검증 사항이며 이번 조사에서 통과했다고 주장하지 않는다.

| 확인 | 통과 기준 |
| --- | --- |
| 프로젝트 접근 | Live·Terra·Decisions 각각 허용된 계정에서 최소 호출 성공 |
| SDK 계약 | 고정 버전에서 `client.live.create`, `client.responses.create`, `client.decisions.create` 및 Live sideband/event 타입 확인 |
| 한국어 이해 | 상대 날짜, 수량, 기간 정정, 물품 유사어를 요약 카드에서 정확히 확인 가능 |
| 모바일 음성 | 갤럭시 Chrome·Samsung Internet, iPhone Safari·설치 PWA에서 권한/재생/중단/복귀 시험 |
| 사용자 경계 | A가 B·C의 물품에 요청 → B·C가 각각 자기 분기 카드에만 승인·변경 → A가 최신 조건 비교 → 한 제안 선택 시 다른 분기 종료 |
| 재개 | 음성 종료 후 B 응답 처리, A 재진입 시 동일 작업과 최신 조건 복원 |
| 업무 무결성 | 중복 이벤트·재시도·오래된 버전·모델의 잘못된 성공 설명이 중복 신청/자동 동의를 만들지 않음 |
| 실패 표현 | 429/네트워크 단절/모델 거부/서버 충돌을 구별하고 실제 결제·예약 완료로 표시하지 않음 |

API 사용 불가 시 모델을 임의로 다른 공급자로 바꾸지 않는다. OpenAI 모델 대체안은 공식 지원과 품질을 다시 확인해 문서에 변경 이력을 남긴다. 텍스트 입력 경로는 대여 업무를 계속 검증하는 대안이지만 실시간 음성 MVP 완료의 대체 통과 조건은 아니다.
