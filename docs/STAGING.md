# Staging Environment

## Конфигурация

Staging работает на том же VPS но на отдельных портах и с префиксом `staging.streambro.ru`.

### Переменные окружения (staging)

- `NODE_ENV=staging`
- `DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5433/streambro_staging`
- `JWT_SECRET=staging-secret-different-from-prod`
- `FRONTEND_URL=https://staging.streambro.ru`
- `COOKIE_DOMAIN=staging.streambro.ru`
- Отдельная БД на порту 5433

### Запуск

На сервере создать `/opt/deploy-staging/docker-compose.yml`:

```yaml
version: '3.8'
services:
  backend-staging:
    build: /opt/server
    container_name: streambro-backend-staging
    restart: unless-stopped
    ports:
      - "3011:3001"
    environment:
      - NODE_ENV=staging
      - DATABASE_URL=postgresql://postgres:PASSWORD@postgres-staging:5432/streambro_staging
      - JWT_SECRET=staging-jwt-secret
      - FRONTEND_URL=https://staging.streambro.ru
      - COOKIE_DOMAIN=staging.streambro.ru
      - PORT=3001
    depends_on:
      - postgres-staging

  postgres-staging:
    image: postgres:16-alpine
    container_name: streambro-postgres-staging
    restart: unless-stopped
    environment:
      - POSTGRES_DB=streambro_staging
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=CHANGE_ME
    volumes:
      - postgres_staging_data:/var/lib/postgresql/data

volumes:
  postgres_staging_data:
```

### Nginx конфиг для staging

```nginx
server {
    listen 80;
    server_name staging.streambro.ru;
    
    location /api/ {
        proxy_pass http://localhost:3011;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location / {
        return 404;
    }
}
```

### Деплой на staging

```bash
cd /opt/deploy-staging
docker compose pull
docker compose up -d
```

### GitHub Actions для staging

Добавить в `.github/workflows/ci.yml`:
- При пуше в ветку `develop` — деплоить на staging через SSH
- При успешном деплое на staging — уведомить Telegram

## Разделение данных

- Prod БД: `streambro` (PostgreSQL на порту 5432)
- Staging БД: `streambro_staging` (PostgreSQL на порту 5433)
- Файлы: `/opt/server-staging/` отдельно от `/opt/server/`

## Тестирование на staging

1. Staging деплоится автоматически при пуше в `develop`
2. Prod деплоится только из `master`/`main` через ручной approve
3. Staging URL: `https://staging.streambro.ru/api/health`
