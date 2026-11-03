# 후속 개발 절차

## 작업 순서

Claude Code·Codex에서는 [AI 작업 흐름](AI_WORKFLOW.md)의 스킬이 아래 순서를 수행한다 (`start-task` → `write-spec` → 구현 → `contract-change` → `verify` → `boundary-review`). 개발자는 AI가 묻는 결정 질문에 답하고 결과를 검토한다. 스킬이 지키는 원칙은 다음과 같다.

1. 수정 대상이 1번·2번·3번·공용 중 어디인지 [모듈 경계](MODULE_BOUNDARIES.md)로 분류한다.
2. 실제 코드·스키마·호출자를 검색해 겹치는 기능을 확인한다. `docs/archive/`의 MVP 명세는 기본 입력으로 사용하지 않는다.
3. 명세 규모를 판정한다. 모듈 간 API·데이터 소유권·DB 스키마·공용 파일의 1번 사용 부분이 바뀌면 [전체 명세](../specs/TEMPLATE.md), 2·3번 내부 기능·동작 변경은 [카드](../specs/CARD_TEMPLATE.md), 그 밖에는 명세 없이 진행한다.
4. 2·3번 내부에서 결정할 수 있는 부분은 명세 작성 후 구현한다. 모듈 간 미결정은 분리하고, 해당 계약에 의존하지 않는 작업을 진행한다. 1번 변경이 필요하다는 사실은 1번 수정 허가가 아니다.
5. 구현·테스트·필요한 OpenAPI/fixture를 같이 갱신한다. 전환이 끝난 중복 경로는 제거하거나 폐기 시점을 명시한다.
6. 완료 시 명세 상태, 실제 검증 명령·결과·미검증 항목, 대체한 명세를 갱신한다. PR에는 명세 링크와 1번 영향 분석을 포함한다.

모든 수정마다 새 문서를 만들거나 추가 승인을 받는 절차는 두지 않는다.

## 명세 상태

| 상태          | 의미                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `draft`       | 검토 중. 미결정 사항을 포함하며 확정된 연동 계약이 아님                                            |
| `ready`       | 해당 구현 범위의 입출력·소유권·전환·수용 기준이 정해짐. 타 모듈과 합의가 필요한 부분은 근거를 기록 |
| `implemented` | 코드에 반영하고 검증 결과를 기록함. 실제 실행하지 않은 항목은 미검증으로 남김                      |
| `superseded`  | 후속 명세로 대체됨. 대체 문서·적용 범위를 연결                                                     |

문서 상태만으로 1번 수정 금지를 해제하지 않는다. 기존 `implemented` 명세도 후속 명세로 대체할 수 있다. 충돌하는 유효 명세 두 개를 방치하지 않고 대체 관계와 데이터 전환을 기록한다.

## 도구 설정

Claude Code와 Codex의 공용 스킬·에이전트·모델 단계, 처음 세팅, 개인별로 기본값을 바꾸는 방법은 [AI 작업 흐름](AI_WORKFLOW.md)에 있다. 원본은 `.agents/`이고 `.claude/agents`·`.codex/`는 `npm run agents:sync`로 생성한다.

- **Codex:** 루트 `AGENTS.md`를 지침으로 읽는다. 프로젝트를 trusted로 등록해야 `.codex/config.toml`과 `.codex/agents/`가 적용된다. [공식 AGENTS.md 안내](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- **Claude Code:** 루트 `CLAUDE.md`에서 `@AGENTS.md`를 가져와 같은 규칙을 읽는다. `.claude/settings.json`은 1번 전용 파일에 `Edit` deny를 적용한다. `/memory`, `/permissions`로 로드된 지침과 권한을 확인한다. [공식 메모리 안내](https://code.claude.com/docs/en/memory), [권한 규칙](https://code.claude.com/docs/en/permissions)
- 지침·공유 설정·기준 목록·검사 스크립트는 커밋해서 전달한다. `AGENTS.override.md`, `CLAUDE.local.md`, `.claude/settings.local.json`, `~/.codex/` 개인 설정은 공유하지 않는다.
- 새 지침을 적용할 때는 새 세션에서 시작한다. 기존 세션의 과거 MVP 요구를 계속 적용하지 않는다.

`AGENTS.md`와 `CLAUDE.md`는 AI 행동 규칙이다. Claude의 Edit deny도 임의 셸 스크립트까지 막는 OS 잠금은 아니다. 따라서 공통 검사를 함께 둔다. 경로 기반 검사는 공용 코드의 의미 변경이나 새로운 우회 경로까지 판정하지 못하므로 1번 회귀 검증과 리뷰가 필요하다.

## 공통 보호 검사

```sh
npm run check:boundaries
```

1번 전용 코드·전용 테스트·fixture의 SHA-256을 [기준 목록](../../scripts/module-1-baseline.json)과 비교한다. 편집·삭제·이동·심볼릭 링크 대체를 발견하면 실패한다. 실패를 없애기 위해 기준 해시나 검사기를 갱신하지 않는다. 다른 개발자의 변경이 이미 있으면 덮어쓰지 말고 충돌 범위를 보고한다.

[PR 검사](../../.github/workflows/module-boundary.yml)도 같은 검사를 실행한다. 저장소에 workflow를 커밋·푸시한 뒤 동작하며, 병합 필수 검사의 지정은 Git 호스팅 설정에 달려 있다. 이번 프로젝트 설정은 원격 저장소 설정을 바꾸지 않는다.

## 관련 검증 선택

```sh
# 문서 이동 이후에도 과거 계약 문서를 읽지 않는 현재 계약 검사
npm test -- --project @sb/contracts
# 접수 관련 공용 AI 변경 시
npm test -- --project @sb/ai
# 접수 웹 클라이언트 회귀
npm test -- --project @sb/web
# API/DB/worker를 건드렸으면 PostgreSQL을 준비한 뒤 관련 workspace 검사
npm run typecheck
npm test
# 웹/번들 변경 시
npm run build
```

`npm run openapi`는 현재 코드에서 OpenAPI를 생성한다. contracts 테스트는 생성기와 저장된 OpenAPI의 일치를 검사하며 과거 PRD·공통 계약을 현재 API의 규범으로 읽지 않는다.

실제 모델 호출·휴대폰·오디오 재생·DB 통합의 검증 범위는 구분해 기록한다. 과거 보고서의 통과 숫자와 제안 이미지의 완료 문구는 현재 검증 결과가 아니다.
