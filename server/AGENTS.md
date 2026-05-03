# StreamBro Server — Agent Instructions

> Последнее обновление: 2026-05-01
> Этот файл должен прочитать новый агент перед началом работы.
> Сервер: _(IP в secrets)_, ОС: Linux (Ubuntu 24.04), доступ: SSH

---

## 1. Что здесь

StreamBro Server — бекенд для десктопного приложения StreamBro. Развёрнут на VPS и обеспечивает:

- **Сайт** — Next.js frontend (streambro.ru)
- **API** — Express REST: авторизация, профиль, подписки, баг-репорты, авто-обновления, TURN credentials, скачивание
- **Signaling** — WebSocket сервер для P2P (WebRTC) ко-стрима
- **TURN** — coturn relay для NAT traversal

---

## 2. Архитектура (Docker Compose)

Всё работает через Docker Compose (`/opt/deploy/docker-compose.yml`):

```
docker compose ps        # статус всех контейнеров
docker compose logs -f backend  # логи бекенда
```

| Контейнер | Образ | Порт (внутр.) | Назначение |
|---|---|---|---|
| streambro-nginx | nginx:1.27-alpine | 80, 443 | Reverse proxy + SSL |
| streambro-backend | deploy-backend (сборка из /opt/server) | 3001 | Express + Prisma API |
| streambro-frontend | deploy-frontend (сборка из /opt/website) | 3000 | Next.js сайт |
| streambro-signaling | deploy-signaling (сборка из /opt/server) | 7890 | WebSocket сигналинг |
| streambro-postgres | postgres:16-alpine | 5432 | БД PostgreSQL |
| streambro-coturn | coturn/coturn:latest | 5349 (host) | TURN relay |

---

## 3. Файловая структура на сервере

```
/opt/deploy/                    → Docker Compose + nginx конфиг + certbot
  docker-compose.yml
  .env                          → POSTGRES_PASSWORD
  nginx/
    streambro.ru.conf           → основной nginx конфиг (HTTP→HTTPS, проксирование)
    nginx.conf                  → глобальные настройки nginx (rate limits, gzip)
    www/                        → certbot challenge
  coturn/
    turnserver.conf
  scripts/

/opt/server/                    → Бекенд-код (Docker build context)
  src/
    index.js                    → Express app: маршруты /api/auth, /api/user, /api/download, /api/bugs, /api/updates, /api/turn
    routes/
      auth.js                   → Регистрация, логин, JWT
      user.js                   → Профиль пользователя
      subscription.js           → Подписки (FREE/PRO/ULTIMATE)
      download.js               → Скачивание + portable zip (публичный маршрут /api/download/portable/:filename)
      bugs.js                   → Баг-репорты: POST (публичный), GET/DELETE (admin)
      updates.js                → Авто-обновления: latest.yml, latest.json
      turn.js                   → TURN credentials
    middleware/
      auth.js                   → JWT middleware
    config/
    utils/
  prisma/
    schema.prisma               → User, Subscription, Download, TurnCredential модели
  signaling-server/
    server.js                   → WebSocket сигналинг (Dockerfile.signaling)
  Dockerfile                    → Бекенд Dockerfile (Node 20 + Prisma)
  Dockerfile.signaling          → Сигналинг Dockerfile
  .env                          → СЕКРЕТЫ: JWT_SECRET, ADMIN_SECRET, DATABASE_URL, COTURN_SECRET, SMTP_*, YOOKASSA_*
  package.json

/opt/server/downloads/          → Portable .zip файлы для скачивания
  StreamBro-1.1.0-portable.zip  → 209 MB (volume mounted в backend контейнер)

/opt/server/data/               → Runtime data
  bugs/                         → JSON файлы баг-репортов
  updates/
    latest.json                 → Инфо о текущей версии для авто-обновлений

/opt/website/                   → Next.js фронтенд (Docker build context)
```

---

## 4. Nginx маршрутизация (streambro.ru.conf)

| URL | Куда проксируется |
|---|---|
| `https://streambro.ru/` | frontend:3000 (Next.js) |
| `https://streambro.ru/api/*` | backend:3001 (Express) |
| `https://streambro.ru/api/auth/*` | backend:3001 (строже rate limit: 5/мин) |
| `https://streambro.ru/signaling` | signaling:7890 (WebSocket upgrade) |
| `https://streambro.ru/download/*` | backend:3001 |
| `https://streambro.online/*` | 301 redirect → streambro.ru |

SSL: Let's Encrypt, сертификаты на оба домена (.ru и .online).
HSTS включен.

---

## 5. Рабочие API-эндпоинты

### Публичные (без авторизации)
```
GET  /api/health                         → {"status":"ok","timestamp":"..."}
POST /api/bugs                           → принимает баг-репорт, сохраняет в data/bugs/
GET  /api/updates/win/latest.yml         → electron-updater формат
GET  /api/updates/win/latest.json        → HTTP fallback формат (для portable .zip)
GET  /api/download/portable/:filename    → скачивание portable .zip
GET  /api/download/latest                → инфо о последней версии
```

### С авторизацией (Bearer JWT)
```
POST /api/auth/signup                    → { email, password, username } → JWT
POST /api/auth/login                    → то же
GET  /api/auth/me                        → профиль пользователя
GET  /api/user                           → данные пользователя
POST /api/subscription                  → управление подпиской
GET  /api/download/file                  → скачивание установщика (логируется)
GET  /api/download/history               → история скачиваний
```

### Admin (Bearer ADMIN_SECRET из .env)
```
GET  /api/bugs                           → список всех баг-репортов
GET  /api/bugs/stats                     → статистика по типам и версиям
DELETE /api/bugs/:id                     → удалить отчёт
```

---

## 6. Как обновить бекенд

```bash
# 1. Правишь код в /opt/server/src/
nano /opt/server/src/routes/some-route.js

# 2. Пересобираешь и перезапускаешь Docker контейнер
cd /opt/deploy
docker compose build backend
docker compose up -d backend

# 3. Проверяешь
docker logs streambro-backend --tail 10
curl -s https://streambro.ru/api/health
```

---

## 7. Как выложить новую версию приложения

1. На ПК разработчика: обновить version в package.json, собрать zip
2. Загрузить на сервер: `scp dist/StreamBro-X.Y.Z-portable.zip root@<VPS_IP>:/opt/server/downloads/`
3. Обновить latest.json:
```bash
cat > /opt/server/data/updates/latest.json << EOF
{"version":"X.Y.Z","date":"2026-MM-DD","changelog":"Описание изменений","downloadUrl":"https://streambro.ru/api/download/portable/StreamBro-X.Y.Z-portable.zip","sha512":""}
EOF
```

---

## 8. Безопасность

- `/opt/server/.env` содержит СЕКРЕТЫ — **НИКОГДА не коммитить**
- ADMIN_SECRET нужен для доступа к баг-репортам (GET /api/bugs, /api/bugs/stats)
- JWT_SECRET — для авторизации пользователей
- DATABASE_URL — доступ к PostgreSQL
- COTURN_SECRET — пароль TURN сервера
- Rate limits: API 30/мин, auth 5/мин, bugs 10/мин, general 60/мин
- HSTS включен (63072000 секунд)
- CSP и security headers в nginx

---

## 9. Полезные команды

```bash
# Docker
docker compose -f /opt/deploy/docker-compose.yml ps      # статус контейнеров
docker compose logs -f backend                            # логи бекенда
docker compose restart backend                           # перезапуск бекенда
docker exec -it streambro-backend sh                     # shell внутри контейнера

# Nginx
nginx -t && systemctl reload nginx                       # проверка + релоад
cat /opt/deploy/nginx/streambro.ru.conf                  # конфиг

# SSL
certbot renew                                            # обновить сертификаты
ls /etc/letsencrypt/live/                                # проверить сертификаты

# Система
df -h                                                    # свободное место
ss -tlnp                                                 # занятые порты
pm2 status                                               # (pm2 НЕ используется — всё в Docker)
free -m                                                  # RAM
```

---

## 10. DNS записи

```
streambro.ru              → A  <VPS_IP>
www.streambro.ru          → A  <VPS_IP>
streambro.online          → A  <VPS_IP>
www.streambro.online      → A  <VPS_IP>
```

---

## 11. База данных (PostgreSQL)

```bash
# Подключение
docker exec -it streambro-postgres psql -U streambro -d streambro

# Миграции (через Prisma)
cd /opt/server && npx prisma migrate deploy

# Схема: User, Subscription, Download, TurnCredential
# См. /opt/server/prisma/schema.prisma
```

---

## 12. GitHub

Репозиторий: https://github.com/mrkryachkin-stack/StreamBro
Лицензия: GPL-3.0
Серверные файлы в `server/` — для нового агента на сервере лучше клонировать с GitHub.
