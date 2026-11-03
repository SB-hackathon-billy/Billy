# 작업 worker

실행·환경 준비는 [프로젝트 README](../../README.md)를 따른다. 구현은 `src/worker.ts`, 실행 진입은 `src/main.ts`, 검증은 `tests/worker.test.ts`에 있다.

worker 전체가 보존 대상은 아니다. 접수의 의도 분류·요구 추출·종료 후 저장/검색 연결을 유지하면서 2·3번 작업을 교체할 수 있다. [모듈 경계](../../docs/current/MODULE_BOUNDARIES.md)와 [명세 절차](../../docs/current/DEVELOPMENT.md)를 먼저 확인한다. 과거 구현·테스트 결과는 [보관소](../../docs/archive/README.md)에 있다.
