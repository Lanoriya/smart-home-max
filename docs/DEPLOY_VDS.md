# Развёртывание на VDS

## Требования

- Linux VDS с Docker Engine и Docker Compose v2;
- домен с `A`/`AAAA` записью на VDS;
- открытые входящие порты `80/tcp` и `443/tcp,udp`;
- закрытый извне PostgreSQL — сервис БД не публикует порт;
- минимум 2 ГБ RAM и 15 ГБ свободного диска для MVP.

## Первый запуск

1. Распакуйте переданный архив на сервере. Архив не содержит секретов и тестовой БД:

   ```bash
   unzip smart-home-max-production.zip -d smart-home-max
   cd smart-home-max
   ```

2. Создайте `.env.production` из `.env.production.example` и ограничьте к нему доступ:

   ```bash
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```

3. Откройте `.env.production` и замените **каждое** значение вида `REPLACE_WITH_…`; задайте свой `APP_DOMAIN`. Не добавляйте этот файл в архив или Git.
4. Сгенерируйте отдельные длинные значения для пароля PostgreSQL, пароля администратора, `MAX_WEBHOOK_SECRET` и `APARTMENT_CODE_PEPPER`. Не используйте демонстрационные значения. Для `POSTGRES_PASSWORD` используйте URL-safe набор символов. `DATABASE_URL` в production формируется Compose автоматически.
5. Укажите `APP_DOMAIN` без протокола и направьте DNS на VDS.
6. Проверьте итоговую конфигурацию без запуска:

   ```bash
   docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml config --quiet
   ```

7. Запустите production-стек:

   ```bash
   docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build
   ```

Миграции и создание первого supervisor выполняются одноразовыми сервисами. Демонстрационный seed в production-конфигурацию не входит.

После запуска откройте `https://APP_DOMAIN` и войдите с `ADMIN_SEED_USERNAME` / `ADMIN_SEED_PASSWORD`. Сразу смените пароль администратора в настройках, если он был передан третьему лицу.

## Подключение MAX webhook

После успешного запуска выполните:

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml run --rm backend node apps/backend/dist/max-cli.js check
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml run --rm backend node apps/backend/dist/max-cli.js subscribe
```

Публичный адрес webhook формируется как `https://APP_DOMAIN/webhooks/max`. Long polling на сервере использовать не нужно.

## Проверка

```bash
SMOKE_BASE_URL=https://example.ru \
SMOKE_ADMIN_USERNAME=dispatcher \
SMOKE_ADMIN_PASSWORD='...' \
pnpm smoke:production
```

Затем вручную пройдите сценарий из `docs/DEMO_SCRIPT.md` двумя тестовыми аккаунтами MAX.

## Обновление

1. Сделайте резервную копию БД.
2. Получите зафиксированную версию исходников.
3. Повторите `up -d --build`. Сервис `migrate` применит только ещё не выполненные миграции.
4. Запустите smoke-тест и проверьте логи `backend`, `worker`, `caddy`.

Откат кода выполняется возвратом к предыдущему Git-тегу и повторной сборкой. Миграции БД откатываются только восстановлением проверенной резервной копии; автоматического destructive rollback нет.
