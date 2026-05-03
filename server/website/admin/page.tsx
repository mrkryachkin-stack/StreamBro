"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";

type User = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  _count: { accounts: number };
  banned?: boolean;
};

type Stats = {
  totalUsers: number;
  activeToday: number;
  streamingNow: number;
  totalStreams: number;
  activeRooms: number;
  totalBugs: number;
  recentUsers: number;
  streamsByPlatform: { platform: string; count: number }[];
};

type Room = {
  id: string;
  code: string;
  name: string | null;
  maxPeers: number;
  createdAt: string;
  creator: { id: string; username: string; displayName: string | null };
  members: { userId: string; role: string; user: { id: string; username: string; displayName: string; avatarUrl: string | null } }[];
};

const TABS = ["stats", "users", "rooms", "bugs", "feedback", "announce"] as const;
type Tab = (typeof TABS)[number];

// Authenticated fetch — adds ADMIN_SECRET from sessionStorage if available
function adminFetch(path: string, options: RequestInit = {}) {
  const secret = typeof window !== "undefined" ? sessionStorage.getItem("admin_secret") : null;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (secret) headers["Authorization"] = `Bearer ${secret}`;
  return fetch(path, { ...options, headers, credentials: "include" });
}

interface FeedbackConv { partner: { id: string; username: string; displayName: string | null; avatarUrl: string | null }; messages: { id: string; content: string; fromSupport: boolean; edited: boolean; createdAt: string }[]; lastMessage: { id: string; content: string; fromSupport: boolean; edited: boolean; createdAt: string }; unread: number }

function FeedbackSection() {
  const [convos, setConvos] = useState<FeedbackConv[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sent, setSent] = useState(0);

  // Auto-poll every 10s for new messages
  useEffect(() => {
    const load = () => {
      adminFetch("/api/admin/feedback").then(r => r.json()).then(d => { if (d.conversations) setConvos(d.conversations); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [sent]);

  // Mark as read when opening a conversation
  useEffect(() => {
    if (!selectedId) return;
    adminFetch(`/api/admin/feedback/${selectedId}/read`, { method: "POST" })
      .then(() => {
        // Optimistically clear unread badge
        setConvos(prev => prev.map(c => c.partner.id === selectedId ? { ...c, unread: 0 } : c));
      })
      .catch(() => {});
  }, [selectedId]);

  const selected = convos.find(c => c.partner.id === selectedId);
  const msgs = selected?.messages || [];

  const handleReply = async () => {
    if (!selectedId || !replyText.trim()) return;
    await adminFetch("/api/admin/feedback/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: selectedId, content: replyText.trim() }) });
    setReplyText("");
    setSent(s => s + 1);
  };

  return (
    <div style={{ display: "flex", gap: "1rem", minHeight: 400 }}>
      <div style={{ flex: "0 0 260px", overflowY: "auto", borderRight: "1px solid rgba(255,255,255,0.06)", paddingRight: "1rem" }}>
        <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.5rem" }}>{"Пользователи"}</div>
        {convos.map(c => (
          <div key={c.partner.id} onClick={() => setSelectedId(c.partner.id)} style={{ padding: "0.5rem 0.6rem", borderRadius: 6, cursor: "pointer", marginBottom: 4, background: selectedId === c.partner.id ? "rgba(139,92,246,0.12)" : "transparent" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{c.partner.displayName || c.partner.username}</span>
              {c.unread > 0 && <span style={{ fontSize: "0.7rem", background: "#ef4444", color: "#fff", borderRadius: 8, padding: "0.1rem 0.4rem" }}>{c.unread}</span>}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.lastMessage?.content?.slice(0, 40)}</div>
          </div>
        ))}
        {convos.length === 0 && <div style={{ color: "#64748b", fontSize: "0.85rem" }}>{"Нет обращений"}</div>}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {selected ? (
          <>
            <div style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.95rem" }}>{selected.partner.displayName || selected.partner.username}</div>
            <div style={{ flex: 1, overflowY: "auto", marginBottom: "0.5rem", maxHeight: 350 }}>
              {msgs.slice().reverse().map(m => (
                <div key={m.id} style={{ marginBottom: "0.4rem", textAlign: m.fromSupport ? "right" : "left" }}>
                  <span style={{ display: "inline-block", padding: "0.4rem 0.7rem", borderRadius: 8, fontSize: "0.85rem", background: m.fromSupport ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.06)", maxWidth: "80%" }}>{m.content}</span>
                  <div style={{ fontSize: "0.65rem", color: "#475569" }}>{new Date(m.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Ответить..." style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem", color: "#e2e8f0", fontSize: "0.85rem" }} onKeyDown={e => { if (e.key === "Enter") handleReply(); }} />
              <button onClick={handleReply} disabled={!replyText.trim()} style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", fontWeight: 600, opacity: replyText.trim() ? 1 : 0.5 }}>{"→"}</button>
            </div>
          </>
        ) : (
          <div style={{ color: "#64748b", fontSize: "0.85rem", padding: "2rem 0" }}>{"Выберите пользователя слева"}</div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bugs, setBugs] = useState<unknown[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [announceMsg, setAnnounceMsg] = useState("");
  const [announceSent, setAnnounceSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/stats");
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      const data = await res.json();
      setStats(data);
    } catch {
      setError("Нет доступа");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await adminFetch(`/api/admin/users?page=${page}&limit=25${search ? `&search=${encodeURIComponent(search)}` : ""}`);
      const data = await res.json();
      setUsers(data.users);
      setTotalPages(data.pages);
    } catch {
      setError("Ошибка загрузки пользователей");
    }
  }, [page, search]);

  const loadRooms = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/rooms");
      const data = await res.json();
      setRooms(data);
    } catch {
      setError("Ошибка загрузки комнат");
    }
  }, []);

  const loadBugs = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/bugs");
      const data = await res.json();
      setBugs(Array.isArray(data) ? data : data.bugs || []);
    } catch {
      setError("Ошибка загрузки багов");
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (activeTab === "users") loadUsers();
    if (activeTab === "rooms") loadRooms();
    if (activeTab === "bugs") loadBugs();
  }, [activeTab, loadUsers, loadRooms, loadBugs]);

  async function handleRoleChange(userId: string, role: string) {
    try {
      await adminFetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      loadUsers();
    } catch {
      setError("Ошибка смены роли");
    }
  }

  async function handleBan(userId: string, banned: boolean) {
    try {
      await adminFetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ banned }) });
      loadUsers();
    } catch {
      setError("Ошибка блокировки");
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm("Удалить пользователя навсегда?")) return;
    try {
      await adminFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      loadUsers();
    } catch {
      setError("Ошибка удаления");
    }
  }

  async function handleAnnounce() {
    if (!announceMsg.trim()) return;
    try {
      await adminFetch("/api/admin/announce", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: announceMsg.trim() }) });
      setAnnounceSent(true);
      setAnnounceMsg("");
      setTimeout(() => setAnnounceSent(false), 3000);
    } catch {
      setError("Ошибка рассылки");
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a12", color: "#94a3b8" }}>
        {"Загрузка..."}
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a12", color: "#f87171" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a12", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
          <Image src="/logo.png" alt="SB" width={28} height={28} style={{ borderRadius: 6 }} />
          <h1 style={{ fontSize: "1.3rem", fontWeight: 800, margin: 0 }}>{"Admin Panel"}</h1>
          <button
            onClick={() => { sessionStorage.removeItem("admin_secret"); window.location.href = "/admin/login"; }}
            style={{ marginLeft: "auto", padding: "0.4rem 0.8rem", borderRadius: 8, background: "rgba(255,255,255,0.04)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", fontSize: "0.8rem" }}
          >
            {"Выйти"}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "0.5rem 1rem", borderRadius: 8, border: "none", cursor: "pointer",
                background: activeTab === tab ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.04)",
                color: activeTab === tab ? "#c4b5fd" : "#94a3b8", fontWeight: 600, fontSize: "0.85rem",
              }}
            >
              {tab === "stats" ? "Статистика" : tab === "users" ? "Пользователи" : tab === "rooms" ? "Комнаты" : tab === "bugs" ? "Баг-репорты" : "Рассылка"}
            </button>
          ))}
        </div>

        {error && <div style={{ color: "#f87171", marginBottom: "1rem", fontSize: "0.85rem" }}>{error}</div>}

        {/* Stats */}
        {activeTab === "stats" && stats && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: "1.5rem" }}>
              {[
                { label: "Всего пользователей", value: stats.totalUsers },
                { label: "Активных сегодня", value: stats.activeToday },
                { label: "Стримят сейчас", value: stats.streamingNow },
                { label: "Всего стримов", value: stats.totalStreams },
                { label: "Активных комнат", value: stats.activeRooms },
                { label: "Баг-репортов", value: stats.totalBugs },
                { label: "Новых за 30 дней", value: stats.recentUsers },
              ].map((card) => (
                <div key={card.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "1rem" }}>
                  <div style={{ color: "#6b7280", fontSize: "0.75rem", marginBottom: 4 }}>{card.label}</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{card.value}</div>
                </div>
              ))}
            </div>
            {stats.streamsByPlatform.length > 0 && (
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "1rem" }}>
                <div style={{ color: "#6b7280", fontSize: "0.75rem", marginBottom: 8 }}>{"Стримы по платформам"}</div>
                {stats.streamsByPlatform.map((s) => (
                  <div key={s.platform} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "0.85rem" }}>
                    <span>{s.platform}</span><span style={{ fontWeight: 700 }}>{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Users */}
        {activeTab === "users" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: "1rem" }}>
              <input
                className="input"
                placeholder="Поиск по имени/email..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "#e2e8f0", fontSize: "0.85rem" }}
              />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ color: "#6b7280", textAlign: "left" }}>
                    <th style={{ padding: "0.5rem" }}>{"Имя"}</th>
                    <th style={{ padding: "0.5rem" }}>{"Email"}</th>
                    <th style={{ padding: "0.5rem" }}>{"Роль"}</th>
                    <th style={{ padding: "0.5rem" }}>{"Верифицирован"}</th>
                    <th style={{ padding: "0.5rem" }}>{"OAuth"}</th>
                    <th style={{ padding: "0.5rem" }}>{"Создан"}</th>
                    <th style={{ padding: "0.5rem" }}>{"Действия"}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", opacity: u.banned ? 0.5 : 1 }}>
                      <td style={{ padding: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {u.avatarUrl && <img src={u.avatarUrl} alt="" width={24} height={24} style={{ borderRadius: "50%" }} />}
                          <div>
                            <div style={{ fontWeight: 600 }}>{u.displayName || u.username}</div>
                            <div style={{ color: "#6b7280", fontSize: "0.75rem" }}>@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "0.5rem", color: "#94a3b8" }}>{u.email}</td>
                      <td style={{ padding: "0.5rem" }}>
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          style={{ background: u.role === "ADMIN" ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.04)", color: u.role === "ADMIN" ? "#c4b5fd" : "#94a3b8", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: "2px 6px", fontSize: "0.8rem" }}
                        >
                          <option value="USER">USER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </td>
                      <td style={{ padding: "0.5rem" }}>{u.emailVerified ? "Да" : "Нет"}</td>
                      <td style={{ padding: "0.5rem" }}>{u._count?.accounts || 0}</td>
                      <td style={{ padding: "0.5rem", color: "#6b7280", fontSize: "0.75rem" }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td style={{ padding: "0.5rem" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => handleBan(u.id, !u.banned)}
                            style={{ padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: "0.75rem",
                              background: u.banned ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.15)",
                              color: u.banned ? "#22c55e" : "#f87171" }}
                          >
                            {u.banned ? "Разбан" : "Бан"}
                          </button>
                          <button
                            onClick={() => handleDelete(u.id)}
                            style={{ padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: "0.75rem",
                              background: "rgba(248,113,113,0.08)", color: "#f87171" }}
                          >
                            {"Удалить"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: "1rem", alignItems: "center" }}>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.04)", color: "#94a3b8" }}>{"<"}</button>
              <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.04)", color: "#94a3b8" }}>{">"}</button>
            </div>
          </div>
        )}

        {/* Rooms */}
        {activeTab === "rooms" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rooms.length === 0 && <div style={{ color: "#6b7280" }}>{"Нет активных комнат"}</div>}
            {rooms.map((r) => (
              <div key={r.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>{r.code}</span>
                  <span style={{ color: "#6b7280", fontSize: "0.75rem" }}>{r.members.length}/{r.maxPeers}</span>
                </div>
                <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                  {"Создатель: "}{r.creator.displayName || r.creator.username}
                  {" | Участники: "}{r.members.map((m) => m.user.displayName || m.user.username).join(", ")}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bugs */}
        {activeTab === "bugs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {bugs.length === 0 && <div style={{ color: "#6b7280" }}>{"Нет баг-репортов"}</div>}
            {bugs.map((b: any, i: number) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{b.title || b.type || "Bug"}</div>
                <pre style={{ color: "#94a3b8", fontSize: "0.75rem", whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(b, null, 2).substring(0, 500)}</pre>
              </div>
            ))}
          </div>
        )}

        {/* Feedback */}
        {activeTab === "feedback" && <FeedbackSection />}

        {/* Announce */}
        {activeTab === "announce" && (
          <div style={{ maxWidth: 600 }}>
            <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              {"Отправить объявление всем онлайн-пользователям"}
            </div>
            <textarea
              value={announceMsg}
              onChange={(e) => setAnnounceMsg(e.target.value)}
              placeholder="Текст объявления..."
              rows={4}
              style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.75rem", color: "#e2e8f0", fontSize: "0.9rem", resize: "vertical", marginBottom: "0.75rem" }}
            />
            <button
              onClick={handleAnnounce}
              disabled={!announceMsg.trim()}
              style={{ padding: "0.5rem 1.5rem", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", fontWeight: 600, opacity: announceMsg.trim() ? 1 : 0.5 }}
            >
              {"Отправить"}
            </button>
            {announceSent && <span style={{ marginLeft: 12, color: "#22c55e", fontSize: "0.85rem" }}>{"Отправлено!"}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
