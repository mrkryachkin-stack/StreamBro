"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";

export default function RegisterPage() {
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Redirect to dashboard if already logged in
  useEffect(() => {
    document.title = "StreamBro — Регистрация";
    fetch("/api/user/test-cookie", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.hasCookie) window.location.href = "/dashboard"; })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<{ user: { id: string; username: string; email: string }; token: string }>("/auth/register", form);
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect");
      if (redirect === "app") {
        window.location.href = `streambro://login?token=${encodeURIComponent(res.token)}&username=${encodeURIComponent(res.user.username)}`;
      } else {
        // Show verification prompt instead of going straight to dashboard
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", background: "#0a0a12" }}>
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12, padding: "3rem 2.5rem", width: "100%", maxWidth: 420, textAlign: "center",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>&#x2709;</div>
          <h2 style={{ color: "#c4b5fd", fontWeight: 700, marginBottom: "0.75rem" }}>{"Проверьте почту"}</h2>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            {"Мы отправили письмо на "}{form.email}{". Нажмите ссылку в письме для подтверждения email."}
          </p>
          <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "1.5rem" }}>
            {"Без подтверждения email некоторые функции могут быть ограничены."}
          </p>
          <a href="/dashboard" style={{
            display: "inline-block", padding: "0.6rem 1.5rem", borderRadius: 8,
            background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)",
            textDecoration: "none", fontSize: "0.9rem",
          }}>{"Перейти в кабинет"}</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", background: "#0a0a12", position: "relative" }}>
      <div style={{
        position: "absolute", top: "30%", left: "50%", transform: "translate(-50%, -50%)",
        width: 500, height: 500, background: "radial-gradient(ellipse, rgba(139,92,246,0.08) 0%, transparent 60%)", pointerEvents: "none",
      }} />

      <div style={{
        position: "relative", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12, padding: "3rem 2.5rem", width: "100%", maxWidth: 420,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
          <Image src="/logo.png" alt="StreamBro" width={32} height={32} style={{ borderRadius: 8 }} />
          <span style={{ fontWeight: 800, fontSize: "1.15rem", color: "#fff" }}>StreamBro</span>
        </div>

        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "0.5rem", color: "#fff" }}>
          {"Создать аккаунт"}
        </h1>
        <p style={{ color: "#94a3b8", marginBottom: "2rem", fontSize: "0.95rem" }}>
          {"Аккаунт нужен для P2P со-стрима и друзей. Скачивание работает без аккаунта."}
        </p>

        {error && (
          <div style={{
            background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#f87171", fontSize: "0.9rem",
          }}>{error}</div>
        )}

        {/* OAuth buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <a href="/api/auth/google" style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
            padding: "0.65rem 1rem", borderRadius: 8, fontSize: "0.9rem", fontWeight: 500,
            background: "#fff", color: "#1f2937", textDecoration: "none", border: "1px solid rgba(0,0,0,0.1)",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            {"Войти через Google"}
          </a>
          <a href="/api/auth/vk" style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
            padding: "0.65rem 1rem", borderRadius: 8, fontSize: "0.9rem", fontWeight: 500,
            background: "#0077FF", color: "#fff", textDecoration: "none", border: "1px solid rgba(0,119,255,0.3)",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.391 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.862-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.12-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.779.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.203.17-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.17.508.271.508.22 0 .407-.136.813-.542 1.27-1.422 2.18-3.606 2.18-3.606.119-.254.322-.491.762-.491h1.744c.525 0 .643.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .779.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.744-.576.744z"/></svg>
            {"Войти через VK"}
          </a>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
          <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>{"или"}</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>Email</label>
            <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" required />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{"Имя пользователя"}</label>
            <input type="text" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="streamer42" required minLength={3} maxLength={24} />
          </div>

          <div style={{ marginBottom: "2rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{"Пароль"}</label>
            <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={"Минимум 8 символов"} required minLength={8} />
          </div>

          <button type="submit" className="btn-gold" disabled={loading} style={{ width: "100%", opacity: loading ? 0.6 : 1, background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)" }}>
            {loading ? "Регистрация..." : "Создать аккаунт"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "2rem", color: "#6b7280", fontSize: "0.9rem" }}>
          {"Уже есть аккаунт? "}
          <Link href="/login" style={{ color: "#c4b5fd", fontWeight: 600, textDecoration: "none" }}>{"Войти"}</Link>
        </p>
      </div>
    </div>
  );
}
