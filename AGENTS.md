# StreamBro — Knowledge Base for AI Agents

> Последнее обновление: 2026-05-03 (1.2.3+chat-fix — myUserId serverId, slider toggle, chat flicker)
> Этот файл — «память» проекта. Новый агент должен прочитать его целиком перед началом работы.

---

## 1. Что это за проект

StreamBro — Windows-десктопное приложение для стриминга/записи в духе OBS, но проще и нативнее. Платформа для работы с камерой, экраном, изображениями, сценами, источниками, звуком и визуальными настройками.

**Стек:** Electron 33 + Canvas 2D + Web Audio API + WebRTC P2P + FFmpeg (RTMP) + WASAPI (нативный захват системного звука Windows).

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
modules/auto-updater.js              — 1.1.0 — обёртка над electron-updater (generic provider, graceful degradation)
modules/server-api.js                — 1.2.1+ — серверный API клиент: authenticated HTTP (net.request) + presence WebSocket
modules/cloud-sync.js                — 1.2.1+ — AES-256-GCM шифрование настроек, upload/download на сервер
renderer/index.html                  — UI разметка (welcome overlay, settings tabs, friends section, update toast)
renderer/css/styles.css              — Темы (dark/light/neon/paper) через CSS variables на [data-theme]; стили profile/friends/welcome/toast
renderer/js/app.js                   — Основная логика renderer: сцена, источники, микшер, FX, UI (3000+ строк) + sounds/profile/friends/updates wiring + WebGL/2D dual render
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

**Prisma-модель:** `Room` (code, creatorId, maxPeers, status: ACTIVE/CLOSED)
**Prisma-модель:** `RoomMember` (roomId, userId, role: CREATOR/MEMBER)

**API-маршруты:**
- `POST /api/rooms` — создать комнату (генерирует 16-символьный код)
- `GET /api/rooms/:code` — информация о комнате
- `POST /api/rooms/:code/join` — войти
- `POST /api/rooms/:code/leave` — выйти (создатель → комната закрывается)
- `GET /api/rooms/mine/list` — список своих комнат
- `POST /api/rooms/:code/invite` — пригласить друга (отправляет [room-invite:CODE] в чат)

**Сигналинг** остаётся через `/signaling` WS — комнаты в БД для persistence и user-account привязки.

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
41. **1.2.1+ — Комнаты.** Комнаты создаются через серверный API (персистентность). Сигналинг (WebRTC SDP/ICE exchange) остаётся через `/signaling` WebSocket. Код комнаты — 16 символов (4 группы по 4 через дефис). При выходе создателя комната закрывается.
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

**VPS:** REDACTED_VPS_IP (Ubuntu 24.04)

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

