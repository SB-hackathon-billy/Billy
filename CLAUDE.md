@AGENTS.md

Claude Code도 위 공통 규칙을 따른다. 별도의 제품 요구사항을 이 파일에 중복 작성하지 않는다.

프로젝트 루트에서 시작한다. `.claude/settings.json`은 1번 전용 파일의 편집을 거부한다. 셸·스크립트로 우회하지 않는다. 공용 파일은 `docs/current/MODULE_BOUNDARIES.md`에 따라 1번 기능을 보존하며 수정한다. 작업 전후 `npm run check:boundaries`를 실행한다.
