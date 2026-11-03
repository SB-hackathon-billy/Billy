---
name: verify
description: 구현을 마쳤거나 커밋하기 전에 사용. 바뀐 경로에 맞는 검증(경계 검사·타입체크·workspace 테스트·빌드)을 골라 실행하고 결과를 명세에 기록한다.
---

# verify

## 1. 바뀐 경로 확인

`git status --short`와 `git diff --name-only HEAD`로 이번 작업에서 바뀐 파일을 확인한다. 이번 작업과 무관한 다른 사람의 변경은 검증 대상 판단에서 제외하되 덮어쓰지 않는다.

## 2. 명령 선택

| 바뀐 경로                                                  | 명령                                             |
| ---------------------------------------------------------- | ------------------------------------------------ |
| 항상                                                       | `npm run check:boundaries`                       |
| 코드가 하나라도 바뀜                                       | `npm run typecheck`                              |
| `packages/contracts/src`                                   | `contract-change` 스킬 절차                      |
| `packages/ai`                                              | `npm test -- --project @sb/ai`                   |
| `packages/demo-data`                                       | `npm test -- --project @sb/demo-data`            |
| `apps/web`                                                 | `npm test -- --project @sb/web`, `npm run build` |
| `packages/db` (DB 필요)                                    | `npm test -- --project @sb/db`                   |
| `apps/api` (DB 필요)                                       | `npm test -- --project @sb/api`                  |
| `apps/worker` (DB 필요)                                    | `npm test -- --project @sb/worker`               |
| `tests/acceptance`, 또는 api·worker·db 흐름 변경 (DB 필요) | `npm run test:acceptance`                        |
| `.agents/`                                                 | `npm run agents:check`                           |
| 문서만                                                     | `npm run check:boundaries`만                     |

공용 패키지(`packages/*`)를 바꿨다면 그 패키지를 쓰는 workspace 테스트도 함께 실행한다.

## 3. DB 준비

DB가 필요한 명령 전에 `npm run db:up`을 실행한다 (로컬 `db` 컨테이너만 띄우며 이미 떠 있으면 그대로 둔다). 테스트는 파일마다 임시 DB를 만들고 지우므로 공유 DB를 초기화하지 않는다. 도커를 쓸 수 없으면 해당 명령을 "미검증 — DB 없음"으로 기록하고 나머지를 진행한다.

## 4. 실행

명령이 여러 개거나 로그가 길면 `verifier` 에이전트에 명령 목록을 넘겨 실행하게 한다. 실패하면 원인을 고친 뒤 실패한 명령부터 다시 실행한다.

포맷은 이번 작업에서 수정한 허용 파일에만 적용한다: `npx prettier --write <파일들>`. 저장소 전체 `npm run format`은 1번 전용 파일을 바꾸므로 쓰지 않는다.

## 5. 기록

관련 명세(카드·전체)가 있으면 수용 기준·검증 칸에 실제 실행한 명령, 결과, 일시를 적는다. 실행하지 않은 항목은 "미검증"과 사유를 적는다. 명세가 없는 작업이면 결과를 개발자에게 보고만 한다.
