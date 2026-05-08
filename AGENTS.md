# StreamBro — Knowledge Base for AI Agents

> Последнее обновление: 2026-05-09 (1.4.0-beta10 — P2P: диагностика через логи, выявлена асимметрия сессий — CoScene работает только когда обе стороны используют build3+)
> Этот файл — «память» проекта. Новый агент должен прочитать его целиком перед началом работы.

---

## 1. Что это за проект

StreamBro — Windows-десктопное приложение для стриминга/записи в духе OBS, но проще и нативнее. Платформа для работы с камерой, экраном, изображениями, сценами, источниками, звуком и визуальными настройками.

**Стек:** Electron 41 + Canvas 2D + Web Audio API + WebRTC P2P + FFmpeg (RTMP) + WASAPI (нативный захват системного звука Windows).

**Цель:** коммерческий продукт для Windows — установщик .exe, автолюбованный, стримит на Twitch/YouTube/Kick/Custom, записывает в MP4, P2P со-стрим с другом.

---

## 2. Структура проекта

```
main.js                              — Electron main process: окно, IPC, FFmpeg, сигналинг, safeStorage, deep-link, инициализация модулей 1.1.0
preload.js                           — contextBridge → window.electronAPI (единственный мост renderer↔main)
settings.js                          — persistence: load/save JSON в %APPDATA%\StreamBro\settings.json + safeStorage. v2 schema (1.1.0+), миграция v1→v2
wasapi-capture.js                    — нативный модуль: WASAPI loopback capture системного звука Windows
modules/profile-manager.js           — 1.1.0 — профиль, токен (safeStorage), регистрация/логин через streambro:// deep-link
modules/friends-store.js             — 1.1.0 — друзья, заявки, чат (in-memory cache, fallback при отсутствии авторизации)
modules/bug-reporter.js              — 1.1.0 — очередь баг-репортов, скрабинг секретов, POST через net.request
server/src/ai-bot.js                 — 1.3.1 — AI-ассистент поддержки: мульти-API фолбэк (Ollama/Fireworks/Groq/Gemini), сбор данных для fine-tune
modules/auto-updater.js              — 1.1.0 — обёртка над electron-updater (generic provider, graceful degradation)
modules/server-api.js                — 1.2.1+ — серверный API клиент: authenticated HTTP (net.request) + presence WebSocket
modules/cloud-sync.js                — 1.2.1+ — AES-256-GCM шифрование настроек, upload/download на сервер
renderer/index.html                  — UI разметка (welcome overlay, settings tabs, friends section, update toast)
renderer/css/styles.css              — Темы (dark/light/neon/paper) через CSS variables на [data-theme]; стили profile/friends/welcome/toast
renderer/js/app.js                   — Основная логика renderer: UI, настройки, события, оркестрация (~4000 строк) + delegates к SBScene/SBAudio/SBSources
renderer/js/scene.js                  — 1.3.2 — window.SBScene: трансформы, рендер, handles, undo, borders, glow (~458 строк)
renderer/js/audio.js                  — 1.3.2 — window.SBAudio: аудио-цепочка, FX, микшер, levels, WASAPI (~330 строк)
renderer/js/sources.js                — 1.3.2 — window.SBSources: утилиты источников, ID, Z-order, restore data (~108 строк)
renderer/js/webrtc.js                — WebRTC P2P: PeerConnection + WebRTCManager (сигналинг + TURN)
renderer/js/rtmp-output.js           — RTMP streaming (WebCodecs H.264+AAC / MediaRecorder fallback) + локальная запись (MediaRecorder → MP4)
renderer/js/gl-renderer.js           — 1.2.1 — WebGL2 renderer: textured quads, Gaussian blur, glow/vignette shaders, FBO post-processing, rect SDF, inward/outward glow direction
renderer/js/wasapi-worklet.js        — AudioWorklet для системного звука (200ms ring buffer)
renderer/js/noise-gate-worklet.js    — AudioWorklet процессор шумодава
renderer/js/sounds.js                — 1.1.0 — window.SBSounds: синтезированные UI-звуки через Web Audio API
renderer/js/profile-ui.js            — 1.1.0 — window.SBProfile: welcome overlay + профиль в настройках
renderer/js/friends-ui.js            — 1.1.0 — window.SBFriends: список друзей, чат, статусы, mail-pulse
signaling-server/server.js           — WebSocket сигналинг-сервер для P2P (порт 7890). Запускается in-process в main.js через require('ws'), НЕ как отдельный процесс.
test/transform.test.js               — 57+ smoke-тестов transform-математики
test/settings.test.js                — settings persistence + encryption + миграция v1→v2
test/coscene.test.js                 — 21 async-тест CoScene (LWW, throttle, msid-bind, snapshot)
test/profile.test.js                 — 24 теста profile-manager (token, deep-link, consents)
test/friends.test.js                 — 27 тестов friends-store (LWW, chat, requests)
test/sounds.test.js                  — 9 тестов SBSounds (presets, mute, volume)
build/installer.nsh                  — NSIS кастомизация (регистрация streambro:// протокола в HKCU)
vendor/ffmpeg.exe                    — bundled FFmpeg N-124278 SChannel build (~200 MB, обязателен для AWS IVS)
backups/                             — Снапшоты предыдущих версий проекта (нумерованные: v3-pre-profiles-friends = 1.0.0 baseline, и т.д.)
docs/SERVER_PLAN.md                  — 1.1.0 — полная спецификация будущего бекенда (auth/friends/chat/bugs/updates)
docs/SECURITY.md                     — 1.1.0 — модель угроз и production-чеклист
```

---

## 3. Ключевые модули и их назначение

### main.js (Main Process)
- Создаёт BrowserWindow с `contextIsolation:true`, `nodeIntegration:false`
- `app.requestSingleInstanceLock()` — один экземпляр приложения
- `app.isPackaged` гард: `--no-sandbox` и `disable-site-isolation` только в dev
- IPC-хендлеры:
  - `settings-load` / `settings-save` — работа с settings.json
  - `settings-get-stream-key` — decrypt через `safeStorage` (Windows DPAPI)
  - `startFFmpegStream` / `stopFFmpegStream` / `writeStreamChunk` — RTMP через FFmpeg pipe
  - `set-preferred-display-source` — для кастомного screen picker'а
  - `show-in-folder` — открыть папку в Explorer
  - `start-signaling-server` / `stop-signaling-server` — запуск встроенного WS-сервера
  - `friends-*` — гибридный: server API при авторизации, локальный fallback
  - `rooms-*` — серверные комнаты со-стрима (создание, вход, приглашения)
  - `cloud-settings-*` — облачная синхронизация настроек (AES-256-GCM через cloud-sync.js)
  - `stream-event-*` — логирование стримов на сервер (start/end/reconnect/stats)
  - `presence-*` — presence WebSocket (статус, уведомления о стриме друзей)
- FFmpeg: spawn с `-f webm -i - -c:v libx264 -preset veryfast -tune zerolatency -f flv rtmp://...`
  - URL с key формируется в main, при логировании key заменяется на `<key>`
  - Auto-reconnect: при `close` процесса FFmpeg → 3 сек wait → respawn

### preload.js
- `contextBridge.exposeInMainWorld('electronAPI', {...})` — ВСЁ общение renderer↔main только через это
- Экспортируемые методы: `settingsLoad`, `settingsSave`, `settingsGetStreamKey`, `startStream`, `stopStream`, `writeStreamChunk`, `onStreamStatus`, `setPreferredDisplaySource`, `showInFolder`, `startSignalingServer`, `stopSignalingServer`, `onFFmpegRecStopped`

### settings.js
- `DEFAULT_SETTINGS` — шаблон с версией для миграций
- `loadSettings()` — читает JSON, делает deep merge с DEFAULT_SETTINGS
- `saveSettings()` — atomic write (`.tmp` + `rename`)
- `encryptSecret(text)` / `decryptSecret(cipher)` — через `safeStorage.encryptString` / `decryptString`
- Путь: `app.getPath('userData')/settings.json` → `%APPDATA%\StreamBro\settings.json`

### renderer/js/app.js (Renderer — ядро)
**Глобальное состояние `S`:**
```
S.srcs[]         — все источники (camera/screen/window/image/peer-audio/peer-video/desktop)
S.selId          — ID выбранного источника
S.items[]        — элементы сцены (позиция/размер/поворот/crop, привязаны к src.id)
S.wrtc           — WebRTCManager instance (создаётся при подключении к другу)
S.rtmp           — RTMPOutput instance
S.streaming      — идёт ли стрим
S.roomCode       — код комнаты P2P
S.audioCtx       — AudioContext (48000Hz)
S.audioDest      — MediaStreamDestination → идёт в recording/streaming
S.audioNodes     — Map<srcId, {sourceNode, gainNode, monitorGain, analyser, effectsChain}>
S.audioEffects   — Map<srcId, fxState>
S.combinedStream — MediaStream (video from canvas + audio from audioDest)
S.settings       — загруженные настройки (persisted)
S.targetFps      — FPS throttle (30/60/120)
S.reducedMotion  — отключить анимации
S.showGrid       — сетка на сцене
S.showSafeAreas  — safe-area overlay
```

**Аудио-цепочка (per source):**
```
sourceNode → gateNode(AudioWorklet) → eqLow → eqMid → eqHigh → compressor → compMakeup → limiter
           → gainNode → audioDest (запись/стрим)
           → gainNode → analyser (levels)
           → monitorGain → audioCtx.destination (мониторинг, кроме desktop)
```

**FX state per source:** `{ noiseGate, gateThresh, gateRange, gateAttack, gateHold, gateRelease, eq, eqLow, eqMid, eqHigh, compressor, compThresh, compRatio, compGain, limiter, limThresh }`
- Gate: AudioWorkletNode (`noise-gate-worklet.js`), параметры через `port.postMessage()`
- EQ: 3 BiquadFilterNode (lowshelf/peaking/highshelf)
- Compressor: DynamicsCompressorNode + makeup GainNode
- Limiter: DynamicsCompressorNode (ratio=20)

**Canvas render loop:**
- `loop()` → `requestAnimationFrame` → throttle по `S.targetFps`
- `render()` — рисует все sources на canvas с трансформациями (move/resize/rotate/crop/mirror)
- Transform handles: 8 resize + 4 crop + rotation indicator + mirror handle
- Математика: world↔local координаты через rotation matrix, проверена 57 тестами

**Настройки persistence:**
- `_loadSettings()` — при старте, загружает из main через IPC
- `_scheduleSettingsSave()` — debounced (400ms), вызывает `_persistSettings()`
- `_persistSettings()` — собирает payload из UI, шлёт `settingsSave` IPC (включая зашифрованный stream key)

**Hotkeys:** `R`=reset transform, `H`=hide, `L`=lock, `M`=mute, `G`=grid, `Delete`=remove, `Esc`=close modal

**Screen picker:** `desktopCapturer.getSources()` → сетка превью-тайлов, выбранный source → `setPreferredDisplaySource(id)`

**Device handling:** `track.onended` для камеры/микрофона, `navigator.mediaDevices.devicechange` для обновления списков

### renderer/js/webrtc.js (P2P)
- `PeerConnection` — обёртка над `RTCPeerConnection`, ICE restart при failed, data channel для control
- `WebRTCManager` — управление peers, сигналинг через WebSocket
- `setTurnConfig(url, user, pass)` — конфигурирует TURN relay для NAT traversal
- `_buildIceServers()` — собирает STUN (Google) + TURN (если задан) для iceServers
- **Качество**: video до 8 Мбит/с (`maxBitrate` в encodings) + `degradationPreference='maintain-resolution'`. Audio Opus 192 кбит/с stereo через SDP munging (`stereo=1; sprop-stereo=1; maxaveragebitrate=...`). Кодек-предпочтение VP9 → VP8 → H264.
- **Replay при join**: `WebRTCManager.localStreams` хранит все наши отправляемые стримы; новый peer при подключении автоматически получает их через `addLocalStream()`.
- **Glare-safe renegotiate**: оба пира могут добавлять треки в любой момент — `_renegotiate()` проверяет `signalingState==='stable'`.
- **Data channel**: `streambro-control` (ordered, priority:high). Передан в `WebRTCManager.onDataChannel(dc, peerId)` → CoScene `attachChannel`.
- Signaling: `create`/`join`/`leave`/`signal` сообщения через WS
- Remote stream → передаётся в `onPeerTrack(event, pid)` (для co-session msid-bind) и `onRemoteStream` (legacy fallback)

### renderer/js/coscene.js (Co-session engine)
- `CoScene` — реплицированная сцена (LWW по `ts`) поверх data-channel'ов.
- Глобальные ID источников через `crypto.randomUUID()` (`src.gid` = `src.id`, `it.sid` = `src.gid`).
- Привязка WebRTC треков к gid через `MediaStream.id` (msid пробрасывается в SDP).
- Op-протокол JSON: `snapshot`, `src.add`, `src.update`, `src.remove`, `src.reorder`, `item.upsert`, `item.remove`, `cursor`, `request-snapshot`.
- Throttling: `queueItemUpsert` ≈30 Гц (drag/resize); `flushItem` — синхронная отправка финального состояния (mouseup).
- `applyingRemote()` guard — при применении удалённого op'а локальный re-broadcast подавлен (анти-эхо).
- Initial sync: при открытии data-channel автоматически шлётся `snapshot` (с задержкой 200 мс).
- Anti-echo по аудио: peer-owned audio НИКОГДА не возвращается обратно (проверка `isPeer` в `addAudioSource`).

### renderer/js/rtmp-output.js
- `RTMPOutput` class v8
- `_recorder` — локальная запись: MediaRecorder → WebM → FFmpeg → MP4
- `_streamRecorder` — стрим: MediaRecorder(250ms chunks) → IPC `writeStreamChunk` → FFmpeg pipe → RTMP
- `onStatus` callback: `offline / connecting / live / reconnecting / error`
- `_streamStatus` отслеживает текущее состояние

### renderer/js/noise-gate-worklet.js
- `AudioWorkletProcessor` с именем `'noise-gate'`
- Параметры через `port.postMessage({enabled, thresh, range, attack, hold, release})`
- Per-sample gain envelope: разные коэффициенты для attack/release
- Gate state machine: RMS → compare with threshold → hold timer → smooth gain change

### signaling-server/server.js
- WebSocket сервер на порту 7890
- Комнаты по 8-значным кодам
- сообщения: `create`, `join`, `leave`, `signal`, `room-created`, `room-joined`, `peer-joined`, `peer-left`, `error`
- `cleanupRoom(code)` — удаляет комнату если 0 участников

### renderer/css/styles.css
- 4 темы через `[data-theme]`: dark (default), light, neon, paper
- CSS variables: `--bg0..--bg3`, `--text/--text2/--muted`, `--accent/--accent2`, `--handle-fill/--handle-stroke`, `--selected-stroke`, `--canvas-frame`, etc.
- `.reduced-motion` — отключает transition/animation
- Компоненты: `.stream-pill`, `.screen-grid`, `.screen-tile`, `.theme-grid`, `.theme-tile`, `.turn-details`

---

## 4. Архитектура безопасности

| Что | Как |
|---|---|
| Stream key | Шифруется через `safeStorage` (Windows DPAPI). В settings.json — encrypted blob. В renderer — plaintext только в input field. В FFmpeg args — подставляется в main process, не пробрасывается в renderer. При логировании — `<key>` |
| CSP | В `index.html`: `script-src 'self'`, нет `unsafe-eval`, `object-src 'none'`, `connect-src ws: wss:` |
| Context Isolation | `contextIsolation:true`, `nodeIntegration:false`, все IPC через `contextBridge` |
| Single instance | `app.requestSingleInstanceLock()` |
| Production flags | `--no-sandbox` / `disable-site-isolation` только при `!app.isPackaged`. Меню скрыто в prod. Console renderer→main только в dev |
| Navigation block | `will-navigate` блокирует, `setWindowOpenHandler` открывает http(s) в браузере |
| Permission handler | `setPermissionRequestHandler` разрешает только `media`, `cursor`, `fullscreen` |

---

## 5. RTMP стриминг — как работает

```
Canvas (composite video) + AudioDest (mixed audio)
  → MediaRecorder(video/webm;codecs=vp9,opus, 250ms chunks)
  → dataavailable → IPC writeStreamChunk
  → Main process: FFmpeg stdin pipe
  → FFmpeg → flv → RTMP/RTMPS
```

### 5.1 FFmpeg бинарник — КРИТИЧНО

**`vendor/ffmpeg.exe`** (BtbN N-124278, **SChannel** TLS-стек) — обязателен для AWS IVS-эндпоинтов (Kick, Twitch RTMPS).

`getFFmpegPath()` в `main.js`:
1. Сначала ищет `vendor/ffmpeg.exe` (в dev) или `app.asar.unpacked/vendor/ffmpeg.exe` (в prod).
2. Fallback на `ffmpeg-static@5.3.0` (FFmpeg 6.1.1 GnuTLS) — но он НЕ работает с AWS IVS, GnuTLS падает с "Decryption has failed" на handshake.

**Никогда** не возвращайся к `ffmpeg-static-electron` (FFmpeg 3.0.1 от 2016) — он не умеет современный TLS вообще.

В `package.json`:
- `asarUnpack: ["vendor/**", "node_modules/ffmpeg-static/**", ...]`
- `files: [..., "vendor/**/*", ...]`

### 5.2 Параметры FFmpeg, выверенные под Kick / Twitch / AWS IVS

```
-loglevel level+info -hide_banner
-fflags +igndts+discardcorrupt        # игнорим DTS из MediaRecorder, дропаем битые пакеты
-thread_queue_size 1024
-f webm -i -                          # stdin = WebM от Chrome MediaRecorder
-vf scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2
-fps_mode cfr -r FPS                  # constant frame rate (не -vsync — он deprecated)
-c:v libx264 -preset veryfast -tune zerolatency
-profile:v main -level 4.1            # main, НЕ high — лучше совместимость с web players
-b:v Bk -maxrate Bk -bufsize Bk       # CBR, tight buffer
-pix_fmt yuv420p
-g (FPS*2) -keyint_min (FPS*2) -sc_threshold 0
-x264-params nal-hrd=cbr:keyint=...:min-keyint=...:scenecut=0
-af aresample=async=1000:first_pts=0  # лечит "Queue input is backward in time" от MediaRecorder
-c:a aac -b:a 160k -ar 48000 -ac 2    # 48 kHz stereo, AWS IVS preferred
-f flv -flvflags no_duration_filesize
```

Платформы (URL формируется в renderer'е, `startStream` в `app.js`):
- Twitch: `rtmp://live.twitch.tv/app`
- Kick: `rtmps://fa723fc1b171.global-contribute.live-video.net:443/app` (AWS IVS — обязателен `:443/app`!)
- YouTube: `rtmp://a.rtmp.youtube.com/live2`
- Custom: пользовательский URL

**Auto-fix Custom URL для AWS IVS** (в `startStream`):
- Если URL содержит `live-video.net` или `twitch-ingest` без `:443` — добавляется `:443`.
- Если без application-path — добавляется `/app`.
- Делается это автоматически + toast пользователю.

### 5.3 Защита от висяков и цикла реконнектов

**Лимит реконнектов FFmpeg = 3** (`FFMPEG_STREAM_MAX_ATTEMPTS` в `main.js`):
- Каждое падение FFmpeg до достижения "live" увеличивает `ffmpegStreamAttempts`.
- На 3-й неудаче — `stopFFmpegStream` с ошибкой, без бесконечного зацикливания.
- Сбрасывается до 0 при успешном connect (`stream-status: live`).

**Stall watchdog** (`setInterval` 2 сек в `main.js`):
- Если 10 секунд нет новых чанков из IPC `write-stream-chunk` — корректно стопает FFmpeg.
- Защита от случая «MediaRecorder завис, FFmpeg ждёт stdin вечно».

**Graceful kill** (`_safeKill` в `main.js`):
1. `stdin.write('q\n')` — попросить FFmpeg закрыться нормально.
2. `stdin.end()`.
3. `kill('SIGTERM')`.
4. Через 1.5с `kill('SIGKILL')` если ещё не умер.

**MediaRecorder cleanup в `rtmp-output.js`**: при `stream-status` = `offline | error` — `_streamRecorder.stop()`. Это критично, иначе MediaRecorder продолжает буферизовать данные в RAM при упавшем FFmpeg.

### 5.4 Лимиты бесплатных учёток платформ

В UI стрима стоит предупреждение: **Kick free-tier accept'ит максимум 720p @ 4500 kbps**. 1080p / 6000 kbps силенциально reject'ится edge-нодой AWS IVS — приложение принимает байты, но плеер не показывает поток. Для партнёрских аккаунтов лимит выше.

Twitch free: 1080p @ 6000 kbps — работает. YouTube: 1080p @ 8000 kbps — работает.

### 5.5 Маска ключа в логах

`_parseFFmpegError` и `_silenceStdio` маскируют:
- `rtmps?:\/\/[^\s]+` → `rtmp://<server>/<key>`
- `\bsk_[A-Za-z0-9_-]{8,}` → `<key>` (для Kick-style токенов без URL префикса)

При добавлении нового вендора с другим форматом ключа — расширь регекс.

---

## 6. P2P Co-stream — как работает

```
Пользователь A                    Пользователь B
  │                                  │
  ├─ WebRTCManager.connect()         ├─ WebRTCManager.connect()
  │    → WS → signaling server       │    → WS → signaling server
  ├─ createRoom() → code "ABCD1234"  ├─ joinRoom("ABCD1234")
  │                                  │
  ├─ PeerConnection (WebRTC)  ←─────┤─ PeerConnection (WebRTC)
  │    iceServers: STUN + TURN       │    iceServers: STUN + TURN
  │                                  │
  ├─ addLocalStream(combinedStream)  ├─ addLocalStream(combinedStream)
  │                                  │
  ├─ onRemoteStream → addVideoSource  ├─ onRemoteStream → addVideoSource
  │                    + addAudioSource               + addAudioSource
  │                                  │
  └─ Canvas composite + RTMP ──────→ Twitch/YouTube
     (видео друга как source на сцене)
```

TURN нужен когда оба за симметричным NAT (≈15-20% случаев). Без TURN — P2P не установится.

---

## 7. Transform Controls — ключевые моменты

- **Coordinate system:** canvas center = (S.cw/2, S.ch/2). Source position = center of item in canvas coords.
- **World↔Local:** rotation matrix `R(θ)` и её inverse. Handles рисуются в local space, потом трансформируются в world.
- **Crop:** отдельные `cropL/R/T/B` пиксели в source space. Crop handles двигают обрезку, не сам source.
- **Mirror:** если `scaleX < 0` — зеркалирование. Bounding box не ломается.
- **Rotation snap:** при перетаскивании rotation handle — snap к 0°/90°/180°/270° если близко.
- **Locked source:** `src.locked=true` → нет drag/resize/rotate, handles скрыты, рисуется lock badge.
- **Hidden source:** `src.visible=false` → не рисуется, но остаётся в списке.

---

## 8. Серверные фичи (1.2.1+)

### 8.1 Присутствие и онлайн-статус друзей

**Архитектура:**
- `PresenceServer` (Node) — WebSocket сервер на `/presence`, работает в том же контейнере что и backend
- Авторизация через JWT-токен (из `profile-manager.getToken()`)
- Клиент: `modules/server-api.js` → `presenceConnect/SetStatus/Disconnect`
- Push-уведомления renderer'у через IPC: `presence-update`, `stream-notification`

**Протокол WS:**
```
→ { type: "auth", token, status }      — авторизация при подключении
→ { type: "status", status }           — смена статуса (online/streaming/away/dnd/offline)
→ { type: "stream-start", platform }   — начало стрима (уведомляет друзей)
→ { type: "stream-end" }               — конец стрима
← { type: "presence", userId, status } — статус друга изменился
← { type: "friend-stream-start", userId, platform } — друг начал стрим
← { type: "friend-stream-end", userId }              — друг закончил стрим
← { type: "chat", senderId, content }  — входящее сообщение
```

**Статусы:** `online`, `streaming`, `away`, `dnd`, `offline` — хранятся в `User.status` (Prisma/PostgreSQL).

### 8.2 Друзья и чат (серверный)

**Prisma-модель:** `Friendship` (requesterId, addresseeId, status: PENDING/ACCEPTED/BLOCKED)
**Prisma-модель:** `Message` (senderId, receiverId, content, read)

**API-маршруты:**
- `GET /api/friends` — список принятых друзей (со статусами)
- `GET /api/friends/pending` — входящие заявки
- `GET /api/friends/search?q=...` — поиск по username
- `POST /api/friends/request` — отправить заявку
- `POST /api/friends/accept` — принять
- `POST /api/friends/reject` — отклонить
- `DELETE /api/friends/:userId` — удалить из друзей
- `GET /api/chat/:userId` — история сообщений (пагинация)
- `POST /api/chat/:userId` — отправить сообщение
- `GET /api/chat/unread/count` — количество непрочитанных

**Десктоп:** гибридный — при наличии JWT токена запросы идут на сервер, при отсутствии — в локальный `friends-store.js`

### 8.3 Серверные комнаты со-стрима

**Prisma-модель:** `Room` (code, creatorId, name, maxPeers, status: ACTIVE/CLOSED)
**Prisma-модель:** `RoomMember` (roomId, userId, role: CREATOR/MEMBER)

**API-маршруты:**
- `POST /api/rooms` — создать комнату (генерирует 16-символьный код). **Лимит: максимум 2 ACTIVE комнаты на пользователя** — при превышении возвращает `429`.
- `GET /api/rooms/:code` — информация о комнате
- `POST /api/rooms/:code/join` — войти
- `POST /api/rooms/:code/leave` — выйти (создатель → комната закрывается)
- `GET /api/rooms/mine/list` — список своих ACTIVE комнат (только `creatorId = userId`, `status = ACTIVE`)
- `POST /api/rooms/:code/invite` — пригласить друга (отправляет [room-invite:CODE] в чат)
- `PATCH /api/rooms/:code` — переименовать (только создатель, name до 50 символов)
- `DELETE /api/rooms/:code` — удалить/закрыть комнату (только создатель)

**Важно:** `/mine/list` маршрут расположен ДО `/:code` в Express — иначе `mine` попадёт в параметр `:code`.

### 8.4 Облачная синхронизация настроек

**Prisma-модель:** `SettingsBlob` (userId, encryptedData, iv, version)

**Шифрование:** AES-256-GCM, ключ = SHA-256(JWT-токена). IV — 12 байт, auth tag — 16 байт appended к ciphertext.
**Десктоп:** `modules/cloud-sync.js` — encrypt/decrypt + upload/download

**API-маршруты:**
- `GET /api/settings` — получить зашифрованный blob
- `PUT /api/settings` — загрузить (upsert, инкремент version)
- `DELETE /api/settings` — удалить

**Лимит:** 500 КБ encryptedData. Синхронизация ручная (кнопка в UI).

### 8.5 Профиль пользователя (аватар, био, статус)

**Расширение модели User:** поля `bio` (String?, макс 300), `status` (String, default "online"), `avatarUrl` (String?)

**API-маршруты:**
- `PATCH /api/user/profile` — обновить профиль (displayName, avatarUrl, bio, status)
- `GET /api/user/:username/profile` — публичный профиль любого пользователя

**Сайт (Dashboard):** полный редактор профиля — аватар URL, имя, био, статус, облако-синхронизация, друзья, комнаты, статистика стримов.

### 8.6 Стрим-события (аналитика)

**Prisma-модель:** `StreamEvent` (userId, platform, startedAt, endedAt, duration, reconnects)

**API-маршруты:**
- `POST /api/stream-events/start` — лог начала стрима (возвращает eventId)
- `POST /api/stream-events/:id/end` — лог конца (вычисляет duration)
- `POST /api/stream-events/:id/reconnect` — инкремент reconnects
- `GET /api/stream-events/history` — история стримов
- `GET /api/stream-events/stats` — агрегатная статистика

**Десктоп:** автоматический — `_onStreamLive()` и `_onStreamEnd()` в main.js вызывают serverApi при начале/конце стрима.

---

## 9. Известные проблемы и TODO

### Критичное (для коммерческого релиза)
- **Code signing** — нужен EV-сертификат, иначе SmartScreen warning при установке
- **Electron 33→41** — закроет 12 dev-уязвимостей (high severity CVEs)

### Среднее
- **WebGL render polish** — доработать: dashed/dotted/double/ornate/ridge/inset стили рамок, shimmer/flow анимации, crop handles, inward glow blur-проходы. Сейчас эти стили используют fallback на Canvas 2D overlay.
- **Stream health HUD** — парсить bitrate/dropped frames из FFmpeg stderr, показывать в UI
- **`app.js` рефакторинг** — 3000+ строк, можно разделить на scene.js, audio.js, ui.js, streaming.js
- **Уменьшить размер `vendor/ffmpeg.exe`** (200 MB) — strip + UPX, либо собрать минимальный билд. Ужмёт до ~30-40 MB.
- **Build на Windows требует `--config.win.signAndEditExecutable=false`** — без Developer Mode winCodeSign-архив не распаковывается (symlink-ошибка). Команда: `npx electron-builder --win --dir --config.win.signAndEditExecutable=false`

### Низкое
- **i18n** — строки хардкодом на русском, вынести в locales/ru.json, en.json
- **Master meter** — общий уровень микса в верхней панели
- **`asarIntegrity`** — защита от модификации asar в electron-builder

### Выполнено (1.1.0 — 2026-05-01)

**P6 — Фикс авторизации сайта (2026-05-03):**
- **Cloudflare кешировал API ответы** — `/api/user/me` без куки возвращал 401, Cloudflare кешировал его (ETag `W/"35-..."`), после логина возвращал 304 Not Modified → dashboard думал что токен невалидный → logout → цикл логина.
- **Express ETag отключен** — `app.set('etag', false)` + `res.removeHeader("ETag")` в middleware для `/api`. Без ETag браузер/CDN не может вернуть 304.
- **Cloudflare cache-busting** — добавлены `Surrogate-Control: no-store` + `CDN-Cache-Control: no-store` (Cloudflare-специфичные заголовки). Nginx: `proxy_hide_header ETag` + `proxy_hide_header Last-Modified` для `/api/` и `/api/auth/`.
- **Nginx Cache-Control** — `no-store, no-cache, must-revalidate, private` + `Pragma: no-cache` для всех `/api/` и `/api/auth/` location.
- **Dashboard error handling** — catch-блок в `loadData()` теперь различает 401/token ошибки (→ logout) от других ошибок (→ показать сообщение «Ошибка загрузки»).
- **`/api/user/me` — добавлены `bio` и `status`** в Prisma select (раньше были пропущены, dashboard не мог их прочитать).
- **`setTokenCookie` — `domain: process.env.COOKIE_DOMAIN || undefined`** — для совместимости с разными браузерами.
- **Helmet — убраны дублирующие заголовки** (`hsts`, `frameguard`, `noSniff`, `referrerPolicy`, `xssFilter`) — они уже ставятся nginx.
- **Cloudflare HTTP/3 (QUIC) отключён** — вызывал `ERR_QUIC_PROTOCOL_ERROR` у некоторых пользователей в РФ. Cloudflare Dashboard → Network → HTTP/3 → Off.
- **Next.js `metadataBase`** — добавлен `metadataBase: new URL("https://streambro.ru")` в layout.tsx для корректных og:image URL (был `http://localhost:3000`).
- **Главная страница — navbar auth** — Navbar проверяет авторизацию через `/api/user/test-cookie`. Если залогинен: показывает «Мой профиль» (ссылка на `/dashboard`) вместо «Войти», скрывает «Начать бесплатно».
- **Диагностический endpoint** — `GET /api/user/test-cookie` (возвращает `{hasCookie, username}` без раскрытия payload). Используется для проверки авторизации на клиенте.
- **Диагностическая страница** — `/cookie-test` (временно создана для отладки, потом удалить).

### Выполнено (1.1.0 — 2026-05-01)

**P0 — Критичные оптимизации:**
- **Единый `captureStream()`** — video track создаётся один раз, переиспользуется через `S._canvasVideoTrack`. Экономия: -300-400 MB RAM.
- **Dirty-flag система** — `_markDirty()` + `S._dirty` флаг. Рендер пропускается если сцена статична. Кэши `_getSortedItems()` / `_getSrcById()`. Экономия: -30-50% CPU.
- **Mixer visibility guard** — `updateLevels()` пропускает DOM-записи когда микшер скрыт. Pre-allocated Uint8Array. Throttle ~15fps. Экономия: -10-15% CPU.
- **`reducedMotion` подавляет анимации** — pulse/breathe/colorShift/rainbow = `'none'`. Blur-проходы сокращены (6→2). targetFps автоматически 30fps.

**P1 — Важные оптимизации:**
- **H.264 вместо VP9 для P2P** — `preferVP9: false`. H.264 аппаратно ускоряется GPU.
- **Снижен P2P битрейт** — видео 2.5 Мбит/с, аудио 64 кбит/с mono.
- **Ring buffer 200ms для WASAPI** — предотвращает отставание звука и хруст.
- **Race condition fix recorder** — `onstop` проверяет `=== recInstance`.
- **WebM fallback RAM limit** — 500MB cap.
- **Node leak fix** — `rawSource`/`splitter` disconnect + `audioEffects.delete()`.

**WebCodecs — Этап 1 (прямой H.264 стрим без re-encode):**
- **VideoEncoder (H.264)** + **AudioEncoder (AAC)** в renderer вместо MediaRecorder для стриминга.
- **MPEG-TS пакетизация** в renderer — H.264 NAL + AAC пакеты → 188-байт TS пакеты → IPC.
- **FFmpeg copy mode** — `-c:v copy -c:a copy`, FFmpeg только демуксит TS и ремуксит в FLV → RTMP. Никакого перекодирования.
- **`hardwareAcceleration: 'prefer-hardware'`** — VideoEncoder использует GPU (NVENC/QSV).
- **Fallback** — если WebCodecs недоступен, используется старый MediaRecorder (WebM → re-encode).
- Ожидаемый выигрыш: -150-200 MB RAM, -30-50% CPU, ниже задержка.

**WebGL — Этап 2 (GPU-рендеринг сцены):**
- **`gl-renderer.js`** — новый модуль: WebGL2 контекст, шейдерные программы, FBO для post-processing.
- **Textured quads** вместо `drawImage()` — VideoFrame текстуры загружаются через `texImage2D(video)`, GPU-композитинг.
- **Camera FX в шейдерах** — brightness/contrast/saturation/hue-rotate/sepia — всё на GPU (TEX_FS).
- **Crop mask в шейдерах** — circle/rounded-rect SDF mask (soft edge) — на GPU.
- **Gaussian blur** — two-pass (H+V) 9-tap blur на FBO. Используется для glow/halo эффектов.
- **Outward glow** — glow shader (SDF distance field) → blur passes → additive composite.
- **Vignette** — radial gradient shader.
- **Border stroke** — glow shader с минимальным expand.
- **Overlay canvas** (`sceneOverlay`) — handles, grid, safe-areas рисуются на отдельном 2D canvas поверх WebGL (pointer-events:none).
- **Автоматический fallback** — если WebGL2 недоступен, рендер переключается на Canvas 2D (старый render()).
- **`preserveDrawingBuffer: true`** — для корректной работы `captureStream()` + `VideoFrame()`.
- Ожидаемый выигрыш: -200-300MB RAM, -70% CPU на рендере.

**P2 — Умеренные:**
- **Pre-alloc `gainEnv`** в noise gate — -370 аллокаций/сек.
- **`Buffer.from()` zero-copy** — Uint8Array view вместо копии ArrayBuffer.
- **Аудио FX toggle кнопки** — вместо checkbox кликабельные кнопки ВКЛ/ВЫКЛ.
- **EQ переключатель** — добавлена кнопка ВКЛ/ВЫКЛ.
- **Компрессор fix** — `compOn` = `fx.compressor` только (не `|| fx.compThresh < 0`).

**P3 — RAM/CPU оптимизации (round 3):**
- **Убраны `<video>` превью из списка источников** — заменены на статичные SVG-иконки по типу (камера/экран/окно/peer). Каждый `<video autoplay>` потреблял ~50-100MB GPU памяти + decode CPU. Экономия: -150-300 MB RAM, -5-15% CPU.
- **Убраны CSS background-анимации** — `sceneDrift`, `auroraDrift`, `sidebarFlow`, `topStrip` заменены на статичные фоны (градиенты + blur без `animation`). Экономия: -2-5% CPU на compositor.
- **Сигналинг-сервер в main process** — вместо `spawn(process.execPath, [server.js])` (отдельный Node/Electron-процесс ~80MB), сервер запускается через `require('ws')` прямо в main. Экономия: -80 MB RAM.
- **Убран memory logging** — `setInterval(10s)` для `process.memoryUsage()` удалён.

**P4 — FPS разделение + UX (round 4, v1.2.0):**
- **Превью всегда 30fps** (`S.targetFps=30`) — экономит CPU/GPU. Выходной FPS (`S._captureFps`) — из настроек (30/60/120). `captureStream(S._captureFps)` берёт полный FPS для записи/стрима.
- **"Уменьшить анимации" больше не влияет на FPS** — только отключает анимации эффектов рамок (pulse, breathe, colorShift, rainbow). Превью и так 30fps.
- **FPS перенесён в секцию стрима** — разрешение, битрейт и FPS теперь вместе как параметры выходного потока.
- **Убрана галочка GPU-рендеринг** — WebGL нестабилен, убран из UI чтобы не путать.
- **`?` тултипы** — при наведении на `?` рядом с настройками появляется подсказка (JS, на уровне body, не обрезается). Цвета адаптированы для светлых тем.
- **Handles/grid/safe-area НЕ видны на записи/стриме** — рисуются на отдельном `sceneOverlay` canvas, который не захватывается `captureStream()`. Позиционирование синхронизируется через `_syncOverlaySize()`. Редактирование сцены работает даже во время стрима.
- **RAM итог:** idle ~1170 MB → recording ~1700 MB (FFmpeg 308 MB). Без утечек (после стопа возвращается к ~1360 MB).

**P5 — Свечение, маски, UX (round 5, v1.2.1):**
- **GLOW_FS shader исправлен** — правильный rect SDF (`length(max(dd,0.0)) + min(max(dd.x,dd.y),0.0)`), отрицательный внутри, положительный снаружи. `u_direction` uniform (0=outward, 1=inward, 2=both). Alpha через `pow(alpha, 0.6)` для яркости.
- **Внутреннее свечение** — отдельный вызов `drawGlowOut(it, fs, glowColor, glowSize, opacity * 0.8, 1)` после отрисовки видео. Раньше было только наружное.
- **Canvas 2D внутреннее свечение** — вместо `shadowBlur` (квадратные артефакты) используются 4 линейных градиента для прямоугольных масок.
- **Наружное свечение усилено** — blur radius `glowSize * 1.5`, blur passes 6 (2 для reducedMotion).
- **Border stroke** — `u_direction=2` (both), чтобы рамка рисовалась по краю, а не уходила внутрь.
- **Маска «Прямоугольник» (rect)** — cover-fit + `CIRCLE_PAN_ZOOM` для обрезки вместо растягивания. Элемент принудительно квадратный (`min(w,h)`). Панорамирование работает с запасом. `_snapCircle` обрабатывает и `rect`.
- **Маски «Закруглённый» и «Круг»** — cover-fit + `CIRCLE_PAN_ZOOM` в превью и основной сцене. «Без маски» — stretch-fit (оригинальное поведение).
- **Кроп квадратной маски** — порог snap уменьшен: 0.03→0.015 (равный кроп), 0.02→0.008 (пресеты 25%/33%/50%).
- **Z-порядок источников** — `S.srcs.unshift()` для новых (на верх). Display-источники всегда full-canvas. Заблокированные «всплывают» наверх, новые добавляются под ними.
- **Блокировка Z-позиции** — `togLock()` перемещает заблокированный источник в начало массива, разблокированный — после последнего заблокированного. Новые источники вставляются после последнего заблокированного.
- **Дебаунс добавления** — `_confirmAddLock` / `_confirmMicLock` флаги + кнопка disabled во время `getUserMedia`. Предотвращает двойное добавление камеры/микрофона.
- **Переименование источников** — карандаш в списке → модальное окно (`renameModal`) с инпутом. `_confirmRename()` + `_scheduleSettingsSave()` для персистентности. Escape закрывает.
- **Звуки мьютятся на стриме/записи** — `_muteAppSounds()` / `_unmuteAppSounds()` через `SBSounds.setEnabled()`. SBSounds использует свой AudioContext → `destination`, не `S.audioDest`.
- **Качество камеры** — `frameRate:{ideal:30,min:15}` в constraints. `imageSmoothingQuality:'high'` для Canvas 2D. `antialias:true` для WebGL2.
- **Bugfix: `const cr` duplicate** — убрано повторное объявление в mousemove handler. Убран лишний `{` block после cr.

---

## 10. Важные правила для агентов

1. **НЕ ЛОМАЙ рабочую логику.** Перед изменением — прочитай контекст. Проверь что не ломаются тесты.
2. **Backup перед крупными изменениями.** Папка `backups/` — для снапшотов.
3. **`_connectSource` теперь async** — она ждёт загрузки AudioWorklet модуля. Все вызовы должны быть `await _connectSource(src)`.
4. **Gate — AudioWorkletNode, не ScriptProcessorNode.** Настройки передаются через `gateNode.port.postMessage()`. Не пытайся вернуть ScriptProcessor.
5. **TURN credentials** хранятся в `settings.json` в plaintext (не ключ стрима — просто relay-пароль). Если нужно шифровать — используй `safeStorage` аналогично stream key.
6. **ICE servers** собираются в `WebRTCManager._buildIceServers()` — не хардкодь в `PeerConnection`.
7. **CSP в index.html** — если добавляешь новые внешние ресурсы, обнови CSP. Сейчас `connect-src` разрешает `ws:` и `wss:`.
8. **`window.__sbDev`** — флаг dev-режима. Используй его для condition-логов: `if(window.__sbDev) console.log(...)`.
9. **`S.settings`** — главный объект настроек. Всё что должно пережить перезапуск — должно быть в нём. `_scheduleSettingsSave()` — debounced сохранение, вызывай при любом изменении UI-настроек.
10. **FFmpeg путь и сборка** — `getFFmpegPath()` в main.js приоритезирует `vendor/ffmpeg.exe` (SChannel-build). Это **обязательно** для AWS IVS (Kick, Twitch RTMPS) — GnuTLS-сборки падают с "Decryption has failed". Не вызывай `ffmpeg-static-electron` (FFmpeg 3.0.1 от 2016) ни при каких обстоятельствах. При `app.isPackaged` путь идёт через `process.resourcesPath/app.asar.unpacked/vendor/`.
11. **FFmpeg-аргументы для RTMP — НЕ упрощай** наугад. Параметры в `start-ffmpeg-stream` (см. §5.2) выверены под AWS IVS и протестированы. В частности: `aresample=async=1000` обязателен (иначе DTS-warnings ломают плеер), `+igndts+discardcorrupt` обязательны (MediaRecorder даёт битые DTS), `profile main` лучше чем `high` для веб-плееров, GOP=2 секунды без scenecut обязателен для Twitch/Kick.
12. **Stall watchdog + лимит реконнектов** — не отключай. Без них при невалидном ключе или сетевом сбое FFmpeg уходит в бесконечный реконнект, MediaRecorder копит данные в памяти, приложение тормозит за минуты.
13. **Co-session (collaborative scene)** — все мутации сцены, которые должен видеть друг, обязаны проходить через CoScene:
    - drag/resize/rotate/crop → `S.co.queueItemUpsert(it)` в `_coTickActiveEdit()` + `flushItem(sid)` в `endI()`
    - frame settings → `queueItemUpsert(it)` в `liveFrameUpdate`
    - add/remove source → `broadcastSourceAdd/Remove` (уже встроено в `addVideoSource/addAudioSource/rmSrc`)
    - vol/mute/visible/locked/camSettings → `broadcastSourceUpdate(s)` (или debounced `_coBroadcastSrcUpdateDebounced`)
    - Z-order (drag в списке) → `broadcastSrcReorder(_currentSrcOrder())`
    - Если применяется удалённый op (`_isRemote()` возвращает true) — НЕ делать broadcast, иначе будет эхо.
14. **WebRTC качество (P2P)** — настроено централизованно в `WebRTCManager.qualityOpts`. По умолчанию H.264 (2.5 Мбит/с видео, 64 кбит/с mono audio) — аппаратно ускоряется на GPU и подходит для слабых ПК. VP9 выключен по умолчанию (`preferVP9: false`). Если меняешь — учти, что `_mungeSdpForStereoOpus` применяется и к offer, и к answer, и SDP должен оставаться валидным. Для стрима (RTMP) битрейт остаётся высоким — 6000 кбит/с.
15. **`_parseFFmpegError` НЕ срабатывает на info-выводе FFmpeg.** Он специально игнорирует баннер версии (`configuration:`, `built with`, `lib(av|sw|post)`, `Input #`, `Stream #`, `Output #`, `frame=` и т.д.) и реагирует только на чёткие error-паттерны. Если хочешь добавить новую категорию реальных ошибок — расширяй массив `errorPatterns`, не убирай `isBanner`-фильтр.
16. **Известный косяк Kick Studio**: их встроенный preview-плеер часто залипает на «Loading…» даже когда зрители видят поток нормально. Проверять реальный статус нужно по `kick.com/<юзер>` в инкогнито, либо через раздел **архива записей** — если там появляются записи, поток шёл в эфир.
17. **1.1.0 — НЕ трогай профиль/токен напрямую из renderer.** Все мутации через `window.electronAPI.profile*` IPC. `tokenEncrypted` никогда не пробрасывается в renderer. Используй `profile-manager.getPublic()` вместо `appSettings.profile` если нужны данные для UI.
18. **1.1.0 — Друзья: только через `window.electronAPI.friends*`.** Не пытайся писать в `S.settings.friends` напрямую — там кеш, который перезаписывается. Source of truth — `friends-store.js` в main.
19. **1.1.0 — Звуки: только через `SBSounds.play(name)`.** Не создавай новые `<audio>` теги или Audio() в renderer. Все события UI должны попадать в `SBSounds.PRESETS`. Если нужен новый звук — добавь пресет в `renderer/js/sounds.js`.
20. **1.1.0 — Баг-репорты: добровольные.** Перед `bugReport()` НЕ забывай, что `bug-reporter.consented()` проверяется в main, но визуально пользователь должен видеть индикатор «отправлено». Не отправляй stack trace, который содержит **plaintext stream key** — `_scrub()` уже это делает, но если пишешь новый код, не клади key в `Error.message`.
21. **1.1.0 — Deep-link `streambro://login`.** Парсится в `profile-manager.handleDeepLink()`. Если добавляешь новые deep-link маршруты (`streambro://join-room?code=...` и т.п.) — добавь обработку туда же; не парси URL в renderer.
22. **1.1.0 — Auto-update graceful degradation.** Модуль `auto-updater.js` падает тихо если `electron-updater` не установлен (для портативных запусков). Не assertить наличие.
23. **1.1.0 — Settings v2 миграция.** Если добавляешь новое поле в `DEFAULT_SETTINGS` — обнови `_migrate()` и подними `SETTINGS_VERSION`. Иначе старые установки (v1) не получат новых полей.
24. **1.1.0 — Dirty-flag: `_markDirty()` обязателен** при любом изменении сцены (add/remove source, toggle visible/locked, grid/safe-areas, frame settings, reducedMotion). Рендер пропускается когда `S._dirty===false` и нет активных видео/стрима/drag. Если добавляешь новый UI-элемент, меняющий сцену — добавь `_markDirty()`.
25. **1.1.0 — Единый `captureStream()`** — video track создаётся один раз в `_rebuildCombinedStream()` и хранится в `S._canvasVideoTrack`. `_buildStream()` в rtmp-output.js берёт video tracks из `combinedStream`, НЕ вызывает `captureStream()` повторно. Повторный вызов создаст дублирующий видеопоток = +300-400 MB RAM.
26. **1.1.0 — WASAPI ring buffer** — фиксированный размер (200ms, ~38KB), не растёт. Если добавляешь новые PCM-источники — используй тот же ring-buffer паттерн из `wasapi-worklet.js`. Не возвращайся к `new Float32Array(old.length + pcm.length)` — это утечка.
27. **1.1.0 — WebCodecs стрим путь.** Если `this._webCodecsSupported === true` (VideoEncoder + AudioEncoder доступны), rtmp-output.js использует VideoEncoder(H.264) + AudioEncoder(AAC) + MPEG-TS packetizer вместо MediaRecorder. FFmpeg получает `-f mpegts` + `-c:v copy -c:a copy`. НЕ меняй `-c:v copy` на `-c:v libx264` для этого пути — это убьёт смысл WebCodecs (zero re-encode). Если WebCodecs недоступен — fallback на MediaRecorder (WebM → FFmpeg re-encode) работает автоматически.
28. **1.1.0 — ScriptProcessor для аудио в WebCodecs.** `rtmp-output.js` использует `createScriptProcessor(4096, 2, 2)` для захвата raw PCM из MediaStream и передачи в AudioEncoder. Это единственное место где ScriptProcessor допустим — для _стриминга_ (не для noise gate, который обязательно AudioWorklet). Если заменишь на AudioWorklet — убедись что timestamp в AudioData синхронизирован с VideoFrame timestamp.
29. **1.1.0 — WebGL renderer (S._useGL).** Если `GLRenderer.init()` успешно — `S._useGL=true`, `S.gl=GLRenderer`, render() использует `_renderGL()`. Иначе — fallback на Canvas 2D. НЕ удаляй Canvas 2D fallback — он нужен для систем без WebGL2. Overlay canvas (`sceneOverlay`) всегда использует 2D контекст для handles/grid/safe-areas.
30. **1.1.0 — GL текстуры.** `GLRenderer._texCache` хранит WebGL текстуры по srcId. При удалении источника вызывается `S.gl.removeSource(sid)`. НЕ забудь чистить текстуры иначе утечка GPU памяти.
31. **1.1.0 — `preserveDrawingBuffer: true`** обязателен для WebGL canvas который используется с `captureStream()` или `new VideoFrame(canvas)`. Без этого буфер очищается до копирования = чёрные кадры.
32. **1.2.1 — Свечение (glow) рисуется в 2 прохода.** Наружное (`direction=0`) рисуется ДО видео, внутреннее (`direction=1`) — ПОСЛЕ. `drawBorderStroke` использует `direction=2` (both). НЕ объединяй в один вызов — внутреннее свечение должно накладываться поверх видео.
33. **1.2.1 — Маски и cover-fit.** Для масок (circle/rect/rounded) — cover-fit + `CIRCLE_PAN_ZOOM` (×1.18 запас для панорамирования). Для `none` — stretch-fit (видео заполняет рамку). НЕ применяй CIRCLE_PAN_ZOOM к `none` — ломает рамку.
34. **1.2.1 — Блокировка = Z-закрепление.** `togLock()` перемещает источник: заблокированный → начало массива, разблокированный → после последнего заблокированного. Новые источники вставляются после последнего заблокированного. `rebuildZ()` вызывается после.
35. **1.2.1 — Переименование источников.** `_confirmRename()` должен вызывать `_scheduleSettingsSave()` — иначе имя теряется при перезапуске. Модалка `renameModal` должна закрываться через `hideM('rename')` по Escape (глобальный обработчик).
36. **1.2.1 — Звуки мьютятся на стриме/записи.** `_muteAppSounds()`/`_unmuteAppSounds()` вызываются в RTMPOutput callbacks. SBSounds использует свой AudioContext → `destination` (мониторинг), НЕ `S.audioDest` (стрим). НЕ добавляй SBSounds в `S.audioDest`.
37. **1.2.1+ — Друзья: гибридный source-of-truth.** При наличии JWT токена (`profileMgr.getToken()`) IPC-хендлеры `friends-*` идут через `serverApi` (REST API на streambro.ru). При отсутствии — fallback на локальный `friendsStore`. НЕ забывай проверять токен перед серверными вызовами.
38. **1.2.1+ — Presence WebSocket.** Подключение через `presenceConnect()` после логина. Отключение через `presenceDisconnect()` при логауте. Статус `streaming` устанавливается автоматически при начале стрима (`_onStreamLive`), возвращается на `online` при конце.
39. **1.2.1+ — Cloud sync шифрование.** Ключ = SHA-256(JWT-токена). AES-256-GCM с 12-байтовым IV и 16-байтовым auth tag appended к ciphertext. При смене пароля (→ новый токен) старые зашифрованные настройки станут нечитаемыми — это ожидаемое поведение.
40. **1.2.1+ — Stream events.** `_onStreamLive()` и `_onStreamEnd()` в main.js автоматически логируют начало/конец стрима на сервер. `currentStreamEventId` хранит ID текущего события. НЕ вызывай `streamEventEnd` вручную — это делается автоматически при `stopFFmpegStream()`.
41. **1.2.1+ — Комнаты.** Комнаты создаются через серверный API (персистентность). Сигналинг (WebRTC SDP/ICE exchange) остаётся через `/signaling` WebSocket. Код комнаты — 16 символов (4 группы по 4 через дефис). Лимит: 2 ACTIVE комнаты на аккаунт. Создатель может переименовать (`PATCH`) и удалить (`DELETE`) комнату. «Покинуть» для создателя = только disconnect WebRTC, комната остаётся ACTIVE; для гостя = `roomsLeave` + комната закрывается.
42. **1.2.1+ — Express ETag ОТКЛЮЧЕН.** `app.set('etag', false)` + middleware `res.removeHeader("ETag")` для `/api`. Cloudflare кешировал ETag → 304 Not Modified на `/api/user/me` после логина → login loop. НЕ включай ETag обратно для API маршрутов.
43. **1.2.1+ — Cloudflare cache-busting заголовки.** Express middleware ставит `Surrogate-Control: no-store` + `CDN-Cache-Control: no-store` для `/api` маршрутов. Nginx: `proxy_hide_header ETag` + `proxy_hide_header Last-Modified`. НЕ удаляй эти заголовки — без них Cloudflare закеширует API ответы.
44. **1.2.1+ — Navbar auth на главной.** Компонент `Navbar` в `page.tsx` проверяет авторизацию через `fetch("/api/user/test-cookie", {credentials:"include"})`. Если `hasCookie===true` → показывает «Мой профиль» вместо «Войти». НЕ убирай эту проверку.
45. **1.2.1+ — HTTP/3 (QUIC) Cloudflare ОТКЛЮЧЕН.** Вызывал `ERR_QUIC_PROTOCOL_ERROR` у пользователей РФ. НЕ включай HTTP/3 в Cloudflare Dashboard без поддержки QUIC на origin-сервере.
46. **1.2.1+ — `/api/user/test-cookie` — публичный diagnostic endpoint.** Не требует auth middleware. Возвращает `{hasCookie, username}` если кука валидна, `{hasCookie:false}` если нет. Используется на главной странице для проверки сессии. НЕ удаляй — нужен для navbar auth.

---

## 11. Как запускать и тестировать

```bash
npm install          # зависимости (включая electron-updater@^6.3.9)
npm start            # запуск в dev-режиме
npm test             # smoke-тесты (transform + settings + coscene + profile + friends + sounds — всего 150+)
npm run build:dir    # быстрая сборка без NSIS, для smoke-теста (dist/win-unpacked/)
npm run build:dir    # быстрая сборка без signing: npx electron-builder --win --dir --config.win.signAndEditExecutable=false
npm run build:win    # NSIS .exe установщик в dist/ (требует Developer Mode или signing cert)
npm run publish      # сборка + публикация (нужен GH_TOKEN или S3 creds)
```

Dev-режим: `--no-sandbox` включён, DevTools доступны, логи renderer→main пробрасываются.
Prod-режим (`app.isPackaged`): sandbox включён, меню скрыто, логи не пробрасываются.

---

## 12. Серверная инфраструктура (РАЗВЁРНУТА)

**VPS:** _(IP в secrets, не коммитим)_ (Ubuntu 24.04)

**Домен:** `streambro.ru` (`.online` редиректит → `.ru`)

**GitHub:** https://github.com/mrkryachkin-stack/StreamBro (GPL-3.0)

**Docker Compose** (`/opt/deploy/docker-compose.yml`):
- `nginx` (80/443) — reverse proxy + SSL (Let's Encrypt)
- `backend` (порт 3001 внутри Docker) — Express + Prisma + PostgreSQL
  - Маршруты: `/api/auth`, `/api/user`, `/api/subscription`, `/api/download`, `/api/bugs`, `/api/updates`, `/api/turn`
  - Volume: `/opt/server/downloads:/app/downloads` — portable .zip файлы
- `frontend` (порт 3000 внутри Docker) — Next.js сайт (streambro.ru)
- `signaling` (порт 7890 внутри Docker) — WebSocket сигналинг (`/signaling`)
- `postgres` (5432) — PostgreSQL 16
- `coturn` — TURN relay (host network, порт 5349)

**Рабочие URL:**
| URL | Назначение |
|---|---|
| `https://streambro.ru` | Сайт |
| `https://streambro.ru/api/health` | Health check |
| `https://streambro.ru/api/bugs` (POST) | Баг-репорты |
| `https://streambro.ru/api/bugs/stats` (GET, Bearer ADMIN_SECRET) | Статистика багов |
| `https://streambro.ru/api/updates/win/latest.json` | Авто-обновления (HTTP fallback) |
| `https://streambro.ru/api/download/portable/StreamBro-1.1.0-portable.zip` | Скачивание |
| `wss://streambro.ru/signaling` | P2P сигналинг |

**Десктопные URL (в коде приложения):**
- Баг-репорты: `https://streambro.ru/api/bugs` (в `settings.js` DEFAULT_SETTINGS)
- Обновления: `https://streambro.ru/api/updates/win/latest.json` (в `auto-updater.js` CHECK_URL)
- Сигналинг: `wss://streambro.ru/signaling` (в `app.js` default + `webrtc.js`)
- Регистрация: `https://streambro.ru/signup` (в `profile-manager.js`)
- Логин: `https://streambro.ru/login`
- Профиль: `https://streambro.ru/profile`

**Серверные файлы:**
- `/opt/server/` — бекенд-код (Docker build context)
- `/opt/server/.env` — секреты (JWT_SECRET, ADMIN_SECRET, DATABASE_URL, COTURN_SECRET, etc.)
- `/opt/server/data/bugs/` — JSON баг-репорты
- `/opt/server/data/updates/latest.json` — инфо о текущей версии
- `/opt/server/downloads/StreamBro-1.1.0-portable.zip` — 209 MB portable архив
- `/opt/deploy/` — Docker Compose + nginx конфиг

**Как обновить серверный код:**
1. Правишь код в `/opt/server/src/`
2. `cd /opt/deploy && docker compose build backend && docker compose up -d backend`

**Как выложить новую версию:**
1. На ПК: обновить version в package.json, собрать `npm run build:dir`, запаковать zip
2. Загрузить zip на сервер в `/opt/server/downloads/`
3. Обновить `/opt/server/data/updates/latest.json` (версия, changelog, downloadUrl)

**Рабочий процесс с Git:**
1. Правишь код на ПК
2. `git add .` → `git commit -m "описание"` → `git push origin master`
3. Код на GitHub: https://github.com/mrkryachkin-stack/StreamBro

---

## 13. Выполнено (1.2.2 — 2026-05-03)

**Серверные фичи:**
- **Админ-страница** — `/admin/login` для входа через ADMIN_SECRET или JWT admin; `/admin/setup` для создания admin-пользователя. `/api/admin/*` теперь принимает ADMIN_SECRET bearer токен.
- **BugReport в Prisma** — добавлена модель `BugReport` в schema.prisma; `/api/bugs` POST сохраняет в Prisma + filesystem fallback; `/api/admin/bugs` и `/api/bugs` GET читают из Prisma с filesystem fallback.
- **Комнаты fix** — `createRoom()` в `app.js` теперь читает `r.data?.code` вместо `r.code` (ключ не генерировался из-за неправильного разбора ответа `_request`). `joinRoom()` аналогично исправлен. Добавлен cron cleanup: комнаты без участников >24ч → EXPIRED; CLOSED/EXPIRED >7 дней → удаляются.
- **Download version** — обновлена с 1.2.0 до 1.2.1.

**Авторизация & профиль:**
- **Google OAuth username** — вместо `name_hex` теперь `name1234` (латиница + 4 цифры). Для кириллических имён — `user1234`.
- **Редактирование username** — `PATCH /api/user/me` принимает `username` с валидацией (2-30 символов, латиница+цифры, уникальность).
- **Presence DB sync** — `PresenceServer` теперь обновляет `User.status` в PostgreSQL при connect/disconnect/status change. Статусы на сайте и в приложении синхронизированы.
- **Аватарки nginx** — добавлен `location /api/user/avatars/` с `Cache-Control: public, max-age=2592000` (раньше попадал под `no-store` от `/api/`).

**Чат:**
- **Edit/delete сообщений** — `PATCH /api/chat/message/:messageId` (редактирование, 24ч лимит), `DELETE /api/chat/message/:messageId` (удаление). Добавлено поле `edited` в Prisma Message.
- **Чат оптимизация** — `friends-ui.js` теперь кэширует сообщения, добавляет новые в DOM без полной перезагрузки. Context menu для edit/delete своих сообщений.
- **IPC handlers** — `chat-edit`, `chat-delete` добавлены в preload.js и main.js.

**Брендинг:**
- **`app.setAppUserModelId('com.streambro.app')`** — Windows Task Manager показывает «StreamBro» вместо «Electron».
- **Иконка** — созданы `assets/icon.png`, `assets/icon.ico`, `assets/icon.svg` (SB логотип, фиолетовый фон, красный dot).

**Сайт:**
- **Login/Register redirect** — если пользователь залогинен, `/login` и `/register` редиректят на `/dashboard`.
- **Tab title** — «StreamBro — Профиль» для dashboard, «StreamBro — Вход» для login, «StreamBro — Регистрация» для register.
- **Cookie-test удалена** — `/cookie-test` страница удалена с сервера.

**Сайт авторизация (из предыдущей сессии):**
- **Cloudflare cache fix** — ETag disabled в Express, `Surrogate-Control: no-store` + `CDN-Cache-Control: no-store` middleware, nginx `proxy_hide_header ETag/Last-Modified`.
- **Navbar auth** — homepage navbar показывает «Мой профиль» когда залогинен, «Войти» когда нет. Проверка через `/api/user/test-cookie`.

**Тесты:**
- `friends.test.js` — исправлен `await` для `sendFriendRequest` и `removeFriend` (async функции). Все 150+ тестов проходят.

**Правила для агентов:**
42. **ADMIN_SECRET авторизация** — `authMiddleware` и `adminMiddleware` принимают `Authorization: Bearer <ADMIN_SECRET>` как валидный admin-токен. Это позволяет входить в админку без JWT admin-пользователя.
43. **Username редактирование** — `PATCH /api/user/me` с `{ username }` позволяет менять username (валидация: 2-30 симв, `[a-zA-Z0-9_-]`, уникальность).
44. **Chat edit/delete** — `PATCH /api/chat/message/:id` (24ч лимит, только свои), `DELETE /api/chat/message/:id` (только свои). Поле `edited: true` ставится при редактировании.
45. **Presence DB sync** — PresenceServer автоматически обновляет `User.status` в PostgreSQL. Не вызывай `prisma.user.update({ status })` вручную — PresenceServer это делает.
46. **Room cleanup cron** — setInterval(1h) в index.js: ACTIVE комнаты без участников >24ч → EXPIRED; CLOSED/EXPIRED >7д → удаляются. Не удаляй этот cron.
47. **`_request` возвращает `{ ok, data }`** — все вызовы `serverApi.*` возвращают `{ ok: true, data: {...} }` или `{ ok: false, error: '...' }`. В app.js: проверяй `r.ok`, данные в `r.data`, не в `r` напрямую.
48. **`app.setAppUserModelId`** — ОБЯЗАТЕЛЕН для Windows. Без него Task Manager показывает «Electron» вместо «StreamBro».

---

## 14. Выполнено (1.2.3 — 2026-05-03)

**Друзья по аккаунту (критичный багфикс):**
- **`friendsStore.clear()`** — новый метод, вызывается при logout. Обнуляет list, requests, chats, unread.
- **`friendsStore.syncFromServer()` при login** — после profile-login, profile-register, deep-link логина автоматически синхронизирует друзей с сервера.
- **Logout чистит друзей** — в main.js `profile-logout` handler вызывает `friendsStore.clear()` + `presenceDisconnect()`.

**Аватарки:**
- **CSP `img-src https:`** — вместо `https://streambro.ru` теперь `https:`, чтобы OAuth аватарки (Google, VK) загружались.

**Баг входа после выхода:**
- **Reset UI state** — при logout: очистка `data-orig-html`, пересоздание welcome overlay, `_wireWelcome()`. Подтверждение меняет текст: «Друзья и чаты этого аккаунта будут очищены».

**Заявка в друзья — реальное время:**
- **`presence.notifyUser()`** — новый метод в PresenceServer для targeted WS push.
- **`friend-accepted` WS событие** — при accept friend request, инициатор получает WS уведомление → `friendsStore.syncFromServer()`.
- **`friend-request` WS событие** — при отправке заявки, получатель получает уведомление → `refresh()`.
- **Periodic sync** — каждые 30 сек friends-ui.js вызывает `friendsSync` IPC.
- **`friendsRoutes.setPresence(presence)`** — presence инжектится в friends и admin routes.

**Уведомления друзей:**
- **`friends.notifications.sound/badge`** — новые настройки в DEFAULT_SETTINGS.
- **Тогглы в UI** — чекбоксы «Звук» и «Бейдж» в секции друзей.
- **`_notifSoundAllowed()` / `_updateBadge()`** — проверяют настройки перед воспроизведением/показом.

**OAuth в приложении:**
- **`profileOpenOAuth(provider)`** — новый IPC handler в preload + main. Открывает `https://streambro.ru/api/auth/{google|vk}?redirect=app`.
- **Google/VK кнопки** — добавлены в welcome overlay, inline login/register формы, settings card.

**Админ-друг StreamBro:**
- **`_ensureSupportUser()`** — при старте сервера создаёт пользователя `StreamBro` (role=SUPPORT).
- **Авто-френд при регистрации** — в auth.js register + _findOrCreateOAuthUser: после создания пользователя, Friendship(ACCEPTED) с StreamBro.
- **Защита от удаления** — `removeFriend()` в friends-store.js блокирует удаление друга с nickname «StreamBro*». UI: alert + скрытая кнопка.
- **Бейдж «Поддержка»** — в friends-ui.js друг StreamBro показывается с жёлтым бейджем.

**Админка — обратная связь:**
- **`GET /api/admin/feedback`** — возвращает все чаты с StreamBro пользователем, сгруппированные по партнёру.
- **`POST /api/admin/feedback/reply`** — отправляет ответ от имени StreamBro + push через presence WS.
- **Вкладка «feedback»** — добавлена в админку (page.tsx). Список пользователей слева, чат справа, input для ответа.

**Обновления:**
- **latest.json 1.2.3** — обновлён на сервере (внутри контейнера).
- **Dockerfile CMD** — `prisma migrate deploy` → `prisma db push --accept-data-loss` (fix для отсутствующих миграций).
- **Prisma schema** — добавлен `SUPPORT` в enum Role.

**Правила для агентов:**
49. **`friendsStore.clear()` при logout** — ОБЯЗАТЕЛЕН. Без этого друзья старого аккаунта показываются в новом. Вызывается в main.js `profile-logout` handler.
50. **Админ-друг StreamBro не удаляется** — `removeFriend()` блокирует удаление друга с nickname «StreamBro*». Не обходи эту защиту.
51. **Presence `notifyUser()`** — метод для targeted WS push. Используй его вместо broadcast когда нужен конкретный получатель.
52. **OAuth в приложении** — `shell.openExternal('https://streambro.ru/api/auth/{provider}?redirect=app')` открывает браузер, после OAuth браузер редиректит на `streambro://login?token=...` → deep-link → приложение получает токен.
53. **`prisma db push` вместо `prisma migrate deploy`** — Dockerfile CMD использует `db push` потому что нет файлов миграций. НЕ меняй на `migrate deploy` без создания миграций.

---

## 15. Выполнено (1.2.3+chat-fix — 2026-05-03)

**Чат — критичные багфиксы:**

- **Сообщения отображались наоборот (sender misattribution)** — `_renderMsg` и `_appendMessageToDOM` использовали `_myProfile.id` (локальный `prof-xxx`) для `isMe`, но серверные сообщения содержат `senderId` = UUID. Заменено на `_myProfile.serverId || _myProfile.id`. Теперь свои и чужие сообщения отображаются корректно.

- **Слайдеры уведомлений не включались обратно** — две причины:
  1. `<label>` вместо `<div>` — браузер пытался найти связанный `<input>`, ломая клик. Заменено на `<div>` для global и per-friend слайдеров.
  2. `_persistSettings()` в `app.js` **не сохранял блок `friends`** — после `_scheduleSettingsSave()` настройки `friends.notifications` и `friends.perFriend` терялись. Добавлен `...(S.settings.friends?{friends:S.settings.friends}:{})` в payload.

- **Чат дёргался/пропадал при refresh** — несколько причин:
  1. `_renderList()` пересоздавал весь DOM, уничтожая содержимое открытого чата → белый провал → `_loadAndRenderChat()` с setTimeout → мигание. Теперь `_renderList()` сохраняет и восстанавливает chat HTML + scroll позицию.
  2. `refresh()` вызывал `_loadAndRenderChat()` при открытом чате — убрано, чат обновляется только через live WS push.
  3. `friends-list` IPC каждый раз делал HTTP-запрос на сервер. Теперь использует кеш `friendsStore.listFriends()` (обновляемый раз в 30с через `friendsSync`), fallback на API только при пустом кеше.
  4. `_loadAndRenderChat()` теперь кеширует сообщения — при повторном открытии того же чата не делает HTTP-запрос.
  5. При `onFriendsChanged` с открытым чатом — lightweight refresh (только данные + badge), без DOM-перестроения.
  6. Добавлен `SBFriends.reset()` для очистки при логауте. Вызывается из `profile-ui.js`.

- **`syncFromServer` маппинг** — приоритет `displayName` над `username` (как в main.js), а не наоборот.

**Правила для агентов:**
54. **`myUserId` = `serverId`** — для сравнения `senderId` в чат-сообщениях ВСЕГДА используй `_myProfile.serverId || _myProfile.id`. Локальный `.id` = `prof-xxx`, серверный `.serverId` = UUID. Без `.serverId` все свои сообщения покажутся как чужие.
55. **`_persistSettings()` должен включать `friends`** — `S.settings.friends` (notifications, perFriend, list) мутируется на месте в renderer. Если не включить в payload `_persistSettings()`, данные потеряются при следующем сохранении. НЕ удаляй `...(S.settings.friends?{friends:S.settings.friends}:{})`.
56. **Слайдеры — `<div>`, не `<label>`** — `<label>` без связанного `<input>` вызывает непредсказуемое поведение при клике. Все `.friend-slider` элементы должны быть `<div>`.
57. **Не перезагружай чат при refresh** — `_renderList()` должен сохранять chat HTML перед `el.innerHTML=` и восстанавливать после. `_loadAndRenderChat()` использовать кеш. Не вызывать `_loadAndRenderChat()` из `refresh()`.
58. **`friends-list` IPC: кеш, не HTTP** — при авторизации сначала возвращать `friendsStore.listFriends()`, HTTP-запрос только при пустом кеше. Кеш обновляется через `friends-sync` IPC (каждые 30с).
59. **`SBFriends.reset()` при логауте** — очищает `_chatMessages`, `_friends`, `_expanded`, останавливает `_syncTimer`. Вызывается из `profile-ui.js` перед показом welcome overlay.

---

## 16. Выполнено (1.3.0 — 2026-05-03)

**Electron 41:**
- Обновлён с Electron 33 до **41.5.0**. Нативный модуль `native-recorder-nodejs` использует N-API — совместим без перекомпиляции.
- Убран устаревший `experimentalFeatures: true` из BrowserWindow (удалён в Electron 35).

**Виртуальная камера:**
- `modules/virtual-camera.js` — FFmpeg → DirectShow вывод. Требует OBS Virtual Camera (или любой DirectShow virtual cam driver).
- IPC хендлеры: `vcam-list-devices`, `vcam-start`, `vcam-stop`, `vcam-status`, `vcam-write-chunk`.
- UI в справке приложения: выбор устройства, кнопка вкл/выкл, статус.
- MediaRecorder → IPC → FFmpeg stdin → DirectShow virtual camera.

**Onboarding Wizard:**
- 4-шаговый мастер при первом запуске: Добро пожаловать → Добавь источник → Настрой звук → Стрим.
- Сохраняется в `settings.onboardingComplete`. Если `false` — показывается при `_loadSettings()`.
- Кнопка «Пропустить» на каждом шаге.

**Hardware Encoder:**
- `detectHardwareEncoder(ffmpegPath)` в `main.js` — проверяет h264_nvenc/h264_amf/h264_qsv, fallback на libx264.
- IPC: `detect-hw-encoder` → `electronAPI.detectHwEncoder()`.
- `start-ffmpeg-stream` принимает `encoder` в payload, валидирует allowlist.
- `S._hwEncoder` кешируется при первом запуске стрима.

**RNNoise AI шумоподавление:**
- `renderer/js/rnnoise-worklet.js` — AudioWorklet процессор для RNNoise (480-sample frames, 48kHz).
- Кнопка в Audio FX panel. Активируется через `port.postMessage({type:'enable', enabled})`.
- WASM загружается лениво при первом включении (`_loadRNNoise()`).
- Требует `renderer/rnnoise.wasm` (не включён в репо — нужно положить самостоятельно).

**2FA TOTP для admin:**
- Prisma User: `totpSecret String?`, `totpEnabled Boolean @default(false)`.
- `GET /api/admin/2fa/status` — статус 2FA.
- `POST /api/admin/2fa/setup` — генерирует TOTP secret + QR код.
- `POST /api/admin/2fa/verify` — подтверждает и включает 2FA.
- `POST /api/admin/2fa/disable` — отключает (с подтверждением кода).
- Admin page.tsx: вкладка Безопасность с QR и управлением 2FA.
- Пакеты: `speakeasy`, `qrcode` в server/package.json.

**Swagger / OpenAPI:**
- `GET /api/docs` — Swagger UI (swagger-ui-express).
- `GET /api/docs.json` — JSON спецификация.
- Пакеты: `swagger-ui-express`, `swagger-jsdoc` в server/package.json.
- Graceful degradation — если пакеты не установлены, сервер стартует без docs.

**AuditLog:**
- Prisma модель `AuditLog` (id, adminId, action, targetId, targetType, details, ip, createdAt).
- Таблица `audit_logs` в PostgreSQL.

**E2E Smoke тесты:**
- `test/e2e.test.js` — 38 тестов: settings merge, URL validation, semver, LWW friends, chat validation, edit window, onboarding, rate limiting, avatar URL, HW encoder validation.
- Добавлен в `npm test`.

**Рефакторинг:**
- `renderer/js/hotkeys.js` — keyboard shortcuts module (window.SBHotkeys).
- `renderer/js/streaming.js` — streaming utilities (PLATFORM_URLS, safeEncoder, formatBitrate).
- `renderer/js/README.md` — документация модулей renderer.

**CONTRIBUTING.md + CHANGELOG.md:**
- `CONTRIBUTING.md` — гайд для контрибьюторов (запуск, структура, правила кода, PR template).
- `CHANGELOG.md` — полная история версий от 1.0.0 до 1.3.0.
- `standard-version` scripts в package.json (`release`, `release:minor`, `release:patch`).

**Staging:**
- `server/docker-compose.staging.yml` — staging на портах 3011, отдельная БД.
- `docs/STAGING.md` — инструкция по настройке.
- GitHub Actions `deploy-staging` job для ветки `develop`.

**Sentry:**
- `@sentry/electron` в main.js (инициализируется при наличии `SENTRY_DSN` env).
- `@sentry/node` в server/src/index.js (Prisma integration, scrub sensitive data).
- `SENTRY_DSN` добавлен в `server/.env.example`.

**Авто-обновление:**
- Проверено: эндпоинт `https://streambro.ru/api/updates/win/latest.json` работает, отдаёт 1.3.0.

**Правила для агентов:**
60. **Electron 41 — `experimentalFeatures` удалён.** Это было deprecated свойство BrowserWindow. В Electron 35+ его нет. НЕ добавляй обратно.
61. **Виртуальная камера — требует DirectShow драйвер.** `modules/virtual-camera.js` работает только если установлен OBS Virtual Camera или аналог. Без драйвера FFmpeg вернёт ошибку. Покажи пользователю ссылку на установку OBS.
62. **RNNoise WASM** — файл `renderer/rnnoise.wasm` не включён в репо (бинарный, ~2 MB). Нужно скачать с https://github.com/xiph/rnnoise или собрать через Emscripten. Положить в `renderer/` для работы.
63. **2FA speakeasy** — `speakeasy.totp.verify(..., window: 2)` — допустимо 2 интервала отклонения (60 сек). НЕ уменьшай window до 0 — часы могут расходиться.
64. **Swagger graceful** — server/src/index.js загружает swagger через try/catch. Если пакеты не установлены — сервер стартует нормально без docs. НЕ убирай этот guard.
65. **`S._hwEncoder`** кешируется при первом запуске стрима. Для принудительного пере-определения — `delete S._hwEncoder` или `S._hwEncoder = null` и перезапуск стрима.
66. **Onboarding** — проверяется в `_loadSettings()`. Если `S.settings.onboardingComplete === false` → `_startOnboarding()`. Флаг сохраняется через `_scheduleSettingsSave()` при завершении.
67. **E2E тесты** — `test/e2e.test.js` — 38 Node.js тестов без Electron. Проверяют бизнес-логику renderer/server без GUI. Добавляй новые тесты при добавлении новой логики.
68. **`.notif-pill` кнопки** — кнопки уведомлений в карточке друга. `data-state="1"` = зелёная обводка, `data-state="0"` = красная обводка. Цвет текста всегда `var(--text)` (тёмный/светлый по теме) — НЕ используй `#86efac` или `#fca5a5` для текста, иначе на светлых темах нечитаемо.

---

## 17. Реальный статус всех задач v1.3.0 (верифицировано по коду 2026-05-03)

### ✅ Реально в коде:
- **asarIntegrity** — `package.json` строка 76: `"asarIntegrity": true`
- **Виртуальная камера** — `modules/virtual-camera.js` существует, подключён в `main.js`
- **RNNoise** — `renderer/js/rnnoise-worklet.js` существует
- **hotkeys.js** — `renderer/js/hotkeys.js` существует, подключён в `index.html` с `defer`
- **streaming.js** — `renderer/js/streaming.js` существует, подключён в `index.html`
- **E2E тесты** — `test/e2e.test.js` существует, добавлен в `npm test`
- **CONTRIBUTING.md** — существует в корне
- **Staging docker-compose** — `server/docker-compose.staging.yml` существует
- **Swagger** — в `server/src/index.js`, `/api/docs/` работает на сервере (200)
- **Rate limiting** — `express-rate-limit` в `server/src/index.js`
- **Onboarding wizard** — HTML разметка в `renderer/index.html`
- **Electron 41** — `package.json`: `"electron": "^41.5.0"`
- **2FA TOTP** — `server/src/routes/admin.js` с speakeasy
- **HW encoder** — `detectHardwareEncoder()` в `main.js`
- **Sentry (main.js)** — добавлен graceful init (env-gated через `SENTRY_DSN`)
- **Sentry (server)** — добавлен в `server/src/index.js` с `@sentry/node`
- **Lazy loading (defer)** — `sounds.js`, `profile-ui.js`, `friends-ui.js`, `hotkeys.js` имеют `defer`
- **PostgreSQL бэкапы** — cron `/opt/scripts/backup-db.sh` на сервере (3:00 каждый день)
- **Telegram мониторинг** — cron `/opt/scripts/monitor.sh` на сервере (каждые 5 мин)
- **download.js** — `CURRENT_VERSION = "1.3.0"`, URL с `/api/` префиксом — скачивание работает
- **Сайт** — обновлён до v1.3.0, новые фичи в changelog и features секции

### ❌ Не реализовано (честно):
- **FFmpeg уменьшение** (200MB → 30MB) — требует кастомной компиляции FFmpeg, не сделано
- **WebCodecs Phase 2** (FLV без FFmpeg) — только задекларировано, не реализовано
- **`@sentry/electron` npm пакет** — код добавлен но пакет не установлен (`npm install @sentry/electron` нужен при сборке)
- **`@sentry/node` npm пакет** — код добавлен в server/src/index.js, но пакет не в `server/package.json` (нужно добавить при деплое)

69. **Sentry graceful** — В `main.js` и `server/src/index.js` Sentry инициализируется только если `SENTRY_DSN` env переменная задана. Без неё приложение стартует нормально. НЕ добавляй `require('@sentry/...')` без try/catch — при отсутствии пакета сервер упадёт.
70. **Lazy loading порядок** — В `index.html` порядок скриптов: `streaming.js` → `gl-renderer.js` → `webrtc.js` → `coscene.js` → `rtmp-output.js` → `app.js` → (`sounds.js` defer) → (`profile-ui.js` defer) → (`friends-ui.js` defer) → (`hotkeys.js` defer). `sounds.js`, `profile-ui.js`, `friends-ui.js` загружаются с `defer` — после парсинга DOM.
71. **PostgreSQL бэкапы** — cron задача на сервере: `0 3 * * * /opt/scripts/backup-db.sh`. Бэкапы хранятся в `/opt/backups/postgres/`, retention 7 дней. При успешном бэкапе Telegram уведомление.
72. **Мониторинг** — cron `*/5 * * * * /opt/scripts/monitor.sh`. Проверяет `/api/health`, сайт, диск (>85%), упавшие контейнеры. Алерты в Telegram.
73. **`/opt/server/` не git-репо** — Файлы на сервере нельзя обновить через `git pull`. Нужно загружать через SFTP или `docker cp`. Docker build context = `../server` (т.е. `/opt/server/`). Все изменения нужно копировать туда вручную или через деплой-скрипт.

101. **НИКОГДА не коммить пароли, токены, API-ключи, IP-адреса серверов.** Это критично. Секреты утекали в репозиторий через deploy-скрипты (`tmp_*.py`, `deploy_icons.py`, `_ssh-check-site.js`) — пришлось переписывать всю git-историю через `git filter-repo`. Любой секрет, попавший в публичный git, считается скомпрометированным НАВСЕГДА — его нужно менять, недостаточно просто удалить из кода.

102. **Deploy-скрипты — НЕ для git.** Все `.py`/`.js`/`.sh` скрипты для деплоя на сервер (SSH, SFTP, SCP, paramiko) содержат учётные данные и должны быть только локально. Они добавлены в `.gitignore`: `tmp_*.py`, `deploy_icons.py`, `_deploy.py`, `_check.py`, `_verify.py`, `streambro-setup.sh`, `_ssh-check-site.js`. НЕ создавай deploy-скрипты в папке проекта — создавай в `~/scripts/` или другом месте вне git-репозитория.

103. **Секреты на сервере — через `.env` или GitHub Secrets.** VPS пароли, JWT_SECRET, ADMIN_SECRET, COTURN_SECRET, Telegram Bot токены — ТОЛЬКО в `/opt/server/.env` на сервере или в GitHub Repository Settings → Secrets. НЕ пиши их в исходный код, НЕ коммить `.env` файлы (они в `.gitignore`). GitHub Actions использует `${{ secrets.VPS_HOST }}`, `${{ secrets.VPS_PASSWORD }}`, `${{ secrets.TG_BOT_TOKEN }}` — НЕ заменяй на хардкод.

104. **VPS IP-адрес — не для публичного кода.** IP сервера `31.128.45.133` не должен появляться в коммитах. В GitHub Actions используй `${{ secrets.VPS_HOST }}`. В `server/setup.sh` и `streambro-setup.sh` — использовать `$VPS_IP` переменную окружения, не хардкодить. История была очищена через `git filter-repo --blob-callback` — IP заменён на `REDACTED_VPS_IP`.

105. **Перед `git add .` — проверяй что не добавляешь секреты.** Особо опасны: `_deploy*.py`, `_check*.py`, `_verify*.py`, `_ssh-*.js`, `ИТОГ_РАБОТЫ.md`, `streambro-setup.sh` — все эти файлы содержали VPS root-пароль и Telegram Bot токен. Если создаёшь скрипт с SSH-подключением — НЕ клади его в папку проекта, ИЛИ используй переменные окружения вместо хардкода, ИЛИ убедись что файл в `.gitignore`.

106. **Если секрет всё-таки попал в git — действуй немедленно:** (1) Сменить скомпрометированный пароль/токен — это ЕДИНСТВЕННЫЙ надёжный способ. Очистка git-истории не гарантирует что секрет никто не скачал. (2) `git filter-repo --invert-paths --path <файл>` для удаления файла из всех коммитов. (3) `git push --force` для перезаписи истории на GitHub. (4) Обновить `.gitignore` чтобы предотвратить повторное добавление.

---

## 18. Выполнено (1.3.1 — 2026-05-04)

**AI-бот поддержки (StreamBro Поддержка):**

- **`server/src/ai-bot.js`** — модуль AI-ассистента с мульти-API фолбэком:
  - Провайдеры (по приоритету): Ollama (локальный) → Fireworks → Groq → Gemini
  - Все OpenAI-совместимые (кроме Gemini — свой формат, конвертируется)
  - System prompt: выжимка знаний о StreamBro из AGENTS.md (~3К токенов)
  - Автоматический фолбэк: если провайдер недоступен → следующий, если все недоступны → сообщение ждёт живого админа
  - Загрузка истории чата (последние 10 сообщений) для контекста
  - Таймауты: Ollama 15с, Fireworks 12с, Groq 10с, Gemini 10с

- **Интеграция в чат:** при отправке сообщения пользователем пользователю «StreamBro Поддержка» (`chat.js` `POST /:userId`), если `receiverId === supportUserId` и бот включён → `aiBot.respond()` (fire-and-forget, не блокирует HTTP ответ).

- **Сбор данных для обучения:** каждый AI-ответ логируется в таблицу `AiConversation` (question, answer, provider, model, responseMs). Админ может исправить ответ (`corrected=true`, `correction`), оценить (`rating 1-5`).

- **Экспорт training data:** `GET /api/admin/ai/export` отдаёт JSONL в формате OpenAI fine-tune (только исправленные + rating>=4 по умолчанию). Данные для будущего LoRA fine-tune локальной модели.

- **Prisma модель `AiConversation`:** поля userId, question, answer, provider, model, corrected, correction, rating, responseMs. Индексы по userId+createdAt, corrected+createdAt, provider+createdAt.

- **Admin API:**
  - `GET /api/admin/ai/stats` — статистика (всего диалогов, исправленных, по провайдерам, avg responseMs)
  - `POST /api/admin/ai/toggle` — вкл/выкл бота
  - `GET /api/admin/ai/conversations` — список диалогов (фильтр по corrected)
  - `POST /api/admin/ai/correct` — исправить ответ + рейтинг
  - `GET /api/admin/ai/export` — экспорт JSONL для fine-tune

- **.env переменные:** `FIREWORKS_API_KEY`, `FIREWORKS_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OLLAMA_ENDPOINT`, `OLLAMA_MODEL`, `OLLAMA_KEY`. Добавлены в `.env.example`. Хотя бы один провайдер должен быть настроен для работы бота.

**Правила для агентов:**
74. **AI-бот включён по умолчанию если хотя бы один провайдер настроен.** Если ни один API-ключ не задан в `.env` — бот отключается автоматически (`_enabled = false`). Не включай бот руками без провайдера — будет бесконечно фолбэчить и тратить ресурсы.
75. **AI-ответ — fire-and-forget.** `aiBot.respond()` вызывается в `chat.js` через `.catch()` — не блокирует HTTP-ответ пользователю. Если AI отвечает медленно (5-10 сек), пользователь видит своё сообщение сразу, а ответ бота приходит через Presence WS push.
76. **`AiConversation` — растущий актив.** Каждый диалог логируется. НЕ удаляй старые записи без необходимости — это данные для будущего fine-tune. При большом объёме (>100К) можно архивировать старые в S3.
77. **System prompt в `ai-bot.js`** — это выжимка знаний о StreamBro. При добавлении новых функций в приложение — ОБНОВИ system prompt тоже, иначе бот не будет о них знать.
78. **Admin correction ≠ chat update.** `correctConversation()` обновляет запись в `AiConversation`, но НЕ обновляет Message в чате пользователя. Админ может отдельно ответить через feedback/reply если нужно поправить ответ в реальном чате.
79. **Ollama — первый приоритет.** Если `OLLAMA_ENDPOINT` настроен, бот сначала идёт к локальной модели (бесплатно, приватно). Cloud API — fallback. Это путь к полностью локальному AI-ассистенту.
80. **AI-ответы помечены `source: "ai"` в Presence WS.** Клиент может показывать бейдж «AI» рядом с ответами бота. НЕ удаляй это поле — оно нужно для прозрачности.
81. **`.env` API ключи — НЕ коммить.** `FIREWORKS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` — секреты. Они в `.env` (gitignored), не в коде. См. правило 101.
82. **Мульти-ключи через запятую.** В `.env` можно указать несколько ключей через запятую: `FIREWORKS_API_KEY=fw_key1,fw_key2,fw_key3`. Бот ротирует их round-robin — каждый запрос использует следующий ключ. Это для обхода rate limits.
83. **[ESCALATE] — эскалация к админу.** Если бот не уверен или пользователь просит «позови человека», модель ставит `[ESCALATE]` в ответ. ai-bot убирает метку из текста, но шлёт `_escalateToAdmin()` — все админы получают Presence WS push `type: "support-escalation"`.
84. **Технические ошибки скрыты от пользователя.** Если все провайдеры не ответили — пользователь НЕ видит никаких ошибок типа «нет соединения» или «токены закончились». Сообщение просто ждёт живого админа. НЕ добавляй технические сообщения пользователю.
85. **max_tokens = 800.** Бот пишет полностью, мысль не обрывается. В промпте: «ОБЯЗАТЕЛЬНО доделывай мысль до конца». НЕ уменьшай ниже 600 — оборвёт ответ на середине.
86. **AI-ответы видны в admin feedback.** `GET /api/admin/feedback` помечает сообщения от support: `isAi: true/false`, `aiProvider`, `aiCorrected`, `aiCorrection`. Админ видит какие ответы от бота, какие от человека, и может исправить неточные AI-ответы. Также показывается `aiPaused: true/false` для каждого чата.
87. **Per-user AI pause.** Админ может приостановить AI для конкретного чата (`POST /api/admin/ai/pause/:userId`). Пока приостановлен — бот не отвечает на сообщения этого пользователя, их видит только админ. Когда админ возобновляет (`POST /api/admin/ai/resume/:userId`) — бот НЕ читает старые непрочитанные сообщения, а ждёт только НОВЫЕ после момента resume (с 2-секундным буфером от race conditions).
88. **AI pause НЕ удаляет историю.** При pause бот просто игнорирует новые сообщения. При resume — возобновляет с текущего момента. Все сообщения пользователя сохраняются в БД как обычно (для админа), просто бот на них не отвечает.

**Admin редактирование/удаление сообщений (1.3.1+):**

- **`PATCH /api/admin/feedback/message/:messageId`** — админ редактирует любое сообщение в чате поддержки (своё или пользователя). Устанавливает `edited: true`. Пушит `chat-edit` событие пользователю через Presence WS.
- **`DELETE /api/admin/feedback/message/:messageId`** — админ удаляет сообщение из чата поддержки. Пушит `chat-delete` событие пользователю через Presence WS, затем удаляет Message из БД.
- **Presence WS `chat-edit`/`chat-delete`** — передаются в десктопное приложение (`modules/server-api.js` → IPC `friends-chat-edit`/`friends-chat-delete` → `renderer/js/friends-ui.js`). Клиент обновляет/удаляет сообщение в DOM в реальном времени.
- **Admin UI:** кнопки ✏️ (редактировать) и 🗑 (удалить) рядом с каждым сообщением в FeedbackSection. При редактировании — inline input с подтверждением/отменой. При удалении — confirm диалог.

**Правила для агентов:**
89. **Admin edit/delete — только для чата поддержки.** `PATCH`/`DELETE /api/admin/feedback/message/:messageId` работает только если сообщение в чате с StreamBro support user. Проверка: `senderId === supportUser.id || receiverId === supportUser.id`. НЕ давай админу редактировать чужие приватные чаты.
90. **`chat-edit`/`chat-delete` WS push — ОБЯЗАТЕЛЕН.** При редактировании/удалении сообщения админом, пользователь должен увидеть изменения в реальном времени. Без пуша — пользователь увидит старую версию до перезагрузки чата.
91. **Delete — сначала пуш, потом удаление.** Порядок в `DELETE` handler: сначала `_presence.notifyUser(notifyUserId, ...)` с `type: "chat-delete"`, потом `prisma.message.delete()`. Если удалить раньше — сообщение уже не существует, и клиент не сможет его найти для удаления из DOM.
92. **`edited: true` флаг.** При `PATCH` всегда ставится `edited: true` — показывает пользователю метку «(ред.)» рядом с сообщением. НЕ удаляй этот флаг — прозрачность редактирования.
93. **`friends-chat-edit`/`friends-chat-delete` IPC events.** Добавлены в `preload.js` (`onChatEdit`/`onChatDelete`) и обрабатываются в `friends-ui.js`. Обновляют кеш `_chatMessages` и DOM. НЕ забудь обработать эти события при добавлении новых чат-фич.

---

## 19. Выполнено (1.3.2 — 2026-05-04)

**P2P комната — критичный багфикс:**
- **Код комнаты ко-стрима**: генерировался `XXXX-XXXX-XXXX-XXXX` (16 символов + 3 дефиса = 19), но поле ввода «Присоединиться» принимало только 8 символов (`maxlength="9"`, placeholder `XXXX-XXXX`, форматтер обрезал до `ABCD-1234`). Друзья физически не могли ввести код и подключиться.
- **Исправлено**: `maxlength="19"`, placeholder `XXXX-XXXX-XXXX-XXXX`, форматтер расставляет дефисы между 4 группами.
- **CSS**: `.room-code` display уменьшен `font-size: 28px → 18px`, `letter-spacing: 4px → 2px`, добавлен `word-break: break-all`.
- **Тесты**: 21 новый e2e-тест (генерация, форматтер, посимвольный ввод, signaling join).
- **`asarIntegrity` убран из `package.json`** — не поддерживается electron-builder 25.x.
- **Версия**: 1.3.1 → 1.3.2.

**Правила для агентов:**
94. **Код комнаты = 19 символов (16 алфанум + 3 дефиса).** Формат `XXXX-XXXX-XXXX-XXXX`. Форматтер в `app.js` oninput handler расставляет дефисы автоматически. НЕ укорачивай код до 8 символов — это было причиной критичного бага.
95. **`maxlength="19"` на join input.** Если изменишь длину generateRoomCode — обнови maxlength, placeholder, и форматтер соответственно.

**Инцидент: агент перегрузил сервер (2026-05-04):**
Агент пытался загрузить 234 MB файл на сервер через paramiko SFTP. Загрузка шла медленно (0.2 MB/s), несколько попыток обрывались с EOFError, каждый раз оставляя orphaned sshd-процессы и partial files на сервере. Также был запущен `docker compose build` который потреблял ресурсы. Результат: 10-15 процессов легли на сервер.

**Правила для агентов:**
96. **ПЕРЕД любым действием с сервером — проверь доступ.** Один быстрый SSH ping: `ssh root@HOST "echo ok"` или `curl -s https://streambro.ru/api/health`. Если сервер не отвечает — НЕ пытайся подключаться повторно, НЕ запускай загрузки.
97. **НЕ запускай длительные загрузки (>50 MB) автоматически.** Большие файлы (билды, zip) пользователь загружает сам через SCP/SFTP. Агент только готовит файлы локально и даёт инструкции.
98. **НЕ запускай несколько параллельных SSH/SFTP соединений.** Одно соединение — одна задача. Если загрузка обрывается — убей процесс, НЕ запускай новый поверх.
99. **НЕ запускай `docker compose build` без подтверждения пользователя.** Docker build потребляет CPU и RAM. На сервере с 2 GB RAM это может положить все контейнеры.
100. **Убирать за собой.** Если скрипт упал — проверить и убить orphaned-процессы на сервере: `pkill -f "sshd:.*notty"`, `docker system prune -f`. НЕ оставлять мусор.

---

## 20. Выполнено (1.3.3 — 2026-05-05)

**Комнаты со-стрима — UI и серверный API:**

- **Вкладка «Мои комнаты»** в модалке «Совместный стрим» (третья вкладка после «Создать» и «Войти по коду»). Показывает только ACTIVE комнаты созданные текущим пользователем.
- **Серверный API `PATCH /api/rooms/:code`** — переименование комнаты (только для создателя, name до 50 символов).
- **Серверный API `DELETE /api/rooms/:code`** — удаление/закрытие комнаты (только для создателя, все участники отключаются).
- **Серверный API `POST /api/rooms` — лимит 2 комнаты на аккаунт**. При превышении — HTTP 429 с ошибкой. Клиент тоже проверяет лимит перед созданием.
- **Серверный API `GET /rooms/mine/list`** — фильтрует по `creatorId = req.user.id` + `status = ACTIVE`. Маршрут расположен ДО `/:code` чтобы `mine` не попал в параметр `:code`.
- **IPC хендлеры `rooms-rename` / `rooms-delete`** — добавлены в `main.js`, `preload.js`, `modules/server-api.js`.

**UI карточек комнат:**
- Карточка показывает: название (или код если без имени), бейдж «Создатель», бейдж «● текущая» если подключён.
- Кнопки: «Скопировать код» (clipboard), «Войти» / «Покинуть» (если текущая), ✏️ (переименовать), 🗑 (удалить).
- **Переименование** — inline input вместо `prompt()` (не работает в Electron с contextIsolation). Кнопки скрываются, появляется текстовое поле + OK/Отмена. Enter подтверждает, Escape отменяет.
- **Удаление** — inline confirm «Удалить? Да/Нет» вместо `confirm()`.
- **«Покинуть» для создателя** — только disconnect WebRTC, комната остаётся ACTIVE на сервере. Гости могут подключаться позже. Для гостя — вызывает `roomsLeave` на сервере.

**Кнопка «Покинуть» в верхнем баре:**
- При подключении к комнате в `roomStatus` появляется красная кнопка «Покинуть» рядом с «Комната: CODE».
- При покидании — `uRS('offline','Не подключён')`, кнопка скрывается.

**Поле имени при создании комнаты:**
- Добавлен `input#roomNameInput` на вкладке «Создать». Передаётся в `roomsCreate({name: roomName})`.

**Кнопка «Вставить» в поле кода:**
- Рядом с полем ввода кода комнаты — кнопка «Вставить», читает из clipboard.

**Исправленные баги:**
- **`profileManager` → `profileMgr`** — в `main.js` IPC handlers `rooms-list` и `get-turn-credentials` использовалось несуществующее имя `profileManager` вместо `profileMgr`. Это ломало ВСЕ IPC вызовы связанных с комнатами и TURN.
- **Tab ID `tabMyrooms` vs `tabMyRooms`** — обработчик табов генерировал `tabMyrooms` (маленькая 'r'), а HTML id был `tabMyRooms`. Вкладка никогда не получала класс `active`. Исправлено через явный `tabMap`.
- **Дублированный `if(!r||!r.ok)` блок** — после правки `loadMyRooms` остался осиротевший код без `if`, ломавший try-catch → SyntaxError → приложение не запускалось.
- **Серверный `/rooms/mine/list` маршрут ПОСЛЕ `/:code`** — Express считал `mine` как значение параметра `:code`, возвращал 401 вместо списка комнат. Перемещён перед `/:code`.

**Друзья — загрузка:**
- **`friends-list` IPC** — всегда возвращает кеш мгновенно, HTTP-запрос только при пустом кеше. Кеш обновляется через `friends-sync` каждые 30 сек.
- **`SBFriends.boot()`** — показывает кешированных друзей сразу, синхронизация с сервером в фоне.
- **Skeleton loader** — `.friends-loading` + `.friend-skeleton` пока данные загружаются.

**Onboarding:**
- **Интерактивный тур** — `clip-path` spotlight эффект (фон размытый, подсвеченный элемент чёткий), плавные tooltip-переходы через CSS `transition`.
- **6 шагов**: Добро пожаловать → Добавь источник → Платформы и ключ стрима → Микшер звука → Друзья и поддержка → Настройки.
- **`onboardingNeverShow`** — галочка «Больше не показывать», сохраняется в settings.
- **Кнопка «Пройти обучение»** — в help модалке (раздел «Быстрый старт»), перезапускает тур.
- **AI-бот в обучении** — шаг 5 «Друзья и поддержка» упоминает что можно написать «StreamBro Поддержка».

**Правила для агентов:**
107. **`profileMgr`, не `profileManager`.** В main.js профиль-менеджер импортирован как `const profileMgr = require('./modules/profile-manager')`. НЕ используй `profileManager` — это вызовет ReferenceError и сломает IPC.
108. **Tab ID маппинг** — обработчик табов в модалке использует `tabMap = {create:'tabCreate', join:'tabJoin', myrooms:'tabMyRooms'}`. Если добавляешь новую вкладку — добавь маппинг явно, НЕ полагайся на авто-генерацию `'tab' + capitalize(tab)`.
109. **`prompt()` и `confirm()` НЕ работают в Electron с contextIsolation.** Используй inline UI: при действии скрой кнопки, покажи input/confirm элементы прямо в карточке. Enter подтверждает, Escape отменяет.
110. **«Покинуть» ≠ «Удалить» для создателя.** Создатель при «Покинуть» только disconnect WebRTC — комната остаётся ACTIVE, друзья могут подключаться. Только «Удалить» (🗑) вызывает `roomsDelete` и закрывает комнату. Для гостя «Покинуть» = `roomsLeave` + комната закрывается если создатель вышел.
111. **Лимит 2 комнаты на аккаунт** — проверяется и на сервере (`activeCount >= 2` → 429), и на клиенте (`roomsList().data.length >= 2`). При превышении — сообщение об ошибке, комната не создаётся.
112. **`/rooms/mine/list` — ПЕРЕД `/:code` в Express.** Иначе `mine` попадёт в параметр `:code` и вернёт 401. Это общее правило Express: специфичные маршруты ДО параметризованных.
113. **`roomsRename` / `roomsDelete` IPC** — `rooms-rename(code, name)` и `rooms-delete(code)` в preload.js. Серверный `PATCH /rooms/:code` и `DELETE /rooms/:code` требуют авторизацию + создатель.
114. **Друзья: instant cache display** — `friends-list` IPC всегда возвращает `friendsStore.listFriends()` (кеш) мгновенно. HTTP-запрос на сервер делается ТОЛЬКО при пустом кеше, обновляется каждые 30 сек через `friends-sync`. НЕ добавляй `await serverApi.friendsList()` в `friends-list` handler.

---

## 21. Модульная архитектура renderer (1.3.2+ — в процессе)

**Проблема:** `renderer/js/app.js` = ~4000 строк (было ~5000). Любое изменение — риск сломать другое. Найти нужный код — долго.

**Решение:** разделение на независимые модули с `window.SB*` интерфейсом. Каждый модуль = IIFE, экспортирующий объект на `window`.

### Текущие модули renderer:

| Модуль | Файл | Строк | Назначение |
|---|---|---|---|
| `window.SBScene` | `renderer/js/scene.js` | ~458 | Трансформы, рендер (Canvas 2D + WebGL), handles, crop, undo, borders, glow, color utils |
| `window.SBAudio` | `renderer/js/audio.js` | ~330 | Аудио-цепочка, FX, микшер, levels, WASAPI, noise gate, combined stream |
| `window.SBSources` | `renderer/js/sources.js` | ~108 | Утилиты источников, ID, Z-order, restore data, insert/lock логика |
| `window.SBUi` | `renderer/js/ui.js` | ~138 | Темы, CSS vars, модалки show/hide, тултипы, overlay sync, settings debounce, HTML esc |
| `window.SBSounds` | `renderer/js/sounds.js` | 193 | UI-звуки через Web Audio API |
| `window.SBProfile` | `renderer/js/profile-ui.js` | 524 | Welcome overlay + профиль |
| `window.SBFriends` | `renderer/js/friends-ui.js` | 878 | Список друзей, чат, уведомления |
| `window.SBHotkeys` | `renderer/js/hotkeys.js` | 84 | Горячие клавиши |
| (глобальные) | `renderer/js/streaming.js` | 53 | PLATFORM_URLS, safeEncoder, formatBitrate |
| (глобальные) | `renderer/js/gl-renderer.js` | 624 | WebGL2 renderer |
| (глобальные) | `renderer/js/webrtc.js` | 631 | WebRTC P2P |
| (глобальные) | `renderer/js/coscene.js` | 403 | CoScene collaborative engine |
| (глобальные) | `renderer/js/rtmp-output.js` | 662 | RTMP streaming + recording |

### Запланированные модули (дальнейшая оптимизация):

| Модуль | Файл | ~Строк | Извлекаемые функции |
|---|---|---|---|
| — | `renderer/js/settings-ui.js` | ~400 | _populateSettingsModal, _persistSettings, настройки DOM wiring |

app.js останется ~3500 строк — инициализация, состояние `S`, стриминг, P2P, комнаты, `bind()`, renderSources, FX modal, WASAPI setup, _persistSettings.

### Порядок загрузки в index.html:

```
streaming.js → scene.js → audio.js → sources.js → ui.js → gl-renderer.js → webrtc.js → coscene.js → rtmp-output.js → app.js
(deferred: sounds.js, profile-ui.js, friends-ui.js, hotkeys.js)
```

**Правила для агентов:**
115. **Модульная разработка — ОБЯЗАТЕЛЬНА.** Новые функции добавляются в соответствующий модуль (`SBScene`, `SBAudio`, `SBSources`, `SBUi`), НЕ в `app.js`. Если модуль не существует — создай его.
116. **`app.js` владеет `S` и `D`.** Модули получают `S` и `D` как параметры. НЕ дублируй глобальное состояние.
117. **Backup перед каждым этапом рефакторинга.** `backups/pre-refactor-TIMESTAMP/`. Проверяй что бэкап полный (все файлы renderer/).
118. **Тесты после каждого шага.** `npm test` — 170+ тестов должны пройти. Если хоть один упал — откатись к бэкапу.
119. **Один модуль за сессию.** Не пытайся вынести scene + audio + ui одновременно. Один модуль → тесты → коммит.
120. **Функции-делегаты в app.js.** При извлечении функции в модуль, оставь в app.js wrapper: `function render(){ return SBScene.render(S,D,...); }`. Это гарантирует что все вызовы внутри app.js не сломаются. После проверки — wrapper можно убрать.
121. **scene.js — канонический источник для трансформаций.** `rotMat`, `localToWorld`, `worldToLocal`, `hitHandle`, `hitItem` — использовать через `SBScene.*`. НЕ дублируй математику.
122. **Проверяй себя дважды.** После каждого изменения: (1) просмотр измениённых строк, (2) `npm test`, (3) при ручном тесте — проверить что сцена рендерится, стрим работает, P2P подключается.

---

## 22. Выполнено (1.4.0-beta1 — 2026-05-06/07)

**P2P Co-stream — критичные багфиксы (источники + звук):**

Тестировали P2P комнату с другом в реальном времени. Выявлены и частично исправлены критичные баги:

**1. Двоение источников (FIXED):**
- `_onPeerTrack` в `app.js` вызывался **дважды** для одного `stream.id` — WebRTC отправляет отдельные `ontrack` события для video и audio треков, и каждый раз создавались дубликаты источников.
- **Фикс:** добавлен `S._handledPeerStreams` (Set) для дедупликации по `stream.id`. Повторный `ontrack` для того же stream только обновляет аудио-цепочку, не создаёт новые источники.

**2. Пиру отправлялся весь canvas вместо отдельных источников (FIXED):**
- `_addCombinedStreamToWebRTC` в `audio.js` отправлял `combinedStream` (canvas video + mixed audio) пиру — друг видел composited сцену целиком, не отдельные камеру/экран/микрофон.
- **Фикс:** вместо combinedStream теперь отправляются **оригинальные MediaStream каждого локального источника** (камера, экран, микрофон, desktop audio) индивидуально через `S.wrtc.addLocalStreamToAllPeers(src.stream)`.
- `_rebuildCombinedStream` больше не вызывает `_addCombinedStreamToWebRTC` — combinedStream используется только для RTMP/записи.
- Новый метод `_sendSourceStreamsToPeers()` вызывается при создании/подключении к комнате.
- `addVideoSource` и `addAudioSource` автоматически отправляют новый источник пиру при добавлении.

**3. CoScene msid binding не работал (PARTIALLY FIXED):**
- `src.add` через data-channel приходил **позже** чем `ontrack` (SDP exchange быстрее DC message) — `bindIncomingStream` в `coscene.js` не находил совпадения по msid.
- **Фикс:** добавлен grace period (1.5 сек) — если `src.add` не пришёл, создаётся fallback источник с оригинальным WebRTC stream.
- Snapshot handler теперь отправляет `msid: s.stream?s.stream.id:(s.msid||null)` — msid потока который пир видит в `ontrack` (тот же, что мы отправили).

**4. Звук друга не слышен (IN PROGRESS):**
- `addAudioSource` создавал peer-источник с `monitor:false` — `monitorGain.gain = 0` → друг не слышен в наушниках.
- **Фикс:** `monitor:isP` — peer-аудио автоматически включает мониторинг.
- `new MediaStream(stream.getAudioTracks())` в fallback **ломал аудио** — создавался новый MediaStream из треков, которые теряли связь с WebRTC декодером. **Фикс:** передаём оригинальный `stream` напрямую.
- Добавлена обработка `unmute` события на WebRTC треках — треки могут приходить в `muted=true`, и звук появляется только после unmute.
- Добавлено расширенное логирование: track state (readyState/muted/enabled) в `_onPeerTrack` и `_connectSource`.
- **Статус:** на fix4 источники работают корректно, звук ещё тестируется.

**5. Несколько "Микрофон друга" (PARTIALLY FIXED):**
- Друг шлёт desktop audio + mic как 2 отдельных потока — оба создавались как "Микрофон друга".
- **Частичный фикс:** fallback теперь проверяет `hasVideo` в stream для определения типа (desktop vs mic), но надёжное различение требует CoScene src.add с правильным `type`.

**S-объект — новые поля:**
- `S._handledPeerStreams` — Set<string> stream.id уже обработанных в `_onPeerTrack` (дедуп)
- `S._perSourceStreams` — Map<srcId, MediaStream> (зарезервировано)
- `S._wrtcPrevPerSource` — Map<srcId, MediaStream> последних отправленных пиру потоков

**`audio.js` — изменения:**
- `_addCombinedStreamToWebRTC()` — теперь отправляет индивидуальные `src.stream` каждого локального источника, не combinedStream
- `_rebuildCombinedStream()` — убран вызов `_addCombinedStreamToWebRTC()` — combinedStream только для RTMP
- `_connectSource()` — добавлено логирование track state для peer-источников

**`_wireTrackEndHandlers` — изменения:**
- Добавлены обработчики `unmute`/`mute` событий для peer-треков — при unmute аудио реконнектится

**Правила для агентов:**
123. **`S._handledPeerStreams` — дедупликация ontrack.** Никогда не убирай — без него создаются дубликаты источников при получении video+audio треков одного потока.
124. **Пиру отправляются индивидуальные потоки, НЕ combinedStream.** `combinedStream` (canvas + mixed audio) — только для RTMP/записи. Пир получает отдельные `src.stream` каждого локального источника через `_sendSourceStreamsToPeers()` и `addVideoSource`/`addAudioSource`.
125. **НЕ создавай `new MediaStream(stream.getTracks())` из WebRTC треков.** Это ломает связь с декодером — звук пропадает. Передавай оригинальный `stream` из `event.streams[0]` напрямую.
126. **Peer-audio: `monitor=isP` (true).** Без этого друг не слышен — `monitorGain.gain = 0`. Пользователь может toggлить монитор вручную.
127. **WebRTC треки могут приходить muted.** `_wireTrackEndHandlers` слушает `unmute` и реконнектит аудио-цепочку. НЕ удаляй эту обработку.
128. **CoScene msid binding — grace period 1.5с.** `src.add` через data-channel приходит позже чем `ontrack`. Без grace period трек теряется. НЕ уменьшай grace period ниже 1с.
129. **`_sendSourceStreamsToPeers()` вызывается при создании/подключении к комнате.** НЕ заменяй на `_addCombinedStreamToWebRTC()`.
130. **Звук друга — открытая проблема.** На fix4 (2026-05-07) источники работают корректно, но звук друга может не работать. Возможные причины: (1) WebRTC трек приходит muted и unmute не срабатывает, (2) `createMediaStreamSource` не подхватывает живой поток, (3) SDP renegotiate ломает аудио transceiver. Нужно продолжить диагностику с расширенным логированием.

---

## 23. Уроки P2P-сессии (2026-05-07 вечер) — ЗВУК ЗАРАБОТАЛ

**Главная новость: звук и картинка P2P работают!** Первый тест с другом на старом архиве (700 MB, без фиксов сессии) — камера и микрофон передавались корректно.

**Но есть проблемы при перезапуске/переподключении:**

### Проблема 1: `_userJoinedRoom` не устанавливался (CRITICAL, FIXED)
- В `createRoom()` строка `if(S.wrtc) S.wrtc._userJoinedRoom=true` стояла ДО `new WebRTCManager()` — `S.wrtc` был null, флаг не ставился.
- `handlePresenceSignal` игнорировал ВСЕ signaling-сообщения как «устаревшие» → SDP offer/answer не доставлялись → P2P не подключался.
- **Фикс:** перенёс `S.wrtc._userJoinedRoom=true` после `if(!S.wrtc)S.wrtc=new WebRTCManager();`.
- В `joinRoom()` флаг стоял правильно (после new WebRTCManager).

### Проблема 2: Источники не отправлялись пиру (CRITICAL, FIXED)
- `_sendSourceStreamsToPeers()` вызывался в `createRoom()` когда `peers=0` — бесполезно, пиров ещё нет.
- Когда друг подключался (`peer-joined` через `onStreamNotification`), PeerConnection создавался, но треки не добавлялись.
- **Фикс:** добавлен `onPeerConnectionsReady` callback в `WebRTCManager` — вызывается при `room-joined-server` и `peer-joined-server`, что позволяет `app.js` добавить треки и триггерить renegotiate.
- Убран `_sendSourceStreamsToPeers()` из `createRoom()` — теперь источники отправляются когда пиры реально подключаются.

### Проблема 3: Оба пира — initiator (glare) (CRITICAL, FIXED)
- В `joinRoom()`: `S.wrtc._createPeerConnection(pid, true)` — joiner тоже был initiator.
- Оба пира отправляли offer одновременно → SDP m-line mismatch → ошибка.
- **Фикс:** joiner теперь `isInitiator=false` + вызывает `_addTracksToPeersWithoutRenegotiate()` — добавляет треки, но НЕ триггерит renegotiate. Ждёт offer от создателя (initiator). При получении offer, `createAnswer` автоматически включает joiner's треки в SDP answer.

### Проблема 4: `_createPeerConnection` делал bare renegotiate без треков (FIXED)
- Когда `isInitiator && localStreams.size === 0`, вызывался `_renegotiate()` без треков → пустой SDP offer без m-lines для медиа.
- **Фикс:** убран bare renegotiate из `_createPeerConnection`. `_sendSourceStreamsToPeers()` теперь ВСЕГДА триггерит renegotiate (даже если 0 треков добавлено) — это нужно для data channel.

### Проблема 5: Перезапуск ломает подключение (OPEN)
- **Симптом:** первый заход в комнату — всё работает. Перезапуск приложения → повторный вход в ту же комнату → источники не появляются.
- **Вероятная причина:** при перезапуске Presence WS автоматически реконнектит и шлёт `room-joined-server` с ID пиров из предыдущей сессии. Но старые PeerConnection уже мертвы, а новые не создаются потому что `_userJoinedRoom=false` (пользователь не нажимал «Создать/Войти» в этом сеансе).
- **Нужно:** (1) сохранять roomCode в settings и восстанавливать при перезапуске, (2) автоматически переподключаться к комнате при старте если `roomCode` установлен, (3) очищать старые PeerConnection при отключении.

### Проблема 6: UI — контекстное меню, glassmorphism, resizable панели (DONE)
- **Контекстное меню чата:** правая кнопка → стеклянное прозрачное меню (copy/paste/cut/select all для input; copy/edit/delete для сообщений). z-index=10003.
- **Стеклянный стиль чат-панели:** `backdrop-filter: blur(20px)` + полупрозрачный фон.
- **Resizable sidebar:** drag-ручка слева от sidebar, ширина сохраняется в `S.settings.sidebarWidth`.
- **Resizable bottom panel:** drag-ручка сверху bottom panel, высота сохраняется в `S.settings.bottomPanelHeight`.

### Проблема 7: Сетевой индикатор "слабая сеть" (FIXED)
- `fetch` с `mode: 'no-cors'` не мог проверить реальный статус сервера — всегда «ошибка».
- **Фикс:** `mode: 'cors'` + `_failCount` (2+ подряд failures = «слабая сеть»).

### Проблема 8: Peer source не удаляется при удалении другом (FIXED)
- Когда друг удалял источник (камеру), WebRTC трек signal'ил `ended`, но локальный источник оставался в UI.
- **Фикс:** `_wireTrackEndHandlers` теперь проверяет `ended` и `removetrack` для peer-источников → `rmSrc(src.id, {fromRemote:true})`.

### Новый код — `_addTracksToPeersWithoutRenegotiate()`
```javascript
function _addTracksToPeersWithoutRenegotiate(){
  // Add local source tracks to all peers but DON'T trigger renegotiate.
  // Used when joining a room — the initiator will send an offer,
  // and our tracks will be included in the SDP answer automatically.
  if(!S.wrtc) return;
  for(const [pid,pc] of S.wrtc.peers){
    try{
      const existingTrackIds=new Set(pc.pc.getSenders().filter(s=>s.track).map(s=>s.track.id));
      let added=0;
      for(const src of S.srcs){
        if(src.isPeer||!src.stream) continue;
        const tracks=src.stream.getTracks();
        if(!tracks.length) continue;
        for(const track of tracks){
          if(existingTrackIds.has(track.id)) continue;
          try{ pc.pc.addTrack(track,src.stream); added++; }catch(e){}
        }
        if(!S._wrtcPrevPerSource) S._wrtcPrevPerSource=new Map();
        S._wrtcPrevPerSource.set(src.id,src.stream);
      }
    }catch(e){}
  }
}
```

### Новый callback — `onPeerConnectionsReady`
В `webrtc.js`: при `room-joined-server` и `peer-joined-server` вызывается `this.onPeerConnectionsReady(peerIds)`.
В `app.js`: `S.wrtc.onPeerConnectionsReady` → `ensureAudioCtx(); _rebuildCombinedStream(); _sendSourceStreamsToPeers();`

### Zip-архив для друга
- **Правильный способ:** `npx electron-builder --win --dir --config.win.signAndEditExecutable=false` → `dist/win-unpacked/StreamBro.exe` → zip.
- **НЕправильный способ** (была ошибка): копировать исходники + node_modules вручную → структура ломается, 700 MB вместо 234 MB.
- Всегда собирать через `electron-builder` — это даёт настоящий `.exe` + правильную структуру.

**Правила для агентов:**
131. **`_userJoinedRoom=true` — ОБЯЗАТЕЛЬНО после `new WebRTCManager()`.** Если поставить до — `S.wrtc` null, флаг не установится, `handlePresenceSignal` заблокирует ВСЕ signaling-сообщения.
132. **Joiner = `isInitiator=false`.** Создатель комнаты (createRoom) — initiator. Присоединившийся (joinRoom) — НЕ initiator. Joiner добавляет треки через `_addTracksToPeersWithoutRenegotiate()` и ждёт offer от создателя.
133. **NEVER вызывать `_sendSourceStreamsToPeers()` в `createRoom()`.** Пиров ещё нет. Источники отправляются через `onPeerConnectionsReady` callback когда пиры реально подключаются.
134. **`_sendSourceStreamsToPeers()` ВСЕГДА триггерит renegotiate.** Даже если 0 треков добавлено — renegotiate нужен для data channel (CoScene). Убран bare renegotiate из `_createPeerConnection`.
135. **Перезапуск ломает P2P — ОТКРЫТАЯ ПРОБЛЕМА.** Нужно: (1) сохранять roomCode в settings, (2) при старте проверять и переподключаться, (3) очищать старые PeerConnection. Пока workaround: пользователь должен создавать новую комнату после перезапуска.
136. **Zip-архив — ТОЛЬКО через `electron-builder`.** `npx electron-builder --win --dir --config.win.signAndEditExecutable=false` → zip `dist/win-unpacked/`. НЕ копировать node_modules вручную. Имя файла ДОЛЖНО включать версию и номер билда: `StreamBro-VERSION-buildN-portable.zip` (например `StreamBro-1.4.0-beta2-build1-portable.zip`). Номер билда инкрементируется на каждый zip.
137. **Peer source удаление — `rmSrc(sid, {fromRemote:true})`.** `_wireTrackEndHandlers` слушает `ended` и `removetrack` для peer-источников. `{fromRemote:true}` предотвращает re-broadcast (анти-эхо). `{fromRecreate:true}` — при пересоздании WASAPI source (device change), не бродкастить удаление.
138. **Peer desktop audio мониторинг.** `_connectSource` в `audio.js`: peer desktop audio МОНИТОРИТСЯ (друг слышен), peer mic НЕ мониториится если WASAPI активен (feedback prevention: mic→speakers→WASAPI→echo). `_updatePeerMonitorRouting()` вызывается при изменении WASAPI state. Локальный desktop audio НЕ мониториится (избегаем feedback).
139. **Контекстное меню чата — glassmorphism, z-index=10003.** Блокирует `document.oncontextmenu` глобально, но разрешает внутри `.friend-chat-panel`. Элементы `<div>`, не `<label>`.
140. **Resizable sidebar/bottom — CSS variables `--sidebar-w` / `--bottom-h`.** Drag handles в `index.html`. Значения сохраняются в `S.settings.sidebarWidth` / `S.settings.bottomPanelHeight` через `_scheduleSettingsSave()`.
141. **WASAPI desktop audio = `addAudioSource()`.** Desktop audio source ДОЛЖЕН создаваться через `addAudioSource('desktop',...)`, а НЕ через `S.srcs.push()`. Прямой push пропускает: (1) WebRTC `addTrack` → трек не отправляется пиру, (2) CoScene `src.add` → друг не видит источник, (3) `S.wrtc.localStreams.add()` → новые пиры не получают replay.
142. **`_applyRemoteSrcAdd` — msid dedup.** Если fallback уже создал источник с этим `msid` (пока ждали CoScene `src.add`), нужно обновить `gid`/`name`/`type` существующего источника вместо создания дубликата. Без этого появляются два "Микрофон друга" — один рабочий, один мёртвый.
143. **`_applyRemoteSrcAdd` — НЕ создавать source с пустым `new MediaStream()`.** Если pending streams не найдены (трек ещё не пришёл), stash'им src.add в `_pendingSrcByMsid` и ждём `ontrack`. Пустой MediaStream = мёртвый источник без звука.
144. **Renegotiate ОБЯЗАТЕЛЕН после добавления треков.** `_addTracksToPeersWithoutRenegotiate()` переименован и теперь триггерит renegotiate с задержкой 500ms (через `_scheduleRenegotiate`). Без renegotiate SDP не обновляется → треки не передаются → нет видео/аудио → нет DC → нет CoScene. Это была корневая причина "источники не появляются".
145. **Joiner тоже renegotiate.** Раньше joiner НЕ триггерил renegotiate (ждал offer от initiator). Но при reconnect оба — joiner, и никто не шлёт offer. Теперь `joinRoom()` вызывает `_sendSourceStreamsToPeers()` (с renegotiate). Glare-safe renegotiate (polite/impolite pattern) предотвращает двойные offer'ы.
146. **Auto-rejoin комнаты.** `S.settings.p2p.roomCode` сохраняется при create/join, очищается при leave. `_autoRejoinRoom()` вызывается при старте после Presence WS connect. Проверяет что комната ACTIVE, затем вызывает `joinRoom()`. Settings version = 3 (p2p block).
147. **`_handledPeerStreams` чистится при `leaveCurrentRoom()`.** Иначе при повторном подключении к комнате старые stream.id блокируют новые ontrack события. Также чистится при `rmSrc()` (через `msid`).
148. **`removetrack` НЕ удаляет peer-source мгновенно.** При renegotiate WebRTC временно удаляет все треки и добавляет новые (с другим `stream.id`). Мгновенное удаление ломает аудио-цепочку. Теперь проверка: если от этого пира уже есть другие источники — старый удаляется сразу. Если нет — grace period 8с. См. правило 158.
149. **Peer mic ВСЕГДА мониториится, но с ограничением громкости при активном WASAPI.** `monitor=true` для peer mic/desktop. Если WASAPI активен и источник = peer mic → `monitorGain = Math.min(src.vol, 0.5)` (предотвращает feedback: mic→speakers→WASAPI→echo). `_updatePeerMonitorRouting()` и `_updateGain()` учитывают это.
150. **`_addTracksToPeersWithoutRenegotiate` УДАЛЁН.** Функция больше не существует. `_sendSourceStreamsToPeers()` — единственный способ добавить треки пирам.
151. **`onPresenceReconnect` — ручной reconnect.** При потере Presence WS: (1) закрыть все старые PeerConnection, (2) удалить peer-источники, (3) re-join через `roomsJoin`, (4) создать новые PeerConnection с `isInitiator=true`, (5) `_sendSourceStreamsToPeers()`. Сервер НЕ шлёт `room-joined-server`.
152. **`_createPeerConnection` — закрывает старый PC.** Если PeerConnection для данного peerId уже существует, он закрывается перед созданием нового. Без этого reconnect создаёт «зомби» PC.
153. **JOINER НЕ ДОЛЖЕН ВЫЗЫВАТЬ `addTrack()` ДО ПОЛУЧЕНИЯ OFFER'А.** Это КРИТИЧНОЕ правило WebRTC. Каждый `addTrack()` создаёт новый transceiver в PeerConnection. Когда приходит offer от initiator, `setRemoteDescription(offer)` создаёт СВОИ transceivers из m-lines. Если joiner уже добавил треки через `addTrack()`, получается `m-lines < transceivers` — треки joiner'а отправляются через «сиротские» transceivers, которые не соответствуют m-lines в SDP, и данные НЕ доходят до initiator'а. Это была корневая причина «друг не слышит меня» на протяжении beta1–beta6.
154. **Правильный порядок для joiner'а:** (1) stash'ить свои MediaStream'ы в `pc._pendingLocalStreams`, (2) ждать offer от initiator, (3) `setRemoteDescription(offer)` — создаёт transceivers из m-lines offer'а, (4) `_attachLocalTracksToTransceivers()` — присоединить свои треки к созданным transceivers через `sender.replaceTrack()`, (5) `createAnswer()` — answer включает треки joiner'а. См. `_sendSourceStreamsToPeers()` и `_attachLocalTracksToTransceivers()`.
155. **`_attachLocalTracksToTransceivers()` — единственный правильный способ добавить треки joiner'ом.** Метод вызывается ПОСЛЕ `setRemoteDescription(offer)` в `handleSignal()`. Для каждого pending track ищет transceiver с подходящим `mid` и `kind`, и вызывает `sender.replaceTrack(track)`. Если нет подходящего transceiver — fallback на `addTrack()` (создаёт новый, нужен renegotiate).
156. **`_p2pLog()` — ВСЕГДА логирует, не только в dev.** Глобальная функция (инициализируется в `streaming.js`, переопределяется в `app.js`). Пишет в `window._sbP2pLog[]` (до 5000 записей). `_p2pLog` доступна из `webrtc.js`, `audio.js`, `app.js`. Кнопка «📋 Лог» в верхнем баре → `_exportP2pLog()` → IPC `save-p2p-log` → файл на рабочем столе. Используется для удалённой диагностики P2P проблем у пользователей.
157. **`streaming.js` — первый скрипт, создаёт заглушку `_p2pLog`.** `webrtc.js` и `audio.js` загружаются до `app.js` и вызывают `_p2pLog()`. Без заглушки в `streaming.js` будет `_p2pLog is not defined`.
158. **`removetrack` grace period = 8с + проверка `samePeerSrcs`.** При `removetrack` на peer stream: если от этого пира уже есть другие источники (`S.srcs.filter(s=>s.isPeer&&s.peerId===src.peerId&&s.id!==src.id)`) — старый источник удаляется сразу (он заменён новым). Если нет — таймер 8с, потом перепроверка. Это связано с тем, что renegotiate создаёт НОВЫЙ stream с другим `stream.id`, а старый stream пустеет. Grace period даёт время новому `onPeerTrack` создать fallback-источник.

---

## 24. Выполнено (1.4.0-beta3–beta5 — 2026-05-08)

**P2P Co-stream — глубокий рефакторинг и багфиксы (3 итерации):**

### Beta3 — Renegotiate + Auto-rejoin + Desktop Audio

- **`_addTracksToPeersWithoutRenegotiate` → renegotiate обязателен.** Функция добавляла треки но НЕ триггерила renegotiate → SDP не обновлялся → треки не передавались. Переименована, теперь триггерит renegotiate с задержкой 500ms.
- **`_applyRemoteSrcAdd` — msid dedup + no-empty-stream.** Fallback-источник с совпадающим msid обновляется вместо создания дубликата. Пустой `new MediaStream()` больше не создаётся — src.add stash'ится до прихода ontrack.
- **WASAPI desktop audio = `addAudioSource()`.** Вместо прямого `S.srcs.push()` — корректная интеграция в WebRTC (addTrack) + CoScene (src.add broadcast) + localStreams replay.
- **Auto-rejoin комнаты.** `S.settings.p2p.roomCode` сохраняется в settings (version 3). `_autoRejoinRoom()` при старте — проверяет ACTIVE комнату, вызывает `joinRoom()`.
- **`_handledPeerStreams` cleanup.** Чистится при `leaveCurrentRoom()` — иначе старые stream.id блокируют новые ontrack.
- **`joinRoom()` — isInitiator + renegotiate.** Joiner тоже триггерит renegotiate (glare-safe polite/impolite pattern).

### Beta4 — Peer Audio Monitoring + Reconnect Fix

- **Peer mic мониторинг — ВСЕГДА включён.** Раньше peer mic НЕ мониториился при активном WASAPI — друг не был слышен. Теперь `monitor=true` всегда, но при WASAPI+peerMic → `gain = Math.min(vol, 0.5)` (feedback prevention).
- **`_updatePeerMonitorRouting()`** — новый метод в `audio.js`, вызывается при изменении WASAPI state. Динамически переключает monitor gain.
- **`_updateGain()`** — учитывает peerMic+wasapi condition для monitor volume.
- **`_createPeerConnection` — close old PC first.** Закрывает существующий PeerConnection перед созданием нового (reconnect).
- **`onPresenceReconnect`** — ручной reconnect при потере WS: очистка старых PC/источников → `roomsJoin` → новые PC (`isInitiator=true`) → `_sendSourceStreamsToPeers()`.
- **`onStreamNotification` — `peer-joined` = `isInitiator=false`.** Когда новый пиp подключается к комнате, его PeerConnection НЕ initiator — ждёт offer от существующих участников.
- **Extensive P2P logging** — `_signalingSend`, `handleSignal`, `_onPeerTrack` логируют шаги renegotiate/SDP/track state.

### Beta5 — removetrack Grace Period (критичный фикс)

- **`removetrack` НЕ удаляет peer-source мгновенно.** При renegotiate WebRTC временно удаляет все треки (`removetrack`), потом добавляет новые. Мгновенный `rmSrc()` ломал аудио-цепочку — друг терял микрофон/видео. Теперь 3-секундный grace period через `setTimeout`: если за 3с появились живые треки — источник сохраняется.
- **Beta4 логи показали:** `removetrack on peer stream: Микрофон друга audio` → `All peer tracks removed, deleting source: Микрофон друга` → мгновенное удаление при renegotiate. Это была корневая причина потери звука/видео при добавлении новых источников.
- **`_addTracksToPeersWithoutRenegotiate` полностью удалён.** `_sendSourceStreamsToPeers()` — единственный путь, всегда с renegotiate.

**Settings schema:**
- `SETTINGS_VERSION` = 3
- `p2p: { roomCode: null }` — автосохранение roomCode для auto-rejoin

**Тесты:**
- `test/settings.test.js` — обновлён для SETTINGS_VERSION=3

**Билды:**
- `StreamBro-1.4.0-beta3-portable.zip` (234 MB) — renegotiate + auto-rejoin + WASAPI fix
- `StreamBro-1.4.0-beta4-portable.zip` (234 MB) — peer audio monitoring + reconnect
- `StreamBro-1.4.0-beta5-portable.zip` (234 MB) — removetrack grace period

**Открытые проблемы:**
- P2P: входящие треки от друга приходят `muted:true` — видео/аудио может не воспроизводиться сразу, нужен unmute event
- P2P: множественный renegotiate при добавлении источников по одному — может дестабилизировать соединение (лучше добавить все источники разом)
- P2P: переименование/удаление комнаты после перезапуска — UI может не видеть комнату если auto-rejoin не сработал

---

## 25. Выполнено (1.4.0-beta6–beta7 — 2026-05-08)

### Beta6 — P2P Debug Logging + removetrack Grace Period Fix

- **`_p2pLog()` — глобальная функция P2P-логирования.** Работает ВСЕГДА, не только в `__sbDev`. Пишет в `window._sbP2pLog[]` (до 5000 записей, автообрезка). Заглушка создаётся в `streaming.js` (первый загружаемый скрипт), основная реализация — в `app.js`. Доступна из `webrtc.js`, `audio.js`, `app.js`.
- **Кнопка «📋 Лог»** в верхнем баре (рядом с «Покинуть»). `_exportP2pLog()` → IPC `save-p2p-log` → файл `StreamBro-P2P-log-YYYY-MM-DD.txt` на рабочем столе.
- **IPC `save-p2p-log`** в `main.js` — записывает текст в файл через `fs.writeFileSync`, открывает папку через `shell.showItemInFolder`.
- **`preload.js` — `saveP2pLog(text)`** добавлен в `electronAPI`.
- **Все `[P2P]`, `[WebRTC]`, `[Signaling]` логи** заменены с `if(window.__sbDev) console.log` на `_p2pLog()`. `_p2pLog` принимает одну строку (конкатенация, не несколько аргументов).
- **`[Audio]` логи** — `_connectSource`, `_rebuildCombinedStream`, monitor routing дублируются в `_p2pLog` через `typeof _p2pLog==='function'` guard (audio.js загружается отдельно).
- **WebRTC логирование:** `ontrack` (stream id, track state, muted), `onconnectionstatechange`, `onnegotiationneeded`, `createAnswer` m-lines, ICE state, addLocalStream details.
- **`removetrack` grace period увеличен с 3с до 8с** + добавлена проверка `samePeerSrcs` — если от пира уже есть другие источники, старый удаляется сразу.

### Beta7 — Transceiver Mismatch Fix (КРИТИЧНЫЙ ФИКС)

**Диагностика через P2P-логи:**

Пользователь и друг обменялись лог-файлами через кнопку «📋 Лог». Анализ показал:

| | Пользователь (initiator) | Друг (joiner) |
|---|---|---|
| `_sendSourceStreamsToPeers` | Batch-added 1 track | **Batch-added 3 tracks** |
| Первый offer | m-lines=2, senders=1 | — |
| Первый answer | — | **m-lines=2, transceivers=3, senders=3** |
| Второй offer | m-lines=3, senders=2 | — |
| Второй answer | — | m-lines=3, transceivers=3, senders=3 |

**Корень проблемы: `m-lines < transceivers` у joiner'а.**

Друг (joiner) вызывал `addTrack()` для всех своих треков ДО получения offer'а. Каждый `addTrack()` создавал новый transceiver в его PeerConnection. Когда приходил offer с m-lines=2 (audio + data channel), `setRemoteDescription(offer)` создавала ещё transceivers для этих m-lines. Итого: 3 transceivers (от addTrack) + 2 от offer, но SDP answer содержал только m-lines=2 — треки друга отправлялись через «сиротские» transceivers, которые не были связаны с m-lines в SDP, и данные **не доходили** до initiator'а.

Именно поэтому: (1) пользователь слышал друга — треки от initiator приходили правильно через ontrack, (2) друг НЕ слышал пользователя — треки joiner'а уходили в никуда.

**Fix:**

- **`_sendSourceStreamsToPeers()` — joiner НЕ вызывает `addTrack()`.** Вместо этого stash'ит свои MediaStream'ы в `pc._pendingLocalStreams` и ждёт offer от initiator.
- **`_attachLocalTracksToTransceivers()`** — новый метод в `PeerConnection`. Вызывается ПОСЛЕ `setRemoteDescription(offer)` в `handleSignal()`. Для каждого pending track: ищет transceiver с подходящим kind, вызывает `sender.replaceTrack(track)`. Если нет подходящего — fallback на `addTrack()` (создаёт новый transceiver).
- **Fallback 5с:** если offer не приходит за 5 секунд (reconnect), joiner добавляет треки через `addTrack()` и триггерит renegotiate.
- **`_addSourceToPeers()` — joiner stash'ит.** Если источник добавляется во время ожидания offer'а (`pc._pendingLocalStreams`), он добавляется в pending, не через `addTrack`.

**Билды:**
- `StreamBro-1.4.0-beta6-portable.zip` (234 MB) — P2P logging + removetrack fix
- `StreamBro-1.4.0-beta7-portable.zip` (234 MB) — transceiver mismatch fix

**Закрытые проблемы:**
- ~~P2P: друг не слышит пользователя~~ — корень: transceiver mismatch при addTrack до offer
- ~~P2P: debug-логи не видны в production~~ — `_p2pLog()` работает всегда, экспорт в файл

---

### Beta8 — msid-preserve + Renegotiate-after-Fallback + Rebind safety net (2026-05-09)

**Диагностика по разбору кода после ревью:**

Beta7 решил часть проблемы (joiner перестал создавать «сиротские» transceiver-ы ДО offer'а), но оставил две скрытые баги в обратном направлении (creator → joiner):

**Корень проблемы 1: `replaceTrack` не сохраняет msid.**

В `_attachLocalTracksToTransceivers()` мы вызывали `sender.replaceTrack(track)` для прикрепления локального трека к transceiver-у созданному из offer'а. Но `replaceTrack` ТОЛЬКО подменяет дорожку — он НЕ обновляет связанные с sender-ом MediaStream'ы. Поэтому в outgoing answer SDP попадал произвольный msid (или пустой), который НЕ совпадал с `src.stream.id` из CoScene-snapshot.

Последствия для friend (offerer):
1. `ontrack` приходил со stream.id=`X` (произвольный от Chromium).
2. CoScene `bindIncomingStream(msid='X')` не находил совпадения → стэшил трек.
3. Через 2.5с grace timer срабатывал fallback → создавал источник с эвристикой имени **«Микрофон друга»**.
4. Позже src.add по data-channel приходил с реальным msid=`Y` → dedup по msid НЕ матчил (X≠Y) → создавался **второй источник** «Звук рабочего стола» (отображалось как «Звук друга»).
5. Итого: дубликаты в микшере. Один (с правильным msid) работал, второй (со старым msid) — «мёртвый», но мешал.

**Корень проблемы 2: addTrack-fallback без renegotiate.**

Если у user'а БОЛЬШЕ источников чем m-lines в offer'е (типичный случай: creator имеет камеру + mic + WASAPI desktop = 3 трека, joiner шлёт offer на свою камеру = 2 m-line), `_attachLocalTracksToTransceivers` после исчерпания transceiver-ов вызывает `pc.addTrack(track, stream)` как fallback. Это создаёт НОВЫЕ transceiver-ы, но они НЕ попадают в SDP answer (m-lines в answer должны соответствовать m-lines в offer). Без follow-up renegotiate эти треки **остаются осиротевшими навсегда** — друг их не получает.

Именно поэтому: «друг не слышит мой WASAPI desktop / не слышит мой микрофон» — у пользователя их 3, а у друга в offer'е только 2 m-line.

**Это же объясняет issue «добавил источники → вошёл в комнату → не видны»:** друг шлёт offer с 0/1/2 m-line, ваши 3 трека частично уходят в fallback addTrack, renegotiate не срабатывает. Когда вы ВРУЧНУЮ удаляете и добавляете источник — `_addSourceToPeers()` корректно вызывает `addTrack + _scheduleRenegotiate()`, и тогда трек доходит.

**Fix:**

- **`sender.setStreams([stream])` после `replaceTrack(track)`** — сохраняет msid в outgoing SDP. Теперь answer SDP содержит правильный `a=msid:<src.stream.id>` line, friend `ontrack` получает stream.id совпадающий с CoScene snapshot → биндинг работает с первой попытки → нет дубликатов.
- **`tr.direction='sendrecv'`** если transceiver был `recvonly` или `inactive` — гарантирует что наш трек реально потечёт.
- **`usedFallback` флаг + `_scheduleRenegotiate()`** в конце `_attachLocalTracksToTransceivers` — если хоть один трек ушёл в addTrack-fallback, через 250ms (после того как answer ушёл и signalingState='stable') запускаем НАШ offer, который добавляет недостающие m-lines. Polite peer pattern в `handleSignal` уже реализован, glare с другим offer'ом не будет.
- **`usedTransceivers` WeakSet** — гарантия что один transceiver не будет использован дважды для двух наших треков одного kind (если у friend'а только 1 audio m-line, а у нас 2 audio source'а — второй уйдёт в addTrack-fallback, не подменит первый).

**Safety net против дублирования (rebind):**

Добавлен в `_onPeerTrack` блок проверки до CoScene-binding: если `ontrack` приходит с НОВЫМ stream.id, но у нас уже есть peer-источник от того же `peerId` с тем же `kind` и его старый stream имеет 0 живых треков этого kind — НЕ создаём дубликат, а **переносим источник на новый stream** (`ps.stream=stream; ps.msid=stream.id`) и переподключаем аудио-цепочку. Это закрывает кейсы когда msid всё-же поменялся (например, друг сделал `removeTrack + addTrack` для того же логического источника).

**Правила для агентов:**
159. **`sender.setStreams([stream])` ПОСЛЕ `replaceTrack(track)` — обязательно.** Без него msid в outgoing SDP не совпадает с `src.stream.id` который мы транслируем по data-channel в CoScene snapshot. Friend'у приходит ontrack с произвольным stream.id → fallback создаёт левый источник → потом src.add создаёт второй («Микрофон друга» + «Звук друга»). НЕ удаляй `setStreams` из `_attachLocalTracksToTransceivers`.
160. **`_attachLocalTracksToTransceivers` ОБЯЗАН триггерить renegotiate если был fallback.** Если у нас больше треков чем m-lines в offer'е, лишние уходят в `pc.addTrack(track, stream)` — новые transceiver-ы НЕ попадают в answer. Без follow-up `_scheduleRenegotiate()` эти треки осиротевают и НИКОГДА не доходят до peer'а. Это была корневая причина «друг не слышит мой mic/desktop» при асимметричном кол-ве источников.
161. **`tr.direction='sendrecv'` после `replaceTrack`.** Если offer пришёл с recvonly transceiver'ом (peer не ожидал что мы тоже шлём), нужно явно поднять направление до `sendrecv`, иначе наш трек не потечёт даже если sender есть. setStreams обычно делает это автоматически, но защита явная.
162. **Rebind safety net в `_onPeerTrack`.** Когда `ontrack` приходит с новым stream.id и у нас уже есть peer-источник от того же `peerId+kind` с мёртвым старым stream'ом — НЕ создаём fallback дубликат, переносим существующий источник на новый stream через `ps.stream=stream; ps.msid=stream.id; _disconnectSource; _connectSource;`. Это страхует от случаев когда msid всё-же изменился (несмотря на setStreams) при removeTrack+addTrack или re-renegotiate.
163. **`usedTransceivers` WeakSet в `_attachLocalTracksToTransceivers`.** Гарантирует что один transceiver не будет использован для двух наших треков одного kind. Если у нас 2 audio source'а а у peer'а 1 audio m-line — первый идёт в replaceTrack (с setStreams), второй в addTrack-fallback (с последующим renegotiate). НЕ убирай эту проверку — иначе второй replaceTrack перебьёт первый и трек первого источника пропадёт.

**Билды:**
- `StreamBro-1.4.0-beta8-portable.zip` (234 MB) — msid preservation + renegotiate after fallback + rebind safety net

**Закрытые проблемы:**
- ~~Друг не слышит мой mic / WASAPI desktop (асимметричное кол-во источников)~~ — fixed by setStreams + renegotiate after fallback
- ~~Дубликат источников друга в микшере «Микрофон друга» + «Звук друга»~~ — fixed by msid preservation
- ~~Источники не доходят если добавлены ДО входа в комнату~~ — то же самое: msid + renegotiate fix покрывает кейс

---

## 27. Выполнено (1.4.0-beta9 — 2026-05-09) — РЕГРЕССИЯ beta8 ИСПРАВЛЕНА

**Симптом beta8 (по логам пользователя):**

После beta8 у пользователя пропали И картинка И звук от друга в обе стороны. Логи показали критичный баг **в моих собственных правках**:

```
[17:47:49.536] [WebRTC] Attached local track video:... to transceiver mid=0 stream=83311cd7...
[17:47:49.536] [WebRTC] WARN: replaceTrack failed for mid=0: Cannot read properties of undefined (reading 'has')
[17:47:49.537] [WebRTC] WARN: addTrack fallback failed: Sender already exists for track ...
...
[17:47:49.539] [WebRTC] Attached 0/3 local tracks to transceivers, fallbackUsed=false
```

И на стороне инициатора:
```
[17:47:49.158] [WebRTC] ontrack: peer=... stream=null track=video:... readyState=live muted=true streams=0
[17:47:49.158] [WebRTC] ontrack: peer=... stream=null track=audio:... readyState=live muted=true streams=0
[17:47:49.159] [WebRTC] ontrack: peer=... stream=null track=audio:... readyState=live muted=true streams=0
```

**Root causes:**

1. **Сломанная ссылка `this.localStreams.has(stream)`** в `_attachLocalTracksToTransceivers`. `this` это `PeerConnection`, у которого НЕТ свойства `localStreams` — это есть только на `WebRTCManager`. Эта строка существовала ещё в beta7 (легаси), но в beta7 цикл проходил только один раз и не заметили. В beta8 я добавил setStreams ПЕРЕД этой строкой и она стала throwать на КАЖДОЙ итерации:
   - `replaceTrack(track)` успевает в Chrome (sender реально привязал трек),
   - `setStreams([stream])` успевает,
   - `tr.direction='sendrecv'` успевает,
   - `_p2pLog('Attached…')` успевает,
   - `this.localStreams.has(stream)` → **TypeError: Cannot read properties of undefined**.
   - catch ловит → `found=false; attached не инкрементируется`.
   - Цикл идёт на СЛЕДУЮЩИЙ transceiver того же kind → тот же track replaceTrack-ится туда → ломает первый → каскад.
   - Финальное состояние senders: каша (на mid=1 и mid=2 один и тот же desktop-audio, mic перезаписан).

2. **`setStreams` НЕ пропагирует msid в немедленный `createAnswer` SDP в Chrome 134**. setStreams помечает `[[NeedsRenegotiation]]` для следующего createOffer, но текущий answer уходит без `a=msid` → friend'у `ontrack` приходит с `event.streams=[]` → раннее `return` в `_onPeerTrack` → источник вообще не создаётся.

**Fix в beta9:**

Полностью переписан `_attachLocalTracksToTransceivers` — переход с `replaceTrack`+`setStreams` на канонический `pc.addTrack(track, stream)`:

```javascript
_attachLocalTracksToTransceivers() {
  if (!this._pendingLocalStreams || !this._pendingLocalStreams.length) return;
  const streams = this._pendingLocalStreams;
  this._pendingLocalStreams = null;
  const existingTrackIds = new Set();
  for (const s of this.pc.getSenders()) {
    if (s.track) existingTrackIds.add(s.track.id);
  }
  let added = 0;
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      if (existingTrackIds.has(track.id)) continue;
      try {
        const sender = this.pc.addTrack(track, stream);
        existingTrackIds.add(track.id);
        this._tuneSender(sender, track.kind);
        added++;
      } catch (e) {
        _p2pLog('[WebRTC] WARN: addTrack failed: '+e.message);
      }
    }
  }
  if (added > 0) {
    this._needsRenegotiate = true;
    this._scheduleRenegotiate();
  }
}
```

**Почему это работает:**
- `pc.addTrack(track, stream)` — канонический API. Второй аргумент `stream` ассоциирует sender с MediaStream → msid в SDP проставляется автоматически и КОРРЕКТНО.
- Chromium unified-plan **переиспользует** существующий recvonly transceiver (созданный из offer'а) если у его sender'а нет track'а и direction позволяет send. → m-lines в answer-е совпадают с offer'ом, msid правильный.
- Если у нас БОЛЬШЕ треков чем m-lines в offer'е (наш WASAPI desktop был добавлен после receiver'а offer'а) — addTrack создаёт новый transceiver. Он НЕ попадает в текущий answer (m-lines must match offer), но `_scheduleRenegotiate()` через 250ms отправит наш offer с дополнительной m-line → peer получит трек.
- Никаких throwов в цикле — нет каскадных перезаписей senders'ов.

**Правила для агентов:**

164. **НИКОГДА не используй `this.localStreams` в методах `PeerConnection`.** Это поле есть только на `WebRTCManager`. PeerConnection имеет `this.localStream` (singular) для одного backwards-compat поля, но не Set. Если нужно отслеживать MediaStream'ы на уровне peer connection — добавь явное поле в constructor и обновляй его явно.
165. **`pc.addTrack(track, stream)` в `_attachLocalTracksToTransceivers` — канонический способ.** Не `replaceTrack`+`setStreams`. setStreams в Chrome 134 не пропагирует msid в немедленный createAnswer SDP — только в следующий createOffer/createAnswer. addTrack(track, stream) делает это атомарно и корректно.
166. **Always `_scheduleRenegotiate()` если `added > 0`.** Если addTrack переиспользовал существующий transceiver — renegotiate безвредный no-op (signalingState check предотвратит double-offer). Если addTrack создал новый transceiver — renegotiate ОБЯЗАТЕЛЕН, иначе новая m-line никогда не отправится peer'у.
167. **Бэкап перед изменениями WebRTC negotiation logic.** Любая ошибка в `_attachLocalTracksToTransceivers` или `handleSignal` ломает P2P целиком (картинка И звук в обе стороны). Перед правками всегда `cp renderer/js/webrtc.js backups/webrtc-before-NAME.js`.
168. **Запусти `npm test` после правок WebRTC.** Хотя основной P2P-flow тестируется только runtime'ом, smoke-тесты проверяют структуру signaling-сообщений и базовую логику. Если они падают — скорее всего ты сломал и runtime тоже.

**Билды:**
- `StreamBro-1.4.0-beta9-portable.zip` (234 MB) — критичный фикс регрессии beta8
- `StreamBro-1.4.0-beta9-build3-portable.zip` (234 MB) — `queueMicrotask` fix для CoScene initiator DC

**Открытые проблемы:**
- P2P: входящие треки от друга приходят `muted:true` — видео может не отображаться сразу (нужно ждать unmute event)
- P2P: если оба пользователя одновременно создают комнату (race), fallback через 5с может создать дублирующие transceivers
- P2P: auto-rejoin после перезапуска — комната может быть уже не ACTIVE

---

## 26. Выполнено (1.4.0-beta10 — 2026-05-09)

**P2P диагностика — анализ 5 логов сессии 2026-05-08:**

Пользователь и друг протестировали 2 сессии. Сессия 1 (пользователь = initiator) — работала идеально. Сессия 2 (друг = initiator) — оба получили `Grace expired, fallback` → "Микрофон друга" / "Звук друга".

**Root cause сессии 2:**

Друг запускал СТАРЫЙ build (`beta9` без `build3`). В `_wireDataChannel`, OLD код:
```js
// OLD (без queueMicrotask):
if (this.onDataChannel) {
    this.onDataChannel(dc, this.peerId);  // ← fires synchronously
}
```
Вызов происходит СИНХРОННО внутри конструктора `PeerConnection`, ДО того как менеджер устанавливает `pc.onDataChannel`. Результат: `attachChannel` никогда не вызывается для DC созданного INITIATOR'ом. CoScene на стороне друга не может ни отправить, ни получить snapshot. Оба получают fallback с неверными именами.

**Почему сессия 1 работала:** Друг был JOINER → `ondatachannel` приходит асинхронно после setRemoteDescription → к тому моменту `pc.onDataChannel` уже установлен → `attachChannel` работает даже без `queueMicrotask`.

**Вывод из диагностики:**
- CoScene snapshot передаётся корректно ЕСЛИ оба имеют `build3+`
- Трек-передача (audio/video) работает правильно: m-lines=4, transceivers=3, senders=3, added 3/3
- Треки приходят с `muted:true` но `unmute` event работает — аудио восстанавливается

**Изменения в 1.4.0-beta10:**
- Только версионный bump (package.json, log header) чтобы обе стороны могли идентифицировать одинаковую сборку

**Правила для агентов:**
169. **ОБЯЗАТЕЛЬНО оба пира должны иметь одинаковый build с `queueMicrotask` fix.** Без этого сторона где пир является INITIATOR (создаёт комнату) не вызывает `attachChannel` → CoScene snapshot не работает → неверные имена источников. Проверяй версию в логе: `Version: 1.4.0 (1.4.0-beta10)` или выше должно быть у ОБОИХ.
170. **`Version: undefined` в P2P логе = dev mode (`npm start`).** `navigator.userAgent` не содержит `StreamBro/X.X.X` в dev режиме. Это нормально — код тот же самый. Проверяй parenthetical: `(1.4.0-beta10)` — это hardcoded из app.js и всегда актуально.
171. **Сессия работает = CoScene работает ТОЛЬКО для роли где был инициализирован фикс.** Joiner path (ondatachannel async) работал и до build3. Initiator path (createDataChannel sync) требует `queueMicrotask`. Если одна сессия работает а другая нет — это признак несоответствия версий.
172. **Для диагностики CoScene — искать в логах:** (1) `DC open` — когда канал открылся, (2) `[CoScene] dc open` — когда `attachChannel` сработал (появится после build3), (3) правильные имена источников через 200-400ms после DC open — признак успешного snapshot, (4) `Grace expired, fallback` через 2.5s — CoScene snapshot не работает.

---

## 27. Выполнено (1.4.0-beta11 — 2026-05-09)

### Диагноз: race condition между `unmute` и `_wireTrackEndHandlers`

Анализ логов (`Друг.txt` / `мои.txt` от 19:01) показал новый чёткий паттерн:

| Трек | ontrack | ICE connected | Источник создан | unmute fired | unmute listener есть? |
|---|---|---|---|---|---|
| be2a90a2 (desktop) | 18:58:39.152 | 18:58:39.696 | 18:58:40.582 | ~18:58:39.7 | НЕТ (−0.9с) |
| d734e329 (mic) | 18:58:39.152 | 18:58:39.696 | 18:58:40.582 | ~18:58:39.7 | НЕТ (−0.9с) |
| b4115338 (mic new) | 18:59:31.842 | уже connected | 18:59:31.843 | 18:59:31.988 | ДА (+0.1с) |

**Почему b4115338 работает:** CoScene уже знал этот msid → источник создаётся почти мгновенно → `_wireTrackEndHandlers` успевает зарегистрироваться ДО `unmute` (146ms разрыв) → `unmute handler` → `_disconnectSource + _connectSource` → рабочая Web Audio цепочка.

**Почему первые треки не работают:** ICE коннектится через 0.5s после `ontrack`. Chrome сразу стреляет `unmute` на треках. Но источники создаются через CoScene snapshot (0.9s после ICE) → `_wireTrackEndHandlers` регистрируется ПОСЛЕ того как `unmute` уже отстрелял → reconnect никогда не вызывается.

**Корень проблемы:** `createMediaStreamSource(stream)` в Chrome/Electron НЕ начинает подавать PCM-данные в Web Audio API если трек прошёл через `muted=true → muted=false` без активного Web Audio потребителя в момент перехода. Reconnect (disconnect + reconnect MediaStreamAudioSourceNode) ОБЯЗАТЕЛЕН для запуска потока данных.

### Фикс в `_wireTrackEndHandlers` (app.js)

При регистрации `unmute` listener для peer аудио-треков — проверяем, не опоздали ли. Если трек уже `muted=false` в момент `_wireTrackEndHandlers` — планируем принудительный reconnect через 200ms:

```js
// Если unmute уже произошёл до регистрации listener'а — пропустили событие
if(t.kind==='audio' && !t.muted){
  _p2pLog('[P2P] Track already unmuted at wire time: '+src.name+' - scheduling reconnect');
  setTimeout(()=>{
    if(!S.srcs.find(s=>s.id===src.id)) return;
    _p2pLog('[P2P] Executing scheduled reconnect for already-unmuted track: '+src.name);
    try{ _disconnectSource(src.id); _connectSource(src); _rebuildCombinedStream(); }catch(e){
      _p2pLog('[P2P] WARN: scheduled reconnect failed: '+e.message);
    }
  }, 200);
}
```

### `_connectSource` peer logging (audio.js)

Убран `window.__sbDev` для логирования track states peer источников — теперь они всегда идут в `_p2pLog`:
```
[Audio] _connectSource peer: <name> tracks=1 states=live/muted=false/en=true monitor=true vol=1
```

### Подтверждение в beta11 логах

Тест `StreamBro-P2P-log-2026-05-08T19-21-40.txt` (beta11, joiner):
```
[19:19:32.485] [Audio] _connectSource peer: Звук рабочего стола states=live/muted=false/en=true
[19:19:32.486] [P2P] Track already unmuted at wire time: Звук рабочего стола - scheduling reconnect
[19:19:32.489] [Audio] _connectSource peer: Communications - Analogue 1 + 2 states=live/muted=false/en=true
[19:19:32.489] [P2P] Track already unmuted at wire time: Communications - Analogue 1 + 2 - scheduling reconnect
[19:19:32.687] [P2P] Executing scheduled reconnect for already-unmuted track: Звук рабочего стола
[19:19:32.691] [P2P] Executing scheduled reconnect for already-unmuted track: Communications - Analogue 1 + 2
```

Фикс отрабатывает корректно: оба треки `muted=false` в момент wire, оба получают принудительный reconnect. CoScene работает — правильные имена источников.

### Открытая проблема: звук всё ещё не слышен

Несмотря на то что фикс работает (reconnect выполняется, FX chain пересобирается, треки `muted=false/enabled=true`), друг по-прежнему не слышит пользователя. Причина не установлена.

**Два принципиально разных сценария:**
- **Сценарий A:** RTP пакеты не доходят до стороны друга — `bytesReceived` не растёт
- **Сценарий B:** Пакеты доходят, но `createMediaStreamSource` не выдаёт PCM в Web Audio API

Без `getStats()` данных нельзя различить A и B. Нужны следующие диагностики.

### Следующие шаги (приоритет)

1. **`getStats()` для audio receivers** — через 3с после DC open логировать `bytesReceived` для каждого `inbound-rtp` audio в `_p2pLog`. Это разделяет сценарии A и B.

2. **Analyser level check** — через 1с после scheduled reconnect проверять `analyser.getByteFrequencyData()`. Если `max=0` при `muted=false` треке → `createMediaStreamSource` не получает данные.

3. **`<audio>` bypass тест** — после reconnect создавать `<audio autoplay>` с peer stream. Если через `<audio>` слышно а через Web Audio нет → баг специфичный для `createMediaStreamSource` + WebRTC треки в Electron.

4. **Архитектурный рефакторинг (долгосрочно)** — перейти на `sender.replaceTrack()` + фиксированные transceivers вместо `addTrack/removeTrack`. Это устраняет весь цикл `removetrack → новый ontrack → новый audio graph` целиком. Также нужно: не пересоздавать `MediaStream` объекты при переподключении источников.

**Правила для агентов:**
173. **"Track already unmuted at wire time" в логах = норма для beta11+.** Это не ошибка, это фикс в действии. За ним должно следовать "Executing scheduled reconnect". Если "scheduled reconnect" НЕ следует — значит источник был удалён за 200ms (это баг).
174. **`_connectSource` НЕ ждётся (`await`).** В `addAudioSource` строка 1117 и в `_wireTrackEndHandlers` reconnect — `_connectSource(src)` вызывается без `await`. Это значит `_rebuildCombinedStream()` и `_wireTrackEndHandlers` выполняются пока `_connectSource` ещё строит цепочку (suspended на `await deps._gateWorkletLoaded`). Для мониторинга это не критично, но создаёт неаккуратный тайминг.
175. **Для диагностики "нет звука у друга":** (1) в P2P логах искать `states=live/muted=false/en=true` у peer источников — подтверждает что трек живой, (2) искать "Executing scheduled reconnect" — подтверждает что reconnect выполнен, (3) если оба есть а звука нет → нужен `getStats().bytesReceived` и/или analyser level check.
176. **`<audio>` элемент vs Web Audio для peer мониторинга.** `<audio autoplay srcObject=stream>` использует MediaPlayer rendering path, минуя `createMediaStreamSource`. Если через `<audio>` звук есть — проблема в Web Audio API. Это быстрый диагностический тест. НЕ заменяй Web Audio на `<audio>` в проде — теряются FX (gate, EQ, компрессор) и dB-метры.
177. **`replaceTrack` архитектура — правильное долгосрочное решение.** `sender.replaceTrack(newTrack)` не создаёт новых m-lines, не вызывает `removetrack` у пира, не убивает audio graph. Вся нестабильность из цикла `mute→removetrack→delete→ontrack→new graph` исчезает. Требует: pre-allocated transceivers (1 video + 2 audio per direction), отказ от `addTrack/removeTrack`, сохранение `MediaStream` объектов без пересоздания.

**Билды:**
- `StreamBro-1.4.0-beta11-build1-portable.zip` (234 MB) — missed-unmute fix + peer audio logging

