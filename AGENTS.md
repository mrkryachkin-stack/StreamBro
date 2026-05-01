# StreamBro — Knowledge Base for AI Agents

> Последнее обновление: 2026-05-02 (1.2.0 — масштабная оптимизация производительности, UX улучшения, overlay canvas)
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
modules/friends-store.js             — 1.1.0 — друзья, заявки, чат (in-memory cache, готов к серверной репликации)
modules/bug-reporter.js              — 1.1.0 — очередь баг-репортов, скрабинг секретов, POST через net.request
modules/auto-updater.js              — 1.1.0 — обёртка над electron-updater (generic provider, graceful degradation)
renderer/index.html                  — UI разметка (welcome overlay, settings tabs, friends section, update toast)
renderer/css/styles.css              — Темы (dark/light/neon/paper) через CSS variables на [data-theme]; стили profile/friends/welcome/toast
renderer/js/app.js                   — Основная логика renderer: сцена, источники, микшер, FX, UI (3000+ строк) + sounds/profile/friends/updates wiring + WebGL/2D dual render
renderer/js/webrtc.js                — WebRTC P2P: PeerConnection + WebRTCManager (сигналинг + TURN)
renderer/js/rtmp-output.js           — RTMP streaming (WebCodecs H.264+AAC / MediaRecorder fallback) + локальная запись (MediaRecorder → MP4)
renderer/js/gl-renderer.js           — 1.1.0 — WebGL2 renderer: textured quads, Gaussian blur, glow/vignette shaders, FBO post-processing
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

## 8. Известные проблемы и TODO

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

---

## 9. Важные правила для агентов

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

---

## 10. Как запускать и тестировать

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

## 11. Серверная инфраструктура (РАЗВЁРНУТА)

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
