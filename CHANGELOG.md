# Changelog

Все значимые изменения в этом проекте документируются здесь.

Формат: [Conventional Commits](https://conventionalcommits.org/). Версии по [SemVer](https://semver.org/).

## [1.2.8] — 2026-05-03

### Fixed
- Кнопки уведомлений: овальные pill-кнопки с зелёным/красным контуром вместо слайдеров
- Чат: бейдж непрочитанных прямо на карточке друга (+N)
- Чат: уведомление пропадает мгновенно после прочтения
- Admin Panel: непрочитанные сообщения подсвечены красным с меткой NEW, сортировка вверх
- Аватарки: улучшенный fallback + referrerpolicy

## [1.2.7] — 2026-05-03

### Changed
- Кнопки уведомлений: меньше размер, белый текст на зелёном/красном фоне

## [1.2.6] — 2026-05-03

### Changed
- Слайдеры уведомлений заменены на кнопки ВКЛ/ВЫКЛ

## [1.2.5] — 2026-05-03

### Changed
- Чат полностью переписан: плавающая панель (`#friendChatPanel`) вместо встроенных секций
- Live-сообщения от админки приходят без перезапуска (fix presence payload)
- Admin Panel: автополлинг 10с + автоотметка прочитанных

## [1.2.4] — 2026-05-03

### Fixed
- Аватарки в чате: URL нормализация (относительный → полный HTTPS)
- Google/VK OAuth: теперь 1 вкладка вместо 2-3
- Форма входа: поля больше не зависали
- Чат: контекст-меню не обрезается рамкой

### Added
- Rate limiting: auth 10/5мин, friends 15/мин, chat 60/мин
- CSRF Origin-check для cookie-сессий
- AuditLog для admin действий
- CI/CD: GitHub Actions (тесты + серверный деплой)
- Мониторинг сервера + Telegram алерты
- Ежедневные бэкапы PostgreSQL

## [1.2.3] — 2026-05-03

### Fixed
- myUserId: теперь использует serverId для корректного определения своих сообщений
- Слайдеры уведомлений: `<div>` вместо `<label>`
- Чат: не пересоздаётся при refresh (сохранение scroll позиции)

### Added
- Аватарки: нормализация через `_normalizeAvatarUrl()` в friends-store.js
- Синхронизация друзей с сервера после логина
- `friendsStore.clear()` при логауте
- Periodic sync каждые 30с

## [1.2.2] — 2026-05-02

### Added
- Брендинг: `app.setAppUserModelId('com.streambro.app')`
- Иконка: icon.png, icon.ico, icon.svg
- Login/Register redirect если уже авторизован
- Редактирование username через `PATCH /api/user/me`
- Edit/Delete сообщений (PATCH/DELETE `/api/chat/message/:id`)

### Fixed
- Room code: `r.data?.code` вместо `r.code`
- Google OAuth username: `name1234` вместо hex

## [1.2.1] — 2026-05-02

### Added
- WebGL2 renderer (gl-renderer.js) — GPU-рендеринг сцены
- Glow shader: inward/outward direction
- Cover-fit маски (circle/rect/rounded) с CIRCLE_PAN_ZOOM
- Блокировка = Z-закрепление источника

### Fixed
- GLOW_FS shader: правильный rect SDF
- Canvas 2D: внутреннее свечение через градиенты

## [1.2.0] — 2026-05-01

### Added
- Превью всегда 30fps, выходной FPS раздельный
- Overlay canvas для handles (не попадает в запись)
- WebCodecs Phase 1: VideoEncoder + AudioEncoder + MPEG-TS
- GPU аппаратное ускорение (`prefer-hardware`)

### Changed
- FPS настройки перенесены в секцию стрима

## [1.1.0] — 2026-05-01

### Added
- Профиль пользователя, токен (safeStorage)
- Друзья, чат, статусы (friends-store.js)
- P2P комнаты со-стрима (серверные)
- Облачная синхронизация настроек (AES-256-GCM)
- Аналитика стримов (StreamEvent в БД)
- Presence WebSocket (онлайн-статусы)
- Чат поддержки (StreamBro admin friend)
- Auto-updater (electron-updater)
- Баг-репортер с очередью
- Deep-link `streambro://login`
- Оптимизации: dirty-flag, единый captureStream, mixer guard
- WebGL2 renderer

## [1.0.0] — 2026-04-30

### Added
- Первый публичный релиз
- Сцены, источники (камера/экран/окно/изображение)
- Canvas 2D рендеринг с трансформами
- RTMP стриминг (FFmpeg) → Twitch/YouTube/Kick/Custom
- Локальная запись (MediaRecorder → MP4)
- P2P со-стрим (WebRTC + signaling server)
- Web Audio API микшер
- Noise gate (AudioWorklet)
- EQ, компрессор, лимитер
- 4 темы (dark/light/neon/paper)
- 89+ smoke-тестов
