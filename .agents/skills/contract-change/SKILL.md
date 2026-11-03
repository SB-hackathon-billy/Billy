---
name: contract-change
description: packages/contracts/src의 스키마·DTO·HTTP 계약을 바꿀 때나 바꾼 직후에 사용. 1번이 쓰는 계약을 보존하는지 확인하고 OpenAPI를 다시 생성해 contracts 테스트를 실행한다.
---

# contract-change

## 1. 변경 전 확인

- `docs/current/MODULE_BOUNDARIES.md` 공용 표의 contracts 행을 확인한다. `NeedDraft`, `RequestView`, voice/turn/task 스키마, 버전·상태·기간 검사는 1번이 쓰는 계약이다. 이 스키마의 필드 의미·필수 여부·검증 규칙을 바꾸지 않는다.
- 2·3번용 새 DTO는 1번 DTO를 덮어쓰지 않고 별도 스키마로 추가한다. 1번과 다른 envelope·필드가 필요하면 2·3번 쪽 어댑터에서 변환한다.
- 바꿀 스키마를 쓰는 곳(`apps`, `packages`, `tests`)을 모두 찾는다.

## 2. 생성과 검사

```sh
npm run openapi
npm test -- --project @sb/contracts
npm run typecheck
```

`packages/contracts/openapi.json`은 생성물이다. 손으로 고치지 않는다. 생성 결과가 달라졌다면 함께 커밋한다.

## 3. 후속

- 1단계에서 찾은 소비자 workspace의 테스트를 `verify` 기준으로 실행한다.
- 모듈 간 API가 바뀌었다면 전체 명세의 API·이벤트 계약 절에 요청·응답·실패 예시를 갱신한다.
- 공용 계약을 바꿨으므로 완료 전에 `boundary-review`를 실행한다.
