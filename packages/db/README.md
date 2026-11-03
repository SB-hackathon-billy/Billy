# DB·도메인 구현

`src/commands.ts`는 업무 명령, `src/database.ts`는 작업 처리·조회, `src/unit.ts`는 트랜잭션·이벤트, `migrations/`는 현재 DB 구조를 담는다. 실행은 [프로젝트 README](../../README.md)를 따른다.

DB 설계는 2·3번 명세에 따라 대체·분리할 수 있다. 접수 초안·음성 종료·작업 최신성·원문 정리와 현재 접수의 입출력은 유지해야 한다. [모듈 경계](../../docs/current/MODULE_BOUNDARIES.md)에 따라 영향 분석과 migration·롤백을 먼저 명세한다. 타 모듈 데이터의 쓰기는 소유 모듈 API로 연결한다.

과거 함수 표·구현·검증 결과는 [보관소](../../docs/archive/README.md)로 이동했다. 현재 함수 시그니처와 동작은 코드·테스트로 확인한다.
