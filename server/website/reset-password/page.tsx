"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";

export default function ResetPasswordPage() {
  const [mode, setMode] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);

  // Check if token is in URL params (from email link)
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken && mode === "request") {
      setToken(urlToken);
      setMode("confirm");
    }
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/reset-request", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/reset-confirm", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", background: "#0a0a12" }}>
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12, padding: "3rem 2.5rem", width: "100%", maxWidth: 420,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
          <Image src="/logo.png" alt="StreamBro" width={32} height={32} style={{ borderRadius: 8 }} />
          <span style={{ fontWeight: 800, fontSize: "1.15rem", color: "#fff" }}>StreamBro</span>
        </div>

        {done ? (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ color: "#22c55e", fontWeight: 700, marginBottom: "1rem" }}>{"Пароль изменён!"}</h2>
            <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
              {"Теперь вы можете войти с новым паролем."}
            </p>
            <Link href="/login" style={{
              display: "inline-block", padding: "0.6rem 1.5rem", borderRadius: 8,
              background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)",
              textDecoration: "none", fontSize: "0.9rem",
            }}>{"Войти"}</Link>
          </div>
        ) : mode === "request" ? (
          <>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff", marginBottom: "0.5rem" }}>{"Сброс пароля"}</h1>
            <p style={{ color: "#94a3b8", marginBottom: "2rem", fontSize: "0.95rem" }}>
              {"Введите email — мы отправим ссылку для сброса пароля."}
            </p>

            {sent ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>&#x2709;</div>
                <p style={{ color: "#c4b5fd", fontWeight: 600, marginBottom: "0.5rem" }}>{"Письмо отправлено!"}</p>
                <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                  {"Если email существует, письмо придёт в течение минуты."}
                </p>
              </div>
            ) : (
              <form onSubmit={handleRequest}>
                {error && (
                  <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#f87171", fontSize: "0.9rem" }}>{error}</div>
                )}
                <div style={{ marginBottom: "2rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>Email</label>
                  <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                </div>
                <button type="submit" className="btn-gold" disabled={loading} style={{ width: "100%", opacity: loading ? 0.6 : 1, background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)" }}>
                  {loading ? "Отправка..." : "Отправить ссылку"}
                </button>
              </form>
            )}

            <p style={{ textAlign: "center", marginTop: "1.5rem" }}>
              <Link href="/login" style={{ color: "#94a3b8", fontSize: "0.85rem", textDecoration: "none" }}>{"Вернуться ко входу"}</Link>
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff", marginBottom: "0.5rem" }}>{"Новый пароль"}</h1>
            <p style={{ color: "#94a3b8", marginBottom: "2rem", fontSize: "0.95rem" }}>
              {"Введите новый пароль для вашего аккаунта."}
            </p>

            <form onSubmit={handleConfirm}>
              {error && (
                <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#f87171", fontSize: "0.9rem" }}>{error}</div>
              )}
              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{"Новый пароль"}</label>
                <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={"Минимум 8 символов"} required minLength={8} />
              </div>
              <button type="submit" className="btn-gold" disabled={loading} style={{ width: "100%", opacity: loading ? 0.6 : 1, background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)" }}>
                {loading ? "Сохранение..." : "Сбросить пароль"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
