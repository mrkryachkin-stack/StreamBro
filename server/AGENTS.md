# StreamBro Server — Agent Instructions

> Этот файл должен прочитать новый агент перед началом работы.
> Сервер: REDACTED_VPS_IP, ОС: Linux (Ubuntu 24.04), доступ: SSH root

---

## 1. Что здесь

StreamBro Server — бекенд для десктопного приложения StreamBro. Запускается на VPS и обеспечивает:

- **Signaling** — WebSocket сервер для P2P (WebRTC) ко-стрима
- **API** — REST эндпоинты для баг-репортов, авто-обновлений, профиля, друзей
- **Static files** — сайт, загрузки, обновления

---

## 2. Структура

```
/opt/streambro/
├── server.js              → Главный API сервер (Express)
├── signaling.js            → WebSocket сигналинг (вынесен из signaling-server/server.js)
├── package.json
├── .env                    → Секреты (НЕ коммитить)
├── data/
│   ├── bugs/               → JSON файлы баг-репортов
│   └── updates/            → latest.json для авто-обновлений
├── downloads/              → portable .zip файлы для скачивания
└── logs/                   → Логи сервера
```

---

## 3. Поддомены и Nginx

| Поддомен | Назначение | Порт Node | Nginx proxy |
|---|---|---|---|
| `streambro.online` | Сайт + ститика | — | root `/var/www/streambro` |
| `api.streambro.online` | REST API | 3000 | `proxy_pass http://127.0.0.1:3000` |
| `signaling.streambro.online` | WS сигналинг | 7890 | `proxy_pass http://127.0.0.1:7890`, ws upgrade |
| `updates.streambro.online` | Файлы обновлений | — | root `/opt/streambro/data/updates` |

---

## 4. Порядок запуска

```bash
cd /opt/streambro
npm install          # зависимости
cp .env.example .env # заполнить секреты
pm2 start server.js --name streambro-api
pm2 start signaling.js --name streambro-signal
pm2 save
pm2 startup          # автозапуск при ребуте
```

---

## 5. API Эндпоинты

### Баг-репорты
```
POST /bugs            → принимает JSON баг-репорт, сохраняет в data/bugs/
GET  /bugs            → (admin) список баг-репортов
GET  /bugs/stats      → (admin) статистика: количество по типам, версиям
DELETE /bugs/:id      → (admin) удалить отчёт
```

### Обновления
```
GET /win/latest.yml   → electron-updater формат
GET /win/latest.json  → HTTP fallback формат (для portable .zip)
```

### Профиль (будущее)
```
POST /auth/signup
POST /auth/login
GET  /auth/me
```

### Друзья (будущее)
```
GET  /friends
POST /friends/request
```

---

## 6. Безопасность

- `.env` содержит секреты — НИКОГДА не коммитить
- API rate limit: 60 req/min per IP
- Bug reports: 10 req/min per IP
- Все эндпоинты кроме `/bugs` (POST) и обновлений требуют Bearer JWT (когда будет auth)
- Nginx терменирует SSL (Let's Encrypt)

---

## 7. Полезные команды

```bash
pm2 status                     # статус процессов
pm2 logs streambro-api         # логи API
pm2 logs streambro-signal      # логи сигналинга
pm2 restart streambro-api      # перезапуск
nginx -t && systemctl reload nginx  # проверка и релоад nginx
certbot renew                  # обновление SSL сертификатов
df -h                          # свободное место
ss -tlnp                       # занятые порты
```

---

## 8. DNS записи (должны быть настроены)

```
streambro.online         → A  REDACTED_VPS_IP
api.streambro.online     → A  REDACTED_VPS_IP
signaling.streambro.online → A  REDACTED_VPS_IP
updates.streambro.online → A  REDACTED_VPS_IP
```

---

## 9. SSL сертификаты

После настройки DNS и nginx:
```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d streambro.online -d api.streambro.online -d signaling.streambro.online -d updates.streambro.online
```
