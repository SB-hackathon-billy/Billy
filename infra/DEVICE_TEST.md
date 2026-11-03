# 실제 휴대폰 검증 — AT21·AT22

상태: **미검증**. 아래 절차는 준비물이며 실제 갤럭시·iPhone, 한국어 음성 품질·지연, VoiceOver·TalkBack 합격을 뜻하지 않는다. Chromium 자동화 결과는 `test-artifacts/e2e/`에 별도로 남긴다.

## PC 준비

Node.js 26.8.2, npm 11.19.1, Docker Compose, mkcert가 필요하다. macOS의 Colima는 사용자 홈만 마운트한다. 새 환경에서는 `colima start --mount "$HOME:w"`를 사용하고, 이미 실행 중인 공유 VM·DB를 재생성하지 않는다.

```sh
npm ci
npm run certs
npm run up
npm run seed -- --scenario default
```

`certs`는 mkcert가 없으면 Homebrew로 설치하고 `infra/certs/ca` 전용 CAROOT를 만든다. `localhost`, `127.0.0.1`, 현재 LAN IPv4를 SAN에 넣는다. `en0` → 기본 경로 인터페이스 순서로 주소를 찾으며 `LAN_IP=192.168.0.10 npm run certs`로 지정할 수 있다. 출력된 URL을 사용하고 IP가 바뀌면 인증서를 다시 발급한 뒤 `npm run down && npm run up`으로 Caddy를 다시 시작한다.

`up`은 production web을 빌드하고 PostgreSQL migration, API·worker·Caddy를 실행한다. web의 mock은 production에서 제외된다. 기본 AI 모드는 **live**이며 루트 `.env`의 서버 전용 OpenAI 키를 API·worker에만 전달한다. `seed`는 개발 DB의 업무 데이터를 초기화하므로 다른 시연이 진행 중이면 조율한다. `down`은 API·worker·Caddy만 중지하며 공유 DB와 volume은 보존한다.

시작 후 PC에서 확인한다. LAN 주소는 `infra/certs/hosts.json` 또는 `certs` 출력에서 확인한다.

```sh
curl --cacert infra/certs/ca/rootCA.pem https://localhost:8443/
curl --cacert infra/certs/ca/rootCA.pem https://localhost:8443/api/v1/places
curl --cacert infra/certs/ca/rootCA.pem https://<PC의-LAN-IP>:8443/api/v1/places
docker compose ps
```

LAN에는 8443만 publish한다. API는 compose 내부에서만 수신하고 PostgreSQL은 `127.0.0.1:54329`에서만 접근한다. Caddy는 SSE를 `flush_interval -1`로 즉시 전달한다. 휴대폰과 PC는 같은 네트워크에 있어야 하며 AP/client isolation·방화벽이 연결을 막으면 해당 로컬 설정을 확인한다. PC 절전 중에는 서버 처리가 진행되지 않는다.

## 테스트 CA 신뢰

스크립트는 시스템 키체인이나 휴대폰의 신뢰 설정을 변경하지 않는다. PC 브라우저를 신뢰 설정하여 시험하려면 사용자가 저장소 루트에서 직접 아래 명령을 실행한다. 권한 요청을 확인한 뒤 진행한다.

```sh
CAROOT="$PWD/infra/certs/ca" mkcert -install
```

휴대폰으로 전달할 파일은 **`infra/certs/ca/rootCA.pem` 공개 인증서 하나**다. AirDrop 또는 USB 등 직접 전달 방법을 사용한다. iPhone에서 확장자 인식이 필요하면 공개 인증서 복사본을 `rootCA.crt`로 이름만 바꾼다. `rootCA-key.pem`, `local-key.pem`, `.env`는 전달하지 않는다. 루트 CA·서버 인증서·키 전체는 `.gitignore`에서 제외된다.

### iPhone

1. 전달받은 공개 인증서를 열어 프로파일을 다운로드한다.
2. 설정 → 일반 → VPN 및 기기 관리에서 해당 프로파일을 설치한다. 기기 암호를 입력한다.
3. 설정 → 일반 → 정보 → 인증서 신뢰 설정에서 해당 mkcert 루트 인증서의 **전체 신뢰**를 켠다.
4. Safari에서 `https://<PC의-LAN-IP>:8443`을 연다. 인증서 경고가 없어야 한다.
5. 공유 메뉴 → 홈 화면에 추가를 실행한다. 홈 화면 아이콘으로 다시 열고 별도로 검증한다.

프로파일 설치만으로 TLS 신뢰가 켜지는 것은 아니다. [Apple의 수동 인증서 신뢰 안내](https://support.apple.com/en-us/102390)를 따른다.

### 갤럭시

1. 공개 인증서를 기기에 복사한다.
2. 설정 → 보안 및 개인정보 보호 → 기타 보안 설정 → 기기 저장공간에서 설치 → CA 인증서에서 선택한다. One UI 버전에 따라 메뉴명이 다르므로 실제 경로를 기록한다.
3. Chrome과 Samsung Internet 각각에서 동일한 LAN HTTPS 주소를 연다. 인증서 경고가 없어야 한다.
4. 각 브라우저의 앱 설치/홈 화면 추가 메뉴로 설치하고, 아이콘 실행에서도 같은 흐름을 확인한다.

브라우저 경고 무시·HTTP LAN URL·자동화의 `ignoreHTTPSErrors`는 실기기 합격 방법으로 사용하지 않는다. 자세한 CA 배포 경계는 [mkcert 모바일 안내](https://github.com/FiloSottile/mkcert#mobile-devices)를 참고한다.

## 실행 체크리스트

서로 다른 실제 기기에 `demo-hana`, `demo-duri`, `demo-seul`로 진입한다. 같은 브라우저의 일반 탭은 쿠키를 공유하므로 사용자 분리로 세지 않는다. 한국어 음성과 OpenAI 연결에는 PC와 휴대폰 모두 외부 인터넷이 필요하다. 사용 중인 모델은 `gpt-live-1`, `gpt-6.1-terra`, `gpt-6-luna`이며 접근 실패를 다른 모델로 대체하지 않는다.

| 검증 환경                        | HTTPS  | 마이크·오디오 | 한국어 음성 | 설치·재실행 | 다자 흐름 | 상태   |
| -------------------------------- | ------ | ------------- | ----------- | ----------- | --------- | ------ |
| 갤럭시 Chrome 브라우저           | 미검증 | 미검증        | 미검증      | 해당 없음   | 미검증    | 미검증 |
| 갤럭시 Chrome 설치 PWA           | 미검증 | 미검증        | 미검증      | 미검증      | 미검증    | 미검증 |
| 갤럭시 Samsung Internet 브라우저 | 미검증 | 미검증        | 미검증      | 해당 없음   | 미검증    | 미검증 |
| 갤럭시 Samsung Internet 설치 PWA | 미검증 | 미검증        | 미검증      | 미검증      | 미검증    | 미검증 |
| iPhone Safari                    | 미검증 | 미검증        | 미검증      | 해당 없음   | 미검증    | 미검증 |
| iPhone 홈 화면 PWA               | 미검증 | 미검증        | 미검증      | 미검증      | 미검증    | 미검증 |

- HTTPS 오류 없이 접속하고 실제 마이크를 허용한다. “모레 오전 10시부터 다음날 오후 4시까지 프로젝터가 필요해요”를 말한다. 상대 날짜를 절대 날짜로 보여 주고 누락 장소를 확인하는지 기록한다. 음성 전사·오디오·응답 지연을 기록한다.
- 음소거, 종료, 권한 거부 후 텍스트 입력, 오디오 자동재생 차단 후 재생 버튼을 확인한다. 텍스트 성공을 음성 성공으로 기록하지 않는다.
- 하나가 요약을 확인한 뒤 공공·두리·슬 3개 후보를 전송한다. 두리는 4,500원·도서관 앞으로 변경하고 슬은 3,000원·역 앞 조건을 승인한다. 공공은 3,000원·센터 앞 데모 제안을 만든다.
- 다른 기기 갱신을 측정한다(목표 2초 이내). 하나 화면에서 기간·장소·금액·변경 표시를 비교하고 두리를 선택한다. 두리 선택됨, 다른 분기 종료, 4,500원 결제 미리보기와 “실제 결제와 예약이 이루어지지 않습니다.”를 확인한다.
- 하나의 앱을 완전히 닫은 동안 소유자가 응답한 뒤 재진입한다. 최신 비교 상태가 복원되고 마이크는 자동 시작되지 않는지 확인한다. 화면 잠금·백그라운드·복귀 때도 새 음성은 사용자의 버튼으로 시작한다.
- 아이디 전환 후 이전 사용자 요청·카드가 남지 않는지 확인한다. 오프라인 안내, 제출·승인 비활성, 캐시된 센터 안내, 재연결 후 snapshot 복원을 확인한다.
- 360px 상당 좁은 화면, 큰 글자, 가상 키보드, 하단 안전 영역, 화면 회전, reduced motion을 확인한다. VoiceOver·TalkBack으로 카드의 물품·기간·장소·가격·상태와 승인·변경·선택 버튼을 식별하고 끝까지 조작한다.
- 센터 프로그램·동아리 세 양식·공간 예약 미리보기는 서버 접수 없이 종료되는지 확인한다.

## 기록 양식

| 항목                                            | 기록                           |
| ----------------------------------------------- | ------------------------------ |
| 실행 시각 / 담당자                              | 미기록                         |
| 계약 / git revision                             | 0.1.0 / 미기록                 |
| seed 시각 / 시나리오                            | 미기록                         |
| PC·LAN 주소·Wi-Fi / CA 신뢰 경로                | 미기록                         |
| 기기·OS·브라우저 버전 / 브라우저·설치 모드      | 미기록                         |
| 테스트 아이디·상대 기기                         | 미기록                         |
| 음성 발화 / 전사·요약 / 누락 질문 / 오디오 결과 | 미기록                         |
| 요청→소유자 / 소유자→요청자 지연(ms)            | 미기록                         |
| 정상 흐름 시도 수 / 결제 미리보기 도달 수       | 미기록 (목표 10회 중 9회 이상) |
| 잘못된 승인 / 중복 선택 수                      | 미기록 (목표 0건)              |
| AT21 / AT22 결과·실패 단계·재현 절차            | 미검증                         |
| 스크린샷·화면 녹화 경로                         | 미기록                         |

시연 종료 후 기기에서 설치한 테스트 CA 프로파일/인증서를 제거한다. PC 키체인에 설치했다면 사용자가 동일 CAROOT로 `mkcert -uninstall`을 실행한다. 개인키가 유출되었다면 해당 CA를 계속 사용하지 않고 새 CA를 발급한 뒤 모든 기기의 신뢰를 교체한다.

## 자동화와 실기기 결과의 구분

`npm run test:e2e`는 production web + 실제 API·PostgreSQL·pg-boss·SSE를 구동하며 **AI만 고정 fixture 모드**로 실행한다. 별도 테스트 DB를 생성·삭제하고 종료 시 live 시연 스택으로 복귀한다. 자동화 한정 `ignoreHTTPSErrors`와 프로젝트 인증서 공개키에만 한정한 Chromium SPKI 예외를 사용한다(서비스 워커 다운로드에 필요). 별도 `curl --cacert`는 예외 없이 인증서를 검증한다. Playwright는 390×844 Chromium 세 쿠키 저장소를 사용하며 UI 클릭·키보드로만 업무 명령을 보낸다. 요청자의 핵심 흐름은 Tab·Enter·Space·방향키로 수행하고 소유자의 네이티브 선택창은 Playwright UI 선택을 사용한다. [Playwright 접근성 검사 안내](https://playwright.dev/docs/accessibility-testing)처럼 axe 자동 검사는 실기기 스크린리더 검증을 대체하지 않는다.

## 자동화 실행 기록

아래는 이 PC에서 실제 실행한 결과다. 위 실기기 표의 **미검증** 상태는 유지한다.

| 명령·검사                                                                                            | 관찰 결과                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run certs`                                                                                      | mkcert 1.4.4 설치 후 프로젝트 CA와 localhost·127.0.0.1·223.194.139.23 SAN 인증서 발급, 시스템 신뢰 설치 없음                                     |
| `npm run up`                                                                                         | production web·runtime image 빌드, migration, API·worker·Caddy 시작 성공                                                                         |
| `npm run seed -- --scenario default`                                                                 | 실제 개발 DB에 사용자 4명·장소 3곳·물품 10개 적재                                                                                                |
| `curl --cacert infra/certs/ca/rootCA.pem`                                                            | localhost·127.0.0.1·223.194.139.23의 8443에서 루트 HTTPS 200, `/api/v1/places` 200·3곳·계약 0.1.0; LAN origin 세션 생성 201                      |
| `npm run test:e2e`                                                                                   | **4개 통과**: 기본 3개(14.0초), expiry-fast 1개(36.2초), 재시도 0·실패 0                                                                         |
| SSE 수신 및 UI 반영                                                                                  | 요청자→소유자 **93ms**, 소유자→요청자 **39ms**; CDP로 실제 named SSE 이벤트 수신도 확인                                                          |
| 다자·복원·격리                                                                                       | 두리 4,500원·도서관 앞 선택, 나머지 2분기 SUPERSEDED, 요청자 페이지 종료 중 슬 응답 후 복원, 준 전환 후 이전 요청 404·비노출                     |
| 결제·만료                                                                                            | PREVIEW_ONLY·chargeable=false·NOT_APPLICABLE, 실제 30초 후 EXPIRED, 가상 시계 사용 없음·결제 mutation 0                                          |
| 센터                                                                                                 | 메뉴 6개·프로그램/리더/팀원/활동보고/공간 미리보기 5개, mutation 0                                                                               |
| 마이크·오프라인·키보드                                                                               | 브라우저의 실제 denied 권한 상태에서 텍스트 대체, 오프라인 명령 비활성·센터 안내, 요청자 핵심 흐름 키보드 통과                                   |
| axe                                                                                                  | 8개 화면에서 전체 위반 **0건**, critical **0건**                                                                                                 |
| PWA                                                                                                  | production 서비스 워커 활성, API Cache Storage 0건, 공개 센터 캐시, 192·512 PNG 실측, manifest·secure context, Chromium installabilityErrors 0개 |
| `npm run -w @sb/web test`                                                                            | 25개 통과                                                                                                                                        |
| `npx vitest run --project @sb/api apps/api/src/origins.test.ts`                                      | 허용 origin 2개·미허용/유사 origin 403 검사 1개 통과                                                                                             |
| `npm run -w @sb/web typecheck`, `npm run -w @sb/api typecheck`, `npx tsc -p tests/e2e/tsconfig.json` | 모두 통과                                                                                                                                        |
| `npm run -w @sb/web test:build`                                                                      | production mock 제외·API NetworkOnly·센터 precache·아이콘·물품 에셋 검사 통과                                                                    |
| `npm run down` 후 `npm run up`                                                                       | 기존 공유 DB 컨테이너 ID 유지, HTTPS 재개, API·worker live 모드 복귀                                                                             |
| `git check-ignore`, Colima mount 검사                                                                | CA·키·인증서·테스트 산출물 제외 확인, 호스트 mount는 사용자 홈 디렉터리 하나                                                                          |

수정한 연결 결함: 텍스트 요청의 ROUTE_INTENT 결과 뒤 동일 turnId의 EXTRACT_NEED를 따라 요약 표시, 브라우저가 일반적인 capture 오류를 반환해도 사전에 확인한 마이크 denied 상태를 정확히 안내. 서버는 승인된 한정 변경으로 `HOST` 설정과 정확히 일치하는 `APP_ORIGINS` allowlist를 지원한다.

증거는 전체 실행 로그 (실행 산출물은 공유본에서 제외), 기본 결과 (실행 산출물은 공유본에서 제외), 만료 결과 (실행 산출물은 공유본에서 제외), SSE 측정 (실행 산출물은 공유본에서 제외), TLS (실행 산출물은 공유본에서 제외), PWA (실행 산출물은 공유본에서 제외), 결제 만료 (실행 산출물은 공유본에서 제외), 센터 네트워크 (실행 산출물은 공유본에서 제외), 재시작 로그 (실행 산출물은 공유본에서 제외)에 있다. 단계별 스크린샷 20장은 `test-artifacts/e2e/screenshots/`, axe 결과 8개는 `test-artifacts/e2e/axe/`에 저장했다. 대표 화면은 비교 (실행 산출물은 공유본에서 제외), 4,500원 미리보기 (실행 산출물은 공유본에서 제외), 만료 (실행 산출물은 공유본에서 제외)다.
