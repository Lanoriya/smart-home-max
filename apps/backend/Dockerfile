FROM node:22.23.2-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --filter @smart-home/backend... --frozen-lockfile
COPY apps/backend apps/backend
RUN pnpm --filter @smart-home/backend build

FROM node:22.23.2-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --chown=app:app --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --chown=app:app --from=builder /app/node_modules ./node_modules
COPY --chown=app:app --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --chown=app:app --from=builder /app/apps/backend/package.json ./apps/backend/package.json
COPY --chown=app:app --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --chown=app:app --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --chown=app:app --from=builder /app/apps/backend/certs ./apps/backend/certs
USER app
EXPOSE 3000
CMD ["node", "apps/backend/dist/server.js"]
