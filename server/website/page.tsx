"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

/* ═══════════════════════════════════════════════════════════════
   CHANGES — version changelog (update with each release)
   ═══════════════════════════════════════════════════════════════ */
const VERSION = "1.2.2";
const CHANGES: Record<string, string[]> = {
  "1.2.2": [
    "Админ-панель — управление пользователями, комнатами, баг-репортами",
    "Чат — редактирование и удаление сообщений",
    "Друзья — аватарки, онлайн-статус синхронизирован сайт↔приложение",
    "Комнаты — серверное создание, автозакрытие через 24ч после выхода",
    "Google OAuth — понятные имена пользователей (name1234)",
    "Редактирование username в профиле",
    "Облачная синхронизация настроек (AES-256-GCM)",
    "Баг-репорты сохраняются в базу данных",
    "Брендинг — StreamBro в диспетчере задач, кастомный значок",
    "Сайт — «Мой профиль» в навбаре, редиректы для залогиненных",
  ],
  "1.2.1": [
    "Свечение рамок — прямоугольные, круглые, внутрь и наружу",
    "Квадратные и скруглённые маски для источников",
    "Камера — улучшенное качество и частота кадров",
    "Блокировка Z-позиции — заблокированные источники всегда сверху",
    "Переименование источников — карандаш в списке",
    "Звуки приложения не попадают на стрим и запись",
    "Защита от двойного добавления камеры/микрофона",
  ],
  "1.2.0": [
    "WebGL рендеринг — GPU-ускоренный композитор",
    "WebCodecs H.264 — стрим без перекодирования",
    "Оверлейная canvas — handles не видны на стриме",
    "Предпросмотр 30fps, выходной 30/60/120fps",
    "30-50% экономия CPU, 200-400 МБ RAM",
  ],
  "1.1.0": [
    "Профили, друзья, чат",
    "Баг-репорты, автообновление",
    "Deep-link streambro://login",
    "Сигналинг-сервер в main process",
    "Умный dirty-flag рендер",
  ],
};

/* ═══════════════════════════════════════════════════════════════
   CHANGES MODAL
   ═══════════════════════════════════════════════════════════════ */
function ChangesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const versions = Object.keys(CHANGES);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "2rem", animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-2)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "2.5rem",
          maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto",
          animation: "scaleIn 0.25s cubic-bezier(0.2,0.7,0.2,1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.02em" }}>История обновлений</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: "1.2rem", padding: "0.25rem" }}
          >✕</button>
        </div>
        {versions.map((v) => (
          <div key={v} style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
              <span style={{
                fontWeight: 800, fontSize: "0.9rem", color: "var(--gold)",
                background: "var(--gold-dim)", padding: "0.25rem 0.75rem", borderRadius: 999,
                border: "1px solid rgba(255,210,60,0.15)",
              }}>
                v{v}
              </span>
              {v === VERSION && (
                <span style={{ fontSize: "0.75rem", color: "var(--success)", fontWeight: 600 }}>текущая</span>
              )}
            </div>
            <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {CHANGES[v].map((c) => (
                <li key={c} style={{ color: "var(--text-1)", fontSize: "0.88rem", lineHeight: 1.5 }}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NAVBAR
   ═══════════════════════════════════════════════════════════════ */
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);
  useEffect(() => {
    fetch("/api/user/test-cookie", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setLoggedIn(!!d.hasCookie))
      .catch(() => {});
  }, []);

  return (
    <nav
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "0 2rem", height: 64, display: "flex", alignItems: "center",
        justifyContent: "space-between",
        background: scrolled ? "rgba(8,8,12,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(24px) saturate(1.4)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,210,60,0.06)" : "1px solid transparent",
        transition: "all 0.35s ease",
      }}
    >
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Image src="/logo.png" alt="StreamBro" width={32} height={32} style={{ borderRadius: 8 }} />
        <span style={{ fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.02em" }}>StreamBro</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <a href="#features" style={{ color: "var(--text-1)", fontSize: "0.88rem", fontWeight: 500 }}>Функции</a>
        <a href="#safety" style={{ color: "var(--text-1)", fontSize: "0.88rem", fontWeight: 500 }}>Безопасность</a>
        <a href="#download" style={{ color: "var(--text-1)", fontSize: "0.88rem", fontWeight: 500 }}>Скачать</a>
        {loggedIn ? (
          <Link href="/dashboard" className="btn-ghost" style={{ padding: "0.5rem 1.2rem", fontSize: "0.85rem" }}>Мой профиль</Link>
        ) : (
          <Link href="/login" className="btn-ghost" style={{ padding: "0.5rem 1.2rem", fontSize: "0.85rem" }}>Войти</Link>
        )}
        {!loggedIn && (
          <Link href="/register" className="btn-gold" style={{ padding: "0.5rem 1.2rem", fontSize: "0.85rem" }}>Начать бесплатно</Link>
        )}
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HERO — bold, animated, unique
   ═══════════════════════════════════════════════════════════════ */
function Hero({ onChangelog, downloadUrl }: { onChangelog: () => void; downloadUrl: string }) {
  const [hoverBadge, setHoverBadge] = useState(false);

  return (
    <section
      style={{
        position: "relative", minHeight: "100vh",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", textAlign: "center",
        padding: "8rem 2rem 6rem", overflow: "hidden",
      }}
    >
      {/* Animated aurora background */}
      <div className="hero-aurora" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

      {/* Floating particles */}
      <div className="hero-particles" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

      {/* Gold accent line */}
      <div
        className="shimmer-line"
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, var(--gold-glow), transparent)" }}
      />

      <div className="fade-up" style={{ position: "relative", maxWidth: 800 }}>
        {/* Version badge — clickable */}
        <button
          onClick={onChangelog}
          onMouseEnter={() => setHoverBadge(true)}
          onMouseLeave={() => setHoverBadge(false)}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            color: "var(--gold)", fontWeight: 600, fontSize: "0.82rem",
            letterSpacing: "0.1em", textTransform: "uppercase",
            marginBottom: "1.5rem", padding: "0.5rem 1.3rem",
            borderRadius: 999, border: "1px solid rgba(255,210,60,0.15)",
            background: hoverBadge ? "rgba(255,210,60,0.12)" : "rgba(255,210,60,0.06)",
            cursor: "pointer", transition: "all 0.3s ease",
            transform: hoverBadge ? "scale(1.05)" : "scale(1)",
          }}
        >
          <span className="pulse-dot" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--gold)", boxShadow: "0 0 8px var(--gold)" }} />
          v{VERSION} — что нового?
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.3s", transform: hoverBadge ? "translateX(2px)" : "none" }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* FREE badge */}
        <div
          className="float-badge"
          style={{
            position: "absolute", top: "-0.5rem", right: "-1rem",
            background: "linear-gradient(135deg, #ffd23c, #ffb800)",
            color: "#000", fontWeight: 900, fontSize: "0.7rem",
            letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "0.35rem 0.8rem", borderRadius: 999,
            boxShadow: "0 4px 20px rgba(255,210,60,0.4)",
          }}
        >
          БЕСПЛАТНО
        </div>

        <h1
          className="hero-title"
          style={{
            fontSize: "clamp(2.8rem, 8vw, 5.5rem)",
            fontWeight: 900, lineHeight: 0.95,
            letterSpacing: "-0.04em", marginBottom: "1.5rem",
          }}
        >
          Стримить —<br />
          <span style={{ color: "var(--gold)", fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontWeight: 400 }}>
            просто
          </span>
        </h1>

        <p
          style={{
            fontSize: "1.2rem", color: "var(--text-1)", lineHeight: 1.7,
            marginBottom: "2.5rem", maxWidth: 560,
            marginLeft: "auto", marginRight: "auto", fontWeight: 400,
          }}
        >
          Распакуй. Открой. Нажми Стрим — ты на Twitch, YouTube или Kick.
          Никаких настроек, никаких кабелей, никаких подписок.
        </p>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <a href={downloadUrl} className="btn-gold btn-glow" style={{ fontSize: "1.05rem", padding: "1rem 2.5rem" }}>
            Скачать бесплатно
          </a>
          <a href="#features" className="btn-ghost" style={{ fontSize: "1rem", padding: "1rem 2rem" }}>
            Узнать больше
          </a>
        </div>

        {/* Stats */}
        <div
          style={{
            marginTop: "4rem", display: "flex", justifyContent: "center",
            gap: "3rem", flexWrap: "wrap",
          }}
        >
          {[
            { val: "0 ₽", label: "Навсегда бесплатно", sub: "Без подписок и лимитов" },
            { val: "<30с", label: "От запуска до стрима", sub: "Без настроек и танцев" },
            { val: "208МБ", label: "Размер приложения", sub: "Portable, без установки" },
          ].map((s) => (
            <div key={s.label} className="stat-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 900, color: "var(--gold)", letterSpacing: "-0.03em", lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: "0.9rem", color: "var(--text-0)", marginTop: "0.4rem", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)", marginTop: "0.15rem" }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="scroll-hint" style={{ position: "absolute", bottom: "2rem", left: "50%", transform: "translateX(-50%)" }}>
        <div style={{ width: 24, height: 40, borderRadius: 12, border: "2px solid rgba(255,210,60,0.25)", display: "flex", justifyContent: "center", paddingTop: 8 }}>
          <div className="scroll-dot" style={{ width: 3, height: 8, borderRadius: 2, background: "var(--gold)" }} />
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FEATURES — bento grid, diverse card sizes
   ═══════════════════════════════════════════════════════════════ */
const FEATURES = [
  {
    icon: "stream",
    title: "RTMP стриминг",
    desc: "Настоящий RTMP через FFmpeg — Twitch, YouTube, Kick, любой сервер. Автопереподключение при обрыве, защита от зависаний.",
    tag: "Ключевое",
    span: 2,
  },
  {
    icon: "scene",
    title: "Композитор сцен",
    desc: "Камера, экран, окно — перетаскивай, вращай, обрезай. Круглые, квадратные, скруглённые маски. Рамки со свечением внутрь и наружу.",
    tag: null,
    span: 1,
  },
  {
    icon: "audio",
    title: "Аудиомикшер с FX",
    desc: "Шумодав, 3-полосный EQ, компрессор, лимитер — для каждого источника отдельно. Мониторинг в реальном времени.",
    tag: null,
    span: 1,
  },
  {
    icon: "p2p",
    title: "P2P со-стрим",
    desc: "Код комнаты — и друг на вашей сцене. WebRTC P2P с TURN fallback. Без серверов-посредников, напрямую между компьютерами.",
    tag: "Уникальное",
    span: 1,
  },
  {
    icon: "record",
    title: "Запись в MP4",
    desc: "Локальная запись в высоком качестве с отдельным битрейтом. Стрим и запись одновременно — независимо друг от друга.",
    tag: null,
    span: 1,
  },
  {
    icon: "wasapi",
    title: "Системный звук без кабелей",
    desc: "Нативный WASAPI захват — системный звук Windows без виртуальных кабелей и дополнительных программ. Один тоггл.",
    tag: "Только Windows",
    span: 2,
  },
  {
    icon: "security",
    title: "Шифрование ключей",
    desc: "Stream key зашифрован через Windows DPAPI. Данные никогда не покидают ваш ПК. Context isolation от Electron.",
    tag: null,
    span: 1,
  },
  {
    icon: "themes",
    title: "4 темы оформления",
    desc: "Тёмная, Светлая, Неон, Бумага — переключаются мгновенно. Рамки со свечением и анимациями под настроение.",
    tag: null,
    span: 1,
  },
];

const ICONS: Record<string, React.ReactNode> = {
  stream: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  scene: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  audio: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  ),
  p2p: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  record: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  wasapi: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="2" x2="9" y2="4" /><line x1="15" y1="2" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="22" /><line x1="15" y1="20" x2="15" y2="22" /><line x1="20" y1="9" x2="22" y2="9" /><line x1="20" y1="14" x2="22" y2="14" /><line x1="2" y1="9" x2="4" y2="9" /><line x1="2" y1="14" x2="4" y2="14" />
    </svg>
  ),
  security: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  themes: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
};

function Features() {
  return (
    <section id="features" style={{ padding: "8rem 0" }}>
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: "4rem" }}>
          <p className="label-gold">Возможности</p>
          <h2 className="section-title" style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "1rem" }}>
            Всё для стрима.<br />
            <span style={{ color: "var(--gold)", fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontWeight: 400 }}>Ничего лишнего.</span>
          </h2>
          <p style={{ color: "var(--text-1)", fontSize: "1.1rem", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            Каждая функция — ради одного: чтобы вы стримили, а не настраивали.
          </p>
        </div>

        {/* Bento grid */}
        <div className="bento-grid">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`bento-card ${f.span === 2 ? "bento-wide" : ""}`}
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              {f.tag && (
                <span className={`feature-tag ${f.tag === "Уникальное" ? "tag-purple" : f.tag === "Только Windows" ? "tag-blue" : "tag-gold"}`}>
                  {f.tag}
                </span>
              )}
              <div className="feature-icon">{ICONS[f.icon]}</div>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "-0.01em" }}>{f.title}</h3>
              <p style={{ color: "var(--text-1)", lineHeight: 1.6, fontSize: "0.92rem" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HOW IT WORKS — timeline style
   ═══════════════════════════════════════════════════════════════ */
function HowItWorks() {
  const STEPS = [
    { num: "01", title: "Скачайте", desc: "Распакуйте архив. Никакой установки — запустите StreamBro.exe", icon: "⬇" },
    { num: "02", title: "Добавьте источники", desc: "Камера, экран, микрофон — кнопка + и всё готово", icon: "+" },
    { num: "03", title: "В эфире", desc: "Выберите платформу, вставьте ключ — вы стримите за 30 секунд", icon: "▶" },
  ];

  return (
    <section style={{ padding: "7rem 0", background: "var(--bg-1)", position: "relative", overflow: "hidden" }}>
      {/* Diagonal background accent */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, var(--gold-glow), transparent)" }} />
      <div style={{ position: "absolute", top: 0, right: "-20%", width: "60%", height: "100%", background: "radial-gradient(ellipse at 80% 50%, rgba(255,210,60,0.03) 0%, transparent 50%)", pointerEvents: "none" }} />

      <div className="container" style={{ position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: "4rem" }}>
          <p className="label-gold">Как начать</p>
          <h2 className="section-title" style={{ fontSize: "clamp(2rem, 4vw, 2.8rem)", fontWeight: 900, letterSpacing: "-0.03em" }}>
            Три шага — и вы в эфире
          </h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
          {STEPS.map((s, i) => (
            <div key={s.num} className="step-row" style={{ display: "flex", gap: "1.5rem", alignItems: "start", position: "relative" }}>
              {/* Timeline dot */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div
                  className="step-dot"
                  style={{
                    width: 52, height: 52, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.2rem", fontWeight: 800, color: "var(--gold)",
                    background: "rgba(255,210,60,0.08)", border: "2px solid rgba(255,210,60,0.2)",
                    transition: "all 0.3s",
                  }}
                >
                  {s.icon}
                </div>
                {i < STEPS.length - 1 && (
                  <div className="step-line" style={{ width: 2, height: 48, background: "linear-gradient(to bottom, rgba(255,210,60,0.2), transparent)" }} />
                )}
              </div>
              <div style={{ paddingBottom: "2.5rem" }}>
                <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.35rem", letterSpacing: "-0.01em" }}>{s.title}</h3>
                <p style={{ color: "var(--text-1)", fontSize: "0.95rem", lineHeight: 1.55 }}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SAFETY / SMARTSCREEN SECTION
   ═══════════════════════════════════════════════════════════════ */
function SafetySection() {
  return (
    <section id="safety" style={{ padding: "7rem 0" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "center" }}>
          {/* Left — Security features */}
          <div>
            <p className="label-gold">Безопасность</p>
            <h2 className="section-title" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "1rem" }}>
              Ваш ключ под<br />
              <span style={{ color: "var(--gold)", fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontWeight: 400 }}>надёжной защитой</span>
            </h2>
            <p style={{ color: "var(--text-1)", fontSize: "1rem", lineHeight: 1.7, marginBottom: "2rem" }}>
              Stream key — это доступ к вашему каналу. Мы относимся к этому серьёзно.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {[
                { title: "DPAPI шифрование", desc: "Ключ стрима шифруется через Windows Data Protection API — тот же механизм, что защищает пароли в браузере." },
                { title: "Данные на вашем ПК", desc: "Ничего не отправляется на наши серверы. Все настройки хранятся локально в %APPDATA%." },
                { title: "Context Isolation", desc: "Electron с включённой изоляцией контекстов. Никакой доступ к Node.js из рендерера." },
                { title: "Open Source", desc: "Весь код на GitHub под GPL-3.0. Проверьте сами — нам нечего скрывать." },
              ].map((item) => (
                <div key={item.title} style={{ display: "flex", gap: "0.75rem", alignItems: "start" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--gold-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem" }}>{item.title}</p>
                    <p style={{ color: "var(--text-2)", fontSize: "0.88rem", lineHeight: 1.5 }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — SmartScreen explanation */}
          <div
            style={{
              background: "var(--bg-2)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "2.5rem", position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Warning icon */}
            <div
              style={{
                width: 56, height: 56, borderRadius: 16,
                background: "rgba(255,210,60,0.1)", border: "1px solid rgba(255,210,60,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: "1.5rem", fontSize: "1.5rem",
              }}
            >
              ⚠️
            </div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "0.75rem", letterSpacing: "-0.01em" }}>
              Windows может показать предупреждение
            </h3>
            <p style={{ color: "var(--text-1)", fontSize: "0.95rem", lineHeight: 1.65, marginBottom: "1rem" }}>
              {"При первом запуске Windows SmartScreen может показать"} <strong style={{ color: "var(--text-0)" }}>{"Неизвестное приложение"}</strong> {"или"} <strong style={{ color: "var(--text-0)" }}>{"Windows защитила ваш ПК"}</strong>{"."}
            </p>
            <p style={{ color: "var(--text-1)", fontSize: "0.95rem", lineHeight: 1.65, marginBottom: "1rem" }}>
              <strong style={{ color: "var(--gold)" }}>{"Это нормально и безопасно."}</strong> {"Это не вирус и не ошибка — SmartScreen показывает это для любого нового приложения без дорогостоящей цифровой подписи от Microsoft (EV-сертификат стоит ~$400/год)."}
            </p>
            <div
              style={{
                background: "var(--bg-1)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", padding: "1.25rem", marginBottom: "1rem",
              }}
            >
              <p style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.5rem" }}>Что делать:</p>
              <ol style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <li style={{ color: "var(--text-1)", fontSize: "0.9rem", lineHeight: 1.5 }}>{"Нажмите"} <strong style={{ color: "var(--text-0)" }}>{"Подробнее"}</strong></li>
                <li style={{ color: "var(--text-1)", fontSize: "0.9rem", lineHeight: 1.5 }}>{"Нажмите"} <strong style={{ color: "var(--text-0)" }}>{"Выполнить в любом случае"}</strong></li>
                <li style={{ color: "var(--text-1)", fontSize: "0.9rem", lineHeight: 1.5 }}>Приложение запустится — всё в порядке!</li>
              </ol>
            </div>
            <p style={{ color: "var(--text-2)", fontSize: "0.82rem", lineHeight: 1.5 }}>
              Исходный код полностью открыт на GitHub — вы можете собрать приложение сами и убедиться в безопасности. Мы планируем получить EV-сертификат для будущих версий.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DOWNLOAD — prominent, clear FREE
   ═══════════════════════════════════════════════════════════════ */
function DownloadSection({ downloadUrl }: { downloadUrl: string }) {
  return (
    <section id="download" style={{ padding: "8rem 0", position: "relative" }}>
      <div className="container">
        <div
          className="download-card"
          style={{
            position: "relative", padding: "5rem 3rem", borderRadius: "var(--radius)",
            background: "var(--bg-2)", border: "1px solid rgba(255,210,60,0.1)",
            textAlign: "center", overflow: "hidden",
          }}
        >
          {/* Ambient glow */}
          <div className="download-glow" style={{ position: "absolute", top: "-50%", left: "50%", transform: "translateX(-50%)", width: 800, height: 600, background: "radial-gradient(ellipse, rgba(255,210,60,0.06) 0%, transparent 65%)", pointerEvents: "none" }} />

          <div style={{ position: "relative" }}>
            {/* FREE stamp */}
            <div
              className="free-stamp"
              style={{
                display: "inline-block", marginBottom: "1.5rem",
                fontSize: "0.75rem", fontWeight: 900, letterSpacing: "0.15em",
                textTransform: "uppercase", color: "var(--gold)",
                padding: "0.4rem 1.2rem", borderRadius: 999,
                background: "linear-gradient(135deg, rgba(255,210,60,0.12), rgba(255,210,60,0.06))",
                border: "1px solid rgba(255,210,60,0.2)",
              }}
            >
              100% бесплатно — без карты, без лимитов, без подписок
            </div>

            <h2 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "0.75rem" }}>
              Скачать StreamBro
            </h2>

            <p style={{ color: "var(--text-1)", fontSize: "1.15rem", marginBottom: "0.5rem", maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
              Все функции. Сразу. Навсегда. Без ограничений по времени.
            </p>

            <p style={{ color: "var(--text-2)", fontSize: "0.88rem", marginBottom: "2.5rem" }}>
              Windows 10/11 x64 · ~208 МБ · Portable · v{VERSION}
            </p>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "2rem" }}>
              <a href={downloadUrl} className="btn-gold btn-glow" style={{ fontSize: "1.1rem", padding: "1.1rem 3rem" }}>
                Скачать бесплатно
              </a>
              <Link href="/register" className="btn-ghost" style={{ fontSize: "1rem", padding: "1.1rem 2rem" }}>
                Создать аккаунт
              </Link>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "2rem", flexWrap: "wrap" }}>
              {[
                { icon: "📦", text: "Без установки — распакуй и запускай" },
                { icon: "🔄", text: "Автообновление внутри приложения" },
                { icon: "🔓", text: "Open Source (GPL-3.0)" },
              ].map((t) => (
                <div key={t.text} style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-2)", fontSize: "0.85rem" }}>
                  <span style={{ fontSize: "1rem" }}>{t.icon}</span>
                  {t.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CTA — gradient, bold
   ═══════════════════════════════════════════════════════════════ */
function CtaBanner({ downloadUrl }: { downloadUrl: string }) {
  return (
    <section style={{ padding: "6rem 0" }}>
      <div className="container">
        <div
          className="cta-card"
          style={{
            position: "relative", padding: "4rem 3rem", borderRadius: "var(--radius)",
            background: "linear-gradient(135deg, rgba(255,210,60,0.1) 0%, rgba(139,92,246,0.06) 50%, var(--bg-2) 100%)",
            border: "1px solid rgba(255,210,60,0.1)",
            textAlign: "center", overflow: "hidden",
          }}
        >
          <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "0.75rem", position: "relative" }}>
            Начните стримить
            <span style={{ color: "var(--gold)", fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontWeight: 400 }}> прямо сейчас</span>
          </h2>
          <p style={{ color: "var(--text-1)", fontSize: "1.1rem", marginBottom: "2rem", position: "relative", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            Бесплатно. Без карты. Аккаунт нужен только для P2P и друзей.
          </p>
          <a href={downloadUrl} className="btn-gold btn-glow" style={{ fontSize: "1.1rem", padding: "1.1rem 3rem", position: "relative" }}>
            Скачать StreamBro
          </a>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════════════════════════ */
function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border)", padding: "3rem 0 2rem" }}>
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "2rem", marginBottom: "2rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.75rem" }}>
              <Image src="/logo.png" alt="StreamBro" width={26} height={26} style={{ borderRadius: 6 }} />
              <span style={{ fontWeight: 800, fontSize: "1rem" }}>StreamBro</span>
            </div>
            <p style={{ color: "var(--text-2)", fontSize: "0.85rem", maxWidth: 260, lineHeight: 1.5 }}>
              Стриминг-композитор для Windows. Простой. Быстрый. Бесплатный.
            </p>
          </div>
          <div style={{ display: "flex", gap: "3rem" }}>
            <div>
              <h4 style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.6rem", color: "var(--text-1)" }}>Продукт</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <a href="#features" style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>Функции</a>
                <a href="#safety" style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>Безопасность</a>
                <a href="#download" style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>Скачать</a>
                <a href="https://github.com/mrkryachkin-stack/StreamBro" target="_blank" rel="noopener" style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>GitHub</a>
              </div>
            </div>
            <div>
              <h4 style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.6rem", color: "var(--text-1)" }}>Поддержка</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <a href="mailto:support@streambro.ru" style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>Email</a>
              </div>
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <p style={{ color: "var(--text-2)", fontSize: "0.8rem" }}>&copy; {new Date().getFullYear()} StreamBro. Все права защищены.</p>
          <p style={{ color: "var(--text-2)", fontSize: "0.8rem" }}>Лицензия GPL-3.0</p>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function HomePage() {
  const [showChanges, setShowChanges] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(`/api/download/portable/StreamBro-${VERSION}-portable.zip`);

  useEffect(() => {
    fetch("/api/download/latest")
      .then((r) => r.json())
      .then((d) => {
        if (d.url) setDownloadUrl(d.url);
      })
      .catch(() => {});
  }, []);

  return (
    <main>
      <ChangesModal open={showChanges} onClose={() => setShowChanges(false)} />
      <Navbar />
      <Hero onChangelog={() => setShowChanges(true)} downloadUrl={downloadUrl} />
      <Features />
      <HowItWorks />
      <SafetySection />
      <DownloadSection downloadUrl={downloadUrl} />
      <CtaBanner downloadUrl={downloadUrl} />
      <Footer />
    </main>
  );
}
