FROM node:22.23.2-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
RUN pnpm install --filter @smart-home/admin-web... --filter @smart-home/miniapp... --frozen-lockfile
COPY apps/admin-web apps/admin-web
COPY apps/miniapp apps/miniapp
RUN pnpm --filter @smart-home/admin-web build && pnpm --filter @smart-home/miniapp build

FROM nginx:1.27.5-alpine
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html
# The MAX mini-app lives next to the dispatcher desk under /app/.
COPY --from=builder /app/apps/miniapp/dist /usr/share/nginx/html/app
EXPOSE 8080
