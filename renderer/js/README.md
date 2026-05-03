# StreamBro Renderer Modules

## Структура модулей

| Файл | Назначение | Размер |
|---|---|---|
| `app.js` | Основная логика: сцена, источники, микшер, FX, UI, стриминг, настройки | ~4500 строк |
| `webrtc.js` | WebRTC P2P: PeerConnection, WebRTCManager, сигналинг | ~600 строк |
| `rtmp-output.js` | RTMP стриминг: RTMPOutput, WebCodecs, MediaRecorder | ~800 строк |
| `gl-renderer.js` | WebGL2 рендеринг: шейдеры, текстуры, FBO, glow | ~600 строк |
| `friends-ui.js` | UI друзей: список, чат, уведомления, аватарки | ~900 строк |
| `profile-ui.js` | UI профиля: welcome overlay, login, OAuth | ~400 строк |
| `sounds.js` | SBSounds: синтезированные UI-звуки через Web Audio API | ~200 строк |
| `noise-gate-worklet.js` | AudioWorklet: noise gate процессор | ~80 строк |
| `wasapi-worklet.js` | AudioWorklet: системный звук WASAPI | ~60 строк |
| `rnnoise-worklet.js` | AudioWorklet: RNNoise AI шумоподавление | ~80 строк |
| `hotkeys.js` | Keyboard shortcuts module | ~80 строк |
| `streaming.js` | Streaming utilities: URLs, encoders, bitrate | ~50 строк |

## Глобальный стейт (S)

Объект `S` объявлен в `app.js` и доступен глобально через `window.S`. Все модули обращаются к нему через `window.S`.

## Порядок загрузки (index.html)

1. `streaming.js` — утилиты (нет зависимостей)
2. `sounds.js` — SBSounds
3. `gl-renderer.js` — GLRenderer
4. `webrtc.js` — WebRTCManager (ленивая загрузка при P2P)
5. `coscene.js` — CoScene (collaborative scene engine)
6. `rtmp-output.js` — RTMPOutput
7. `profile-ui.js` — SBProfile
8. `friends-ui.js` — SBFriends
9. `app.js` — основная логика (ссылается на все остальные)
10. `hotkeys.js` — keyboard shortcuts (defer, после app.js; самоинициализируется)

> Worklets (`noise-gate-worklet.js`, `wasapi-worklet.js`, `rnnoise-worklet.js`) загружаются динамически через `AudioWorklet.addModule()` из `app.js` — не через `<script>`.

## Механика hotkeys.js

`hotkeys.js` загружается с `defer` и вызывает `window.SBHotkeys.init()` при загрузке.

`init()` проверяет: если `document.onkeydown` уже занят (app.js устанавливает его в `bind()`), новые слушатели не добавляются — это предотвращает двойное срабатывание клавиш. Модуль готов стать основным обработчиком, когда клавиатурный блок будет удалён из `bind()` при финальном рефакторинге.

## Планируемый рефакторинг (TODO)

Разделить `app.js` на:
- `scene.js` — источники, элементы, трансформы (S.srcs, S.items, render)
- `audio.js` — аудио-цепочка, FX, микшер
- `ui.js` — DOM, модалки, настройки, темы
- `rooms.js` — P2P комнаты, CoScene

При этом рефакторинге блок `document.onkeydown` в `bind()` переходит в `hotkeys.js`, и `SBHotkeys.init()` начинает регистрировать реальные слушатели.
