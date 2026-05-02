// StreamBro — Email sender via Resend API
// 100 emails/day free tier — enough for verification + password reset

const BASE_URL = process.env.FRONTEND_URL || "https://streambro.ru";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@streambro.ru";

async function sendMail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[MAIL LOG] No RESEND_API_KEY — To: ${to} | Subject: ${subject}`);
    console.log(`[MAIL LOG] Link: ${html.match(/href="([^"]+)"/)?.[1] || "(no link)"}`);
    return { logged: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `StreamBro <${FROM_EMAIL}>`,
        to: [to],
        subject,
        html,
      }),
    });

    const data = await res.json();

    if (res.ok) {
      console.log(`[MAIL] Sent via Resend to ${to}: ${data.id}`);
      return { sent: true, id: data.id };
    }

    console.error(`[MAIL] Resend error (${res.status}):`, JSON.stringify(data));
    return { error: data };
  } catch (err) {
    console.error(`[MAIL] Resend fetch error: ${err.message}`);
    return { error: err.message };
  }
}

// ─── Email templates ───

async function sendVerificationEmail(email, verifyToken) {
  const verifyUrl = `${BASE_URL}/api/auth/verify-email?token=${verifyToken}`;
  return sendMail(email, "Подтвердите ваш email — StreamBro", `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:2rem">
      <div style="text-align:center;margin-bottom:2rem">
        <h1 style="color:#8b5cf6;font-size:1.5rem;margin:0">StreamBro</h1>
        <p style="color:#6b7280;margin:0.5rem 0 0">Подтверждение email</p>
      </div>
      <div style="background:#f9fafb;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem">
        <p style="margin:0 0 1rem;color:#374151">Нажмите кнопку ниже, чтобы подтвердить ваш email:</p>
        <a href="${verifyUrl}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:0.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600">Подтвердить email</a>
      </div>
      <p style="color:#9ca3af;font-size:0.8rem;margin:0">Если вы не регистрировались на StreamBro, проигнорируйте это письмо.</p>
      <p style="color:#9ca3af;font-size:0.75rem;margin:0.5rem 0 0">Ссылка действительна 24 часа.</p>
    </div>
  `);
}

async function sendResetEmail(email, resetToken) {
  const resetUrl = `${BASE_URL}/reset-password?token=${resetToken}`;
  return sendMail(email, "Сброс пароля — StreamBro", `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:2rem">
      <div style="text-align:center;margin-bottom:2rem">
        <h1 style="color:#8b5cf6;font-size:1.5rem;margin:0">StreamBro</h1>
        <p style="color:#6b7280;margin:0.5rem 0 0">Сброс пароля</p>
      </div>
      <div style="background:#f9fafb;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem">
        <p style="margin:0 0 1rem;color:#374151">Нажмите кнопку ниже, чтобы установить новый пароль:</p>
        <a href="${resetUrl}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:0.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600">Сбросить пароль</a>
      </div>
      <p style="color:#9ca3af;font-size:0.8rem;margin:0">Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
      <p style="color:#9ca3af;font-size:0.75rem;margin:0.5rem 0 0">Ссылка действительна 1 час.</p>
    </div>
  `);
}

module.exports = { sendMail, sendVerificationEmail, sendResetEmail };
