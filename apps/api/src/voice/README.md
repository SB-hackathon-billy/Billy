# 접수 음성 연결 · 모듈 1

이 디렉터리의 TypeScript 구현과 테스트는 수정·삭제·이동 금지다. 채팅을 포함한 접수 전체 경계와 공용 의존성은 [모듈 경계](../../../../docs/current/MODULE_BOUNDARIES.md)를 따른다. 후속 API 연결은 2·3번 쪽 호환 계층으로 설계한다.

`index.ts`는 세션·최신성·종료 처리를, `bindings.ts`는 서버 권한으로 요약 제안을, `guards.ts`는 수집 완료 판정을, `completion-audio.ts`는 종료 안내 오디오를 담당한다. 정확한 타입은 `packages/contracts/src`, 구현은 이 디렉터리 코드를 확인한다.

현재 개발 절차는 [개발 안내](../../../../docs/current/DEVELOPMENT.md)에서 시작한다. 과거 0.1/0.2/0.3 구현·검증 보고는 [보관소](../../../../docs/archive/README.md)로 이동했다.
