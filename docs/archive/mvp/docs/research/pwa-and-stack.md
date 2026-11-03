> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `docs/research/pwa-and-stack.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../../../README.md)을 먼저 확인하세요.

# PWA·모바일 컴포넌트·기술 스택 리서치

확인일: 2026-10-31. 로컬 배포 요구 반영: 2026-11-01. 이 문서는 문서 작성 단계의 조사 결과와 설계 권고다. 실제 기기 시험, 패키지 설치, 애플리케이션 구현은 수행하지 않았다. `확인`은 아래 공식 문서에서 확인한 사실이고, `선정`은 이 MVP를 위한 기술적 판단이다.

## 1. 선정안

| 영역 | 선정 | 이 MVP에 적용하는 이유 |
| --- | --- | --- |
| 프론트엔드 | React + TypeScript + Vite, React Router | 앱 중심 PWA와 화면 전용 센터 메뉴를 한 클라이언트에서 구성한다. 독립 REST 계약을 기준으로 서버와 병렬 개발한다. |
| PWA | `vite-plugin-pwa` + Workbox | manifest, service worker, 설치 아이콘과 앱 셸 캐시를 관리한다. |
| UI | React Aria Components + 자체 CSS 변수·디자인 토큰 | 접근성·포커스·키보드·국제화 동작을 활용하고, 외형은 자체 수채화 디자인으로 만든다. |
| 서버 | Node.js + TypeScript + Fastify | 공통 JSON Schema로 요청 검증과 응답 직렬화를 묶고, OpenAPI 계약을 유지한다. |
| 데이터 | PostgreSQL | 사용자·물품·요청·조건 버전·이벤트를 영속화하고 동시 응답을 트랜잭션으로 제어한다. |
| 비동기 업무 | `pg-boss` 기반 별도 Node worker 프로세스 | 앱이 닫혀도 요청 전달·조건 요약·재시도 작업이 계속되게 한다. Redis 추가 없이 PostgreSQL을 활용한다. |
| 로컬 배포 | 한 PC의 정적 web 빌드 + Fastify API + worker + PostgreSQL, Caddy 진입점 | `http://localhost:8000`에서 로컬 서버에 접속한다. 클라우드 배포를 기본 조건으로 두지 않는다. |
| 서버→앱 상태 전달 | 같은 origin의 SSE + REST snapshot | 소유자 요청 카드와 요청자 진행 상황을 갱신한다. 음성 스트림과 업무 이벤트를 분리한다. |
| 음성 | WebRTC + OpenAI GPT-Live | 실제 전화 발신 없이 앱 안에서 음성을 주고받는다. 모델·인증 방식은 OpenAI 조사 (공유본 미포함: `./openai-models.md`)를 따른다. |
| 프로젝트 경계 | 하나의 TypeScript 저장소, `web`·`api`·`worker`·`contracts` 구분 | 세 영역을 병렬 작업하되 인증·상태 규칙의 구현은 서버 한 곳에서 소유한다. 이 경로는 향후 구조 제안이며 현재 앱을 생성하지 않는다. |

React 공식 문서는 새 앱에 프레임워크 사용을 우선 권장하면서 Vite로 시작하는 경로도 설명한다. 이 MVP는 공개 검색 최적화·SSR보다 독립 API, 음성 세션, 두 사용자 상호작용의 검증이 중요하므로 Vite SPA를 선택한다. 라우팅과 데이터 로딩을 별도로 정해야 하는 비용은 받아들인다. [React의 빌드 도구 경로](https://react.dev/learn/build-a-react-app-from-scratch)

Vite PWA는 manifest와 service worker 생성·등록을 제공한다. Fastify는 JSON Schema 기반 입력 검증·응답 직렬화를 지원한다. pg-boss는 PostgreSQL `SKIP LOCKED`를 이용하는 Node.js 작업 큐다. 이 세 가지는 공식 문서에서 확인했다. [Vite PWA](https://vite-pwa-org.netlify.app/guide/), [Fastify 검증·직렬화](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [pg-boss 저장소](https://github.com/timgit/pg-boss)

### 대안 비교와 채택하지 않은 이유

| 대안 | 판단 |
| --- | --- |
| Next.js 등 통합 React 프레임워크 | 향후 공개 콘텐츠 SEO·SSR가 커지면 적합하다. 현재는 별도 서버 계약과 worker가 필요하므로 통합 프레임워크를 추가하는 이점이 작다고 판단했다. |
| Redis 기반 별도 큐 | 가능하지만 데모 규모에서 운영 저장소를 추가할 근거가 약하다. PostgreSQL 기반 큐를 먼저 사용한다. |
| 브라우저 메모리·localStorage만으로 상태 관리 | 실제 서로 다른 아이디와 기기 사이의 요청 전달, 앱 종료 후 진행, 동시 승인 충돌을 검증할 수 없어 채택하지 않는다. |
| React Aria 대신 Radix 기반 컴포넌트 | Radix도 포커스·키보드·ARIA 동작을 제공한다. 이번에는 날짜 범위와 국제화까지 같은 계열에서 구성하기 위해 React Aria를 선택한다. 두 라이브러리를 기본 세트로 중복 도입하지 않는다. |

위 비교는 프로젝트 설계 판단이다. Radix의 접근성 기능 자체는 공식 설명으로 확인했다. [Radix 접근성](https://www.radix-ui.com/primitives/docs/overview/accessibility)

패키지의 구체 버전은 구현 착수 시 서로 호환되는 안정 릴리스를 검증한 뒤 lockfile에 고정한다. 이 문서는 확인하지 않은 최신 버전 번호를 제시하지 않는다. 사용자가 정한 이번 MVP 배포 대상은 로컬 PC다. 해당 PC에서 API·worker·DB를 계속 실행한다.

### 로컬 배포

선정 구조는 `로컬 PC의 브라우저 → http://localhost:8000 → 정적 web / API·SSE → PostgreSQL·worker`다. web은 Vite 개발 서버에만 의존하지 않고 정적 production 빌드를 제공한다. Caddy가 정적 파일을 제공하고 `/api/*`를 Fastify로 전달해 쿠키·SSE가 같은 origin을 사용하게 한다. [Caddy reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy)

| 구성 | 로컬 실행 기준 |
| --- | --- |
| 네트워크 노출 | 프록시는 `127.0.0.1`에 바인딩한다. API는 loopback 또는 로컬 컨테이너 내부, PostgreSQL은 loopback 또는 비공개 컨테이너 네트워크로 제한한다. DB 포트를 휴대폰에 개방할 필요가 없다. |
| 파일·키 | OpenAI API 키·DB 비밀번호는 저장소에 커밋하지 않는다. |
| PC 수명 | PC가 깨어 있고 API·worker·DB가 실행 중인 동안 서버 업무가 계속된다. PC 종료·절전 중까지 처리가 이어진다고 표현하지 않는다. 재실행 후 저장된 작업·상태가 복구되어야 한다. |

로컬 배포는 인터넷 없이 모든 기능이 동작한다는 뜻이 아니다. PC의 OpenAI API 호출과 휴대폰의 OpenAI GPT-Live WebRTC 연결에는 외부 인터넷이 필요하다. 로컬 Wi-Fi 연결과 OpenAI 접근을 각각 시험한다. 인터넷이 끊기면 로컬 정적 화면·이미 저장된 DB 상태 조회는 가능할 수 있지만 새 AI 음성·추론 작업은 실패 또는 재시도 대기로 표시한다. 외부 연결 없이 완료된 AI 대여 요청처럼 꾸미지 않는다.

## 2. 갤럭시·애플에서 실제로 보장할 범위

| 항목 | 확인한 플랫폼 특성 | MVP 요구사항 |
| --- | --- | --- |
| 마이크 | `getUserMedia()`는 사용자 권한이 필요하다. | 사용자의 ‘AI와 이야기하기’ 버튼 동작으로 권한을 요청한다. 거부·기기 없음·사용 중 오류를 구분하고 텍스트 입력 경로를 제공한다. |
| Android 설치 | Chrome 및 Samsung Internet의 PWA 설치 경로가 있다. | 두 브라우저에서 웹 진입과 설치 실행을 모두 시험한다. 설치 여부가 대여 업무 사용의 필수 조건이 되지 않는다. |
| iPhone 설치 | Safari 공유 메뉴의 ‘홈 화면에 추가’와 manifest의 standalone 실행을 지원한다. | iPhone에서는 실제 공유 메뉴 안내를 제공한다. Android 설치 배너를 그대로 재현하지 않는다. |
| 앱 종료·백그라운드 | 모바일 브라우저는 페이지를 정지하거나 폐기할 수 있다. | 백그라운드 마이크·음성 연결 유지를 보장하지 않는다. 서버에서 접수된 업무만 계속 처리한다. |
| 알림 | iOS 홈 화면 웹 앱의 Web Push는 별도 사용자 권한 조건이 있다. | MVP 필수는 앱 내 요청함과 다시 접속했을 때 상태 복원이다. Web Push는 별도 후속 기능으로 둔다. |

근거: [MDN 마이크 권한](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN 설치 조건·브라우저 차이](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [Samsung 공식 PWA 설치 안내](https://developer.samsung.com/automation/progressive-web-app.html), [WebKit 홈 화면 웹 앱·Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Chrome 페이지 생명주기](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

‘앱을 닫은 뒤 AI가 계속 일한다’는 표현은 **서버가 저장된 요청을 처리하고 다음 사용자 응답을 기다린다**는 뜻이다. 사용자가 말했지만 아직 서버에 저장·확인하지 않은 요청까지 제출되었다고 간주하지 않는다. 마이크 사용 중에는 상태 표시, 음소거, 대화 종료를 항상 제공한다. 대화 종료 시 미디어 트랙과 연결을 정리한다.

설치형 PWA·일반 Safari·다른 앱의 내장 브라우저를 동일 환경으로 보지 않는다. 내장 브라우저에서 음성이나 설치가 막히면 Safari/Chrome/Samsung Internet으로 여는 안내를 제공한다. 현재 문서 조사는 실제 모든 OS·브라우저 조합의 동작 보증이 아니다.

## 3. 한국어·모바일 UI와 에셋

React Aria는 외형을 직접 구성할 수 있는 접근성·국제화 컴포넌트를 제공한다. `DateRangePicker`는 날짜 구간 입력과 달력, 날짜·시간대 처리를 지원한다. 이를 사용해 한국어 레이블과 대여 기간 입력을 통일한다. [React Aria](https://react-aria.adobe.com/), [날짜 구간 입력](https://react-aria.adobe.com/DateRangePicker)

| 구성 | 구현 시 적용할 설계 규칙 |
| --- | --- |
| 기본 조작 | 터치 영역 최소 44×44 CSS px, 핵심 음성·승인 버튼은 48px 이상을 설계 목표로 둔다. 이는 제품 목표이며 WCAG AA 최소치 24×24px와 구분한다. |
| 텍스트 | 본문 16px 이상, 충분한 행간, `lang="ko"`, 한글 장문이 깨지지 않는 줄바꿈. placeholder만으로 필드명을 대신하지 않는다. |
| 글꼴 | Pretendard self-host 또는 시스템 한글 sans-serif fallback. 실제 배포 시 사용 라이선스 파일을 함께 관리한다. |
| 날짜·금액 | 화면은 `ko-KR`와 `Asia/Seoul`, 원화는 정수 원 단위. ‘내일’·‘다음 주’는 절대 날짜와 요일로 다시 보여 준다. |
| 안전 영역 | `viewport-fit=cover`와 `env(safe-area-inset-*)`를 고려해 하단 내비게이션·마이크·CTA가 홈 인디케이터와 겹치지 않게 한다. |
| 작은 화면·키보드 | 360 CSS px 폭에서 가로 스크롤 없이 사용한다. 입력 중 키보드가 CTA를 가리지 않게 한다. 설치/브라우저 모드와 화면 회전을 각각 확인한다. |
| 요청 카드 | 물품·기간·장소·가격·변경 전후·현재 응답자·응답 버튼을 한 카드에 담는다. 색상만으로 승인·대기를 구분하지 않는다. |
| 바텀 시트 | 포커스 이동·닫기·뒤로 가기·스크린리더 레이블을 구현한다. 스와이프만 가능한 필수 조작을 만들지 않는다. |
| 음성 화면 | 말한 내용의 텍스트 요약, 잘못 인식된 기간 수정, 연결 실패 재시도, 텍스트 대체 입력을 제공한다. |
| 상태 표현 | ‘듣는 중 / 조건 확인 중 / 물품 찾는 중 / 소유자 응답 대기 / 조건 확인 필요’처럼 실제 서버·음성 상태와 연결한다. 대기 중에 가짜 진행률을 만들지 않는다. |

일반 텍스트 대비는 4.5:1, 큰 텍스트는 3:1을 기준으로 검증한다. 수채화 질감은 카드 바깥 장식·일러스트에 사용하고 글자 바로 아래에는 안정적인 단색 바탕을 둔다. [WCAG 대비](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WCAG 최소 터치 크기](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [WebKit safe area](https://webkit.org/blog/7929/designing-websites-for-iphone-x/), [Pretendard 공식 저장소](https://github.com/orioncactus/pretendard)

에셋은 세 층으로 구성하도록 권고한다.

1. 기본 기능 아이콘: Lucide 등 일관된 SVG 아이콘. 라이선스 고지를 유지한다. [Lucide 라이선스](https://lucide.dev/license)
2. 고유 기능 그림: 자체 제작 SVG 물품 그림·센터 공간 모티프·음성 상태 오브젝트. 색상은 브랜드 조사 (공유본 미포함: `./center-and-brand.md`)의 팔레트 토큰에 연결한다.
3. 정서적 그림: Imagegen 또는 직접 제작한 수채화 종이 질감·생활 물품 일러스트. WebP/AVIF 등 모바일용 크기로 내보내며 텍스트·금액·버튼은 이미지에 굽지 않는다.

음성 에이전트의 움직임은 녹음 중 작은 파형, 검색 중 겹치는 물감 번짐, 응답 대기 중 정적인 봉투 그림처럼 상태별로 정의한다. `prefers-reduced-motion` 설정에서는 정적인 아이콘과 문구를 제공한다. 이번 산출물은 제작 방향과 에셋 목록이며 최종 이미지 제작은 앱 구현 단계의 작업이다.

## 4. 공통 컨트랙트에 반영할 기술 결정

### 세션과 접근 경계

- 사용자가 사전 준비된 데모 아이디를 입력하면 서버가 해당 데모 사용자의 세션을 만든다. 주민등록·센터 회원 인증을 구현했다고 표현하지 않는다.
- 세션은 같은 origin의 `demo_session; HttpOnly; SameSite=Lax; Path=/` 쿠키로 유지한다. 클라이언트가 보낸 `userId`를 권한 근거로 사용하지 않는다. mutation은 Origin/CSRF 검사를 적용한다.
- 요청자의 요청 상세와 해당 물품 소유자의 요청 카드를 서버가 권한에 따라 투영한다. 물품 소유 여부는 DB의 owner 값으로 판정한다.
- 일반 OpenAI API 키는 서버/worker에만 두고 PWA 번들·서비스 워커·로그에 넣지 않는다.

### 영속 업무와 실시간 표시

- REST 쓰기 성공은 DB commit 이후 응답한다. 상태 변경과 이벤트·작업 생성 사이의 유실을 막기 위해 같은 트랜잭션이나 outbox 방식을 사용한다.
- 큐 재시도·브라우저 재전송·OpenAI 재요청을 고려해 애플리케이션 명령마다 idempotency key를 저장한다. 큐 도입만으로 외부 효과가 정확히 한 번 실행된다고 간주하지 않는다.
- 요청·조건 제안은 `version`을 가진다. 이미 변경된 요청에 대한 승인·조건 변경은 충돌로 거절하고 최신 snapshot을 반환한다.
- SSE는 해당 세션이 볼 수 있는 이벤트만 보낸다. `eventId`, `requestId`, `version`, `occurredAt`, 이벤트 종류를 포함하고 클라이언트가 중복을 버린다.
- 앱 재진입 시 REST snapshot을 먼저 읽고 event cursor 이후를 연결한다. 보관 기한이 지난 cursor는 전체 재동기화로 처리한다. 이벤트 수신 자체를 최종 업무 상태의 유일한 근거로 삼지 않는다.
- SSE 연결 실패 시 앱이 전경에 있을 때만 제한된 polling으로 전환한다. 앱이 닫힌 동안은 SSE 연결이 없어도 DB·worker 업무가 유지된다.

SSE의 자동 재연결과 이벤트 ID 형식은 표준 `EventSource` 동작을 활용한다. 위의 사용자별 접근 제어, snapshot/cursor 정책, 중복 처리 규칙은 이 프로젝트의 추가 설계다. [MDN SSE 사용](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

### PWA 캐시와 배포

- 앱 셸·버전이 붙은 정적 에셋·센터 화면용 공개 데모 콘텐츠만 캐시한다. 세션·개인 요청·소유자 카드·음성 세션·조건 변경 API는 network-only로 처리한다.
- 로컬 서버에 연결할 수 없을 때는 연결 복구 안내와 캐시된 안내 화면을 표시한다. 승인·신청을 접수한 것처럼 보이게 하거나 보이지 않는 오프라인 명령 큐를 만들지 않는다. 로컬 서버는 연결되지만 외부 OpenAI 연결만 실패한 경우에는 AI 작업 실패를 별도로 표시한다.
- 새 service worker는 음성 대화·조건 입력 중 자동 reload하지 않는다. 사용자에게 업데이트 가능 상태를 알리고 안전한 시점에 전환한다.
- 두 테스트 사용자는 별도 기기나 분리된 브라우저 프로필을 사용한다. 같은 브라우저의 일반 탭 두 개는 쿠키 세션을 공유하므로 서로 다른 사용자 테스트로 취급하지 않는다.

## 5. 구현 후 검증할 수용 기준

아래는 아직 실행하지 않은 테스트 계획이다. 해커톤에서 사용할 실제 단말의 OS·브라우저 버전은 시험 기록에 남긴다.

| 환경 | 필수 확인 |
| --- | --- |
| 갤럭시 Chrome 웹·설치 모드 | 진입, 마이크 허용/거부, 한국어 음성, 텍스트 대체, 요청 제출, 소유자 카드, 설치 아이콘, 앱 복귀 |
| 갤럭시 Samsung Internet 웹·설치 모드 | 동일 흐름, 설치 경로와 오디오 재생, 키보드·하단 안전 영역 |
| iPhone Safari 웹·홈 화면 모드 | 동일 흐름, 공유 메뉴 설치 안내, 오디오 시작 사용자 동작, 잠금·복귀 후 새 음성 세션 시작 |
| 서로 다른 두 실제 사용자 | A의 신청 → B의 승인/거절/변경 → A의 최신 조건 표시. 어느 한쪽 앱을 닫았다 열어도 서버 저장 상태 복구 |
| 접근성·입력 | VoiceOver 또는 TalkBack으로 요청 카드와 승인 버튼 식별, 텍스트 확대, 작은 화면·가상 키보드, reduced motion |
| 실패·경합 | 중복 탭·재시도, 오래된 조건 승인, 네트워크 끊김, worker 재시작, 이벤트 재수신, 사용 권한 없는 요청 접근 |
| 로컬 실행 수명·외부 연결 | PC 재시작 뒤 작업 복구, 휴대폰 앱 종료와 PC 절전 구분, 로컬 서버 단절과 OpenAI 인터넷 단절을 서로 다른 오류로 표시 |

공식 문서에서 지원 여부를 확인하는 것과 실제 한국어 음성의 인식률·지연·브라우저 조합의 안정성을 검증하는 것은 구분한다. 실제 단말 리허설 결과가 나오기 전에는 이 항목들을 ‘검증 완료’로 표시하지 않는다.
