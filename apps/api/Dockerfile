# syntax=docker/dockerfile:1
# ==============================================================================
# Image de production de l'API LogiXpress (monorepo npm workspaces)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/

RUN npm ci

COPY packages ./packages
COPY apps/api ./apps/api
COPY prisma ./prisma

RUN npx prisma generate \
 && npm run build:packages \
 && npm run build --workspace @logixpress/api

# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/

RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY prisma ./prisma

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
