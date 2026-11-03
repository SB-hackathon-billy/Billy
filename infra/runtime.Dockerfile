FROM node:26.8.2-bookworm-slim
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
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
USER node
CMD ["npm", "run", "-w", "@sb/api", "start"]
