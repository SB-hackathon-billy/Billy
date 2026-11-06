# 성북 공유대여

한국어 모바일 PWA와 API·worker를 포함한 개발 기반입니다. 현재 앱은 MVP 구현을 유지하고 있으며 실제 결제와 기관 예약을 수행하지 않습니다.

## 후속 개발 시작

**1번 접수 에이전트의 기능·동작은 수정 금지입니다. 2번 AI 물품 등록, 3번 물품 탐색·대여 관리 및 나머지 MVP 코드는 교체할 수 있습니다.** 공용 코드에서 1번에 영향을 주는 부분도 보호합니다.

- [공통 AI 지침](AGENTS.md): Codex와 Claude가 함께 사용하는 작업 규칙
- [모듈 경계와 현재 코드](docs/current/MODULE_BOUNDARIES.md)
- [명세 작성·개발 절차](docs/current/DEVELOPMENT.md), [AI 작업 흐름](docs/current/AI_WORKFLOW.md), [후속 명세 목록](docs/specs/README.md)
- [문서 안내](docs/README.md)

기존 PRD·공통 컨트랙트·QA·구현 보고는 `docs/archive/mvp/`로 옮겼습니다. 현재 요구사항이 아니며 기본 탐색 대상에서 제외합니다. 코드의 현재 API 계약은 `packages/contracts/src`와 생성된 `packages/contracts/openapi.json`에서 확인합니다. 이 계약도 1번 호환성을 유지하면서 후속 명세에 따라 변경할 수 있습니다.

## 실행

Node.js 26.8.2 이상 27 미만, npm 11, Docker Compose를 사용합니다. 정확한 의존성은 `package.json`과 lockfile을 따릅니다.

```sh
npm ci
cp .env.example .env
# .env에 OPENAI_API_KEY를 입력합니다.
npm run up
# 새 개발 DB에 데모 데이터가 필요할 때만 실행합니다.
npm run seed -- --scenario default
```

`http://localhost:8000`으로 접속합니다. 서비스는 이 PC의 localhost에서만 열립니다. seed는 개발 DB의 업무 데이터를 초기화하므로 공유 DB 사용자와 조율해야 합니다. 공유 DB에 `docker compose down -v`를 실행하지 마세요.

### Railway 배포

`main`에 push하면 Railway 프로젝트 `billy`가 자동 배포합니다. 공개 주소: https://web-production-968e50.up.railway.app

| 서비스     | Dockerfile                                | 시작·배포 전 명령                                                                                         |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `web`      | `infra/web.Dockerfile` (정적 web + Caddy) | `API_UPSTREAM=api.railway.internal:3000`, `PORT=8080`                                                     |
| `api`      | `infra/runtime.Dockerfile`                | 배포 전 `npm run -w @sb/db migrate`, 시작 `npm run -w @sb/api start` (`HOST=::`, `APP_ORIGINS`=공개 주소) |
| `worker`   | `infra/runtime.Dockerfile`                | `npm run -w @sb/worker start`                                                                             |
| `Postgres` | Railway 관리형                            | 외부 공개 없음. 각 서비스는 `DATABASE_URL=${{Postgres.DATABASE_URL}}` 참조                                |

서비스 설정은 Railway 대시보드(Settings)에 있습니다. 데모 데이터 재적재는 api의 배포 전 명령을 `sh -c 'npm run -w @sb/db migrate && npm run -w @sb/db seed -- --scenario default && npm run -w @sb/db showcase'`로 바꿔 한 번 배포한 뒤 원래대로 되돌립니다. seed는 업무 데이터를 초기화합니다. `showcase`는 시연용 진행 데이터(캠퍼스 거점 6곳(고려대·국민대·동덕여대·서경대·성신여대·한성대), 인계 대기·응답 대기·반납 완료·승인 대기·대여 중 예약)를 더합니다. 응답 대기 신청은 24시간 뒤 만료됩니다.

## 구조와 검증

- `apps/web`: React PWA
- `apps/api`: Fastify API·접수 음성 연결
- `apps/worker`: 검색·AI 작업·만료 처리
- `packages`: 실행 가능한 계약·DB·AI·데모 데이터

```sh
npm run check:boundaries
npm run typecheck
npm test
npm run build
```

DB/API/worker 테스트는 PostgreSQL이 필요합니다. 실제 사람 음성·휴대폰·스크린리더 검증은 별도이며, 과거 결과는 현재 버전의 합격 증거가 아닙니다.

## 팀 공유

변경을 커밋한 Git 저장소 또는 `git archive --format=zip --output=../seongbuk.zip HEAD`로 공유하세요. `git archive`에는 미커밋 변경이 포함되지 않습니다. `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, AI 작업 설정(`.agents/`, `.claude/agents`, `.claude/skills`, `.codex/config.toml`, `.codex/agents`), 경계 검사와 후속 명세도 함께 버전 관리합니다. `.env`, 개인 키, 의존성, 빌드 산출물과 개인 도구 설정은 포함하지 않습니다.
