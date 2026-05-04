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

const TABS = ["stats", "streams", "users", "rooms", "bugs", "feedback", "ai", "announce", "security", "audit"] as const;
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

interface FeedbackMsg { id: string; content: string; fromSupport: boolean; edited: boolean; read: boolean; createdAt: string; isAi?: boolean; aiProvider?: string; aiCorrected?: boolean; aiCorrection?: string }
interface FeedbackConv { partner: { id: string; username: string; displayName: string | null; avatarUrl: string | null }; messages: FeedbackMsg[]; lastMessage: FeedbackMsg; unread: number; aiPaused?: boolean }

function FeedbackSection() {
  const [convos, setConvos] = useState<FeedbackConv[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sent, setSent] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

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

  const handleEditMsg = async (messageId: string) => {
    if (!editText.trim()) return;
    await adminFetch(`/api/admin/feedback/message/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editText.trim() }),
    });
    setEditingId(null);
    setEditText("");
    setSent(s => s + 1);
  };

  const handleDeleteMsg = async (messageId: string) => {
    if (!confirm("Удалить сообщение? Пользователь тоже его не увидит.")) return;
    await adminFetch(`/api/admin/feedback/message/${messageId}`, { method: "DELETE" });
    setSent(s => s + 1);
  };

  const toggleAiPause = async (userId: string, currentlyPaused: boolean) => {
    const endpoint = currentlyPaused ? `/api/admin/ai/resume/${userId}` : `/api/admin/ai/pause/${userId}`;
    await adminFetch(endpoint, { method: "POST" }).catch(() => {});
    // Refresh conversations
    const r = await adminFetch("/api/admin/feedback");
    const d = await r.json();
    if (d.conversations) setConvos(d.conversations);
  };

  return (
    <div style={{ display: "flex", gap: "1rem", minHeight: 400 }}>
      <div style={{ flex: "0 0 280px", overflowY: "auto", borderRight: "1px solid rgba(255,255,255,0.06)", paddingRight: "1rem" }}>
        <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between" }}>
          <span>Обращения</span>
          <span style={{ color: convos.reduce((s,c) => s + c.unread, 0) > 0 ? "#ef4444" : "#64748b" }}>
            Новых: {convos.reduce((s,c) => s + c.unread, 0)}
          </span>
        </div>
        {convos.slice().sort((a,b) => b.unread - a.unread || (new Date(b.lastMessage?.createdAt || 0).getTime() - new Date(a.lastMessage?.createdAt || 0).getTime())).map(c => {
          const hasUnread = c.unread > 0;
          return (
            <div key={c.partner.id} onClick={() => setSelectedId(c.partner.id)} style={{
              padding: "0.55rem 0.65rem",
              borderRadius: 6,
              cursor: "pointer",
              marginBottom: 4,
              background: selectedId === c.partner.id
                ? "rgba(139,92,246,0.18)"
                : hasUnread ? "rgba(239,68,68,0.08)" : "transparent",
              borderLeft: hasUnread ? "3px solid #ef4444" : (selectedId === c.partner.id ? "3px solid #8b5cf6" : "3px solid transparent"),
              transition: "background 0.15s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: hasUnread ? 700 : 600, color: hasUnread ? "#fef2f2" : "#e2e8f0" }}>{c.partner.displayName || c.partner.username}</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {c.aiPaused && <span style={{ fontSize: "0.6rem", background: "rgba(251,191,36,0.2)", color: "#fbbf24", borderRadius: 4, padding: "0.1rem 0.3rem" }}>AI пауза</span>}
                  {hasUnread && <span style={{ fontSize: "0.7rem", background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0.1rem 0.45rem", fontWeight: 700 }}>{c.unread}</span>}
                </div>
              </div>
              <div style={{ fontSize: "0.75rem", color: hasUnread ? "#fca5a5" : "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                {c.lastMessage?.fromSupport ? "Вы: " : ""}{c.lastMessage?.content?.slice(0, 50)}
              </div>
            </div>
          );
        })}
        {convos.length === 0 && <div style={{ color: "#64748b", fontSize: "0.85rem" }}>{"Нет обращений"}</div>}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {selected ? (
          <>
            <div style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.95rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span>{selected.partner.displayName || selected.partner.username}</span>
                <span style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: 400, marginLeft: 8 }}>@{selected.partner.username}</span>
              </div>
              <button
                onClick={() => toggleAiPause(selected.partner.id, !!selected.aiPaused)}
                style={{
                  fontSize: "0.7rem",
                  padding: "0.25rem 0.6rem",
                  borderRadius: 6,
                  border: "1px solid",
                  cursor: "pointer",
                  fontWeight: 600,
                  background: selected.aiPaused ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.12)",
                  borderColor: selected.aiPaused ? "rgba(34,197,94,0.3)" : "rgba(251,191,36,0.3)",
                  color: selected.aiPaused ? "#4ade80" : "#fbbf24",
                }}
              >
                {selected.aiPaused ? "▶ Возобновить AI" : "⏸ Приостановить AI"}
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", marginBottom: "0.5rem", maxHeight: 350, padding: "0.25rem 0.4rem" }}>
              {msgs.slice().reverse().map(m => {
                const isUnread = !m.fromSupport && !m.read;
                const isEditing = editingId === m.id;
                return (
                  <div key={m.id} style={{ marginBottom: "0.5rem", textAlign: m.fromSupport ? "right" : "left", position: "relative" }}>
                    <span style={{
                      display: "inline-block",
                      padding: "0.45rem 0.75rem",
                      borderRadius: 10,
                      fontSize: "0.85rem",
                      background: m.fromSupport ? (m.isAi ? "rgba(34,197,94,0.12)" : "rgba(139,92,246,0.18)") : (isUnread ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.06)"),
                      border: isUnread ? "1px solid rgba(239,68,68,0.5)" : (m.isAi ? "1px solid rgba(34,197,94,0.25)" : "1px solid transparent"),
                      maxWidth: "80%",
                    }}>
                      {isUnread && <span style={{ display: "inline-block", marginRight: 6, fontSize: "0.65rem", background: "#ef4444", color: "#fff", borderRadius: 4, padding: "0.05rem 0.35rem", fontWeight: 700, verticalAlign: "middle" }}>NEW</span>}
                      {m.isAi && <span style={{ display: "inline-block", marginRight: 6, fontSize: "0.6rem", background: "rgba(34,197,94,0.2)", color: "#4ade80", borderRadius: 4, padding: "0.05rem 0.3rem", fontWeight: 700, verticalAlign: "middle" }}>AI</span>}
                      {isEditing ? (
                        <span style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                          <input value={editText} onChange={e => setEditText(e.target.value)} style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(139,92,246,0.4)", borderRadius: 6, padding: "0.25rem 0.5rem", color: "#e2e8f0", fontSize: "0.85rem" }} onKeyDown={e => { if (e.key === "Enter") handleEditMsg(m.id); if (e.key === "Escape") { setEditingId(null); setEditText(""); } }} autoFocus />
                          <button onClick={() => handleEditMsg(m.id)} style={{ background: "rgba(34,197,94,0.2)", border: "none", color: "#4ade80", cursor: "pointer", borderRadius: 4, padding: "0.15rem 0.4rem", fontSize: "0.75rem" }}>✓</button>
                          <button onClick={() => { setEditingId(null); setEditText(""); }} style={{ background: "rgba(239,68,68,0.15)", border: "none", color: "#fca5a5", cursor: "pointer", borderRadius: 4, padding: "0.15rem 0.4rem", fontSize: "0.75rem" }}>✕</button>
                        </span>
                      ) : (
                        <>
                          {m.content}
                          {m.edited && <span style={{ marginLeft: 6, fontSize: "0.65rem", color: "#64748b", fontStyle: "italic" }}>{"(ред.)"}</span>}
                        </>
                      )}
                    </span>
                    {!isEditing && (
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginTop: 2 }}>
                        <span style={{ fontSize: "0.65rem", color: isUnread ? "#fca5a5" : "#475569" }}>
                          {m.fromSupport ? (m.isAi ? `AI (${m.aiProvider || "?"}) → пользователь` : "Вы → пользователь") : isUnread ? "✉ Не прочитано" : "✓ Прочитано"} · {new Date(m.createdAt).toLocaleString()}
                        </span>
                        <button onClick={() => { setEditingId(m.id); setEditText(m.content); }} title="Редактировать" style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "0.7rem", padding: "0 0.2rem" }}>✏️</button>
                        <button onClick={() => handleDeleteMsg(m.id)} title="Удалить" style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "0.7rem", padding: "0 0.2rem" }}>🗑</button>
                      </div>
                    )}
                  </div>
                );
              })}
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

function BugsSection({ bugs, onDeleteBug }: { bugs: any[]; onDeleteBug: (id: string) => void }) {
  const [filterType, setFilterType] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Group by type
  const types = Array.from(new Set(bugs.map((b: any) => b.type || "unknown"))).sort();
  const filtered = filterType === "all" ? bugs : bugs.filter((b: any) => (b.type || "unknown") === filterType);
  const grouped = types.map(t => ({ type: t, count: bugs.filter((b: any) => (b.type || "unknown") === t).length }));

  const TYPE_LABELS: Record<string, string> = {
    unknown: "Неизвестно", crash: "Краш", error: "Ошибка", audio: "Аудио", streaming: "Стриминг", ui: "Интерфейс", network: "Сеть", config: "Настройки",
  };
  const TYPE_COLORS: Record<string, string> = {
    unknown: "#94a3b8", crash: "#ef4444", error: "#f59e0b", audio: "#8b5cf6", streaming: "#3b82f6", ui: "#10b981", network: "#f97316", config: "#6366f1",
  };

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {grouped.map(g => (
          <button key={g.type} onClick={() => setFilterType(filterType === g.type ? "all" : g.type)}
            style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid", cursor: "pointer",
              background: filterType === g.type ? `${TYPE_COLORS[g.type] || "#94a3b8"}22` : "rgba(255,255,255,0.03)",
              borderColor: filterType === g.type ? `${TYPE_COLORS[g.type] || "#94a3b8"}55` : "rgba(255,255,255,0.06)",
              color: filterType === g.type ? (TYPE_COLORS[g.type] || "#94a3b8") : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
            {TYPE_LABELS[g.type] || g.type}: {g.count}
          </button>
        ))}
        <span style={{ color: "#64748b", fontSize: "0.8rem", alignSelf: "center" }}>Всего: {bugs.length}</span>
      </div>

      {/* Bug list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.length === 0 && <div style={{ color: "#6b7280" }}>Нет баг-репортов</div>}
        {filtered.slice(0, 50).map((b: any) => {
          const isExp = expanded === b.id;
          const color = TYPE_COLORS[b.type] || "#94a3b8";
          return (
            <div key={b.id} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${color}22`, borderRadius: 8, padding: "0.6rem 0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span style={{ fontSize: "0.7rem", background: `${color}22`, color, borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 700 }}>
                    {TYPE_LABELS[b.type] || b.type || "?"}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{b.message?.slice(0, 80) || b.title || "Без описания"}</span>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  {b.appVersion && <span style={{ fontSize: "0.7rem", color: "#64748b" }}>v{b.appVersion}</span>}
                  <span style={{ fontSize: "0.7rem", color: "#64748b" }}>{new Date(b.createdAt).toLocaleDateString()}</span>
                  <button onClick={() => setExpanded(isExp ? null : b.id)} style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", cursor: "pointer" }}>
                    {isExp ? "Скрыть" : "Подробнее"}
                  </button>
                  {onDeleteBug && <button onClick={() => onDeleteBug(b.id)} style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", borderRadius: 4, border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: "#ef4444", cursor: "pointer" }}>✕</button>}
                </div>
              </div>
              {isExp && (
                <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: 6, fontSize: "0.75rem" }}>
                  {b.message && <div style={{ marginBottom: 4, color: "#e2e8f0" }}><strong>Сообщение:</strong> {b.message}</div>}
                  {b.stackTrace && <div style={{ marginBottom: 4 }}><strong style={{ color: "#94a3b8" }}>Стек:</strong> <pre style={{ color: "#f59e0b", fontSize: "0.7rem", whiteSpace: "pre-wrap", margin: 0, maxHeight: 150, overflowY: "auto" }}>{b.stackTrace.slice(0, 1000)}</pre></div>}
                  {b.profileId && <div style={{ color: "#64748b" }}>Профиль: {b.profileId}</div>}
                  {b.ip && <div style={{ color: "#64748b" }}>IP: {b.ip}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AiBotSection() {
  const [stats, setStats] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    adminFetch("/api/admin/ai/stats").then(r => r.json()).then(setStats).catch(() => {});
    adminFetch("/api/admin/ai/conversations?limit=20").then(r => r.json()).then(d => { setConversations(d.items || []); setTotal(d.total || 0); }).catch(() => {});
  }, []);

  const toggleBot = async () => {
    if (!stats) return;
    await adminFetch("/api/admin/ai/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !stats.enabled }) });
    const r = await adminFetch("/api/admin/ai/stats");
    setStats(await r.json());
  };

  if (!stats) return <div style={{ color: "#64748b" }}>Загрузка...</div>;

  return (
    <div>
      {/* Status card */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "1rem", minWidth: 200 }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "0.5rem" }}>Статус бота</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, color: stats.enabled ? "#4ade80" : "#ef4444" }}>{stats.enabled ? "Включён" : "Выключен"}</span>
            <button onClick={toggleBot} style={{ padding: "0.3rem 0.8rem", borderRadius: 6, border: "1px solid", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, background: stats.enabled ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", borderColor: stats.enabled ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)", color: stats.enabled ? "#ef4444" : "#4ade80" }}>
              {stats.enabled ? "Выключить" : "Включить"}
            </button>
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "1rem", minWidth: 120 }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Диалогов</div>
          <div style={{ fontWeight: 700, fontSize: "1.5rem", color: "#e2e8f0" }}>{stats.total || 0}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "1rem", minWidth: 120 }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>За 24ч</div>
          <div style={{ fontWeight: 700, fontSize: "1.5rem", color: "#e2e8f0" }}>{stats.last24h || 0}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "1rem", minWidth: 120 }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Среднее время</div>
          <div style={{ fontWeight: 700, fontSize: "1.5rem", color: "#e2e8f0" }}>{stats.avgResponseMs ? `${stats.avgResponseMs}мс` : "—"}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "1rem", minWidth: 120 }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Исправлено</div>
          <div style={{ fontWeight: 700, fontSize: "1.5rem", color: "#e2e8f0" }}>{stats.corrected || 0}<span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 400 }}> / {stats.total || 0}</span></div>
        </div>
      </div>

      {/* Providers */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Провайдеры</div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(stats.providers || []).map((p: any) => (
            <div key={p.name} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 6, padding: "0.4rem 0.7rem", fontSize: "0.8rem" }}>
              <span style={{ color: "#4ade80", fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: "#64748b" }}> · {p.model} · {p.keyCount} ключ</span>
            </div>
          ))}
          {stats.providers?.length === 0 && <div style={{ color: "#f59e0b", fontSize: "0.85rem" }}>Нет настроенных провайдеров — добавьте API ключи в .env</div>}
        </div>
      </div>

      {/* Recent AI conversations */}
      <div>
        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Последние AI-диалоги ({total})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {conversations.map((c: any) => (
            <div key={c.id} style={{ background: c.corrected ? "rgba(34,197,94,0.05)" : "rgba(255,255,255,0.03)", border: `1px solid ${c.corrected ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, padding: "0.6rem 0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span style={{ fontSize: "0.7rem", background: "rgba(34,197,94,0.2)", color: "#4ade80", borderRadius: 4, padding: "0.1rem 0.3rem", fontWeight: 600 }}>{c.provider}</span>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{c.user?.displayName || c.user?.username || "?"}</span>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  {c.corrected && <span style={{ fontSize: "0.65rem", color: "#4ade80" }}>Исправлено</span>}
                  {c.rating && <span style={{ fontSize: "0.65rem", color: "#fbbf24" }}>{"★".repeat(c.rating)}</span>}
                  <span style={{ fontSize: "0.7rem", color: "#64748b" }}>{c.responseMs}мс</span>
                </div>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#e2e8f0", marginBottom: 2 }}><strong>Q:</strong> {c.question?.slice(0, 120)}</div>
              <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}><strong>A:</strong> {c.answer?.slice(0, 150)}</div>
            </div>
          ))}
          {conversations.length === 0 && <div style={{ color: "#64748b", fontSize: "0.85rem" }}>Пока нет AI-диалогов</div>}
        </div>
      </div>

      {/* Export training data */}
      <div style={{ marginTop: "1.5rem" }}>
        <a href="/api/admin/ai/export" target="_blank" style={{ fontSize: "0.8rem", color: "#8b5cf6", textDecoration: "underline" }}>
          Экспорт тренировочных данных (JSONL для fine-tune)
        </a>
      </div>
    </div>
  );
}

function TwoFactorSection() {
  const [status2fa, setStatus2fa] = useState<boolean | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    adminFetch("/api/admin/2fa/status")
      .then(r => r.json())
      .then(d => setStatus2fa(d.enabled))
      .catch(() => setStatus2fa(false));
  }, []);

  const setup = async () => {
    const r = await adminFetch("/api/admin/2fa/setup", { method: "POST" });
    const d = await r.json();
    if (d.qrCode) { setQrCode(d.qrCode); setSecret(d.secret); }
    else setMsg("❌ " + (d.error || "Ошибка"));
  };

  const verify = async () => {
    const r = await adminFetch("/api/admin/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    if (d.ok) { setMsg("✅ 2FA включена!"); setStatus2fa(true); setQrCode(null); setToken(""); }
    else setMsg("❌ " + (d.error || "Ошибка"));
  };

  const disable = async () => {
    const t = prompt("Введи TOTP код для отключения 2FA:");
    if (!t) return;
    const r = await adminFetch("/api/admin/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t }),
    });
    const d = await r.json();
    if (d.ok) { setMsg("2FA отключена"); setStatus2fa(false); }
    else setMsg("❌ " + (d.error || "Ошибка"));
  };

  if (status2fa === null) return <div style={{ color: "#94a3b8" }}>{"Загрузка..."}</div>;

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <h3 style={{ color: "#8b5cf6", marginTop: 0 }}>{"Двухфакторная аутентификация"}</h3>
      <div style={{ background: "#1a1a2e", padding: 24, borderRadius: 12, border: "1px solid #333" }}>
        <p style={{ margin: "0 0 16px" }}>
          {"Статус: "}
          <strong style={{ color: status2fa ? "#10b981" : "#ef4444" }}>
            {status2fa ? "✅ Включена" : "❌ Отключена"}
          </strong>
        </p>
        {!status2fa && !qrCode && (
          <button
            onClick={setup}
            style={{ background: "#8b5cf6", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
          >
            {"Настроить 2FA"}
          </button>
        )}
        {qrCode && (
          <div>
            <p style={{ color: "#a0aec0", margin: "0 0 8px" }}>{"Отсканируй QR в Google Authenticator:"}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="QR Code" style={{ width: 200, height: 200, display: "block", margin: "0 0 12px" }} />
            <p style={{ fontSize: 12, color: "#718096", margin: "0 0 12px" }}>
              {"Или введи вручную: "}
              <code style={{ background: "#2d3748", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{secret}</code>
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Код из приложения"
                onKeyDown={e => { if (e.key === "Enter") verify(); }}
                style={{ background: "#2d3748", border: "1px solid #4a5568", color: "#fff", padding: "8px 12px", borderRadius: 8, width: 180 }}
              />
              <button
                onClick={verify}
                disabled={!token.trim()}
                style={{ background: "#10b981", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, opacity: token.trim() ? 1 : 0.5 }}
              >
                {"Подтвердить"}
              </button>
            </div>
          </div>
        )}
        {status2fa && (
          <button
            onClick={disable}
            style={{ background: "#ef4444", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontWeight: 600, marginTop: 8 }}
          >
            {"Отключить 2FA"}
          </button>
        )}
        {msg && <p style={{ color: msg.startsWith("❌") ? "#ef4444" : "#10b981", marginTop: 12, marginBottom: 0 }}>{msg}</p>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STREAMS HISTORY SECTION
   ═══════════════════════════════════════════════════════════════ */
function StreamsSection() {
  const [streams, setStreams] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [byPlatform, setByPlatform] = useState<any[]>([]);
  const [avgDuration, setAvgDuration] = useState<number | null>(null);
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [filterActive, setFilterActive] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filterPlatform !== "all") params.set("platform", filterPlatform);
      if (filterActive) params.set("active", "true");
      const r = await adminFetch(`/api/admin/streams?${params}`);
      const d = await r.json();
      setStreams(d.streams || []);
      setTotal(d.total || 0);
      setByPlatform(d.byPlatform || []);
      setAvgDuration(d.avgDuration || null);
    } catch {}
  }, [filterPlatform, filterActive]);

  useEffect(() => { load(); }, [load]);

  const fmtDuration = (s: number | null) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
  };

  const PLATFORM_COLORS: Record<string, string> = {
    twitch: "#9146FF", youtube: "#FF0000", kick: "#53FC18", custom: "#3B82F6",
  };

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        {byPlatform.map((p: any) => (
          <button key={p.platform} onClick={() => setFilterPlatform(filterPlatform === p.platform ? "all" : p.platform)}
            style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid", cursor: "pointer",
              background: filterPlatform === p.platform ? `${PLATFORM_COLORS[p.platform] || "#94a3b8"}22` : "rgba(255,255,255,0.03)",
              borderColor: filterPlatform === p.platform ? `${PLATFORM_COLORS[p.platform] || "#94a3b8"}55` : "rgba(255,255,255,0.06)",
              color: filterPlatform === p.platform ? (PLATFORM_COLORS[p.platform] || "#94a3b8") : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
            {p.platform}: {p._count?.id || 0}
          </button>
        ))}
        <button onClick={() => setFilterActive(!filterActive)}
          style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid", cursor: "pointer",
            background: filterActive ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.03)",
            borderColor: filterActive ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.06)",
            color: filterActive ? "#4ade80" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
          {filterActive ? "Только активные" : "Все"}
        </button>
        <span style={{ color: "#6b7280", fontSize: "0.8rem", alignSelf: "center" }}>Всего: {total}</span>
        {avgDuration && <span style={{ color: "#6b7280", fontSize: "0.8rem", alignSelf: "center" }}>Ср. длительность: {fmtDuration(avgDuration)}</span>}
      </div>

      {/* Stream list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {streams.length === 0 && <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Нет стримов</div>}
        {streams.map((s: any) => {
          const isActive = !s.endedAt;
          const color = PLATFORM_COLORS[s.platform] || "#94a3b8";
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0.8rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, flexWrap: "wrap" }}>
              <span style={{ padding: "0.15rem 0.5rem", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700, background: `${color}18`, color, border: `1px solid ${color}33` }}>{s.platform}</span>
              <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{s.user?.displayName || s.user?.username || "?"}</span>
              {isActive && <span style={{ fontSize: "0.65rem", background: "rgba(34,197,94,0.15)", color: "#4ade80", borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 700 }}>LIVE</span>}
              <span style={{ color: "#6b7280", fontSize: "0.78rem" }}>{fmtDuration(s.duration)}</span>
              {s.reconnects > 0 && <span style={{ color: "#f59e0b", fontSize: "0.7rem" }}>RC: {s.reconnects}</span>}
              <span style={{ color: "#475569", fontSize: "0.72rem", marginLeft: "auto" }}>{new Date(s.startedAt).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AUDIT LOG SECTION
   ═══════════════════════════════════════════════════════════════ */
function AuditSection() {
  const [logs, setLogs] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await adminFetch("/api/admin/audit?limit=100");
      const d = await r.json();
      setLogs(Array.isArray(d) ? d : []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const ACTION_LABELS: Record<string, string> = {
    ban_user: "Бан пользователя", unban_user: "Разбан", delete_user: "Удаление пользователя",
    update_user: "Обновление пользователя", change_role: "Смена роли",
    delete_bug: "Удаление бага", delete_room: "Удаление комнаты",
    ai_toggle: "Вкл/Выкл AI", ai_correct: "Исправление AI", ai_pause: "Пауза AI", ai_resume: "Возобновление AI",
  };
  const ACTION_COLORS: Record<string, string> = {
    ban_user: "#ef4444", unban_user: "#22c55e", delete_user: "#ef4444",
    delete_bug: "#f59e0b", change_role: "#8b5cf6", ai_correct: "#3b82f6",
  };

  return (
    <div>
      <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.75rem" }}>Действия администраторов</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {logs.length === 0 && <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Нет записей</div>}
        {logs.map((l: any) => {
          const color = ACTION_COLORS[l.action] || "#94a3b8";
          const label = ACTION_LABELS[l.action] || l.action;
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.7rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 6, flexWrap: "wrap" }}>
              <span style={{ padding: "0.1rem 0.45rem", borderRadius: 4, fontSize: "0.68rem", fontWeight: 700, background: `${color}18`, color, border: `1px solid ${color}33` }}>{label}</span>
              <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{l.admin?.displayName || l.admin?.username || "admin"}</span>
              {l.targetId && <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>→ {l.targetType || ""} {l.targetId.slice(0, 8)}...</span>}
              {l.details && <span style={{ color: "#475569", fontSize: "0.72rem" }}>({l.details.slice(0, 40)})</span>}
              <span style={{ color: "#475569", fontSize: "0.68rem", marginLeft: "auto" }}>{new Date(l.createdAt).toLocaleString()}</span>
            </div>
          );
        })}
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
      const res = await adminFetch("/api/bugs");
      const data = await res.json();
      setBugs(Array.isArray(data) ? data : data.bugs || []);
    } catch {
      setError("Ошибка загрузки багов");
    }
  }, []);

  const deleteBug = useCallback(async (id: string) => {
    try {
      await adminFetch(`/api/bugs/${id}`, { method: "DELETE" });
      setBugs(prev => (prev as any[]).filter((b: any) => b.id !== id));
    } catch {}
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
              {tab === "stats" ? "Статистика" : tab === "streams" ? "Стримы" : tab === "users" ? "Пользователи" : tab === "rooms" ? "Комнаты" : tab === "bugs" ? "Баг-репорты" : tab === "feedback" ? "Обратная связь" : tab === "ai" ? "AI Бот" : tab === "security" ? "Безопасность" : tab === "audit" ? "Аудит" : "Рассылка"}
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

        {/* Bugs — structured view with grouping by type */}
        {activeTab === "bugs" && (
          <BugsSection bugs={bugs} onDeleteBug={deleteBug} />
        )}

        {/* Feedback */}
        {activeTab === "feedback" && <FeedbackSection />}

        {/* AI Bot */}
        {activeTab === "ai" && <AiBotSection />}

        {/* Security / 2FA */}
        {activeTab === "security" && <TwoFactorSection />}

        {/* Streams History */}
        {activeTab === "streams" && <StreamsSection />}

        {/* Audit Log */}
        {activeTab === "audit" && <AuditSection />}

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
