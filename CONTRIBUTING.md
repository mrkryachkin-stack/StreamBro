# Contributing to StreamBro

Спасибо за интерес к StreamBro! Ниже — инструкции для контрибьюторов.

## Как запустить

```bash
npm install
npm start        # dev-режим
npm test         # 150+ smoke-тестов
```

## Структура проекта

- `main.js` — Electron main process
- `preload.js` — contextBridge (renderer ↔ main)
- `renderer/js/app.js` — основная логика UI (3000+ строк)
- `renderer/js/friends-ui.js` — чат и список друзей
- `renderer/js/webrtc.js` — P2P
- `renderer/js/rtmp-output.js` — RTMP стриминг
- `modules/` — server-api, friends-store, profile-manager, cloud-sync
- `server/` — Express API + Prisma + PostgreSQL
- `server/website/` — Next.js сайт
- `test/` — unit-тесты (Node.js, без фреймворка)

## Правила кода

- Никаких голых `console.log` — только `if(window.__sbDev) console.log(...)`
- Все настройки через `_scheduleSettingsSave()` после изменений
- Новые IPC хендлеры → сначала `preload.js`, потом `main.js`
- Мутации CoScene только через `S.co.*` методы
- Тесты обязательны для новой бизнес-логики: `test/`

## Commit style (Conventional Commits)

```
feat: add virtual camera support
fix: chat avatar URL normalization
chore: bump version to 1.3.0
docs: update CONTRIBUTING.md
```

## Pull Requests

1. Форк → ветка `feature/название` или `fix/название`
2. `npm test` должен пройти
3. Описание PR: что делает, как тестировал, скриншоты если UI
4. Не добавляй секреты (.env, stream key) в коммиты

## Баг-репорты

Используй вкладку **Issues** на GitHub. Приложи:
- Версию приложения (Settings → About)
- Шаги воспроизведения
- Ожидаемое и фактическое поведение
- Логи из DevTools (в dev-режиме)

## Лицензия

GPL-3.0. Убедись что твой вклад совместим с этой лицензией.
