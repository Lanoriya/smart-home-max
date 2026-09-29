FROM node:22.23.2-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN pnpm install --filter @smart-home/admin-web... --frozen-lockfile
COPY apps/admin-web apps/admin-web
RUN pnpm --filter @smart-home/admin-web build

FROM nginx:1.27.5-alpine
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 8080
