> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `README.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../README.md)을 먼저 확인하세요.

# 성북 공유대여 MVP

성북구 1인가구지원센터를 위한 한국어 모바일 PWA입니다. 음성으로 필요한 물품을 요청하고 공공·주민 물품의 제안을 비교합니다. 흐름은 결제 미리보기에서 끝나며 실제 결제와 예약은 이루어지지 않습니다.

## 실행

Node.js 26.8.2, npm 11, Docker Compose가 필요합니다.

```sh
npm ci
cp .env.example .env
# .env에 OPENAI_API_KEY를 입력합니다.
npm run up
npm run seed -- --scenario default
```

`http://localhost:8000`으로 접속합니다. seed는 개발 DB의 업무 데이터를 초기화하므로 공유 DB 사용자와 조율해야 합니다. 공유 DB에 `docker compose down -v`를 실행하지 마세요.

## 구조와 검증

- `apps/web`: React PWA
- `apps/api`: Fastify API·음성 연결
- `apps/worker`: 검색·AI 작업·만료 처리
- `packages`: 계약·DB·AI·데모 데이터
- [문서 목록](docs/README.md), [공통 계약](docs/COMMON_CONTRACT.md)

```sh
npm run typecheck
npm test
npm run build
```

실기기, 실제 사람 음성, 스크린리더는 별도 검증이 필요합니다. 기존 자동화 결과는 [QA 문서](docs/AGENT_REFACTOR_QA.md)에서 확인할 수 있습니다. 기존 실행 산출물은 포함하지 않으며 테스트 스크립트로 다시 생성합니다.

## 팀 공유

Git 저장소 또는 `git archive --format=zip --output=../seongbuk-mvp.zip HEAD`로 공유하세요. `.env`, 의존성, 빌드 산출물과 개인 도구 설정은 포함하지 않습니다. 각 환경에서 `.env.example`을 복사하세요.
