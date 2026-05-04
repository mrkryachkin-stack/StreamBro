const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const router = express.Router();
const { registerSchema, loginSchema, changePasswordSchema, resetRequestSchema, resetConfirmSchema } = require("../utils/validation");
const { authMiddleware } = require("../middleware/auth");
const { signToken, setTokenCookie, clearTokenCookie } = require("../utils/tokens");
const { sendVerificationEmail, sendResetEmail } = require("../utils/mail");

// ─── POST /api/auth/register ───────────────────────────────
router.post("/register", async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0].message });
  }
  const { email, username, password } = parse.data;

  try {
    const existing = await req.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      const field = existing.email === email ? "email" : "username";
      return res.status(409).json({ error: `Этот ${field} уже занят` });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString("hex");

    const user = await req.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        displayName: username,
        verifyToken,
        subscription: {
          create: {
            plan: "FREE",
            status: "ACTIVE",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date("2099-12-31"),
          },
        },
      },
      select: { id: true, email: true, username: true, role: true, emailVerified: true },
    });

    const token = signToken({ id: user.id, email: user.email, username: user.username, role: user.role });
    setTokenCookie(res, token);

    // Auto-friend with StreamBro support user
    try {
      const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
      if (supportUser) {
        await req.prisma.friendship.create({
          data: { requesterId: supportUser.id, addresseeId: user.id, status: "ACCEPTED" },
        });
      }
    } catch (e) {
      console.warn("[AUTH] Auto-friend with support failed:", e.message);
    }

    // Send verification email (async, don't block response)
    sendVerificationEmail(email, verifyToken).catch((err) => {
      console.error("[AUTH] Verification email failed:", err.message);
    });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error("[AUTH] Register error:", err);
    res.status(500).json({ error: "Ошибка регистрации" });
  }
});

// ─── POST /api/auth/login ──────────────────────────────────
router.post("/login", async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0].message });
  }
  const { login, password } = parse.data;

  try {
    const user = await req.prisma.user.findFirst({
      where: { OR: [{ email: login }, { username: login }] },
    });
    if (!user) {
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }

    // If user has no password (OAuth-only), they must use OAuth
    if (!user.passwordHash) {
      return res.status(401).json({ error: "Используйте вход через соцсеть" });
    }

    // Check if banned
    if (user.banned) {
      return res.status(403).json({ error: "Аккаунт заблокирован" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }

    const token = signToken({ id: user.id, email: user.email, username: user.username, role: user.role });
    setTokenCookie(res, token);

    // Update last login
    await req.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {});

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      token,
    });
  } catch (err) {
    console.error("[AUTH] Login error:", err);
    res.status(500).json({ error: "Ошибка входа" });
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────
router.post("/logout", (req, res) => {
  clearTokenCookie(res);
  res.json({ ok: true });
});

// ─── GET /api/auth/verify-email?token=... ──────────────────
// Clickable link from email
router.get("/verify-email", async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.redirect("/login?verify=missing");
  }

  try {
    const result = await req.prisma.user.updateMany({
      where: { verifyToken: token },
      data: { emailVerified: true, verifyToken: null },
    });

    if (result.count === 0) {
      return res.redirect("/login?verify=invalid");
    }

    res.redirect("/dashboard?verify=success");
  } catch (err) {
    console.error("[AUTH] Verify error:", err);
    res.redirect("/login?verify=error");
  }
});

// ─── POST /api/auth/verify ─────────────────────────────────
// API version (for desktop app)
router.post("/verify", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Токен обязателен" });

  try {
    const result = await req.prisma.user.updateMany({
      where: { verifyToken: token },
      data: { emailVerified: true, verifyToken: null },
    });
    if (result.count === 0) {
      return res.status(400).json({ error: "Неверный или устаревший токен" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[AUTH] Verify error:", err);
    res.status(500).json({ error: "Ошибка верификации" });
  }
});

// ─── POST /api/auth/resend-verification ────────────────────
router.post("/resend-verification", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email обязателен" });

  try {
    const user = await req.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified) {
      // Don't reveal whether email exists
      return res.json({ ok: true });
    }

    const verifyToken = crypto.randomBytes(32).toString("hex");
    await req.prisma.user.update({
      where: { id: user.id },
      data: { verifyToken },
    });

    sendVerificationEmail(email, verifyToken).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error("[AUTH] Resend error:", err);
    res.status(500).json({ error: "Ошибка" });
  }
});

// ─── POST /api/auth/reset-request ─────────────────────────
router.post("/reset-request", async (req, res) => {
  const parse = resetRequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0].message });
  }
  const { email } = parse.data;

  try {
    const user = await req.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json({ ok: true, message: "Если email существует, письмо отправлено" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExp = new Date(Date.now() + 3600000); // 1 hour

    await req.prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExp },
    });

    sendResetEmail(email, resetToken).catch(() => {});

    res.json({ ok: true, message: "Если email существует, письмо отправлено" });
  } catch (err) {
    console.error("[AUTH] Reset request error:", err);
    res.status(500).json({ error: "Ошибка сброса пароля" });
  }
});

// ─── POST /api/auth/reset-confirm ─────────────────────────
router.post("/reset-confirm", async (req, res) => {
  const parse = resetConfirmSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0].message });
  }
  const { token, password } = parse.data;

  try {
    const user = await req.prisma.user.findFirst({
      where: { resetToken: token, resetTokenExp: { gt: new Date() } },
    });
    if (!user) {
      return res.status(400).json({ error: "Токен устарел или неверен" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await req.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExp: null },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[AUTH] Reset confirm error:", err);
    res.status(500).json({ error: "Ошибка сброса пароля" });
  }
});

// ─── POST /api/auth/change-password ───────────────────────
router.post("/change-password", authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Не авторизован" });

  const parse = changePasswordSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0].message });
  }
  const { currentPassword, newPassword } = parse.data;

  try {
    const user = await req.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ error: "У аккаунта нет пароля (вход через соцсеть)" });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Неверный текущий пароль" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await req.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[AUTH] Change password error:", err);
    res.status(500).json({ error: "Ошибка смены пароля" });
  }
});

// ─── GET /api/auth/google ──────────────────────────────────
// Initiate Google OAuth flow
router.get("/google", (req, res) => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_REDIRECT_URI = `${process.env.FRONTEND_URL || "https://streambro.ru"}/api/auth/google/callback`;

  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: "Google OAuth не настроен" });
  }

  // Encode redirect info in state (base64 JSON)
  const redirect = req.query.redirect || "web";
  const state = Buffer.from(JSON.stringify({ r: redirect, n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  const scope = "openid email profile";

  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scope)}&` +
    `state=${state}`;

  res.redirect(url);
});

// ─── GET /api/auth/google/callback ────────────────────────
router.get("/google/callback", async (req, res) => {
  const { code, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`/login?oauth_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return res.redirect("/login?oauth_error=no_code");
  }

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REDIRECT_URI = `${process.env.FRONTEND_URL || "https://streambro.ru"}/api/auth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("[AUTH] Google token exchange failed:", await tokenRes.text());
      return res.redirect("/login?oauth_error=token_failed");
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    // Get user profile
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return res.redirect("/login?oauth_error=profile_failed");
    }

    const profile = await profileRes.json();
    const googleId = profile.sub;
    const email = profile.email;
    const name = profile.name || email.split("@")[0];
    const avatar = profile.picture || null;

    // Find or create user
    const result = await _findOrCreateOAuthUser(req, {
      provider: "google",
      providerId: googleId,
      email,
      name,
      avatar,
      accessToken,
      refreshToken: tokens.refresh_token || null,
    });

    setTokenCookie(res, result.token);

    // Decode state to determine redirect
    let redirectTo = "/dashboard";
    let isAppRedirect = false;
    try {
      const stateObj = JSON.parse(Buffer.from(req.query.state, "base64url").toString());
      if (stateObj.r === "app") {
        isAppRedirect = true;
        redirectTo = `streambro://login?token=${encodeURIComponent(result.token)}&username=${encodeURIComponent(result.user.username)}&id=${result.user.id}&email=${encodeURIComponent(result.user.email || "")}`;
      }
    } catch {}

    if (isAppRedirect) {
      // Show a clean close-this-window page to prevent browser opening extra tabs
      const escaped = redirectTo.replace(/'/g, "\\'");
      return res.send(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>StreamBro</title>
<style>body{font-family:system-ui,sans-serif;background:#08081a;color:#ececef;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px}h2{margin:0;font-size:1.4rem}p{margin:0;color:#a4a4ac;font-size:0.9rem}.check{font-size:3rem}</style>
</head><body><div class="check">✅</div><h2>Вы вошли в StreamBro</h2><p>Это окно можно закрыть. Приложение уже получило доступ.</p>
<script>try{window.location.href='${escaped}';}catch(e){}setTimeout(()=>{try{window.close();}catch(e){}},2000);</script></body></html>`);
    }

    res.redirect(redirectTo);
  } catch (err) {
    console.error("[AUTH] Google OAuth error:", err);
    res.redirect("/login?oauth_error=server_error");
  }
});

// ─── GET /api/auth/vk ─────────────────────────────────────
// Initiate VK OAuth flow (VK ID API with PKCE)
router.get("/vk", (req, res) => {
  const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
  const VK_REDIRECT_URI = `${process.env.FRONTEND_URL || "https://streambro.ru"}/api/auth/vk/callback`;

  if (!VK_CLIENT_ID) {
    return res.status(500).json({ error: "VK OAuth не настроен" });
  }

  // PKCE: generate code_verifier and code_challenge (S256)
  const codeVerifier = crypto.randomBytes(32).toString("base64url"); // 43 chars
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const redirect = req.query.redirect || "web";
  const state = Buffer.from(JSON.stringify({ r: redirect, n: crypto.randomBytes(8).toString("hex") })).toString("base64url");

  // Store code_verifier in a short-lived cookie for the callback
  res.cookie("vk_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600000, // 10 min (code lifetime)
  });

  const url = `https://id.vk.ru/authorize?` +
    `response_type=code&` +
    `client_id=${VK_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(VK_REDIRECT_URI)}&` +
    `state=${state}&` +
    `scope=email&` +
    `code_challenge=${codeChallenge}&` +
    `code_challenge_method=S256`;

  res.redirect(url);
});

// ─── GET /api/auth/vk/callback ──────────────────────────────
router.get("/vk/callback", async (req, res) => {
  const { code, error: oauthError, state: returnedState, device_id } = req.query;

  if (oauthError) {
    return res.redirect(`/login?oauth_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return res.redirect("/login?oauth_error=no_code");
  }

  const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
  const VK_REDIRECT_URI = `${process.env.FRONTEND_URL || "https://streambro.ru"}/api/auth/vk/callback`;
  const codeVerifier = req.cookies?.vk_code_verifier;

  if (!codeVerifier) {
    console.error("[AUTH] VK callback: missing code_verifier cookie");
    return res.redirect("/login?oauth_error=pkce_missing");
  }

  // Clear the PKCE cookie
  res.clearCookie("vk_code_verifier");

  try {
    // Exchange code for tokens (VK ID API with PKCE)
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: VK_CLIENT_ID,
      code_verifier: codeVerifier,
      redirect_uri: VK_REDIRECT_URI,
      state: returnedState || "",
    });
    if (device_id) tokenParams.set("device_id", device_id);

    const tokenRes = await fetch("https://id.vk.ru/oauth2/auth", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("[AUTH] VK token exchange failed:", tokenRes.status, errText);
      return res.redirect("/login?oauth_error=token_failed");
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    const vkId = String(tokens.user_id);

    // Get user info from VK API
    const userInfoRes = await fetch(`https://api.vk.com/method/users.get?access_token=${accessToken}&fields=photo_200&v=5.131`);
    const userInfo = await userInfoRes.json();

    if (userInfo.error) {
      console.error("[AUTH] VK user info error:", userInfo.error);
      return res.redirect("/login?oauth_error=profile_failed");
    }

    const vkUser = userInfo.response[0];
    const name = `${vkUser.first_name} ${vkUser.last_name}`.trim();
    const avatar = vkUser.photo_200 || null;
    // Email comes from token response scope, not from users.get
    const email = tokens.email || `vk${vkId}@streambro.oauth`;

    const result = await _findOrCreateOAuthUser(req, {
      provider: "vk",
      providerId: vkId,
      email,
      name,
      avatar,
      accessToken,
      refreshToken: tokens.refresh_token || null,
    });

    setTokenCookie(res, result.token);

    // Decode state to determine redirect
    let redirectTo = "/dashboard";
    let isAppRedirect = false;
    try {
      const stateObj = JSON.parse(Buffer.from(returnedState || req.query.state || "", "base64url").toString());
      if (stateObj.r === "app") {
        isAppRedirect = true;
        redirectTo = `streambro://login?token=${encodeURIComponent(result.token)}&username=${encodeURIComponent(result.user.username)}&id=${result.user.id}&email=${encodeURIComponent(result.user.email || "")}`;
      }
    } catch {}

    if (isAppRedirect) {
      const escaped = redirectTo.replace(/'/g, "\\'");
      return res.send(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>StreamBro</title>
<style>body{font-family:system-ui,sans-serif;background:#08081a;color:#ececef;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px}h2{margin:0;font-size:1.4rem}p{margin:0;color:#a4a4ac;font-size:0.9rem}.check{font-size:3rem}</style>
</head><body><div class="check">✅</div><h2>Вы вошли в StreamBro</h2><p>Это окно можно закрыть. Приложение уже получило доступ.</p>
<script>try{window.location.href='${escaped}';}catch(e){}setTimeout(()=>{try{window.close();}catch(e){}},2000);</script></body></html>`);
    }

    res.redirect(redirectTo);
  } catch (err) {
    console.error("[AUTH] VK OAuth error:", err);
    res.redirect("/login?oauth_error=server_error");
  }
});

// ─── Helper: find or create OAuth user ─────────────────────
async function _findOrCreateOAuthUser(req, { provider, providerId, email, name, avatar, accessToken, refreshToken }) {
  // 1. Check if account already exists
  const existingAccount = await req.prisma.account.findUnique({
    where: { provider_providerId: { provider, providerId } },
    include: { user: true },
  });

  if (existingAccount) {
    // Update tokens
    await req.prisma.account.update({
      where: { id: existingAccount.id },
      data: { accessToken, refreshToken },
    });

    // Update avatar if changed
    if (avatar && avatar !== existingAccount.user.avatarUrl) {
      await req.prisma.user.update({
        where: { id: existingAccount.userId },
        data: { avatarUrl: avatar },
      });
    }

    const user = existingAccount.user;
    const token = signToken({ id: user.id, email: user.email, username: user.username, role: user.role });
    return { user, token, isNew: false };
  }

  // 2. Check if email already exists (merge accounts)
  const existingUser = await req.prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    // Link OAuth account to existing user
    await req.prisma.account.create({
      data: {
        userId: existingUser.id,
        provider,
        providerId,
        accessToken,
        refreshToken,
      },
    });

    if (avatar && !existingUser.avatarUrl) {
      await req.prisma.user.update({
        where: { id: existingUser.id },
        data: { avatarUrl: avatar },
      });
    }

    const token = signToken({ id: existingUser.id, email: existingUser.email, username: existingUser.username, role: existingUser.role });
    return { user: existingUser, token, isNew: false };
  }

  // 3. Create new user + account
  // Generate a readable username: use the name (latin chars only), fallback to "user" + numeric suffix
  let baseName = name.replace(/[^a-zA-Z0-9_-]/g, "").substring(0, 18);
  if (!baseName || baseName.length < 2) baseName = "user";

  // Ensure uniqueness: append 4-digit numeric suffix
  let username = baseName + Math.floor(1000 + Math.random() * 9000);
  // Check if taken, try again up to 5 times
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await req.prisma.user.findUnique({ where: { username } });
    if (!taken) break;
    username = baseName + Math.floor(1000 + Math.random() * 9000);
  }

  const user = await req.prisma.user.create({
    data: {
      email,
      username,
      displayName: name,
      avatarUrl: avatar,
      passwordHash: null, // OAuth-only user
      emailVerified: true, // OAuth emails are pre-verified
      subscription: {
        create: {
          plan: "FREE",
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date("2099-12-31"),
        },
      },
      accounts: {
        create: {
          provider,
          providerId,
          accessToken,
          refreshToken,
        },
      },
    },
  });

  const token = signToken({ id: user.id, email: user.email, username: user.username, role: user.role });

  // Auto-friend with StreamBro support user
  try {
    const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (supportUser) {
      await req.prisma.friendship.create({
        data: { requesterId: supportUser.id, addresseeId: user.id, status: "ACCEPTED" },
      });
    }
  } catch (e) {
    console.warn("[AUTH] Auto-friend with support failed:", e.message);
  }

  return { user, token, isNew: true };
}

module.exports = router;
