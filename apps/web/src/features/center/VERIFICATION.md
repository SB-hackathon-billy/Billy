# W1 WebCenter 검증 결과

완료 범위: C01–C06 및 상세, 버전 콘텐츠 JSON 18개, 자체 SVG 10종(9,903 bytes), React Aria 검색·탭·달력·시트, 프로그램/리더/팀원/활동보고/공간 양식 미리보기.

## 실행 명령과 결과

| 실제 실행한 명령                                                                                                                                                                                                                 | 결과                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm install -w @sb/web --save-exact @internationalized/date`                                                                                                                                                                    | 코디네이터 승인으로 직접 의존성 `3.12.4` 추가, 성공               |
| `node apps/web/src/features/center/sync-content.mjs`                                                                                                                                                                             | 공개 JSON과 동일한 빌드 스냅샷 18개 생성                          |
| `npm run -w @sb/web typecheck`                                                                                                                                                                                                   | 최종 실행 exit 0                                                  |
| `npm run -w @sb/web test -- src/features/center/content.test.ts`                                                                                                                                                                 | 1 파일, 7 테스트 통과                                             |
| `npm run -w @sb/web build`                                                                                                                                                                                                       | exit 0, Vite production build와 PWA service worker 생성 성공      |
| `npx prettier --write apps/web/src/features/center/*.ts apps/web/src/features/center/*.tsx apps/web/src/features/center/center.css apps/web/src/assets/illustrations/manifest.ts apps/web/public/content/center/v1/catalog.json` | 소유 파일만 포맷                                                  |
| `npm run -w @sb/web dev -- --port 5175 --strictPort`                                                                                                                                                                             | 127.0.0.1:5175에서 실제 앱 실행                                   |
| 아래 Playwright 명령                                                                                                                                                                                                             | Chromium 390×844, 46 캡처, 페이지 오류 0, 가로 넘침 0, mutation 0 |
| 아래 소스 검색 명령                                                                                                                                                                                                              | 일치 0건                                                          |

```sh
CENTER_BROWSER_EXECUTABLE=${HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  /tmp/a2a-report-venv/bin/python apps/web/src/features/center/capture.py

rg -n 'fetch\(|axios|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|method[[:space:]]*:|POST|TODO|FIXME' \
  apps/web/src/features/center --glob '*.ts' --glob '*.tsx' --glob '!*.test.ts'
```

공개 JSON의 직접 import에 대한 Vite 경고는 빌드 스냅샷 생성으로 해소했다. 전체 앱 import를 사용했고 API 응답 가로채기·mock·세션 생성 없이 공개 센터 경로를 검증했다. 최종 production preview 네트워크 기록의 63개 요청 중 POST를 포함한 변경 요청은 0개였다. `localStorage`·`sessionStorage`에 값이 생기지 않았다.

초기 검증 중 동시 작성 중인 WebCore의 `main.tsx → mocks/browser.ts` 누락과 새 mock 파일 타입 오류로 전체 빌드가 잠시 실패했다. 해당 담당자가 수정한 후 최종 typecheck·build와 전체 브라우저 검증이 통과했다. 빌드에는 전체 앱 번들 845.95 kB 관련 500 kB 초과 경고가 남아 있으며 빌드 실패는 아니다.

## 브라우저 증거

캡처와 원시 HTTP 요청 목록: `apps/web/test-artifacts/center/`. 이 디렉터리는 저장소의 기존 `test-artifacts/` ignore 규칙에 따라 로컬 산출물이며, 재생성 스크립트는 센터 소유 경로에 보관했다.

| 화면 | 실제 확인한 동작                                                                                   | 대표 캡처                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| C01  | 소개, 운영법인·히스토리 링크, 이용안내, 위치·시간·지도, 외부 새 창                                 | `C01-intro.png`, `C01-guide.png`, `C01-location.png`                                                    |
| C02  | 4분류, 상태·요일 필터, 검색, 목록·달력, 키보드 다음 날짜 선택, 빈 상태, 상세                       | `C02-filter-sheet.png`, `C02-calendar.png`, `C02-calendar-empty.png`, `C02-detail.png`                  |
| C03  | 목록·검색·빈 상태·상세, 관심 표시, 필수 항목 검증, IME Enter 방지, 입력 요약, 닫기·새로고침 초기화 | `C03-form.png`, `C03-form-validation.png`, `C03-preview.png`                                            |
| C04  | 모집·활동·검색 빈 상태·상세, 리더·팀원·활동보고 각 양식과 요약, 긴 양식 스크롤                     | `C04-leader-form.png`, `C04-member-preview.png`, `C04-report-form-bottom.png`, `C04-report-preview.png` |
| C05  | 공간 소개·검색 빈 상태·달력·시간·인원·목적, 역전 시간 오류, 예약 미리보기                          | `C05-detail-calendar.png`, `C05-invalid-time.png`, `C05-preview.png`                                    |
| C06  | 공지·보도·사진첩, 검색·빈 상태·각 상세, 확대 보기·다음 그림                                        | `C06-notice-detail.png`, `C06-press-detail.png`, `C06-gallery-viewer.png`, `C06-gallery-next.png`       |

`browser-results.json`은 최종 `outcome=passed`, 46개 캡처 경로, 7개 흐름 검증 묶음, `mutationRequests=[]`, `errors=[]`를 기록한다. 폼 제출·예약·PG 요청은 구현하지 않았다.

실제 갤럭시/아이폰·VoiceOver/TalkBack 검증은 수행하지 않았으며 해당 기기 관문에서 별도로 확인해야 한다.

## 제공 인터페이스와 변경 경계

- 라우트: `src/features/center/routes.tsx`의 `centerRoutes: RouteObject[]`.
- 콘텐츠: `public/content/center/v1/catalog.json`의 `items[].content`(공통 계약)와 `items[].display`(정적 확장); 검증된 `catalog.generated.json` 스냅샷이 앱 번들에 정적 import되어 공개 콘텐츠로 캐시 가능. 원본과 스냅샷 일치는 테스트에서 강제한다.
- 에셋: `src/assets/illustrations/manifest.ts`의 `illustrationManifest`, `illustrations`, `categoryIllustrations`. `sharing-home`, `cleaning`, `tools`, `travel`, `hobby`, `empty`, `waiting`, `comparison`과 센터 갤러리 2종. 외부 이미지 핫링크 없음.
- 소유 경로 밖 변경은 승인받은 `apps/web/package.json`의 날짜 라이브러리 의존성과 그에 따른 `package-lock.json`뿐이다. 공통 계약·WebCore 코드는 수정하지 않았다.
- 커밋·push·stash·reset, 실제 접수·예약, 외부 메시지 전송, 비밀값 출력은 수행하지 않았다.

검증에 사용한 5175 개발 서버와 production preview 서버는 각각 캡처 후 종료했다. 실행 중 루트 API 3000이 없어 공통 앱 셸의 GET `/api/v1/me` 연결 실패가 있었지만 공개 센터 경로와 센터 콘텐츠·미리보기는 정상 동작했다.
