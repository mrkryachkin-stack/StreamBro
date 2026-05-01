"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";

export default function RegisterPage() {
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<{ user: { id: string; username: string }; token: string }>("/auth/register", form);
      document.cookie = `token=${res.token}; path=/; max-age=${7 * 86400}; samesite=lax`;
      // Check if there's a deep-link redirect (from desktop app)
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect");
      if (redirect === "app") {
        // Redirect back to app via deep-link
        window.location.href = `streambro://login?token=${encodeURIComponent(res.token)}&username=${encodeURIComponent(res.user.username)}`;
      } else {
        window.location.href = "/dashboard";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "var(--bg-0)",
        position: "relative",
      }}
    >
      {/* Glow */}
      <div
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 500,
          height: 500,
          background: "radial-gradient(ellipse, var(--gold-dim) 0%, transparent 60%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "3rem 2.5rem",
          width: "100%",
          maxWidth: 420,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
          <Image src="/logo.png" alt="StreamBro" width={32} height={32} style={{ borderRadius: 8 }} />
          <span style={{ fontWeight: 800, fontSize: "1.15rem" }}>StreamBro</span>
        </div>

        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "0.5rem" }}>
          Создать аккаунт
        </h1>
        <p style={{ color: "var(--text-1)", marginBottom: "2rem", fontSize: "0.95rem" }}>
          Аккаунт нужен для P2P со-стрима и друзей.
          Скачивание и стриминг работают без аккаунта.
        </p>

        {error && (
          <div
            style={{
              background: "rgba(248, 113, 113, 0.08)",
              border: "1px solid rgba(248, 113, 113, 0.2)",
              borderRadius: "var(--radius-sm)",
              padding: "0.75rem 1rem",
              marginBottom: "1.25rem",
              color: "var(--error)",
              fontSize: "0.9rem",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-1)" }}>
              Email
            </label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              required
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-1)" }}>
              Имя пользователя
            </label>
            <input
              type="text"
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="streamer42"
              required
              minLength={3}
              maxLength={24}
            />
          </div>

          <div style={{ marginBottom: "2rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-1)" }}>
              Пароль
            </label>
            <input
              type="password"
              className="input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Минимум 8 символов"
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            className="btn-gold"
            disabled={loading}
            style={{ width: "100%", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Регистрация..." : "Создать аккаунт"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "2rem", color: "var(--text-2)", fontSize: "0.9rem" }}>
          Уже есть аккаунт?{" "}
          <Link href="/login" style={{ color: "var(--gold)", fontWeight: 600 }}>
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
