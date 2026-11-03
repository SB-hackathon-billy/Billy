# 문서 시작점

## 현재 읽을 자료

| 자료                                      | 용도                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| [모듈 경계](current/MODULE_BOUNDARIES.md) | 1번 접수 기능 보호, 2·3번 교체 허용, 공용 코드 주의 영역 |
| [개발 절차](current/DEVELOPMENT.md)       | 명세 우선 작업, Claude·Codex 설정, 검증                  |
| [AI 작업 흐름](current/AI_WORKFLOW.md)    | 공용 스킬·에이전트·모델 단계, 세팅, 개인 설정 변경 방법  |
| [명세 목록](specs/README.md)              | 후속 작업의 상태와 적용 범위                             |
| [명세 템플릿](specs/TEMPLATE.md)          | 모듈 간 연동·소유권 변경용 전체 명세                     |
| [카드 템플릿](specs/CARD_TEMPLATE.md)     | 2·3번 내부 변경용 짧은 명세                              |
| [프로젝트 README](../README.md)           | 설치·실행                                                |

`current/`는 현재 작업 규칙입니다. `specs/`는 후속 변경 명세이며 문서별 상태를 확인합니다. 아직 `draft`인 제안은 확정된 API나 구현 완료를 뜻하지 않습니다. 현재 구현은 [실행 계약](../packages/contracts/src/index.ts), [OpenAPI](../packages/contracts/openapi.json), 앱 코드·테스트로 확인합니다.

## 보관 자료

[과거 MVP 문서 목록](archive/README.md)은 이력 조사가 필요할 때만 읽습니다. 기존 기획·계약·기술 조사·HTML 제안·QA·모듈별 구현 보고는 `archive/mvp/`에 원래 경로 구조로 모았습니다. 본문에 남은 버전·경로·명령·담당 표기는 작성 당시 기록입니다.

첨부된 [3모듈 분담도](current/three-developer-architecture.png)는 **기능 경계의 참고 자료**입니다. 그림의 API는 초안이며 현재 코드와 다릅니다. 경계는 `current/MODULE_BOUNDARIES.md`, 구체적인 전환은 개별 후속 명세로 판단합니다. 개인별 담당 배정은 문서 기준에 포함하지 않습니다.
