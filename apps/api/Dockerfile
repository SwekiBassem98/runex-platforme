# syntax=docker/dockerfile:1
# ==============================================================================
# Image de production de l'API LogiXpress (monorepo npm workspaces)
# ==============================================================================
FROM node:22-alpine AS builder
# Cette étape sert aussi d'image de migration (docker-compose.prod.yml, service
# `migrate`) : elle contient la CLI Prisma, absente de l'image d'exécution.

# Prisma détecte la version d'OpenSSL du système pour choisir son moteur.
RUN apk add --no-cache openssl

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

RUN apk add --no-cache openssl
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
# Jamais root : une faille applicative ne doit pas donner la main sur le conteneur.
USER node
# Les hébergeurs (Koyeb, Render…) imposent leur port via `PORT` ; 4000 sinon.
EXPOSE 4000
# `/health/live` ne touche pas la base : une sonde toutes les 30 s ne doit pas
# empêcher une base serverless (Neon) de se mettre en veille.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-${API_PORT:-4000}}/api/v1/health/live" >/dev/null || exit 1
CMD ["node", "dist/main.js"]
