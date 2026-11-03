# 과거 MVP 문서 보관소

**이 폴더는 현재 요구사항·개발 계약·완료 기준이 아니다.** 기본 AI 탐색에서 제외하고 이력 확인에 필요한 문서만 읽는다. 현재 기준은 [문서 시작점](../README.md)이다.

2026-11-03에 기존 문서 19개를 `mvp/` 아래 원래 저장소 경로대로 모았다. 기준 commit: `0d643d00b494e22fe2467616fb99a00b1df5ab11`. 본문은 과거 기록으로 보존하고, 보관 표시·상대 링크·원래부터 공유본에 없던 자료의 표기만 정리했다. 원래 경로와 줄 번호를 적은 본문은 당시 위치를 뜻한다. 앱 코드·테스트 fixture는 이곳으로 옮기지 않았다.

| 자료 | 보관 위치 |
| --- | --- |
| 기존 프로젝트 안내 | [README](mvp/README.md) |
| 기존 문서 목록 | [docs/README](mvp/docs/README.md) |
| MVP PRD | [MVP_PRD](mvp/docs/MVP_PRD.md) |
| 공통 계약 0.3.0 | [COMMON_CONTRACT](mvp/docs/COMMON_CONTRACT.md) |
| 음성 QA · 개편 QA | [VOICE_QA](mvp/docs/VOICE_QA.md) · [AGENT_REFACTOR_QA](mvp/docs/AGENT_REFACTOR_QA.md) |
| 화면 IA · 에이전트 개편 HTML | [mvp-ia](mvp/docs/mvp-ia.html) · [architecture-proposal](mvp/docs/agent-architecture-proposal.html) |
| 조사 | [센터·브랜드](mvp/docs/research/center-and-brand.md) · [모델](mvp/docs/research/openai-models.md) · [PWA·스택](mvp/docs/research/pwa-and-stack.md) |
| 구현 보고 | [음성](mvp/apps/api/src/voice/README.md) · [worker](mvp/apps/worker/README.md) · [AI](mvp/packages/ai/README.md) · [DB](mvp/packages/db/README.md) |
| 센터 구현·검증 | [README](mvp/apps/web/src/features/center/README.md) · [VERIFICATION](mvp/apps/web/src/features/center/VERIFICATION.md) |
| 수용 검증 기록 | [REPORT](mvp/tests/acceptance/REPORT.md) |

과거의 “계약이 기준”, 고정 API 수·상태·버전, W1/W2/W3 역할, 실제 예약 제외 등의 문구를 후속 2·3번 개발을 막는 규칙으로 사용하지 않는다. 필요한 결정을 다시 채택할 경우 현재 코드와 요구를 검토하고 후속 명세에 그 범위·근거를 명시한다.

과거 PRD가 참조한 PDF·작성 프롬프트는 원래 공유본에 없다. 존재하지 않는 원문이나 실행 로그를 새로 만들거나 복구했다고 주장하지 않는다. [3모듈 분담도](../current/three-developer-architecture.png)는 현재 기능 경계의 참고이므로 보관 문서와 분리했다.
