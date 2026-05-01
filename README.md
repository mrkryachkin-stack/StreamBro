# StreamBro

Профессиональный стриминг-композитор для Windows. Камера, экран, сцены, микшер с эффектами, P2P со-стрим, друзья, чат — в одном лёгком приложении.

## Возможности

- **Стриминг** — Twitch / YouTube / Kick / Custom RTMP, реальный FFmpeg pipe с параметрами под AWS IVS
- **Запись** — локальная запись в MP4 с автоконвертацией
- **Сцена** — drag/resize/rotate/crop/mirror, OBS-style transform controls, сетка, safe-area
- **Микшер** — микрофоны + системный звук (WASAPI loopback), mute/monitor/FX на каждый канал
- **FX-цепочка** — шумодав (AudioWorklet) → 3-band EQ → компрессор → лимитер, пресеты
- **P2P со-стрим** — WebRTC с сигналингом, ICE restart, TURN support
- **Друзья и чат** — список друзей, статусы, inline-чат для передачи ключей комнат
- **Профиль** — локальный или через сайт, автостатус «Стримлю», баг-репорты
- **Звуки** — мягкие синтезированные тоны (Web Audio API), настраиваемая громкость
- **Темы** — тёмная / светлая / неон / бумага
- **Auto-update** — проверка и загрузка обновлений

## Быстрый старт

```bash
npm install
npm start
```

## Сборка

```bash
npm test          # smoke-тесты (150+ проверок)
npm run build:dir # распакованный билд (dist/win-unpacked/)
npm run build:win # NSIS установщик (требует Windows Developer Mode)
```

Для распространения без установки — portable .zip из `dist/`.

## Где хранятся данные

| Что | Где |
|---|---|
| Настройки | `%APPDATA%\StreamBro\settings.json` |
| Stream key | Зашифрован через Windows DPAPI (`safeStorage`) |
| Записи | `%USERPROFILE%\Videos\StreamBro\` |
| Баг-репорты | `%APPDATA%\StreamBro\bug-reports\` |

Stream key **никогда** не попадает в логи — URL маскируется как `<key>`.

## Горячие клавиши

| Клавиша | Действие |
|---|---|
| `Delete` | Удалить источник |
| `Esc` | Закрыть модалку |
| `R` | Сбросить трансформацию |
| `H` | Скрыть/показать |
| `L` | Заблокировать |
| `M` | Mute |
| `G` | Сетка |
| `Ctrl+Z` | Отменить |
| `Shift`+ручка | Свободное растяжение |
| `Alt`+ручка | Crop |

## Безопасность

- `contextIsolation: true`, `nodeIntegration: false`
- Stream key + session token шифруются через `safeStorage` (DPAPI)
- CSP запрещает `unsafe-eval` и сторонние скрипты
- Single-instance lock
- Баг-репорты скрабят RTMP keys / Bearer / email

## Структура проекта

```
main.js                  — Electron main process
preload.js               — contextBridge API
settings.js              — persistence + encryption
modules/                 — profile, friends, bug-reporter, auto-updater
renderer/js/app.js       — сцена, источники, микшер, UI
renderer/js/webrtc.js    — P2P co-stream
renderer/js/rtmp-output.js — RTMP + запись
renderer/js/sounds.js    — синтезированные звуки
renderer/js/friends-ui.js — друзья, чат, статусы
signaling-server/        — WebSocket сигналинг
test/                    — 150+ smoke-тестов
```

## Требования

- **Windows 10/11** (x64)
- Дополнительные драйверы или программы **не нужны** — системный звук захватывается нативно (WASAPI), FFmpeg включён в поставку

## Стриминг-платформы

- **Twitch**: `rtmp://live.twitch.tv/app` — 1080p @ 6000 kbps
- **Kick**: `rtmps://...live-video.net:443/app` — 720p @ 4500 kbps (free tier)
- **YouTube**: `rtmp://a.rtmp.youtube.com/live2` — 1080p @ 8000 kbps
- **Custom**: любой RTMP/RTMPS сервер

## Лицензия

GNU General Public License v3.0 — см. [LICENSE](LICENSE).

Свободно для личного использования. Форки обязаны открывать исходный код под той же лицензией. Коммерческое использование без согласия автора запрещено условиями GPL-3.0.
