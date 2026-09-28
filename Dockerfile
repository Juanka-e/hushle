FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/jobs/package.json ./apps/jobs/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-contracts/package.json ./packages/api-contracts/package.json
COPY packages/auth-policy/package.json ./packages/auth-policy/package.json
COPY packages/domain-economy/package.json ./packages/domain-economy/package.json
COPY packages/domain-game/package.json ./packages/domain-game/package.json
COPY packages/platform-auth/package.json ./packages/platform-auth/package.json
COPY packages/platform-cache/package.json ./packages/platform-cache/package.json
COPY packages/platform-db/package.json ./packages/platform-db/package.json
COPY packages/platform-inventory/package.json ./packages/platform-inventory/package.json
COPY packages/platform-observability/package.json ./packages/platform-observability/package.json
COPY packages/platform-player/package.json ./packages/platform-player/package.json
COPY packages/platform-payments/package.json ./packages/platform-payments/package.json
COPY packages/platform-store/package.json ./packages/platform-store/package.json
COPY packages/platform-wallet/package.json ./packages/platform-wallet/package.json
RUN npm ci

COPY . .
RUN SKIP_DATABASE_DURING_BUILD=true npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
