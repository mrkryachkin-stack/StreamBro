const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const PLANS = require("../config/plans");

// ─── GET /api/subscription/plans ───────────────────────────
router.get("/plans", (_req, res) => {
  res.json(PLANS);
});

// ─── GET /api/subscription/me ─────────────────────────────
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const sub = await req.prisma.subscription.findUnique({
      where: { userId: req.user.id },
    });
    if (!sub) return res.json({ plan: "FREE", status: "ACTIVE" });
    res.json({
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtEnd: sub.cancelAtEnd,
    });
  } catch (err) {
    console.error("[SUB] Me error:", err);
    res.status(500).json({ error: "Ошибка получения подписки" });
  }
});

// ─── POST /api/subscription/create-payment ─────────────────
// Creates a YooKassa payment and returns the confirmation URL
router.post("/create-payment", authMiddleware, async (req, res) => {
  const { planId } = req.body;
  const plan = PLANS[planId];
  if (!plan || planId === "FREE") {
    return res.status(400).json({ error: "Некорректный план" });
  }

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) {
    return res.status(500).json({ error: "Платёжная система не настроена" });
  }

  try {
    const idempotencyKey = crypto.randomUUID();

    const response = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotence-Key": idempotencyKey,
      },
      body: JSON.stringify({
        amount: {
          value: plan.price.toFixed(2),
          currency: plan.currency,
        },
        description: `StreamBro ${plan.name} — подписка на 1 месяц`,
        metadata: {
          userId: req.user.id,
          planId,
        },
        confirmation: {
          type: "redirect",
          return_url: `${process.env.FRONTEND_URL}/dashboard?payment=success`,
        },
        save_payment_method: true,
        capture: true,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[SUB] YooKassa error:", errBody);
      return res.status(502).json({ error: "Ошибка платёжной системы" });
    }

    const payment = await response.json();
    const confirmationUrl = payment.confirmation?.confirmation_url;

    // Store yookassa payment ID for webhook matching
    await req.prisma.subscription.update({
      where: { userId: req.user.id },
      data: { yookassaId: payment.id },
    });

    res.json({ confirmationUrl, paymentId: payment.id });
  } catch (err) {
    console.error("[SUB] Create payment error:", err);
    res.status(500).json({ error: "Ошибка создания платежа" });
  }
});

// ─── POST /api/subscription/webhook ────────────────────────
// YooKassa webhook — no auth (uses signature verification)
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const body = JSON.parse(req.body.toString());
    const event = body.event;

    if (event === "payment.succeeded") {
      const metadata = body.object?.metadata;
      if (!metadata?.userId || !metadata?.planId) {
        console.warn("[SUB] Webhook missing metadata:", body.object?.id);
        return res.sendStatus(200);
      }

      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await req.prisma.subscription.update({
        where: { userId: metadata.userId },
        data: {
          plan: metadata.planId,
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          cancelAtEnd: false,
          yookassaId: body.object.id,
        },
      });

      console.log(`[SUB] Activated ${metadata.planId} for user ${metadata.userId}`);
    } else if (event === "payment.canceled") {
      console.log(`[SUB] Payment canceled: ${body.object?.id}`);
    } else if (event === "payment.waiting_for_capture") {
      console.log(`[SUB] Payment awaiting capture: ${body.object?.id}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[SUB] Webhook error:", err);
    res.sendStatus(200); // always 200 to YooKassa
  }
});

// ─── POST /api/subscription/cancel ─────────────────────────
router.post("/cancel", authMiddleware, async (req, res) => {
  try {
    await req.prisma.subscription.update({
      where: { userId: req.user.id },
      data: { cancelAtEnd: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[SUB] Cancel error:", err);
    res.status(500).json({ error: "Ошибка отмены подписки" });
  }
});

module.exports = router;
