# 에이전트 개편과 수집 완료 자동 종료 검증

계약 0.3.0

## 반영 범위

역할별 목적·시스템 지시문·모델 키·시간 한도·허용 capability·결과 검증·실패 처리를 분리하고 실제 실행 경로에 연결했다. 업무 5종은 공통 runner를 사용하고, 음성 상담과 발화 판정은 각각 역할 설정을 사용한다. 에이전트 패키지에는 DB·승인·전송·선택·결제 실행 함수를 주지 않는다.

기존 도메인 명령·가격 공식·상태 기계·소유자 응답·후보 선택·결제 미리보기는 유지했다. 화면·라우트·메뉴·새 업무 기능을 추가하지 않았다. 추가 요청에 따른 유일한 동작 확장은 **필수 정보 수집 완료 후 종료 안내와 자동 종료**다. 웹 변경은 기존 음성 제어·종료 콜백·안내 문구이며 센터 JSON은 계약 버전 메타데이터만 맞췄다.

## 자동 종료 경계

1. 최신 발화 READY와 성공 EXTRACT_NEED를 확인한다. 물품·시작/종료 시각·장소, 기간 유효성, 추가 질문 없음, 요청 revision을 서버에서 검사한다. 예산은 선택이다.
2. 같은 Live 모델에 고정 종료 안내를 요청한다. 안내 생성 중 직접 Live 출력은 음소거한다.
3. 출력 전사와 sideband PCM의 세션 시간 범위를 연결해 해당 안내만 유한 WAV로 만든다. 누락된 시작·중간 오디오, 불완전한 문구, 없는 타임스탬프는 거부한다. 출력의 말미 무음이 전달되지 않아도 실제 발화 끝까지의 구간은 사용할 수 있다.
4. 브라우저는 그 WAV의 자연스러운 `ended` 이벤트를 기다린다. 수신 확인·전사·재생 시작만으로 끝내지 않는다. 중단·차단·오류는 자동 종료를 막고 기존 버튼을 안내한다.
5. 최신 서버 snapshot을 다시 확인하고 기존 `/finish`를 호출한다. 서버는 세션·CSRF·멱등성·후보·입력 revision·요청 버전을 검사한다. 같은 자동 종료 body만 재시도하며 DB가 최종 작업 하나를 보장한다.
6. 기존 최종 추출 → 초안 저장 → 조건이 완전하면 검색 → 요청함 흐름을 사용한다. 주민 전송·승인·선택·결제는 자동 실행하지 않는다.

서버의 `completionAudioDelivered`는 안내 전달만 확인한다. 실제 브라우저 재생 종료는 클라이언트가 확인한다. 이 플래그가 청취 증명이거나 새 권한이라고 해석하지 않는다. 생성된 안내를 한 번 완전히 받아 재생하므로 안내 전 준비 시간이 추가된다.

## 보존·관측

- 업무 AI 관측에는 역할·프롬프트 버전·taskId·지연·고정 결과 분류만 남긴다. 사용자 발화·모델 결과·provider 오류 내용은 기록하지 않는다.
- 사용자 원음은 캡처·저장하지 않는다. 에이전트 종료 안내 PCM만 최대 30초 분량을 메모리에 두고 정정·종료 시 폐기한다. 전달된 WAV도 API no-store와 PWA NetworkOnly를 따른다.
- 기존 원문 정리·615초 보존 한도는 유지하며, 새 수집 결과/음성 버퍼도 close에서 제거한다.

## 검증 결과

- 전체 Vitest: 25개 파일, 211/211 통과.
- 서버 수용 테스트: 36/36 통과. 테스트 전용 PostgreSQL DB를 생성·삭제했으며 공유 시연 DB를 초기화하지 않았다.
- 전체 workspace TypeScript 및 production web 빌드 통과.
- 실제 Chromium 유한 오디오 재생: 재생 시작만으로 미완료, 자연 종료 후 완료, 중간 취소 후 미완료 확인. 재생 검증 JSON (실행 산출물은 공유본에서 제외).
- 실제 OpenAI Live + Decisions + Responses, Chromium 합성 한국어 마이크: 종료 안내 자연 재생 종료 1회 → 자동 finish POST 1회/202 → 요청함 이동 → MATCHES_READY, 최종 작업 1개, 주민 분기 0개를 확인했다. 시작 구간 누락 검사 추가 뒤 재실행도 성공했다. 최신 Live 증거 (실행 산출물은 공유본에서 제외).
- 최초 Live 시도는 안내 클립 준비에 실패해 수동 종료 fallback으로 남았다. 오디오 시간 범위 처리와 선택적 말미 무음을 보완한 뒤 두 번 성공했다. 성공률 목표 10회 중 9회를 검증한 것은 아니다.

회귀 테스트에는 잘못된 입력의 모델 호출 차단, 의미 검증 실패·가격/의도 fallback, 로그 비밀 제거, stale 발화와 비동기 조회 뒤 재검사, 추가 질문/불완전 기간의 종료 금지, 정정 중 후보·클립 폐기, 안내 전달 전 종료 금지, 동시 종료와 동일 세션 중복 작업 방지, 종료 중 다른 화면의 수정과 충돌, 권한 없는 클립 조회, 재생 중단/차단 및 늦은 ended 무시를 포함한다.

## 재현

```sh
npm run typecheck
npm test
npm run test:acceptance
npm run build
node apps/web/scripts/verify-voice-completion.mjs
node --env-file=.env --import tsx apps/api/test/voice-auto-finish-live.ts
```

마지막 명령은 실제 API를 사용한다. 합성 입력 fixture 생성에만 기존 테스트와 같은 gpt-4o-mini-tts를 사용한다. 제품의 음성·업무·판정 모델은 지정된 gpt-live-1 / gpt-6.1-terra / gpt-6-luna를 유지한다. Live 테스트는 3103/5175 포트와 독립 DB를 사용한다. 원문·키·생성된 안내 오디오는 보고서에 저장하지 않는다.

실제 사람 음성·갤럭시/iPhone·Safari/PWA·스크린리더·운영 환경 지연은 이번 검증에 포함하지 않았다. AT21·AT22 완료를 주장하지 않는다. 계약 버전이 변경됐으므로 API와 web은 함께 배포해야 한다.

공식 근거: [역할 정의](https://developers.openai.com/api/docs/guides/agents/define-agents), [가드와 승인](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals), [Live 위임](https://developers.openai.com/api/docs/guides/live-delegation), [서버 제어와 재생 경계](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live). 타임스탬프·PCM 형식은 설치된 OpenAI SDK의 Live event 타입과 실제 연결에서 확인했다.
