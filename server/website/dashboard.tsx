"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";

type User = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  status: string;
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

type Friend = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
};

type PendingRequest = {
  friendshipId: string;
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  requestedAt: string;
};

type Room = {
  id: string;
  code: string;
  name: string | null;
  maxPeers: number;
  status: string;
  createdAt: string;
  creator: { id: string; username: string; displayName: string | null };
  members: { userId: string; role: string; user: { id: string; username: string; displayName: string; avatarUrl: string | null } }[];
};

type StreamStats = {
  totalStreams: number;
  totalDuration: number;
  avgDuration: number;
  byPlatform: Record<string, number>;
  thisMonthStreams: number;
  thisMonthDuration: number;
};

type DownloadInfo = {
  version: string;
  platform: string;
  filename: string;
};

const STATUS_OPTIONS = [
  { value: "online", label: "Онлайн", color: "#22c55e" },
  { value: "streaming", label: "Стримлю", color: "#f59e0b" },
  { value: "away", label: "Отошёл", color: "#94a3b8" },
  { value: "dnd", label: "Не беспокоить", color: "#ef4444" },
  { value: "offline", label: "Не в сети", color: "#6b7280" },
];

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

export default function DashboardPage() {
  // Set browser tab title
  useEffect(() => { document.title = "StreamBro — Профиль"; }, []);

  const [user, setUser] = useState<User | null>(null);
  const [download, setDownload] = useState<DownloadInfo | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"profile" | "friends" | "rooms" | "stats" | "download">("profile");

  // Profile edit fields
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editStatus, setEditStatus] = useState("online");
  const [editAvatar, setEditAvatar] = useState("");
  const [saving, setSaving] = useState(false);

  // Change password
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Friends search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; username: string; displayName: string | null; avatarUrl: string | null }[]>([]);
  const [searching, setSearching] = useState(false);

  // Room create
  const [newRoomName, setNewRoomName] = useState("");

  const loadData = useCallback(async () => {
    try {
      const userData = await api.get<User>("/user/me");
      setUser(userData);
      setEditName(userData.displayName || userData.username);
      setEditBio(userData.bio || "");
      setEditStatus(userData.status || "online");
      setEditAvatar(userData.avatarUrl || "");

      // Non-critical data — load independently, don't block on failure
      api.get<DownloadInfo>("/download/latest").then(setDownload).catch(() => {});
      api.get<Friend[]>("/friends").then(setFriends).catch(() => {});
      api.get<PendingRequest[]>("/friends/pending").then(setPending).catch(() => {});
      api.get<Room[]>("/rooms/mine/list").then(setRooms).catch(() => {});
      api.get<StreamStats>("/stream-events/stats").then(setStreamStats).catch(() => {});
    } catch (err) {
      // Only redirect to login on auth errors (401/403)
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("401") || msg.includes("авториза") || msg.includes("Токен") || msg.includes("Невалид")) {
        await api.post("/auth/logout").catch(() => {});
        window.location.href = "/login";
      } else {
        setError("Ошибка загрузки данных. Попробуйте обновить страницу.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSaveProfile() {
    setSaving(true);
    try {
      const updated = await api.patch<User>("/user/profile", {
        displayName: editName.trim(),
        bio: editBio.trim(),
        status: editStatus,
        avatarUrl: editAvatar.trim() || null,
      });
      setUser(updated);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await api.post("/auth/logout").catch(() => {});
    window.location.href = "/";
  }

  async function handleSearch() {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const results = await api.get<{ id: string; username: string; displayName: string | null; avatarUrl: string | null }[]>(
        `/friends/search?q=${encodeURIComponent(searchQuery.trim())}`
      );
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleSendRequest(userId: string) {
    try {
      await api.post("/friends/request", { userId });
      setSearchResults((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function handleAccept(friendshipId: string) {
    try {
      await api.post("/friends/accept", { friendshipId });
      setPending((prev) => prev.filter((r) => r.friendshipId !== friendshipId));
      api.get<Friend[]>("/friends").then(setFriends).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function handleReject(friendshipId: string) {
    try {
      await api.post("/friends/reject", { friendshipId });
      setPending((prev) => prev.filter((r) => r.friendshipId !== friendshipId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function handleRemoveFriend(friendId: string) {
    try {
      await api.delete(`/friends/${friendId}`);
      setFriends((prev) => prev.filter((f) => f.id !== friendId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function handleCreateRoom() {
    try {
      const room = await api.post<Room>("/rooms", { name: newRoomName.trim() || null });
      setRooms((prev) => [room, ...prev]);
      setNewRoomName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания комнаты");
    }
  }

  async function handleLeaveRoom(code: string) {
    try {
      await api.post(`/rooms/${code}/leave`);
      setRooms((prev) => prev.filter((r) => r.code !== code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function handleCloudSync() {
    try {
      await api.put("/settings", { encryptedData: "test", iv: "test" });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка синхронизации");
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a12" }}>
        <div style={{ textAlign: "center" }}>
          <Image src="/logo.png" alt="" width={48} height={48} style={{ borderRadius: 12, opacity: 0.5, marginBottom: 12 }} />
          <p style={{ color: "#6b7280" }}>{"Загрузка..."}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const currentStatus = STATUS_OPTIONS.find((s) => s.value === editStatus) || STATUS_OPTIONS[0];

  const tabs = [
    { id: "profile", label: "Профиль" },
    { id: "friends", label: `Друзья${pending.length > 0 ? ` (${pending.length})` : ""}` },
    { id: "rooms", label: "Комнаты" },
    { id: "stats", label: "Статистика" },
    { id: "download", label: "Скачать" },
  ] as const;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a12" }}>
      {/* Header */}
      <header style={{
        padding: "0 2rem", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,10,18,0.9)", backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <Image src="/logo.png" alt="StreamBro" width={28} height={28} style={{ borderRadius: 6 }} />
          <span style={{ fontWeight: 800, fontSize: "1rem", color: "#fff" }}>StreamBro</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>@{user.username}</span>
          <button onClick={handleLogout} style={{
            padding: "0.45rem 1rem", fontSize: "0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
            background: "transparent", color: "#94a3b8", cursor: "pointer",
          }}>{"Выйти"}</button>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem", display: "flex", gap: "1.5rem" }}>
        {/* Sidebar */}
        <nav style={{ width: 200, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "0.6rem 1rem", fontSize: "0.9rem", textAlign: "left", borderRadius: 8,
                  border: "none", cursor: "pointer",
                  background: activeTab === tab.id ? "rgba(139,92,246,0.15)" : "transparent",
                  color: activeTab === tab.id ? "#c4b5fd" : "#94a3b8",
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >{tab.label}</button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <main style={{ flex: 1, minWidth: 0 }}>
          {error && (
            <div style={{
              background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1.5rem", color: "#f87171", fontSize: "0.9rem",
            }}>{error}</div>
          )}

          {/* ──── PROFILE ──── */}
          {activeTab === "profile" && (
            <div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "1.5rem" }}>{"Профиль"}</h2>
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "2rem", marginBottom: "1.25rem",
              }}>
                {/* Avatar + status */}
                <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "1.5rem" }}>
                  <div style={{ position: "relative" }}>
                    {user.avatarUrl && (user.avatarUrl.startsWith("/") || user.avatarUrl.startsWith("http")) ? (
                      <img src={user.avatarUrl} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(139,92,246,0.3)" }} />
                    ) : user.avatarUrl ? (
                      <div style={{
                        width: 64, height: 64, borderRadius: "50%", background: "rgba(139,92,246,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "2.2rem", border: "2px solid rgba(139,92,246,0.3)",
                      }}>{user.avatarUrl}</div>
                    ) : (
                      <div style={{
                        width: 64, height: 64, borderRadius: "50%", background: "rgba(139,92,246,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "1.5rem", fontWeight: 700, color: "#c4b5fd",
                        border: "2px solid rgba(139,92,246,0.3)",
                      }}>{(user.displayName || user.username)[0].toUpperCase()}</div>
                    )}
                    <div style={{
                      position: "absolute", bottom: 0, right: 0, width: 16, height: 16, borderRadius: "50%",
                      background: currentStatus.color, border: "2px solid #0a0a12",
                    }} />
                  </div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff" }}>{user.displayName || user.username}</p>
                    <p style={{ color: "#6b7280", fontSize: "0.85rem" }}>@{user.username}</p>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* Avatar */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{"Аватар"}</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {editAvatar && <img src={editAvatar} alt="" width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(139,92,246,0.3)" }} />}
                      <label style={{ padding: "0.4rem 0.8rem", borderRadius: 8, background: "rgba(139,92,246,0.15)", color: "#c4b5fd", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", border: "1px solid rgba(139,92,246,0.2)" }}>
                        {"Выбрать файл"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2 * 1024 * 1024) { setError("Файл слишком большой (макс 2MB)"); return; }
                            try {
                              const fd = new FormData();
                              fd.append("avatar", file);
                              const res = await fetch(`/api/user/profile/avatar`, {
                                method: "POST",
                                body: fd,
                                credentials: "include",
                              });
                              if (!res.ok) throw new Error("Upload failed");
                              const data = await res.json();
                              setEditAvatar(data.avatarUrl);
                              setUser((u) => u ? { ...u, avatarUrl: data.avatarUrl } : u);
                              setError("");
                            } catch { setError("Ошибка загрузки аватара"); }
                          }}
                          style={{ display: "none" }}
                        />
                      </label>
                      {editAvatar && (
                        <button
                          onClick={async () => {
                            try {
                              await api.patch("/user/profile", { avatarUrl: null });
                              setEditAvatar("");
                              setUser((u) => u ? { ...u, avatarUrl: null } : u);
                            } catch { setError("Ошибка удаления аватара"); }
                          }}
                          style={{ padding: "0.4rem 0.6rem", borderRadius: 8, background: "rgba(248,113,113,0.1)", color: "#f87171", fontSize: "0.8rem", border: "1px solid rgba(248,113,113,0.2)", cursor: "pointer" }}
                        >
                          {"Удалить"}
                        </button>
                      )}
                    </div>
                    <p style={{ color: "#6b7280", fontSize: "0.75rem", marginTop: 4 }}>{"JPG, PNG, GIF или WebP, до 2 МБ"}</p>
                  </div>

                  {/* Display name */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{"Отображаемое имя"}</label>
                    <input type="text" className="input" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%" }} />
                  </div>

                  {/* Bio */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{"О себе"}</label>
                    <textarea className="input" value={editBio} onChange={(e) => setEditBio(e.target.value)} placeholder="Расскажите о себе..." maxLength={300} rows={3} style={{ width: "100%", resize: "vertical" }} />
                    <p style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>{editBio.length}/300</p>
                  </div>

                  {/* Status */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{"Статус"}</label>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {STATUS_OPTIONS.map((s) => (
                        <button key={s.value} onClick={() => setEditStatus(s.value)} style={{
                          padding: "0.4rem 0.85rem", fontSize: "0.8rem", borderRadius: 20, border: "1px solid",
                          borderColor: editStatus === s.value ? s.color : "rgba(255,255,255,0.1)",
                          background: editStatus === s.value ? `${s.color}15` : "transparent",
                          color: editStatus === s.value ? s.color : "#94a3b8",
                          cursor: "pointer", transition: "all 0.15s",
                          display: "flex", alignItems: "center", gap: "0.4rem",
                        }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "2rem", color: "#6b7280", fontSize: "0.85rem", paddingTop: "0.5rem" }}>
                    <span>{user.email}</span>
                    <span>{"С "}{new Date(user.createdAt).toLocaleDateString("ru-RU")}</span>
                    {!user.emailVerified && <span style={{ color: "#f59e0b" }}>{"Email не подтверждён"}</span>}
                  </div>

                  {/* Change password */}
                  <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <button onClick={() => setShowPasswordForm(!showPasswordForm)} style={{
                      background: "transparent", border: "none", color: "#94a3b8", fontSize: "0.85rem",
                      cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 2,
                    }}>
                      {"Сменить пароль"}
                    </button>
                    {showPasswordForm && (
                      <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Текущий пароль" />
                        <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль (минимум 8 символов)" minLength={8} />
                        <button onClick={async () => {
                          if (newPassword.length < 8) { setPasswordMsg({ ok: false, text: "Минимум 8 символов" }); return; }
                          setChangingPassword(true);
                          setPasswordMsg(null);
                          try {
                            await api.post("/auth/change-password", { currentPassword, newPassword });
                            setPasswordMsg({ ok: true, text: "Пароль изменён!" });
                            setCurrentPassword(""); setNewPassword("");
                            setShowPasswordForm(false);
                          } catch (err) {
                            setPasswordMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" });
                          } finally { setChangingPassword(false); }
                        }} disabled={changingPassword} style={{
                          padding: "0.5rem 1rem", borderRadius: 8, fontSize: "0.85rem",
                          background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)",
                          cursor: changingPassword ? "wait" : "pointer", opacity: changingPassword ? 0.6 : 1,
                        }}>
                          {changingPassword ? "Сохранение..." : "Сменить пароль"}
                        </button>
                        {passwordMsg && <p style={{ fontSize: "0.8rem", color: passwordMsg.ok ? "#22c55e" : "#f87171", margin: 0 }}>{passwordMsg.text}</p>}
                      </div>
                    )}
                  </div>

                  <button className="btn-gold" onClick={handleSaveProfile} disabled={saving} style={{
                    padding: "0.6rem 1.5rem", fontSize: "0.9rem", marginTop: "0.5rem",
                    background: "rgba(139,92,246,0.2)", color: "#c4b5fd", borderRadius: 8,
                    border: "1px solid rgba(139,92,246,0.3)", cursor: saving ? "wait" : "pointer",
                  }}>{saving ? "Сохранение..." : "Сохранить"}</button>
                </div>
              </div>

              {/* Cloud sync */}
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "1.5rem",
              }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem", color: "#c4b5fd" }}>{"Облачная синхронизация"}</h3>
                <p style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "1rem" }}>
                  {"Настройки приложения (сцены, источники, аудио-профили) шифруются и сохраняются на сервере. Синхронизация между устройствами."}
                </p>
                <button onClick={handleCloudSync} style={{
                  padding: "0.5rem 1.25rem", fontSize: "0.85rem", borderRadius: 8,
                  background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.2)",
                  cursor: "pointer",
                }}>{"Синхронизировать сейчас"}</button>
              </div>
            </div>
          )}

          {/* ──── FRIENDS ──── */}
          {activeTab === "friends" && (
            <div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "1.5rem" }}>{"Друзья"}</h2>

              {/* Search */}
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem",
              }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>{"Найти друга"}</h3>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input type="text" className="input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Имя пользователя..." style={{ flex: 1 }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
                  <button onClick={handleSearch} disabled={searching} style={{
                    padding: "0.5rem 1rem", fontSize: "0.85rem", borderRadius: 8,
                    background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)",
                    cursor: searching ? "wait" : "pointer",
                  }}>{searching ? "Поиск..." : "Найти"}</button>
                </div>
                {searchResults.length > 0 && (
                  <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {searchResults.map((u) => (
                      <div key={u.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "0.6rem 0.75rem", borderRadius: 8, background: "rgba(255,255,255,0.02)",
                      }}>
                        <span style={{ color: "#e2e8f0", fontSize: "0.9rem" }}>{u.displayName || `@${u.username}`}</span>
                        <button onClick={() => handleSendRequest(u.id)} style={{
                          padding: "0.3rem 0.75rem", fontSize: "0.8rem", borderRadius: 6,
                          background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)",
                          cursor: "pointer",
                        }}>{"Добавить"}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pending requests */}
              {pending.length > 0 && (
                <div style={{
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem",
                }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem", color: "#f59e0b" }}>
                    {"Заявки в друзья"} ({pending.length})
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {pending.map((r) => (
                      <div key={r.friendshipId} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "0.6rem 0.75rem", borderRadius: 8, background: "rgba(255,255,255,0.02)",
                      }}>
                        <span style={{ color: "#e2e8f0", fontSize: "0.9rem" }}>{r.displayName || `@${r.username}`}</span>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button onClick={() => handleAccept(r.friendshipId)} style={{
                            padding: "0.3rem 0.75rem", fontSize: "0.8rem", borderRadius: 6,
                            background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)",
                            cursor: "pointer",
                          }}>{"Принять"}</button>
                          <button onClick={() => handleReject(r.friendshipId)} style={{
                            padding: "0.3rem 0.75rem", fontSize: "0.8rem", borderRadius: 6,
                            background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.15)",
                            cursor: "pointer",
                          }}>{"Отклонить"}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Friends list */}
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "1.5rem",
              }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>
                  {"Ваши друзья"} ({friends.length})
                </h3>
                {friends.length === 0 ? (
                  <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>{"Пока нет друзей. Найдите кого-нибудь!"}</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {friends.map((f) => {
                      const statusInfo = STATUS_OPTIONS.find((s) => s.value === f.status) || STATUS_OPTIONS[4];
                      return (
                        <div key={f.id} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "0.6rem 0.75rem", borderRadius: 8, background: "rgba(255,255,255,0.02)",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <div style={{ position: "relative" }}>
                              {f.avatarUrl && (f.avatarUrl.startsWith("/") || f.avatarUrl.startsWith("http")) ? (
                                <img src={f.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                              ) : f.avatarUrl ? (
                                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(139,92,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>{f.avatarUrl}</div>
                              ) : (
                                <div style={{
                                  width: 36, height: 36, borderRadius: "50%", background: "rgba(139,92,246,0.1)",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: "0.9rem", fontWeight: 600, color: "#c4b5fd",
                                }}>{(f.displayName || f.username)[0].toUpperCase()}</div>
                              )}
                              <div style={{
                                position: "absolute", bottom: -1, right: -1, width: 12, height: 12, borderRadius: "50%",
                                background: statusInfo.color, border: "2px solid #0a0a12",
                              }} />
                            </div>
                            <div>
                              <p style={{ color: "#e2e8f0", fontSize: "0.9rem", fontWeight: 500 }}>{f.displayName || f.username}</p>
                              <p style={{ color: statusInfo.color, fontSize: "0.75rem" }}>{statusInfo.label}</p>
                            </div>
                          </div>
                          <button onClick={() => handleRemoveFriend(f.id)} style={{
                            padding: "0.25rem 0.6rem", fontSize: "0.75rem", borderRadius: 6,
                            background: "rgba(239,68,68,0.08)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.05)",
                            cursor: "pointer",
                          }}>{"Удалить"}</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ──── ROOMS ──── */}
          {activeTab === "rooms" && (
            <div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "1.5rem" }}>{"Комнаты со-стрима"}</h2>

              {/* Create room */}
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem",
              }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>{"Создать комнату"}</h3>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input type="text" className="input" value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="Название (необязательно)" style={{ flex: 1 }} />
                  <button onClick={handleCreateRoom} style={{
                    padding: "0.5rem 1rem", fontSize: "0.85rem", borderRadius: 8,
                    background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)",
                    cursor: "pointer",
                  }}>{"Создать"}</button>
                </div>
                <p style={{ color: "#6b7280", fontSize: "0.8rem", marginTop: "0.5rem" }}>
                  {"Код комнаты можно ввести в приложении (P2P раздел) для со-стрима с друзьями"}
                </p>
              </div>

              {/* My rooms */}
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "1.5rem",
              }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>{"Ваши комнаты"}</h3>
                {rooms.length === 0 ? (
                  <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>{"Нет активных комнат"}</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {rooms.map((r) => (
                      <div key={r.id} style={{
                        padding: "1rem", borderRadius: 8, background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.04)",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{r.name || `Комната ${r.code}`}</span>
                          <button onClick={() => handleLeaveRoom(r.code)} style={{
                            padding: "0.25rem 0.6rem", fontSize: "0.75rem", borderRadius: 6,
                            background: "rgba(239,68,68,0.08)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.05)",
                            cursor: "pointer",
                          }}>{"Покинуть"}</button>
                        </div>
                        <div style={{ fontFamily: "monospace", color: "#c4b5fd", fontSize: "0.9rem", marginBottom: "0.35rem" }}>{r.code}</div>
                        <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                          {"Участники: "}{r.members.length}/{r.maxPeers}{" — "}{r.creator.username}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ──── STATS ──── */}
          {activeTab === "stats" && (
            <div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "1.5rem" }}>{"Статистика стримов"}</h2>
              {streamStats ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
                  {[
                    { label: "Всего стримов", value: String(streamStats.totalStreams) },
                    { label: "Общее время", value: formatDuration(streamStats.totalDuration) },
                    { label: "Средняя длительность", value: formatDuration(streamStats.avgDuration) },
                    { label: "Стримов за месяц", value: String(streamStats.thisMonthStreams) },
                    { label: "Время за месяц", value: formatDuration(streamStats.thisMonthDuration) },
                  ].map((s) => (
                    <div key={s.label} style={{
                      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 12, padding: "1.25rem",
                    }}>
                      <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "0.35rem" }}>{s.label}</p>
                      <p style={{ color: "#c4b5fd", fontSize: "1.5rem", fontWeight: 700 }}>{s.value}</p>
                    </div>
                  ))}
                  {Object.entries(streamStats.byPlatform).map(([platform, count]) => (
                    <div key={platform} style={{
                      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 12, padding: "1.25rem",
                    }}>
                      <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "0.35rem" }}>{platform}</p>
                      <p style={{ color: "#e2e8f0", fontSize: "1.5rem", fontWeight: 700 }}>{count}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "#6b7280" }}>{"Загрузка статистики..."}</p>
              )}
            </div>
          )}

          {/* ──── DOWNLOAD ──── */}
          {activeTab === "download" && (
            <div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "1.5rem" }}>{"Скачать приложение"}</h2>
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "2rem",
              }}>
                {download && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: "0.25rem", color: "#e2e8f0" }}>
                        {"StreamBro v"}{download.version}
                      </p>
                      <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                        {"Windows x64"}{" - "}{download.filename}
                      </p>
                    </div>
                    <a href="/api/download/portable/StreamBro-1.2.1-portable.zip" style={{
                      padding: "0.7rem 1.5rem", fontSize: "0.9rem", borderRadius: 8,
                      background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)",
                      textDecoration: "none", display: "inline-block",
                    }}>{"Скачать"}</a>
                  </div>
                )}
              </div>

              {/* TURN */}
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "1.5rem", marginTop: "1.25rem",
              }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>{"P2P со-стрим"}</h3>
                <p style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                  {"Для P2P со-стрима с другом, введите в настройках приложения (P2P) код комнаты или TURN-данные:"}
                </p>
                <div style={{
                  background: "rgba(0,0,0,0.3)", padding: "0.75rem 1rem", borderRadius: 8,
                  fontFamily: "monospace", fontSize: "0.85rem", color: "#c4b5fd", marginBottom: "0.75rem",
                }}>turns:streambro.ru:5349</div>
                <p style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                  {"Сигналинг: wss://streambro.ru/signaling"}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
