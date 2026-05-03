"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "StreamBro — Вход";
    fetch("/api/user/test-cookie", { credentials: "include" })
      .then((r) => { if (!r.ok) return null; return r.json(); })
      .then((d) => { if (d && d.hasCookie && d.valid !== false) window.location.href = "/dashboard"; })
      .catch(() => {});
  }, []);

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const oauthError = params?.get("oauth_error");
  const verifyStatus = params?.get("verify");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const res = await api.post<{ user: { id: string; username: string }; token: string }>("/auth/login", form);
      const redirect = params?.get("redirect");
      if (redirect === "app") { window.location.href = `streambro://login?token=${encodeURIComponent(res.token)}&username=${encodeURIComponent(res.user.username)}`; }
      else { window.location.href = "/dashboard"; }
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка входа"); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "stretch", background: "var(--bg-0)", position: "relative", overflow: "hidden" }}>
      {/* Background layers */}
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse 70% 60% at 30% 50%, rgba(201,162,39,0.05) 0%, transparent 60%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse 50% 50% at 80% 30%, rgba(124,92,191,0.04) 0%, transparent 60%)", pointerEvents: "none" }} />
      {/* Vertical gold line */}
      <div style={{ position: "fixed", left: "50%", top: 0, bottom: 0, width: 1, background: "linear-gradient(to bottom, transparent, rgba(201,162,39,0.07) 30%, rgba(201,162,39,0.07) 70%, transparent)", pointerEvents: "none" }} />

      {/* Left branding panel (hidden on small) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "4rem 5%", maxWidth: "50%", position: "relative" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: "4rem", textDecoration: "none" }}>
          <Image src="/logo.png" alt="StreamBro" width={32} height={32} style={{ borderRadius: 9 }} />
          <span style={{ fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.025em", color: "var(--text-0)" }}>StreamBro</span>
        </Link>

        <div>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--gold)", display: "block", marginBottom: "0.75rem" }}>Вход в аккаунт</span>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: "1.25rem" }}>
            Добро<br />
            <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "var(--gold)" }}>пожаловать</span>
          </h1>
          <p style={{ color: "var(--text-2)", fontSize: "0.92rem", lineHeight: 1.65, maxWidth: 300 }}>
            Войдите, чтобы получить доступ к друзьям, комнатам со-стрима и облачной синхронизации.
          </p>
        </div>

        {/* Bottom tag */}
        <div style={{ marginTop: "auto", paddingTop: "4rem" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.4rem 0.9rem", borderRadius: 999, background: "rgba(201,162,39,0.06)", border: "1px solid rgba(201,162,39,0.12)", fontSize: "0.75rem", color: "var(--gold)", fontWeight: 600, letterSpacing: "0.04em" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--gold)", display: "inline-block" }} />
            Бесплатно навсегда
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div style={{ width: "50%", display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 5% 3rem 4%" }}>
        <div style={{ width: "100%", maxWidth: 400, animation: "fadeUp 0.6s var(--ease-out)" }}>
          {/* Form card */}
          <div style={{ background: "rgba(15,15,40,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "var(--r-xl)", padding: "2.75rem 2.25rem", backdropFilter: "blur(24px)", boxShadow: "0 32px 80px rgba(0,0,0,0.4)" }}>

            {verifyStatus === "success" && (
              <div style={{ background: "rgba(42,157,92,0.08)", border: "1px solid rgba(42,157,92,0.2)", borderRadius: "var(--r-sm)", padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "var(--success)", fontSize: "0.86rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>✓</span> Email подтверждён!
              </div>
            )}
            {oauthError && (
              <div style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", borderRadius: "var(--r-sm)", padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#f87171", fontSize: "0.86rem" }}>Ошибка входа через соцсеть</div>
            )}
            {error && (
              <div style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", borderRadius: "var(--r-sm)", padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#f87171", fontSize: "0.86rem" }}>{error}</div>
            )}

            {/* OAuth */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.5rem" }}>
              <a href="/api/auth/google" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.65rem", padding: "0.7rem 1rem", borderRadius: "var(--r-sm)", fontSize: "0.87rem", fontWeight: 600, background: "#fff", color: "#1f2937", textDecoration: "none", border: "1px solid rgba(0,0,0,0.08)", transition: "box-shadow 0.2s ease" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Войти через Google
              </a>
              <a href="/api/auth/vk" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.65rem", padding: "0.7rem 1rem", borderRadius: "var(--r-sm)", fontSize: "0.87rem", fontWeight: 600, background: "#0077FF", color: "#fff", textDecoration: "none", border: "1px solid rgba(0,119,255,0.3)", transition: "opacity 0.2s ease" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.391 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.862-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.12-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.779.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.203.17-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.17.508.271.508.22 0 .407-.136.813-.542 1.27-1.422 2.18-3.606 2.18-3.606.119-.254.322-.491.762-.491h1.744c.525 0 .643.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .779.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.744-.576.744z"/></svg>
                Войти через VK
              </a>
            </div>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ color: "var(--text-2)", fontSize: "0.75rem", letterSpacing: "0.06em" }}>или</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.45rem", fontSize: "0.78rem", fontWeight: 600, color: "var(--gold)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Email или имя пользователя</label>
                <input type="text" className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="you@example.com" required />
              </div>

              <div style={{ marginBottom: "1.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.45rem", fontSize: "0.78rem", fontWeight: 600, color: "var(--gold)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Пароль</label>
                <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Введите пароль" required />
              </div>

              <button type="submit" className="btn-gold" disabled={loading} style={{ width: "100%", opacity: loading ? 0.6 : 1, cursor: loading ? "wait" : "pointer" }}>
                {loading ? "Вход..." : "Войти в аккаунт"}
              </button>
            </form>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
              <Link href="/reset-password" style={{ color: "var(--text-2)", fontSize: "0.8rem", transition: "color 0.2s" }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "var(--text-1)"; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "var(--text-2)"; }}
              >Забыли пароль?</Link>
              <Link href="/register" style={{ color: "var(--gold)", fontWeight: 600, fontSize: "0.8rem" }}>
                Регистрация →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
