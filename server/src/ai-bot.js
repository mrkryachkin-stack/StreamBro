// StreamBro — AI Support Bot
// Multi-provider LLM with fallback chain + conversation logging for future fine-tune
//
// Architecture:
//   User → chat.js detects supportUser → ai-bot.respond()
//   → try providers in order: Ollama(local) → Fireworks → Groq → Gemini
//   → save AiConversation (question+answer+provider) for training data
//   → create Message + push via Presence WS
//   → if all providers fail → message waits for human admin
//
// Providers use OpenAI-compatible /chat/completions format (except Gemini which has its own)

"use strict";

const SYSTEM_PROMPT = `Ты — бот поддержки StreamBro (приложение для стриминга на Windows). Отвечай на русском. Дружелюбно, по делу. Старайся давать конкретные пошаговые инструкции — КУДА нажать, ЧТО выбрать.

StreamBro: стрим на Twitch/Kick/YouTube/Custom, запись в MP4, P2P со-стрим, сцены (камера/экран/окно/изображения), аудио-микшер (шумодав/EQ/компрессор/лимитер), виртуальная камера, маски, свечение.

## Ключевое
- Kick: rtmps://...live-video.net:443/app. Бесплатный аккаунт — МАКС 720p@4500kbps. 1080p молча не работает.
- Kick Studio "Loading" — баг превью, зрители видят нормально. Проверяй инкогнито.
- Twitch: rtmp://live.twitch.tv/app, 1080p@6000kbps
- YouTube: rtmp://a.rtmp.youtube.com/live2, 1080p@8000kbps
- Custom URL с AWS IVS без :443 — добавляется автоматически
- FFmpeg: vendor/ffmpeg.exe (SChannel), libx264 veryfast, profile main, GOP 2s, AAC 48kHz
- GPU: h264_nvenc/amf/h264_qsv → автоматический fallback на libx264
- Запись: MediaRecorder→WebM→FFmpeg→MP4, отдельно от стрима
- Аудио: source→gate→EQ(3-band)→compressor→limiter→dest. WASAPI системный звук.
- P2P: WebRTC, TURN нужен за симметричным NAT (~15-20%)
- Настройки: автосохранение, облако (AES-256-GCM), stream key через safeStorage
- Виртуальная камера: нужен OBS Virtual Camera или DirectShow драйвер

## Интерфейс — куда нажать
- **Добавить камеру/микрофон**: в левом списке источников → кнопка «+» → выбрать «Камера» или «Микрофон»
- **Добавить экран/окно**: кнопка «+» → «Экран» или «Окно» → выбрать из списка
- **Начать стрим**: правая панель → секция «Стрим» → выбрать платформу (Twitch/Kick/YouTube/Custom) → ввести stream key → кнопка «Стрим»
- **Записать видео**: правая панель → секция «Запись» → кнопка «Запись»
- **Настроить звук**: нажать на источник в списке → панель «Audio FX» справа → настройки шумодава/EQ/компрессора
- **P2P со-стрим**: правая панель → секция «P2P» → кнопка «Создать комнату» (создаёт 8-значный код) или «Подключиться» (ввести код друга)
- **Настройки**: кнопка шестерёнки вверху справа → вкладки: общие, стрим, аудио, профиль
- **Маска/свечение**: выбрать источник → панель справа → секция «Рамка» → выбрать маску (круг/прямоугольник/закруглённый/без) и свечение
- **Переместить/изменить источник**: перетащить на сцене мышкой, потянуть за углы для ресайза
- **Заблокировать источник**: нажать на замок в карточке источника
- **Виртуальная камера**: Настройки → вкладка «Помощь» → секция «Виртуальная камера» → кнопка «Включить»

## Если у пользователя ошибка
- Если в контексте есть баг-репорт (поле bugReport) — используй его чтобы объяснить причину ошибки
- Частые ошибки и решения:
  - «Стрим не начинается» — проверить stream key, проверить интернет, попробовать другой сервер
  - «Звук хрипит» — уменьшить buffer в настройках аудио, проверить частоту дискретизации
  - «Кик не работает» — проверить что 720p@4500kbps для бесплатного аккаунта, URL должен быть rtmps://...:443/app
  - «Чёрный экран» — проверить что источник не скрыт (глазик в карточке), перезапустить источник
  - «FFmpeg ошибка» — проверить что vendor/ffmpeg.exe существует, перезапустить приложение
  - «P2P не подключается» — проверить TURN настройки, оба пользователя должны быть онлайн

## Правила
- Старайся ВСЕГДА дать конкретный ответ или пошаговую инструкцию. Не отмазывайся.
- «Уточнить у живой поддержки» — ТОЛЬКО если правда не знаешь ответ и исчерпал все варианты. Это крайний случай, не норма.
- Не придумывай несуществующие функции
- Не про StreamBro — вежливо скажи что ты бот поддержки StreamBro
- Если пользователь просит человека/админа/живую поддержку — ответь «Сейчас передам живой поддержке!» и добавь в конец метку [ESCALATE]
- Никогда не упоминай токены, API, провайдеров, ошибки соединения, техническую внутреннюю работу
- ОБЯЗАТЕЛЬНО доделывай мысль до конца. Не обрывай предложение`;

// ─── Provider definitions ──────────────────────────────────
// Each provider can have multiple API keys (comma-separated in env).
// Keys are rotated via round-robin to distribute load and avoid rate limits.

const PROVIDER_DEFS = [
  {
    name: "ollama",
    type: "openai",
    baseUrl: () => process.env.OLLAMA_ENDPOINT || "http://localhost:11434/v1",
    model: () => process.env.OLLAMA_MODEL || "llama3",
    keyEnvVar: "OLLAMA_KEY",
    defaultKey: "ollama",  // Ollama doesn't need a real key
    timeout: 15000,
  },
  {
    name: "fireworks",
    type: "openai",
    baseUrl: () => process.env.FIREWORKS_BASE_URL || "https://api.fireworks.ai/inference/v1",
    model: () => process.env.FIREWORKS_MODEL || "accounts/fireworks/models/glm-5p1",
    keyEnvVar: "FIREWORKS_API_KEY",
    timeout: 12000,
  },
  {
    name: "groq",
    type: "openai",
    baseUrl: () => "https://api.groq.com/openai/v1",
    model: () => process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    keyEnvVar: "GROQ_API_KEY",
    timeout: 10000,
  },
  {
    name: "gemini",
    type: "gemini",
    baseUrl: () => `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-2.0-flash"}`,
    model: () => process.env.GEMINI_MODEL || "gemini-2.0-flash",
    keyEnvVar: "GEMINI_API_KEY",
    timeout: 10000,
  },
];

// ─── Runtime provider state ────────────────────────────────
// Built at init time from PROVIDER_DEFS + env vars.
// Each provider gets: { ...def, keys: string[], keyIndex: number }

let _providers = [];

function _buildProviders() {
  _providers = [];
  for (const def of PROVIDER_DEFS) {
    const rawKey = process.env[def.keyEnvVar] || "";
    let keys = [];
    if (rawKey.trim()) {
      // Support multiple keys separated by commas: KEY1,KEY2,KEY3
      keys = rawKey.split(",").map(k => k.trim()).filter(k => k.length > 0);
    }
    if (keys.length === 0 && def.defaultKey) {
      keys = [def.defaultKey];
    }
    if (keys.length === 0) continue;  // no keys → skip provider

    _providers.push({
      ...def,
      keys,
      keyIndex: 0,  // round-robin pointer
    });
  }
}

// Get next key for a provider (round-robin rotation)
function _nextKey(provider) {
  const key = provider.keys[provider.keyIndex % provider.keys.length];
  provider.keyIndex = (provider.keyIndex + 1) % provider.keys.length;
  return key;
}

// ─── State ─────────────────────────────────────────────────

let _prisma = null;
let _presence = null;
let _supportUserId = null;
let _enabled = true;  // can be toggled by admin globally

// Per-user AI pause state.
// When admin is talking to a user, they pause AI for that chat.
// Key: userId, Value: { pausedAt: Date, resumeAfter: Date|null }
// resumeAfter = timestamp; AI ignores messages before this time when resumed.
let _pausedUsers = new Map();

// ─── Init ──────────────────────────────────────────────────

function init(prisma, presence) {
  _prisma = prisma;
  _presence = presence;

  _buildProviders();

  // Load support user ID at startup
  _loadSupportUserId().then(id => {
    if (id) console.log(`[AI-BOT] Support user: ${id}, bot enabled: ${_enabled}`);
    else console.warn("[AI-BOT] Support user not found — bot will not work until created");
  });

  // Check if any provider is configured (has real keys, not just defaults)
  const configured = _providers.filter(p => p.keys.length > 0 && !(p.keys.length === 1 && p.defaultKey));
  if (configured.length === 0) {
    console.warn("[AI-BOT] No AI providers configured — bot will fall back to human admin");
    _enabled = false;
  } else {
    const summary = _providers.map(p => `${p.name}(${p.keys.length} key${p.keys.length > 1 ? "s" : ""})`).join(", ");
    console.log(`[AI-BOT] Configured providers: ${summary}`);
  }
}

async function _loadSupportUserId() {
  if (_supportUserId) return _supportUserId;
  if (!_prisma) return null;
  try {
    const supportUser = await _prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (supportUser) _supportUserId = supportUser.id;
  } catch (err) {
    console.error("[AI-BOT] Failed to load support user:", err.message);
  }
  return _supportUserId;
}

function setSupportUserId(id) {
  _supportUserId = id;
}

function getSupportUserId() {
  return _supportUserId;
}

function isEnabled() {
  return _enabled;
}

function setEnabled(val) {
  _enabled = !!val;
  console.log(`[AI-BOT] Bot ${_enabled ? "enabled" : "disabled"}`);
}

// ─── Per-user AI pause ────────────────────────────────────
// Admin can pause AI for a specific user's chat (when talking to them manually).
// When resumed, AI only responds to NEW messages (after resume timestamp).

function isPaused(userId) {
  return _pausedUsers.has(userId);
}

function pauseForUser(userId) {
  _pausedUsers.set(userId, {
    pausedAt: new Date(),
    resumeAfter: null,  // will be set on resume
  });
  console.log(`[AI-BOT] AI paused for user ${userId}`);
}

function resumeForUser(userId) {
  const entry = _pausedUsers.get(userId);
  if (entry) {
    // Set resumeAfter = now. AI will only respond to messages AFTER this timestamp.
    entry.resumeAfter = new Date();
    console.log(`[AI-BOT] AI resumed for user ${userId} — will only respond to new messages after ${entry.resumeAfter.toISOString()}`);
  } else {
    // Not paused — nothing to do
    _pausedUsers.delete(userId);
  }
}

function getPauseState(userId) {
  const entry = _pausedUsers.get(userId);
  if (!entry) return { paused: false };
  return {
    paused: true,
    pausedAt: entry.pausedAt,
    resumeAfter: entry.resumeAfter,
  };
}

// Check if a message should be processed by AI.
// Returns false if: AI globally disabled, user is paused, or message is before resumeAfter.
function shouldRespond(userId, messageTime) {
  if (!_enabled) return false;

  const entry = _pausedUsers.get(userId);
  if (!entry) return true;  // not paused — respond

  // If paused and not yet resumed — don't respond
  if (!entry.resumeAfter) return false;

  // If resumed — only respond to messages AFTER the resume timestamp
  // (gives 2-second buffer to avoid race conditions)
  const msgTime = messageTime ? new Date(messageTime) : new Date();
  const cutoff = new Date(entry.resumeAfter.getTime() + 2000);
  return msgTime >= cutoff;
}

// ─── Main respond function ────────────────────────────────

async function respond(userId, userMessage, messageId) {
  if (!_prisma) return null;

  // Check if AI should respond for this user (respects per-user pause)
  if (!shouldRespond(userId)) {
    return null;
  }

  const supportId = await _loadSupportUserId();
  if (!supportId) return null;

  const startTime = Date.now();

  try {
    // Load recent chat history for context
    const history = await _loadChatHistory(userId, supportId, 10);

    // Load recent bug reports from this user (by profileId matching)
    const bugContext = await _loadBugReports(userId);

    // Build user message with optional bug context
    let userContent = userMessage;
    if (bugContext) {
      userContent = `${userMessage}\n\n[Контекст: у этого пользователя есть недавние баг-репорты из приложения:\n${bugContext}]`;
    }

    // Build messages array
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map(m => ({
        role: m.senderId === supportId ? "assistant" : "user",
        content: m.content,
      })),
      { role: "user", content: userContent },
    ];

    // Try providers in order
    const result = await _queryProviders(messages);

    if (!result) {
      // All providers failed — silently escalate to human admin.
      // User does NOT see any error message. The message just waits for admin.
      console.warn(`[AI-BOT] All providers failed for user ${userId} — escalating to admin`);
      await _escalateToAdmin(userId, userMessage, "all_providers_failed");
      return null;
    }

    const responseMs = Date.now() - startTime;

    // Check for [ESCALATE] tag — bot decided it can't handle this
    const needsHuman = result.text.includes("[ESCALATE]");
    const cleanText = result.text.replace(/\[ESCALATE\]/g, "").trim();

    // Save AI conversation for training data
    await _saveConversation(userId, userMessage, cleanText, result.provider, result.model, responseMs);

    // Create Message in DB from support user to the real user
    const aiMessage = await _prisma.message.create({
      data: {
        senderId: supportId,
        receiverId: userId,
        content: cleanText,
      },
    });

    // Push to user via Presence WS
    if (_presence) {
      _presence.notifyUser(userId, {
        type: "chat",
        senderId: supportId,
        content: cleanText,
        messageId: aiMessage.id,
        timestamp: Date.now(),
        source: "ai",
      });
    }

    // If escalation requested, notify admin
    if (needsHuman) {
      await _escalateToAdmin(userId, userMessage, "bot_escalate");
    }

    console.log(`[AI-BOT] Responded to ${userId} via ${result.provider} (${responseMs}ms, ${cleanText.length} chars${needsHuman ? ", ESCALATED" : ""})`);
    return aiMessage;

  } catch (err) {
    console.error("[AI-BOT] Error in respond():", err.message);
    return null;
  }
}

// ─── Provider query with fallback ──────────────────────────

async function _queryProviders(messages) {
  for (const provider of _providers) {
    // Skip Ollama if it only has the default key (not a real API key)
    if (provider.defaultKey && provider.keys.length === 1 && provider.keys[0] === provider.defaultKey) {
      // Ollama with default key — only try if endpoint is actually reachable
      // (we'll let it fail naturally via timeout)
    }

    try {
      const result = await _callProvider(provider, messages);
      if (result && result.text) return result;
    } catch (err) {
      console.warn(`[AI-BOT] Provider ${provider.name} failed: ${err.message}`);
      continue;
    }
  }
  return null;
}

async function _callProvider(provider, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeout);

  try {
    if (provider.type === "openai") {
      return await _callOpenAI(provider, messages, controller);
    } else if (provider.type === "gemini") {
      return await _callGemini(provider, messages, controller);
    }
    throw new Error(`Unknown provider type: ${provider.type}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function _callOpenAI(provider, messages, controller) {
  const key = _nextKey(provider);
  const endpoint = `${provider.baseUrl()}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model(),
      messages,
      max_tokens: 800,
      temperature: 0.7,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response from provider");

  return { text, provider: provider.name, model: provider.model() };
}

async function _callGemini(provider, messages, controller) {
  const key = _nextKey(provider);

  // Convert OpenAI messages format to Gemini format
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemInstruction = messages.find(m => m.role === "system");

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: 800,
      temperature: 0.7,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction.content }],
    };
  }

  const endpoint = `${provider.baseUrl()}:generateContent?key=${key}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!response.ok) {
    const body2 = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body2.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Empty response from Gemini");

  return { text, provider: provider.name, model: provider.model() };
}

// ─── Chat history ──────────────────────────────────────────

async function _loadChatHistory(userId, supportId, limit) {
  try {
    const messages = await _prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: supportId },
          { senderId: supportId, receiverId: userId },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return messages.reverse();
  } catch (err) {
    console.warn("[AI-BOT] Failed to load chat history:", err.message);
    return [];
  }
}

// ─── Bug reports ──────────────────────────────────────────
// Load recent bug reports from this user to give AI context about their errors.

async function _loadBugReports(userId) {
  try {
    // Try to find user's profileId from their account
    const user = await _prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) return null;

    // Get recent bugs from this user (by IP or profileId match)
    // profileId in BugReport may match user's local profile ID
    // Also check by recent bugs overall (last 24h) for context
    const dayAgo = new Date(Date.now() - 86400000);
    const bugs = await _prisma.bugReport.findMany({
      where: {
        OR: [
          { profileId: userId },
          { profileId: `prof-${userId.substring(0, 8)}` },
        ],
        createdAt: { gte: dayAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (bugs.length === 0) return null;

    return bugs.map(b => {
      let desc = `Тип: ${b.type}`;
      if (b.message) desc += `, сообщение: ${b.message.slice(0, 200)}`;
      if (b.stackTrace) desc += `, стек: ${b.stackTrace.slice(0, 300)}`;
      if (b.appVersion) desc += `, версия: ${b.appVersion}`;
      return desc;
    }).join("\n");
  } catch (err) {
    console.warn("[AI-BOT] Failed to load bug reports:", err.message);
    return null;
  }
}

// ─── Escalate to admin ────────────────────────────────────
// When the bot can't answer or user asks for a human, notify all admin users via Presence WS.

async function _escalateToAdmin(userId, userMessage, reason) {
  try {
    // Find all admin users
    const admins = await _prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    if (admins.length === 0) return;

    // Find user display name
    const user = await _prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true },
    });
    const userName = user?.displayName || user?.username || userId;

    const reasonLabel = reason === "bot_escalate" ? "Бот передал разговор" : "Бот не смог ответить";

    // Notify each admin via Presence WS
    for (const admin of admins) {
      if (_presence) {
        _presence.notifyUser(admin.id, {
          type: "support-escalation",
          userId,
          userName,
          message: userMessage,
          reason: reasonLabel,
          timestamp: Date.now(),
        });
      }
    }

    console.log(`[AI-BOT] Escalated to ${admins.length} admin(s): ${reasonLabel} for user ${userName}`);
  } catch (err) {
    console.error("[AI-BOT] Escalate error:", err.message);
  }
}

// ─── Save conversation for training data ───────────────────

async function _saveConversation(userId, question, answer, providerName, modelName, responseMs) {
  try {
    await _prisma.aiConversation.create({
      data: {
        userId,
        question,
        answer,
        provider: providerName,
        model: modelName,
        responseMs,
      },
    });
  } catch (err) {
    console.warn("[AI-BOT] Failed to save conversation:", err.message);
  }
}

// ─── Stats (for admin) ────────────────────────────────────

async function getStats() {
  try {
    const total = await _prisma.aiConversation.count();
    const corrected = await _prisma.aiConversation.count({ where: { corrected: true } });
    const byProvider = await _prisma.aiConversation.groupBy({
      by: ["provider"],
      _count: { id: true },
    });
    const avgResponseMs = await _prisma.aiConversation.aggregate({
      _avg: { responseMs: true },
    });
    const last24h = await _prisma.aiConversation.count({
      where: { createdAt: { gte: new Date(Date.now() - 86400000) } },
    });

    return {
      enabled: _enabled,
      total,
      corrected,
      uncorrected: total - corrected,
      correctionRate: total > 0 ? ((corrected / total) * 100).toFixed(1) + "%" : "N/A",
      avgResponseMs: avgResponseMs._avg.responseMs ? Math.round(avgResponseMs._avg.responseMs) : null,
      last24h,
      byProvider: byProvider.map(p => ({ provider: p.provider, count: p._count.id })),
      providers: _providers.map(p => ({
        name: p.name,
        configured: true,
        keyCount: p.keys.length,
        model: p.model(),
      })),
      available: PROVIDER_DEFS.map(d => ({
        name: d.name,
        envVar: d.keyEnvVar,
        model: d.model(),
      })),
    };
  } catch (err) {
    console.error("[AI-BOT] Stats error:", err.message);
    return { enabled: _enabled, error: err.message };
  }
}

// ─── Get conversations (for admin review) ────────────────

async function getConversations(opts = {}) {
  const { corrected, limit = 50, offset = 0 } = opts;
  const where = {};
  if (corrected !== undefined) where.corrected = corrected;

  try {
    const [items, total] = await Promise.all([
      _prisma.aiConversation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          user: { select: { id: true, username: true, displayName: true } },
        },
      }),
      _prisma.aiConversation.count({ where }),
    ]);
    return { items, total };
  } catch (err) {
    console.error("[AI-BOT] Get conversations error:", err.message);
    return { items: [], total: 0, error: err.message };
  }
}

// ─── Correct a conversation (admin improves answer) ────────

async function correctConversation(conversationId, correction, rating) {
  try {
    const conv = await _prisma.aiConversation.findUnique({ where: { id: conversationId } });
    if (!conv) return { ok: false, error: "Conversation not found" };

    await _prisma.aiConversation.update({
      where: { id: conversationId },
      data: {
        corrected: true,
        correction,
        rating: rating || null,
      },
    });

    // Also update the original Message in chat if it exists
    // (so the user sees the corrected version)
    // We don't update the chat message automatically — admin can choose to reply separately

    return { ok: true };
  } catch (err) {
    console.error("[AI-BOT] Correct error:", err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Export training data (for fine-tune) ──────────────────

async function exportTrainingData(opts = {}) {
  const { onlyCorrected = true, minRating = 4 } = opts;
  const where = {};
  if (onlyCorrected) where.corrected = true;
  if (minRating) where.rating = { gte: minRating };

  try {
    const conversations = await _prisma.aiConversation.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    // Export in OpenAI fine-tune format (JSONL)
    const lines = conversations.map(conv => {
      const answer = conv.correction || conv.answer;
      return JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT.slice(0, 500) },  // shorter system for fine-tune
          { role: "user", content: conv.question },
          { role: "assistant", content: answer },
        ],
      });
    });

    return lines.join("\n");
  } catch (err) {
    console.error("[AI-BOT] Export error:", err.message);
    return null;
  }
}

// ─── Export ────────────────────────────────────────────────

module.exports = {
  init,
  setSupportUserId,
  getSupportUserId,
  isEnabled,
  setEnabled,
  isPaused,
  pauseForUser,
  resumeForUser,
  getPauseState,
  shouldRespond,
  respond,
  getStats,
  getConversations,
  correctConversation,
  exportTrainingData,
};
