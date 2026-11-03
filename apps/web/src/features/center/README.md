# 센터 화면

센터 화면은 교체 가능한 영역이다. [모듈 경계](../../../../../docs/current/MODULE_BOUNDARIES.md)에 따라 공통 UI·라우트 변경이 접수에 미치는 영향을 확인한다.

현재 공개 콘텐츠 원본은 `apps/web/public/content/center/v1/catalog.json`이며 `sync-content.mjs`가 `catalog.generated.json`을 생성한다. 현재 구조를 유지하며 콘텐츠를 수정할 때는 아래 명령을 사용한다.

```sh
node apps/web/src/features/center/sync-content.mjs
npm run -w @sb/web test -- src/features/center/content.test.ts
```

과거 화면 범위·조사·검증 보고는 [보관소](../../../../../docs/archive/README.md)에 있다. 과거 화면 구성을 후속 요구사항으로 고정하지 않는다.
