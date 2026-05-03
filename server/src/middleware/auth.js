const jwt = require("jsonwebtoken");

// CSRF protection: verify Origin/Referer for state-changing cookie-auth requests
// Desktop app uses Bearer token → skipped. Web dashboard uses cookie → checked.
function csrfMiddleware(req, res, next) {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!mutating) return next();

  // Skip if request uses Bearer token (desktop app, safe against CSRF by design)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return next();

  // Skip OAuth routes (they use GET for redirects, not state-changing)
  if (req.path.startsWith('/api/auth/google') || req.path.startsWith('/api/auth/vk')) return next();

  // Check Origin header
  const origin = req.headers.origin || req.headers.referer;
  const allowed = [
    process.env.FRONTEND_URL || 'https://streambro.ru',
    'https://streambro.ru',
    'https://www.streambro.ru',
  ];

  if (origin) {
    const originHost = (() => { try { return new URL(origin).origin; } catch { return origin; } })();
    if (!allowed.some(a => originHost === a || origin.startsWith(a))) {
      return res.status(403).json({ error: 'CSRF: недопустимый источник запроса' });
    }
  }
  next();
}

function authMiddleware(req, res, next) {
  // Authorization header takes priority over cookie (so admin Bearer token works even with stale cookie)
  const authHeader = req.headers.authorization?.replace("Bearer ", "");
  const token = authHeader || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }

  // Allow ADMIN_SECRET to bypass JWT verification for admin routes
  const secret = process.env.ADMIN_SECRET;
  if (secret && token === secret) {
    req.user = { id: "admin", role: "ADMIN", username: "admin" };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Токен истёк" });
    }
    return res.status(401).json({ error: "Невалидный токен" });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Доступ запрещён" });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware, csrfMiddleware };
