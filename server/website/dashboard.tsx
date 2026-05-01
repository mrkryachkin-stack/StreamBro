"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";

type User = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  subscription: {
    plan: string;
    status: string;
    currentPeriodEnd: string;
    cancelAtEnd: boolean;
  } | null;
};

type DownloadInfo = {
  version: string;
  platform: string;
  filename: string;
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [download, setDownload] = useState<DownloadInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [userData, downloadData] = await Promise.all([
          api.get<User>("/user/me"),
          api.get<DownloadInfo>("/download/latest"),
        ]);
        setUser(userData);
        setEditName(userData.displayName || userData.username);
        setDownload(downloadData);
      } catch {
        document.cookie = "token=; path=/; max-age=0";
        window.location.href = "/login";
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSaveName() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const updated = await api.patch<User>("/user/me", { displayName: editName.trim() });
      setUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await api.post("/auth/logout");
    document.cookie = "token=; path=/; max-age=0";
    window.location.href = "/";
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-0)" }}>
        <div style={{ textAlign: "center" }}>
          <Image src="/logo.png" alt="" width={48} height={48} style={{ borderRadius: 12, opacity: 0.5, marginBottom: 12 }} />
          <p style={{ color: "var(--text-2)" }}>Загрузка...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)" }}>
      {/* Header */}
      <header
        style={{
          padding: "0 2rem",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/logo.png" alt="StreamBro" width={28} height={28} style={{ borderRadius: 6 }} />
          <span style={{ fontWeight: 800, fontSize: "1rem" }}>StreamBro</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link href="/" className="btn-ghost" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}>
            На главную
          </Link>
          <button className="btn-ghost" onClick={handleLogout} style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}>
            Выйти
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "2rem" }}>
          Личный кабинет
        </h1>

        {error && (
          <div
            style={{
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: "var(--radius-sm)",
              padding: "0.75rem 1rem",
              marginBottom: "1.5rem",
              color: "var(--error)",
              fontSize: "0.9rem",
            }}
          >
            {error}
          </div>
        )}

        {/* ──── Profile ──── */}
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "2rem",
            marginBottom: "1.25rem",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1.25rem" }}>Профиль</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-1)" }}>
                Отображаемое имя
              </label>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <input
                  type="text"
                  className="input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-gold"
                  onClick={handleSaveName}
                  disabled={saving}
                  style={{ padding: "0.55rem 1.25rem", fontSize: "0.85rem", opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", color: "var(--text-2)", fontSize: "0.9rem" }}>
              <span>@{user.username}</span>
              <span>{user.email}</span>
              <span>С {new Date(user.createdAt).toLocaleDateString("ru-RU")}</span>
              {!user.emailVerified && (
                <span style={{ color: "var(--gold)" }}>Email не подтверждён</span>
              )}
            </div>
          </div>
        </div>

        {/* ──── Download ──── */}
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "2rem",
            marginBottom: "1.25rem",
          }}
        >
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1.25rem" }}>Скачать приложение</h3>

          {download && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  StreamBro v{download.version}
                </p>
                <p style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>
                  Windows x64 &middot; {download.filename}
                </p>
              </div>
              <a href="/api/download/portable/StreamBro-1.1.0-portable.zip" className="btn-gold" style={{ padding: "0.7rem 1.5rem", fontSize: "0.9rem" }}>
                Скачать
              </a>
            </div>
          )}
        </div>

        {/* ──── P2P / TURN ──── */}
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "2rem",
            marginBottom: "1.25rem",
          }}
        >
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>P2P со-стрим</h3>
          <p style={{ color: "var(--text-1)", fontSize: "0.95rem", marginBottom: "1rem" }}>
            Для P2P со-стрима с другом, введите в настройках приложения (раздел P2P) код комнаты или эти TURN-данные:
          </p>
          <div
            style={{
              background: "var(--bg-1)",
              padding: "1rem 1.25rem",
              borderRadius: "var(--radius-sm)",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              color: "var(--text-1)",
              marginBottom: "1rem",
            }}
          >
            turns:streambro.ru:5349
          </div>
          <p style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>
            TURN-сервер обеспечивает соединение, когда оба стримера за симметричным NAT.
            Сигналинг: <code>wss://streambro.ru/signaling</code>
          </p>
        </div>

        {/* ──── How to connect ──── */}
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "2rem",
          }}
        >
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>Как начать стримить</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {[
              { step: "1", title: "Скачайте приложение", desc: "Ссылка выше — распакуйте zip и запустите StreamBro.exe" },
              { step: "2", title: "Добавьте источники", desc: "Камера, экран, окно, изображение — кнопка \"+\" в приложении" },
              { step: "3", title: "Настройте аудио", desc: "Микшер с шумодавом, EQ, компрессором для каждого источника" },
              { step: "4", title: "Введите stream key", desc: "Из Twitch/YouTube/Kick — в настройках стрима. Ключ шифруется на вашем ПК" },
              { step: "5", title: "Нажмите «Стрим»", desc: "Всё! RTMP через FFmpeg, автопереподключение, запись в MP4" },
            ].map((item) => (
              <div key={item.step} style={{ display: "flex", gap: "1rem", alignItems: "start" }}>
                <div
                  style={{
                    minWidth: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "var(--gold-dim)",
                    color: "var(--gold)",
                    fontWeight: 800,
                    fontSize: "0.95rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid rgba(255,210,60,0.2)",
                  }}
                >
                  {item.step}
                </div>
                <div>
                  <p style={{ fontWeight: 600, marginBottom: "0.15rem", fontSize: "0.95rem" }}>{item.title}</p>
                  <p style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
