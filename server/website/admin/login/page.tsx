"use client";

import { useState } from "react";
import Image from "next/image";

export default function AdminLoginPage() {
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("admin@streambro.ru");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Try ADMIN_SECRET bearer token directly
      const statsRes = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${secret}` },
        credentials: "include",
      });

      if (statsRes.ok) {
        sessionStorage.setItem("admin_secret", secret);
        window.location.href = "/admin";
        return;
      }

      // Try logging in as admin user
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ login: username, password }),
      });

      if (loginRes.ok) {
        const data = await loginRes.json();
        if (data.user?.role === "ADMIN") {
          window.location.href = "/admin";
          return;
        }
        setError("Этот пользователь не администратор");
      } else {
        setError("Неверный ключ или учётные данные");
      }
    } catch {
      setError("Ошибка подключения");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        credentials: "include",
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        // Now log in as the admin user
        const loginRes = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ login: username, password }),
        });
        if (loginRes.ok) {
          window.location.href = "/admin";
          return;
        }
        setError("Admin создан. Войдите с паролем.");
        setMode("login");
      } else {
        if (data.error?.includes("уже существует")) {
          setError("Admin уже существует. Войдите с его данными.");
          setMode("login");
        } else {
          setError(data.error || "Ошибка создания admin");
        }
      }
    } catch {
      setError("Ошибка подключения");
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
        background: "#0a0a12",
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: "3rem 2.5rem",
          width: "100%",
          maxWidth: 420,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
          <Image src="/logo.png" alt="StreamBro" width={32} height={32} style={{ borderRadius: 8 }} />
          <span style={{ fontWeight: 800, fontSize: "1.15rem", color: "#fff" }}>Admin Panel</span>
        </div>

        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.5rem", color: "#fff" }}>
          {mode === "login" ? "Вход в админку" : "Создание admin"}
        </h1>
        <p style={{ color: "#94a3b8", marginBottom: "2rem", fontSize: "0.95rem" }}>
          {mode === "login"
            ? "Введите ADMIN_SECRET или логин/пароль администратора"
            : "Введите ADMIN_SECRET и данные для нового admin-аккаунта"}
        </p>

        {error && (
          <div
            style={{
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              marginBottom: "1.25rem",
              color: "#f87171",
              fontSize: "0.9rem",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={mode === "login" ? handleLogin : handleSetup}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>
              ADMIN_SECRET
            </label>
            <input
              type="password"
              className="input"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Из .env файла"
              required
            />
          </div>

          {mode === "setup" && (
            <>
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>
                  Имя пользователя
                </label>
                <input
                  type="text"
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                />
              </div>
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>
                  Email
                </label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@streambro.ru"
                  required
                />
              </div>
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>
                  Пароль
                </label>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  required
                  minLength={6}
                />
              </div>
            </>
          )}

          <button
            type="submit"
            className="btn-gold"
            disabled={loading}
            style={{
              width: "100%",
              opacity: loading ? 0.6 : 1,
              background: "rgba(139,92,246,0.2)",
              color: "#c4b5fd",
              border: "1px solid rgba(139,92,246,0.3)",
            }}
          >
            {loading ? "Загрузка..." : mode === "login" ? "Войти" : "Создать admin"}
          </button>
        </form>

        <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
          <button
            onClick={() => setMode(mode === "login" ? "setup" : "login")}
            style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline" }}
          >
            {mode === "login" ? "Создать admin-аккаунт" : "Войти в существующий"}
          </button>
        </div>
      </div>
    </div>
  );
}
