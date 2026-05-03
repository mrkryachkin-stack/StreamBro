"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";

type User = {
  id: string; email: string; username: string;
  displayName: string | null; avatarUrl: string | null;
  bio: string | null; status: string; role: string;
  emailVerified: boolean; createdAt: string;
  subscription: { plan: string; status: string; currentPeriodEnd: string; cancelAtEnd: boolean } | null;
};
type Friend = { id: string; username: string; displayName: string | null; avatarUrl: string | null; status: string };
type PendingRequest = { friendshipId: string; id: string; username: string; displayName: string | null; avatarUrl: string | null; requestedAt: string };
type Room = { id: string; code: string; name: string | null; maxPeers: number; status: string; createdAt: string; creator: { id: string; username: string; displayName: string | null }; members: { userId: string; role: string; user: { id: string; username: string; displayName: string; avatarUrl: string | null } }[] };
type StreamStats = { totalStreams: number; totalDuration: number; avgDuration: number; byPlatform: Record<string, number>; thisMonthStreams: number; thisMonthDuration: number };
type DownloadInfo = { version: string; platform: string; filename: string };

const STATUS_OPTIONS = [
  { value: "online",    label: "Онлайн",          color: "#22c55e" },
  { value: "streaming", label: "Стримлю",          color: "#f59e0b" },
  { value: "away",      label: "Отошёл",           color: "#94a3b8" },
  { value: "dnd",       label: "Не беспокоить",    color: "#ef4444" },
  { value: "offline",   label: "Не в сети",        color: "#6b7280" },
];

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

/* ─── Avatar helper ─── */
function Avatar({ src, name, size = 52 }: { src: string | null; name: string; size?: number }) {
  const radius = size / 2;
  if (src && (src.startsWith("/") || src.startsWith("http"))) {
    return <img src={src} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(201,162,39,0.2)", display: "block" }} />;
  }
  if (src) {
    return <div style={{ width: size, height: size, borderRadius: "50%", background: "rgba(201,162,39,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.5, border: "2px solid rgba(201,162,39,0.15)" }}>{src}</div>;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "linear-gradient(135deg, rgba(201,162,39,0.15), rgba(124,92,191,0.15))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 700, color: "var(--gold)", border: "2px solid rgba(201,162,39,0.15)" }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/* ─── Status dot ─── */
function StatusDot({ status, size = 12 }: { status: string; size?: number }) {
  const info = STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[4];
  return <div style={{ width: size, height: size, borderRadius: "50%", background: info.color, boxShadow: `0 0 6px ${info.color}80`, border: `2px solid var(--bg-0)`, flexShrink: 0 }} />;
}

/* ─── Section title ─── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-0)", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.65rem" }}>
      <span style={{ display: "block", width: 3, height: "1.1em", background: "var(--gold)", borderRadius: 2, boxShadow: "0 0 8px var(--gold-glow)" }} />
      {children}
    </h2>
  );
}

/* ─── Panel ─── */
function Panel({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="dash-card" style={{ padding: "1.75rem", marginBottom: "1rem", ...style }}>
      {children}
    </div>
  );
}

/* ─── Loading screen ─── */
function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-0)" }}>
      <div style={{ textAlign: "center", animation: "fadeIn 0.4s ease" }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem", animation: "pulseGlow 2.5s ease-in-out infinite" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        </div>
        <p style={{ color: "var(--text-2)", fontSize: "0.85rem", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>Загрузка</p>
        <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 10 }}>
          {[0, 0.15, 0.3].map((d, i) => (
            <div key={i} className="skeleton" style={{ width: 4, height: 4, borderRadius: "50%", animationDelay: `${d}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  useEffect(() => { document.title = "StreamBro — Профиль"; }, []);

  const [user, setUser] = useState<User | null>(null);
  const [download, setDownload] = useState<DownloadInfo | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"profile"|"friends"|"rooms"|"stats"|"download">("profile");

  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editStatus, setEditStatus] = useState("online");
  const [editAvatar, setEditAvatar] = useState("");
  const [saving, setSaving] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; username: string; displayName: string | null; avatarUrl: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const loadData = useCallback(async () => {
    try {
      const userData = await api.get<User>("/user/me");
      setUser(userData);
      setEditName(userData.displayName || userData.username);
      setEditBio(userData.bio || "");
      setEditStatus(userData.status || "online");
      setEditAvatar(userData.avatarUrl || "");
      api.get<DownloadInfo>("/download/latest").then(setDownload).catch(() => {});
      api.get<Friend[]>("/friends").then(setFriends).catch(() => {});
      api.get<PendingRequest[]>("/friends/pending").then(setPending).catch(() => {});
      api.get<Room[]>("/rooms/mine/list").then(setRooms).catch(() => {});
      api.get<StreamStats>("/stream-events/stats").then(setStreamStats).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as any)?.status || (err as any)?.statusCode;
      if (status === 401 || status === 403 || msg.includes("401") || msg.includes("403") || msg.includes("авториза") || msg.includes("Токен") || msg.includes("Невалид")) {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
        document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = "/login";
        return;
      }
      setError("Ошибка загрузки данных. Попробуйте обновить страницу.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSaveProfile() {
    setSaving(true);
    try {
      const updated = await api.patch<User>("/user/profile", { displayName: editName.trim(), bio: editBio.trim(), status: editStatus, avatarUrl: editAvatar.trim() || null });
      setUser(updated); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }

  async function handleLogout() {
    await api.post("/auth/logout").catch(() => {});
    window.location.href = "/";
  }

  async function handleSearch() {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const results = await api.get<{ id: string; username: string; displayName: string | null; avatarUrl: string | null }[]>(`/friends/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(results);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }

  async function handleSendRequest(userId: string) {
    try { await api.post("/friends/request", { userId }); setSearchResults((p) => p.filter((u) => u.id !== userId)); }
    catch (err) { setError(err instanceof Error ? err.message : "Ошибка"); }
  }

  async function handleAccept(friendshipId: string) {
    try { await api.post("/friends/accept", { friendshipId }); setPending((p) => p.filter((r) => r.friendshipId !== friendshipId)); api.get<Friend[]>("/friends").then(setFriends).catch(() => {}); }
    catch (err) { setError(err instanceof Error ? err.message : "Ошибка"); }
  }

  async function handleReject(friendshipId: string) {
    try { await api.post("/friends/reject", { friendshipId }); setPending((p) => p.filter((r) => r.friendshipId !== friendshipId)); }
    catch (err) { setError(err instanceof Error ? err.message : "Ошибка"); }
  }

  async function handleRemoveFriend(friendId: string) {
    try { await api.delete(`/friends/${friendId}`); setFriends((p) => p.filter((f) => f.id !== friendId)); }
    catch (err) { setError(err instanceof Error ? err.message : "Ошибка"); }
  }

  async function handleCreateRoom() {
    try { const room = await api.post<Room>("/rooms", { name: newRoomName.trim() || null }); setRooms((p) => [room, ...p]); setNewRoomName(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Ошибка создания комнаты"); }
  }

  async function handleLeaveRoom(code: string) {
    try { await api.post(`/rooms/${code}/leave`); setRooms((p) => p.filter((r) => r.code !== code)); }
    catch (err) { setError(err instanceof Error ? err.message : "Ошибка"); }
  }

  async function handleCloudSync() {
    try { await api.put("/settings", { encryptedData: "test", iv: "test" }); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Ошибка синхронизации"); }
  }

  if (loading) return <LoadingScreen />;

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-0)" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "var(--error)", marginBottom: "1rem", fontSize: "0.95rem" }}>{error || "Не удалось загрузить профиль"}</p>
          <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {}); document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;"; window.location.href = "/login"; }} className="dash-btn">{"Войти заново"}</button>
        </div>
      </div>
    );
  }

  const currentStatus = STATUS_OPTIONS.find((s) => s.value === editStatus) || STATUS_OPTIONS[0];
  const tabs = [
    { id: "profile",  label: "Профиль",  icon: "👤" },
    { id: "friends",  label: `Друзья${pending.length > 0 ? ` · ${pending.length}` : ""}`, icon: "👥" },
    { id: "rooms",    label: "Комнаты",  icon: "🎮" },
    { id: "stats",    label: "Статистика", icon: "📊" },
    { id: "download", label: "Скачать",  icon: "⬇" },
  ] as const;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)" }}>
      {/* Header */}
      <header style={{
        padding: "0 2.5rem", height: 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(5,5,16,0.94)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(201,162,39,0.07)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <Image src="/logo.png" alt="StreamBro" width={26} height={26} style={{ borderRadius: 6 }} />
          <span style={{ fontWeight: 800, fontSize: "0.98rem", letterSpacing: "-0.02em", color: "var(--text-0)" }}>StreamBro</span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* User info */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Avatar src={user.avatarUrl} name={user.displayName || user.username} size={28} />
              <div style={{ position: "absolute", bottom: -1, right: -1 }}>
                <StatusDot status={user.status} size={9} />
              </div>
            </div>
            <span style={{ fontSize: "0.82rem", color: "var(--text-2)", letterSpacing: "0.01em" }}>@{user.username}</span>
          </div>

          <button onClick={handleLogout} style={{
            padding: "0.35rem 0.9rem", fontSize: "0.78rem", borderRadius: "var(--r-sm)",
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-2)", cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.2s ease",
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(248,113,113,0.3)"; (e.currentTarget as HTMLElement).style.color = "#f87171"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-2)"; }}
          >Выйти</button>
        </div>
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.5rem", display: "flex", gap: "1.5rem" }}>
        {/* Sidebar */}
        <nav style={{ width: 196, flexShrink: 0 }}>
          {/* User card */}
          <div style={{ marginBottom: "1.5rem", padding: "1.25rem", background: "rgba(201,162,39,0.04)", border: "1px solid rgba(201,162,39,0.12)", borderRadius: "var(--r-md)", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ position: "relative" }}>
              <Avatar src={user.avatarUrl} name={user.displayName || user.username} size={44} />
              <div style={{ position: "absolute", bottom: 0, right: 0 }}>
                <StatusDot status={user.status} size={12} />
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-0)", letterSpacing: "-0.01em" }}>{user.displayName || user.username}</p>
              <p style={{ color: "var(--text-2)", fontSize: "0.73rem" }}>@{user.username}</p>
            </div>
            <div style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--gold)", background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.18)", padding: "0.2rem 0.6rem", borderRadius: 999 }}>
              {currentStatus.label}
            </div>
          </div>

          {/* Nav */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`dash-tab ${activeTab === tab.id ? "active" : ""}`}
              >
                <span style={{ fontSize: "0.85rem" }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0, animation: "dashIn 0.3s var(--ease-out)" }}>
          {error && (
            <div style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", borderRadius: "var(--r-sm)", padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#f87171", fontSize: "0.87rem" }}>
              {error}
            </div>
          )}

          {/* ──── PROFILE ──── */}
          {activeTab === "profile" && (
            <div>
              <SectionTitle>Профиль</SectionTitle>

              <Panel>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ position: "relative" }}>
                    <Avatar src={user.avatarUrl} name={user.displayName || user.username} size={64} />
                    <div style={{ position: "absolute", bottom: 2, right: 2 }}>
                      <StatusDot status={user.status} size={14} />
                    </div>
                  </div>
                  <div>
                    <p style={{ fontWeight: 800, fontSize: "1.15rem", color: "var(--text-0)", letterSpacing: "-0.02em" }}>{user.displayName || user.username}</p>
                    <p style={{ color: "var(--text-2)", fontSize: "0.83rem" }}>@{user.username}</p>
                    <p style={{ color: "var(--text-2)", fontSize: "0.78rem", marginTop: 2 }}>{user.email}{!user.emailVerified && <span style={{ color: "#f59e0b", marginLeft: 6 }}>· не подтверждён</span>}</p>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* Avatar upload */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.45rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--gold)", letterSpacing: "0.05em", textTransform: "uppercase" }}>Аватар</label>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      {editAvatar && <img src={editAvatar} alt="" width={42} height={42} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(201,162,39,0.2)" }} />}
                      <label className="dash-btn" style={{ cursor: "pointer", fontSize: "0.8rem" }}>
                        Выбрать файл
                        <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) { setError("Файл слишком большой (макс 2MB)"); return; }
                          try {
                            const fd = new FormData(); fd.append("avatar", file);
                            const res = await fetch(`/api/user/profile/avatar`, { method: "POST", body: fd, credentials: "include" });
                            if (!res.ok) throw new Error("Upload failed");
                            const data = await res.json();
                            setEditAvatar(data.avatarUrl);
                            setUser((u) => u ? { ...u, avatarUrl: data.avatarUrl } : u);
                            setError("");
                          } catch { setError("Ошибка загрузки аватара"); }
                        }} style={{ display: "none" }} />
                      </label>
                      {editAvatar && (
                        <button onClick={async () => {
                          try { await api.patch("/user/profile", { avatarUrl: null }); setEditAvatar(""); setUser((u) => u ? { ...u, avatarUrl: null } : u); }
                          catch { setError("Ошибка удаления аватара"); }
                        }} className="dash-btn-danger">Удалить</button>
                      )}
                    </div>
                    <p style={{ color: "var(--text-2)", fontSize: "0.73rem", marginTop: 4 }}>JPG, PNG, GIF или WebP · до 2 МБ</p>
                  </div>

                  {/* Display name */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.45rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--gold)", letterSpacing: "0.05em", textTransform: "uppercase" }}>Отображаемое имя</label>
                    <input type="text" className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>

                  {/* Bio */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.45rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--gold)", letterSpacing: "0.05em", textTransform: "uppercase" }}>О себе</label>
                    <textarea className="input" value={editBio} onChange={(e) => setEditBio(e.target.value)} placeholder="Расскажите о себе..." maxLength={300} rows={3} style={{ resize: "vertical" }} />
                    <p style={{ fontSize: "0.72rem", color: "var(--text-2)", marginTop: "0.25rem", textAlign: "right" }}>{editBio.length}/300</p>
                  </div>

                  {/* Status */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.45rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--gold)", letterSpacing: "0.05em", textTransform: "uppercase" }}>Статус</label>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {STATUS_OPTIONS.map((s) => (
                        <button key={s.value} onClick={() => setEditStatus(s.value)} style={{
                          padding: "0.35rem 0.8rem", fontSize: "0.78rem", borderRadius: 999,
                          border: `1px solid ${editStatus === s.value ? s.color : "var(--border)"}`,
                          background: editStatus === s.value ? `${s.color}12` : "transparent",
                          color: editStatus === s.value ? s.color : "var(--text-2)",
                          cursor: "pointer", transition: "all 0.18s ease", fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 5,
                        }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, display: "block" }} />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.8rem", color: "var(--text-2)", paddingTop: "0.25rem" }}>
                    <span>С {new Date(user.createdAt).toLocaleDateString("ru-RU")}</span>
                  </div>

                  {/* Password section */}
                  <div style={{ paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                    <button onClick={() => setShowPasswordForm(!showPasswordForm)} style={{ background: "transparent", border: "none", color: "var(--text-2)", fontSize: "0.83rem", cursor: "pointer", padding: 0, fontFamily: "inherit", transition: "color 0.2s" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-0)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-2)"; }}
                    >
                      {showPasswordForm ? "↑ Скрыть" : "Сменить пароль →"}
                    </button>
                    {showPasswordForm && (
                      <div style={{ marginTop: "0.85rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Текущий пароль" />
                        <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль (минимум 8 символов)" minLength={8} />
                        <button onClick={async () => {
                          if (newPassword.length < 8) { setPasswordMsg({ ok: false, text: "Минимум 8 символов" }); return; }
                          setChangingPassword(true); setPasswordMsg(null);
                          try { await api.post("/auth/change-password", { currentPassword, newPassword }); setPasswordMsg({ ok: true, text: "Пароль изменён!" }); setCurrentPassword(""); setNewPassword(""); setShowPasswordForm(false); }
                          catch (err) { setPasswordMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" }); }
                          finally { setChangingPassword(false); }
                        }} className="dash-btn" disabled={changingPassword} style={{ opacity: changingPassword ? 0.6 : 1, cursor: changingPassword ? "wait" : "pointer" }}>
                          {changingPassword ? "Сохранение..." : "Сменить пароль"}
                        </button>
                        {passwordMsg && <p style={{ fontSize: "0.8rem", color: passwordMsg.ok ? "var(--success)" : "var(--error)", margin: 0 }}>{passwordMsg.text}</p>}
                      </div>
                    )}
                  </div>

                  <button className="btn-gold" onClick={handleSaveProfile} disabled={saving} style={{ padding: "0.65rem 1.75rem", fontSize: "0.88rem", alignSelf: "flex-start", opacity: saving ? 0.6 : 1, cursor: saving ? "wait" : "pointer" }}>
                    {saving ? "Сохранение..." : "Сохранить профиль"}
                  </button>
                </div>
              </Panel>

              {/* Cloud sync */}
              <Panel>
                <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-0)", marginBottom: "0.3rem" }}>Облачная синхронизация</h3>
                    <p style={{ color: "var(--text-2)", fontSize: "0.83rem", lineHeight: 1.55, maxWidth: 400 }}>
                      Настройки приложения шифруются (AES-256-GCM) и сохраняются на сервере. Синхронизация между устройствами.
                    </p>
                  </div>
                  <button onClick={handleCloudSync} className="dash-btn">Синхронизировать</button>
                </div>
              </Panel>
            </div>
          )}

          {/* ──── FRIENDS ──── */}
          {activeTab === "friends" && (
            <div>
              <SectionTitle>Друзья</SectionTitle>

              {/* Search */}
              <Panel>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.85rem" }}>Найти пользователя</h3>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input type="text" className="input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Имя пользователя..." style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
                  <button onClick={handleSearch} disabled={searching} className="dash-btn" style={{ opacity: searching ? 0.6 : 1, whiteSpace: "nowrap" }}>{searching ? "Поиск..." : "Найти"}</button>
                </div>
                {searchResults.length > 0 && (
                  <div style={{ marginTop: "0.85rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {searchResults.map((u) => (
                      <div key={u.id} className="friend-row">
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <Avatar src={u.avatarUrl} name={u.displayName || u.username} size={30} />
                          <span style={{ fontSize: "0.88rem", color: "var(--text-0)" }}>{u.displayName || `@${u.username}`}</span>
                        </div>
                        <button onClick={() => handleSendRequest(u.id)} className="dash-btn-accept">Добавить</button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Pending */}
              {pending.length > 0 && (
                <Panel style={{ borderColor: "rgba(245,158,11,0.2)" }}>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.85rem", color: "#f59e0b" }}>
                    Входящие заявки <span style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b", fontSize: "0.72rem", padding: "0.1rem 0.5rem", borderRadius: 999, marginLeft: 4 }}>{pending.length}</span>
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {pending.map((r) => (
                      <div key={r.friendshipId} className="friend-row">
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <Avatar src={r.avatarUrl} name={r.displayName || r.username} size={32} />
                          <span style={{ fontSize: "0.88rem", color: "var(--text-0)" }}>{r.displayName || `@${r.username}`}</span>
                        </div>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button onClick={() => handleAccept(r.friendshipId)} className="dash-btn-accept">Принять</button>
                          <button onClick={() => handleReject(r.friendshipId)} className="dash-btn-danger">Отклонить</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Friends list */}
              <Panel>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.85rem" }}>
                  Ваши друзья <span style={{ color: "var(--text-2)", fontWeight: 400, fontSize: "0.83rem" }}>({friends.length})</span>
                </h3>
                {friends.length === 0 ? (
                  <p style={{ color: "var(--text-2)", fontSize: "0.88rem", textAlign: "center", padding: "1rem 0" }}>Пока нет друзей. Найдите кого-нибудь выше!</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {friends.map((f) => {
                      const statusInfo = STATUS_OPTIONS.find((s) => s.value === f.status) || STATUS_OPTIONS[4];
                      return (
                        <div key={f.id} className="friend-row">
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <div style={{ position: "relative" }}>
                              <Avatar src={f.avatarUrl} name={f.displayName || f.username} size={36} />
                              <div style={{ position: "absolute", bottom: 0, right: 0 }}>
                                <StatusDot status={f.status} size={10} />
                              </div>
                            </div>
                            <div>
                              <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text-0)" }}>{f.displayName || f.username}</p>
                              <p style={{ fontSize: "0.73rem", color: statusInfo.color }}>{statusInfo.label}</p>
                            </div>
                          </div>
                          <button onClick={() => handleRemoveFriend(f.id)} className="dash-btn-danger">Удалить</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>
          )}

          {/* ──── ROOMS ──── */}
          {activeTab === "rooms" && (
            <div>
              <SectionTitle>Комнаты со-стрима</SectionTitle>

              <Panel>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.85rem" }}>Создать комнату</h3>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input type="text" className="input" value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Название (необязательно)" style={{ flex: 1 }} />
                  <button onClick={handleCreateRoom} className="dash-btn" style={{ whiteSpace: "nowrap" }}>Создать</button>
                </div>
                <p style={{ color: "var(--text-2)", fontSize: "0.78rem", marginTop: "0.5rem" }}>
                  Код комнаты вводится в приложении (раздел P2P) для со-стрима с друзьями
                </p>
              </Panel>

              <Panel>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.85rem" }}>Ваши комнаты</h3>
                {rooms.length === 0 ? (
                  <p style={{ color: "var(--text-2)", fontSize: "0.88rem", textAlign: "center", padding: "1rem 0" }}>Нет активных комнат</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {rooms.map((r) => (
                      <div key={r.id} style={{ padding: "1rem 1.1rem", borderRadius: "var(--r-sm)", background: "rgba(255,255,255,0.025)", border: "1px solid var(--border)", transition: "border-color 0.2s ease" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-gold)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                          <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text-0)" }}>{r.name || `Комната`}</span>
                          <button onClick={() => handleLeaveRoom(r.code)} className="dash-btn-danger">Покинуть</button>
                        </div>
                        <div style={{ fontFamily: "monospace", color: "var(--gold)", fontSize: "0.88rem", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>{r.code}</div>
                        <div style={{ color: "var(--text-2)", fontSize: "0.77rem" }}>
                          {r.members.length}/{r.maxPeers} участников · {r.creator.username}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}

          {/* ──── STATS ──── */}
          {activeTab === "stats" && (
            <div>
              <SectionTitle>Статистика стримов</SectionTitle>
              {streamStats ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(175px,1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
                    {[
                      { label: "Всего стримов",       value: String(streamStats.totalStreams),        accent: true },
                      { label: "Общее время",          value: formatDuration(streamStats.totalDuration),     accent: false },
                      { label: "Средняя длительность", value: formatDuration(streamStats.avgDuration),       accent: false },
                      { label: "Стримов за месяц",     value: String(streamStats.thisMonthStreams),    accent: true },
                      { label: "Время за месяц",       value: formatDuration(streamStats.thisMonthDuration), accent: false },
                    ].map((s) => (
                      <div key={s.label} className="dash-card" style={{ padding: "1.25rem", transition: "all 0.3s ease" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-gold)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
                      >
                        <p style={{ color: "var(--text-2)", fontSize: "0.75rem", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{s.label}</p>
                        <p style={{ color: s.accent ? "var(--gold)" : "var(--text-0)", fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.025em" }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {Object.keys(streamStats.byPlatform).length > 0 && (
                    <Panel>
                      <h3 style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.85rem", color: "var(--text-1)" }}>По платформам</h3>
                      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                        {Object.entries(streamStats.byPlatform).map(([platform, count]) => (
                          <div key={platform} style={{ padding: "0.6rem 1rem", borderRadius: "var(--r-sm)", background: "rgba(255,255,255,0.025)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "0.83rem", color: "var(--text-1)", fontWeight: 500 }}>{platform}</span>
                            <span style={{ fontSize: "1rem", fontWeight: 800, color: "var(--gold)" }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  )}
                </>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem" }}>
                  {[1,2,3,4,5].map((i) => <div key={i} className="skeleton" style={{ height: 88 }} />)}
                </div>
              )}
            </div>
          )}

          {/* ──── DOWNLOAD ──── */}
          {activeTab === "download" && (
            <div>
              <SectionTitle>Скачать приложение</SectionTitle>

              <Panel style={{ borderColor: "var(--border-gold)" }}>
                {download ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                    <div>
                      <p style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--text-0)", letterSpacing: "-0.015em", marginBottom: "0.25rem" }}>
                        StreamBro <span style={{ color: "var(--gold)" }}>v{download.version}</span>
                      </p>
                      <p style={{ color: "var(--text-2)", fontSize: "0.83rem" }}>Windows x64 · {download.filename}</p>
                      <p style={{ color: "var(--text-2)", fontSize: "0.78rem", marginTop: 2 }}>Portable · без установки</p>
                    </div>
                    <a href={`/api/download/portable/${download.filename}`} className="btn-gold" style={{ fontSize: "0.88rem", padding: "0.7rem 1.75rem" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Скачать
                    </a>
                  </div>
                ) : (
                  <div className="skeleton" style={{ height: 70 }} />
                )}
              </Panel>

              <Panel>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.75rem" }}>P2P со-стрим</h3>
                <p style={{ color: "var(--text-2)", fontSize: "0.83rem", marginBottom: "0.85rem", lineHeight: 1.55 }}>
                  Для со-стрима с другом введите в настройках приложения (раздел P2P) код комнаты или TURN-данные:
                </p>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "0.75rem 1rem", borderRadius: "var(--r-sm)", fontFamily: "monospace", fontSize: "0.83rem", color: "var(--gold)", marginBottom: "0.5rem", letterSpacing: "0.02em" }}>
                  turns:streambro.ru:5349
                </div>
                <p style={{ color: "var(--text-2)", fontSize: "0.75rem" }}>Сигналинг: wss://streambro.ru/signaling</p>
              </Panel>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
