# StreamBro CHANGELOG

## 1.1.0 (2026-05-01) — Профиль, друзья, чат, звуки, авто-обновление

### Новые возможности

- **Локальный профиль** (без обязательной регистрации) — никнейм, аватар,
  e-mail, статус. Стабильный `profile.id` (UUID) присваивается при первом
  запуске и не меняется между сборками.
- **Welcome-overlay при первом запуске** — кнопки «Регистрация на сайте»
  / «Уже есть аккаунт» / «Локальный профиль». Галочка согласия на
  баг-репорты включена по умолчанию.
- **Deep-link `streambro://login?token=...`** — после регистрации сайт
  возвращает пользователя в приложение и автоматически логинит. На
  Windows зарегистрировано NSIS-инсталлером, на macOS — через
  `open-url`. См. `docs/SERVER_PLAN.md` §2.
- **Раздел «Профиль» в настройках** — никнейм, статус, согласия,
  кнопки «Открыть профиль на сайте» / «Выйти». Очередь баг-репортов
  с кнопками «Отправить»/«Очистить».
- **Друзья** — отдельная вкладка в сайдбаре под «Платформы»/«Стрим».
  Список друзей с аватарами, статусом (🟢 онлайн / ⚫ оффлайн / 🔴
  стримлю / 🟣 играю / 🟡 отошёл / 🔵 не беспокоить / ⚪ невидимка),
  пульсирующая иконка конверта при новых сообщениях.
- **Inline-чат** — клик по другу выдвигает чат вниз. Удобно для
  передачи кодов комнат P2P. История хранится в `settings.json` (до
  500 сообщений на пару).
- **Свой статус** — выбирается прямо в шапке секции «Друзья» или
  в Настройки → Профиль. Опционально автоматически переключается на
  «Стримлю» при старте стрима и обратно при остановке.
- **Звуки приложения** — мягкие синтезированные тоны (Web Audio API,
  никаких внешних файлов). Пресеты: сообщение, друг онлайн, старт/стоп
  стрима, ошибка стрима, общая ошибка, успех, уведомление, обновление.
  Громкость регулируется, каждый звук можно отключить отдельно.
- **Баг-репортер** — `window.onerror` + `unhandledrejection` ловятся,
  скрабятся (RTMP keys / Bearer tokens / email / home folder), пишутся в
  `%APPDATA%\StreamBro\bug-reports\bug-*.json` и автоматически шлются
  POST'ом на endpoint каждые 2 минуты при наличии сети. Только если
  пользователь дал согласие.
- **Auto-update** — `electron-updater` с generic-провайдером
  (`updates.streambro.online/win/latest.yml`). Toast в верхнем правом
  углу при появлении версии, прогресс загрузки, кнопка «Перезапуск»
  когда готово. Каналы `latest` / `beta`. Настройки авто-загрузки и
  авто-установки в Настройки → Обновления.
- **Вкладки в Настройках** — Общие / Профиль / Звуки / Обновления.

### Архитектура

- Новый каталог `modules/`:
  - `profile-manager.js` — профиль, токен (через safeStorage), deep-link
  - `friends-store.js` — друзья / запросы / чат / unread (LWW по `ts`)
  - `bug-reporter.js` — очередь + скрабинг + POST через `net.request`
  - `auto-updater.js` — обёртка над electron-updater с graceful degradation
- Новый каталог `renderer/js/`:
  - `sounds.js` — `window.SBSounds`
  - `profile-ui.js` — `window.SBProfile`
  - `friends-ui.js` — `window.SBFriends`
- `settings.js` — версия `2`, миграция v1 → v2 добавляет блоки
  `profile / friends / sound / bugReports / updates`.
- `package.json` — версия `1.1.0`, dependency `electron-updater@^6.3.9`,
  `protocols: [streambro]`, `publish: generic`, иконки installer/uninstaller.
- `build/installer.nsh` — `customInstall` / `customUnInstall` macros
  регистрируют `streambro://` протокол в реестре HKCU.
- Новые тесты: `test/profile.test.js` (24 проверки), `test/friends.test.js`
  (27 проверок), `test/sounds.test.js` (9 проверок), расширен
  `settings.test.js` (миграция v1→v2). Всего теперь **150+ smoke-тестов**.
- Новые документы: `docs/SERVER_PLAN.md` (полная спецификация бекенда),
  `docs/SECURITY.md` (модель угроз и чек-лист).

### Известные ограничения 1.1.0

- Сервер `streambro.ru` развёрнут и работает: API, сигналинг, SSL, баг-репорты, авто-обновления, скачивание portable zip. Регистрация/авторизация через сайт работает (deep-link `streambro://login?token=...`). Друзья и чат — локально (in-memory), серверная репликация будет добавлена в следующей версии.
- **Build на Windows** без Developer Mode: `npx electron-builder --win --dir --config.win.signAndEditExecutable=false` — обходит winCodeSign symlink-ошибку. Полный NSIS-сборщик требует включения Developer Mode в Windows.
- Code signing отсутствует — SmartScreen warning при установке.

## v12 — Production-readiness pass (предыдущая)

### Безопасность и стабильность

- **Persistent settings** — `%APPDATA%\StreamBro\settings.json`, atomic write через `.tmp` + rename. Поля: `ui` (тема, FPS, reducedMotion, grid, safeAreas), `stream` (платформа, сервер, key, разрешение, битрейт), `audio`, `recording`, `signaling`, `fxStateByName`.
- **Stream key шифрование** — через Electron `safeStorage` (Windows DPAPI). Plaintext key ни на диске, ни в логах не появляется. В FFmpeg URL key подставляется в main process; при логировании заменяется на `<key>`.
- **Single-instance lock** — два StreamBro не могут работать одновременно (конфликт камеры/микрофона).
- **Production hardening**: 
  - `--no-sandbox` и `disable-site-isolation` отключены в `app.isPackaged`
  - `Menu.setApplicationMenu(null)` в production
  - Логи renderer не пробрасываются в production
  - Все `console.log` обёрнуты в проверку `window.__sbDev`
  - CSP в renderer (запрещает inline-скрипты, `unsafe-eval`, сторонние источники)
  - `will-navigate` блокирует переход на внешние URL внутри окна
  - `setWindowOpenHandler` открывает только http(s) во внешнем браузере
- **Валидация перед стартом стрима**: обязательны источник на сцене, ключ, валидный rtmp(s):// сервер.
- **Track.onended** — реакция на физическое отключение камеры/микрофона: уведомление + удаление источника.
- **mediaDevices.devicechange** — список устройств обновляется автоматически в открытых модалках.
- **Удалён неиспользуемый `assets/IMG_8125.PNG`** (244KB).

### Реальный RTMP-стриминг

- Раньше: `MediaRecorder` с `videoBitsPerSecond` — никуда не передавал. Теперь:
- Renderer: `MediaRecorder` (canvas + audioDest) с `start(250ms)` → `dataavailable` → IPC → main.
- Main: `spawn(ffmpeg, ['-f','webm','-i','-', ..., '-f','flv', rtmpUrl])`. Параметры подобраны для streaming: `veryfast + zerolatency + g=fps*2 + maxrate + bufsize + yuv420p + AAC 160k`.
- **Auto-reconnect**: при `close` процесса FFmpeg → 3 сек wait → новый spawn с теми же args. Статус `reconnecting` показывается в UI.
- **Статусы стрима** в верхней панели и на кнопке: `offline / connecting / live / reconnecting / error` с цветовым индикатором и анимацией.

### Производительность и утечки

- **Throttled render loop**: `requestAnimationFrame` всегда крутится, но `render()` зовётся только если прошло `1000/targetFps` мс. Можно регулировать (30/60/120) в Настройках.
- **Дубликат `mousemove` устранён** — canvas-handler делает только курсор-preview, document-handler делает геометрию (не сбивается двойным применением).
- **Cleanup `_levelsRAF`** — единая RAF-цепочка вместо «новый RAF при каждом renderMixer».
- **Theme-аккенты кешируются** — getComputedStyle читается раз и инвалидируется при смене темы (а не каждый кадр).
- **Recording bitrate** — добавлен `audioBitsPerSecond: 192000` (был дефолтный 128кбит).

### UI/UX

- **4 темы**: Тёмная / Светлая / Неон / Бумага — переключаются мгновенно, без перезапуска. CSS-variables на `[data-theme="..."]`.
- **Reduced-motion** — отключает анимации (для слабых ПК).
- **Сетка и safe-area** на сцене — переключатели в Настройках, hotkey `G`.
- **Hotkeys**: `R` reset, `H` hide, `L` lock, `M` mute, `Delete` remove, `Esc` close-modal/deselect.
- **Lock / Hide / Cog** иконки в списке источников. Locked — не drag/resize, в render видна оранжевая рамка с лочком.
- **Screen / window picker** — теперь сетка из тайлов с превью (data:URL миниатюры от `desktopCapturer`), а не текстовый `<select>`. Выбранный source пробрасывается в main как preferred для `setDisplayMediaRequestHandler` (раньше всегда брался `sources[0]`).
- **Status pill** в топ-баре — отдельный индикатор стрима, не путается с roomStatus.
- **Settings modal** — тема, FPS, reduced-motion, grid, safe-area, версия + где хранятся настройки.
- **Hover/focus/active** — везде унифицированы; `:focus-visible` обводка для клавиатурной навигации; `cubic-bezier(.2,.7,.2,1)` для плавных переходов; transform/box-shadow на hover.
- **Notifications** — больше места, чище анимация, max-width 320px.
- **CSS на CSS-variables** — каждый цвет читается из темы, не хардкоден.

### Сборка / packaging

- `package.json` дополнен: `description`, `homepage`, `repository`, `author`-объект, postinstall (`electron-builder install-app-deps`), скрипты `build:win`, `build:dir`, `dist`, `pack`, `test`.
- `build`-секция: `asar:true`, `asarUnpack` для ffmpeg + native-recorder (так требует Electron, нативные модули не должны быть в asar).
- NSIS: `oneClick:false`, `perMachine:false` (per-user, без admin), `allowToChangeInstallationDirectory:true`, `createDesktopShortcut:true`, `createStartMenuShortcut:true`, `deleteAppDataOnUninstall:false` (настройки выживают переустановку), кастомный `build/installer.nsh`.
- Файлы: `IMG_*` excluded, `backups/` excluded, `*.map` excluded.
- `extraResources` правильно настроен под `app.asar.unpacked` (ffmpeg-static-electron путь подкорректирован при `app.isPackaged`).

### Тесты

- `test/transform.test.js` — round-trip world↔local во всех ключевых углах, opposite handles, crop math, det rotation matrix == 1. **57 проверок, все проходят.**
- `test/settings.test.js` — load/save/migration/encrypt round-trip с stub-Electron. **11 проверок, все проходят.**
- `npm test` запускает оба.

### Инфраструктура

- Backup в `backups/backup-2026-04-30_19-29-04-pre-audit-full/` — полный снэпшот до изменений.
- `signaling-server/server.js` — мелкий баг с `cleanupRoom(ws.roomCode)` после `null`-аnnotации исправлен.
- `webrtc.js` — добавлен `restartIce()` при `iceConnectionState === 'failed'`.
- WASAPI hotplug — без изменений (уже было хорошо).
- StreamBro.bat — добавлен `if errorlevel 1 pause` для прозрачности ошибок.

### Что не сделано (рекомендуется в следующих итерациях)

1. **Noise gate на AudioWorklet** — сейчас на `ScriptProcessor`, в DevTools deprecation warning. Работает корректно, но рекомендуется переписать. ~80 строк worklet-кода.
2. **Code signing** — для production нужен EV-сертификат (~$300/год). Без него Windows Defender SmartScreen показывает предупреждение пользователю. В `package.json.build.win` добавить `certificateFile`/`certificatePassword` или подписывать через `signtool` в CI.
3. **Auto-updater** — `electron-updater` + GitHub Releases / S3. Дополнительная dev-dependency `electron-updater`. Конфигурируется через `publish` в `package.json`.
4. **Stream health HUD** — текущий битрейт, dropped frames, FPS в углу превью. FFmpeg выдаёт это в stderr, можно парсить и эмитить в renderer.
5. **Auto-quality preset** — снижать битрейт/разрешение если сеть плохая. Сейчас фиксированный.
6. **npm audit fix --force** — апгрейд `electron@33 → @41` (high severity bypass CVEs) и `electron-builder@25 → @26.x` (tar/cacache CVEs). Брейкинг — нужно потестировать вручную после.
7. **Защита от модификации asar** — Electron 30+ поддерживает `asar integrity`. Включить в `electron-builder` через `asarIntegrity`.
8. **Localization** — пока всё на русском хардкодом. Можно вынести строки в `locales/ru.json`/`en.json`.
9. **Master meter** — общий уровень микса в верхней панели.
10. **Refactor app.js** — 2400+ строк в одном файле. Не блокер, но поддержка тяжела. Разделить на `scene.js`, `audio.js`, `ui.js`, `streaming.js`.
