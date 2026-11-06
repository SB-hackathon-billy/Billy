# 공개 배포용 진입점: 정적 web 빌드 + Caddy 프록시(/api → API_UPSTREAM).
# 로컬 compose는 기존처럼 apps/web/dist를 마운트하므로 이 파일을 쓰지 않는다.
FROM node:26.8.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/demo-data/package.json packages/demo-data/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ai/package.json packages/ai/package.json
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY types ./types
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build

FROM caddy:2.10.2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
