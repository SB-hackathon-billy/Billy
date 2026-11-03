> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `apps/web/src/features/center/README.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../../../../../../README.md)을 먼저 확인하세요.

# 센터 C01–C06

`centerRoutes`를 기존 앱 셸에서 등록한다. `/center`는 `/center/about`으로 이동하며 소개·사업·프로그램·동아리·공간·소식을 탐색한다. 상세 주소는 목록 뒤에 콘텐츠 ID를 붙인다.

- 콘텐츠 원본: `public/content/center/v1/catalog.json` (`contentVersion=1.0.0`, `contractVersion=0.1.0`). `items[].content`는 `@sb/contracts`의 엄격한 `CenterContentSchema`로 검증하며 화면 전용 정보는 형제 필드 `display`에 둔다. 대여 API와 분리되어 있다. Vite의 public 직접 import를 피하기 위해 `sync-content.mjs`가 원본과 동일한 `catalog.generated.json`을 생성하고 앱은 이 스냅샷을 정적 import한다. 테스트가 원본과 스냅샷의 일치를 강제한다.
- 전체 18개 콘텐츠는 `isDemo=true`이며 프로그램의 2026년 11월 일정·모집 상태·공간 구성·동아리 활동은 합성 예시다. C01의 위치·운영시간은 2026-11-01 공개 페이지에서 확인한 정보로 출처와 확인일을 표시했다. 공식 사이트 링크는 외부 새 창으로 열며 `noopener noreferrer`를 사용한다.
- 검색·분류·상태·요일 필터와 달력은 로컬 콘텐츠를 탐색한다. 달력은 React Aria 및 `@internationalized/date`, 검색·탭·모달 시트는 React Aria로 제공한다. 공간 시간의 역전·동일 종료를 검증한다.
- 프로그램·리더·팀원·활동보고·공간 양식은 상태를 요약해서 보여주는 미리보기다. fetch, 대여 API, POST, 저장소, 오프라인 전송 큐를 사용하지 않는다. 양식 닫기·새로고침으로 입력이 초기화된다. 관심 상태는 센터 라우트가 유지되는 현재 탭의 React 상태에만 있고 센터를 떠나거나 새로고침하면 초기화된다.
- 개인정보나 증빙은 요구하지 않는다. 미리보기 양식의 기본값은 예시이며 이름 대신 예시 별명, 연락처 대신 활동 내용을 사용한다. 초대·업로드·심사·접수·예약 기능은 없다.
- 자체 SVG 10종의 메타데이터는 `src/assets/illustrations/manifest.ts`의 `illustrationManifest`, `illustrations`, `categoryIllustrations`에서 제공한다. `src`, 크기, 제작자, CC0, 실제 바이트 크기, 설명과 장식 여부를 기록했다. 장식은 빈 alt와 `aria-hidden`, 콘텐츠 갤러리는 설명 alt를 사용한다. 외부 이미지 핫링크가 없다.

검증 명령:

```sh
node apps/web/src/features/center/sync-content.mjs # 공개 JSON 수정 후 실행
npm run -w @sb/web typecheck
npm run -w @sb/web test -- src/features/center/content.test.ts
npm run -w @sb/web build
npm run -w @sb/web dev -- --port 5175 --strictPort
# Playwright가 설치된 Python 환경에서 실제 웹 앱을 조작한다.
python apps/web/src/features/center/capture.py
```

캡처 스크립트는 필요하면 `CENTER_BASE_URL`과 `CENTER_BROWSER_EXECUTABLE`을 받는다. 390×844 Chromium에서 실제 앱을 열며 API 가로채기나 mock 응답을 만들지 않는다. 캡처와 HTTP 요청 기록은 `apps/web/test-artifacts/center/`에 생성한다. 실제 휴대폰·VoiceOver·TalkBack 확인은 별도 관문이다.

출처: [센터 공개 메뉴](https://sb1in.or.kr/), [이용안내](https://sb1in.or.kr/about/guide), [운영법인](https://sb1in.or.kr/about/foundation), [위치·운영시간](https://sb1in.or.kr/about/directions), 저장소 `docs/research/center-and-brand.md`.
