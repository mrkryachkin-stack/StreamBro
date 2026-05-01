# StreamBro — Контекст проекта

## Что это
Локальное P2P co-streaming приложение для Windows (Electron). Аналог OBS с встроенным P2P для со-стрима. Два друга запускают приложение, подключаются через код комнаты, видят видео/аудио друг друга напрямую (WebRTC P2P), композитят на одном canvas и стримят на Twitch/Kick через RTMP.

## Стек
- **Electron 33+** (main process + preload + renderer)
- **Canvas 2D API** — рендеринг сцены, интерактивные handles (drag, resize, rotate, crop, flip)
- **WebRTC P2P** — прямое соединение между друзьями
- **WebSocket Signaling Server** — обнаружение пиров (порт 7890)
- **Web Audio API** — анализаторы уровней для микшера
- **MediaRecorder / RTMP** — выход стрима (требует FFmpeg для реального RTMP)

## Файловая структура
```
main.js              — Electron main process, IPC handlers, desktopCapturer
preload.js           — Мост между main и renderer (electronAPI)
renderer/index.html   — UI layout
renderer/css/styles.css — Тема: glass effect, gold accent (#ffd23c), rounded
renderer/js/app.js    — Вся логика: сцена, источники, микшер, WebRTC, RTMP
renderer/js/webrtc.js — WebRTC P2P клиент
renderer/js/rtmp-output.js — RTMP выход (placeholder)
signaling-server/server.js — WebSocket сигналинг
assets/icon.png, icon.ico, icon.svg — Логотип (fist bump)
```

## UI Layout
- **Top bar** — Логотип, статус подключения
- **Center** — Canvas сцена (1920x1080 по умолчанию)
- **Right sidebar** — Аккордеон: "Платформы" + "Стрим"
- **Bottom panel** (160px) — Два раздела рядом:
  - Слева: "Источники" (только видео: камера/экран/окно) + кнопка +
  - Справа: "Микшер" (аудио-каналы) + кнопка + (добавить микрофон / звук рабочего стола)

## Архитектура: Источники vs Микшер (OBS-стиль, v8)
Видео и аудио разделены — как в OBS:

### Источники (левая часть bottom panel)
- Только **видео-источники**: камера, экран, окно
- Добавляются через модалку "Добавить источник"
- Появляются на canvas и в списке источников
- Не создают аудио-фейдеров — только картинка на сцене

### Микшер (правая часть bottom panel)
- **"Звук рабочего стола"** — постоянный канал (как в OBS), неудаляемый
  - Захватывается автоматически при старте через `getDisplayMedia({audio:true})`
  - Если автозахват не сработал — можно повторить через "+" → "Звук рабочего стола"
  - При попытке удалить — переключает mute вместо удаления
- **Микрофоны** — добавляются через "+" → "Микрофон"
  - Каждый микрофон — отдельный фейдер с mute, мониторингом, VST
  - Можно удалять

### Разделение кода
- `addVideoSource()` — создаёт источник с видео, добавляет на сцену (без аудио)
- `addAudioSource()` — создаёт источник с аудио, добавляет фейдер в микшер (без видео/сцены)
- `S.desktopAudioId` — ID неудаляемого канала "Звук рабочего стола"

## Scene Item Model
```
cx, cy        — центр bounding box (world space)
w, h          — размер bounding box (с учётом crop)
rot           — угол поворота (градусы)
flipH, flipV  — зеркальное отражение
crop {l,t,r,b} — доли обрезки (0-0.9) от полного видео
uncropW, uncropH — размер ДО обрезки (базовый для crop расчётов)
uncropCx, uncropCy — центр ДО обрезки
naturalAR     — оригинальное соотношение сторон видео
origVW, origVH — размер видео в пикселях
prevRect      — сохранённое состояние для dblclick toggle
```

## Interaction (Canvas)
- **Click** — выделить элемент
- **Drag** — перемещение с snap к краям canvas
- **Edge handles** — resize (пропорциональный по умолчанию, Shift = свободное растяжение)
- **Corner handles** — rotate + scale (угол + масштаб), snap к 0/90/180/270
- **Circle handle** (правый) — scale + flip (до нуля = зеркальный переворот)
- **Alt+handle** — crop (edge = одна сторона, corner = симметрично с обеих)
- **Double-click** — fullscreen / возврат (сохраняет crop, rotation, flip)
- **Scroll** — масштабирование
- **Delete** — удаление выбранного источника

## Ключевые формулы
- `rotMat(deg)` → `{a, b, c, d}` — матрица поворота
- `localToWorld(it, lx, ly)` / `worldToLocal(it, wx, wy)` — трансформация координат
- Crop: `it.w = uncropW * (1 - l - r)`, центр сдвигается через rotMat
- Resize без Shift: `newH = newW / naturalAR` (восстановление пропорций)
- Crop corner: симметричный — `n.l = n.r`, `n.t = n.b` (центр на месте)

## Известные баги/особенности
1. `chromeMediaSource` с `mandatory` может вызывать "bad IPC message" в некоторых версиях Electron — нужен `--no-sandbox` и `disable-site-isolation`
2. `desktopCapturer.getSources` с `thumbnailSize > 0` может крашить IPC — thumbnail отключен
3. RTMP — placeholder через MediaRecorder, нужен FFmpeg для реального стрима
4. VST — заглушка (EQ/compressor/gate/reverb/de-esser/limiter), реальная обработка не реализована
5. Захват звука рабочего стола — требует системный диалог выбора экрана при запуске (`getDisplayMedia`)

## Бэкапы (backups/)
- `app-v0-pre-sources.js` — до добавления источников
- `app-v0-pre-transform.js` — до системы трансформаций
- `app-v1-transform-stable.js` — стабильная версия трансформаций
- `app-v2-sources-mixer.js` — источники + микшер (связанные аудио/видео)
- `app-v3-mixer-refactor-pre.js` — перед рефакторингом микшера (v8)
- `index-v3.html`, `styles-v3.css` — HTML/CSS перед рефакторингом

## Русская локализация
Весь UI на русском. Кнопки, лейблы, сообщения — всё переведено.
