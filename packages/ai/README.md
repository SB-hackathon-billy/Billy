# AI 실행 패키지

서버 전용 AI 포트·역할·음성 게이트웨이 구현이다. `src/agents`에서 역할과 실행기를, `src/ports.ts`에서 호출 인터페이스를, `src/runtime.ts`에서 설정을 확인한다. 현재 패키지 전체를 영구 계약으로 고정하지 않는다.

**접수 모듈이 사용하는 음성·발화 판정·요구 추출·안내 동작은 수정 금지다.** 등록 AI는 이와 분리하여 개발하고 공용 코드 변경은 접수 호환성을 유지한다. [모듈 경계](../../docs/current/MODULE_BOUNDARIES.md)와 [개발 절차](../../docs/current/DEVELOPMENT.md)를 따른다.

```sh
npm test -- --project @sb/ai
```

과거 모델 조사·실제 호출·버전별 변경 보고는 [보관소](../../docs/archive/README.md)에 있다. 그 결과는 현재 실행의 성공 증거가 아니다.
