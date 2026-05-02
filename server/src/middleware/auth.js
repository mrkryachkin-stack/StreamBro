const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  const token =
    req.cookies?.token ||
    req.headers.authorization?.replace("Bearer ", "");

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

module.exports = { authMiddleware, adminMiddleware };
