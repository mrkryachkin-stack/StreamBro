"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

/* ═══════════════════════════════════════════════════════════════
   VERSION & CHANGELOG DATA
   ═══════════════════════════════════════════════════════════════ */
const VERSION = "1.3.1";
const CHANGES: Record<string, string[]> = {
  "1.3.1": [
    "Стрим на Kick теперь работает стабильно — автофallback GPU → CPU энкодер",
    "Продвинутый шумодав: 4 пресета + индикатор состояния + уровень сигнала",
    "Стабильное подключение: автопереключение на программный кодек если GPU недоступен",
  ],
  "1.3.0": [
    "Виртуальная камера — сцена StreamBro как вебкамера в Zoom, Discord, Teams",
    "GPU-кодировщик NVENC / AMF / QSV — снижает нагрузку на процессор при стриме",
    "Мастер первого запуска — 4 шага от скачивания до первого стрима",
    "Electron 41 — актуальный Chromium, закрыты известные уязвимости",
  ],
  "1.2.5": [
    "Полный редизайн сайта — Dark Gold Futurism",
    "Микро-анимации: parallax, tilt, scroll-reveal",
  ],
  "1.2.2": [
    "Чат — редактирование и удаление сообщений",
    "Онлайн-статус синхронизирован между приложением и сайтом",
    "Комнаты со-стрима — стабильное создание и автозакрытие",
  ],
  "1.2.0": [
    "WebGL рендеринг — GPU-ускоренный композитор",
    "Предпросмотр 30fps, выходной 30/60/120fps",
    "30-50% экономия CPU, 200-400 МБ RAM",
  ],
};


/* ═══════════════════════════════════════════════════════════════
   SCROLL REVEAL HOOK
   ═══════════════════════════════════════════════════════════════ */
function useScrollReveal() {
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("revealed"); }),
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

/* ═══════════════════════════════════════════════════════════════
   TILT CARD HOOK
   ═══════════════════════════════════════════════════════════════ */
function useTiltCards() {
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>(".bento-card");
    const handlers: Array<{ el: HTMLElement; move: (e: MouseEvent) => void; leave: () => void }> = [];

    cards.forEach((card) => {
      const move = (e: MouseEvent) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(800px) rotateX(${-y * 6}deg) rotateY(${x * 6}deg) translateZ(4px)`;
      };
      const leave = () => { card.style.transform = ""; };
      card.addEventListener("mousemove", move);
      card.addEventListener("mouseleave", leave);
      handlers.push({ el: card, move, leave });
    });

    return () => handlers.forEach(({ el, move, leave }) => {
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mouseleave", leave);
    });
  }, []);
}

/* ═══════════════════════════════════════════════════════════════
   CHANGELOG MODAL
   ═══════════════════════════════════════════════════════════════ */
function ChangesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const versions = Object.keys(CHANGES);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(2,2,9,0.85)", backdropFilter: "blur(16px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "2rem", animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(10,10,30,0.96)",
          border: "1px solid rgba(201,162,39,0.15)",
          borderRadius: "var(--r-xl)",
          padding: "2.5rem",
          maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto",
          animation: "scaleIn 0.25s cubic-bezier(0.2,0.7,0.2,1)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 60px rgba(201,162,39,0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <span className="label-overline" style={{ marginBottom: "0.25rem" }}>История версий</span>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.025em" }}>Обновления StreamBro</h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--text-1)", cursor: "pointer", fontSize: "0.9rem", padding: "0.4rem 0.6rem", borderRadius: "6px", transition: "all 0.2s" }}
          >✕</button>
        </div>
        {versions.map((v, vi) => (
          <div key={v} style={{ marginBottom: "1.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
              <span style={{
                fontWeight: 800, fontSize: "0.82rem", color: "var(--gold)",
                background: "rgba(201,162,39,0.08)", padding: "0.25rem 0.8rem", borderRadius: 999,
                border: "1px solid rgba(201,162,39,0.18)", letterSpacing: "0.06em",
              }}>v{v}</span>
              {vi === 0 && <span style={{ fontSize: "0.72rem", color: "var(--success)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>текущая</span>}
            </div>
            <ul style={{ paddingLeft: "1rem", display: "flex", flexDirection: "column", gap: "0.45rem", listStyleType: "none" }}>
              {CHANGES[v].map((c) => (
                <li key={c} style={{ color: "var(--text-1)", fontSize: "0.88rem", lineHeight: 1.55, display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                  <span style={{ color: "var(--gold-dim)", flexShrink: 0 }}>—</span> {c}
                </li>
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
      .then((r) => r.json()).then((d) => setLoggedIn(!!d.hasCookie)).catch(() => {});
  }, []);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      padding: "0 2.5rem", height: 64,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: scrolled ? "rgba(5,5,16,0.94)" : "transparent",
      backdropFilter: scrolled ? "blur(28px) saturate(1.5)" : "none",
      borderBottom: scrolled ? "1px solid rgba(201,162,39,0.07)" : "1px solid transparent",
      transition: "all 0.4s var(--ease-in-out)",
    }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Image src="/logo.png" alt="StreamBro" width={30} height={30} style={{ borderRadius: 7 }} />
        <span style={{ fontWeight: 800, fontSize: "1.05rem", letterSpacing: "-0.025em", color: "var(--text-0)" }}>StreamBro</span>
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        {[["#features", "Функции"], ["#safety", "Безопасность"], ["#download", "Скачать"]].map(([href, label]) => (
          <a key={href} href={href} className="nav-link">{label}</a>
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {loggedIn ? (
            <Link href="/dashboard" className="btn-ghost" style={{ padding: "0.5rem 1.2rem", fontSize: "0.83rem" }}>
              Мой профиль
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost" style={{ padding: "0.5rem 1.2rem", fontSize: "0.83rem" }}>Войти</Link>
              <Link href="/register" className="btn-gold" style={{ padding: "0.5rem 1.25rem", fontSize: "0.83rem" }}>Начать бесплатно</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════════════════════ */
function Hero({ onChangelog, downloadUrl }: { onChangelog: () => void; downloadUrl: string }) {
  const [hoverBadge, setHoverBadge] = useState(false);

  return (
    <section style={{
      position: "relative", minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      textAlign: "center",
      padding: "8rem 2rem 6rem",
      overflow: "hidden",
    }}>
      {/* Layered background */}
      <div className="hero-aurora" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <div className="hero-particles" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.6 }} />

      {/* Large decorative BG numeral */}
      <div style={{
        position: "absolute", top: "8%", right: "5%",
        fontSize: "clamp(10rem, 22vw, 20rem)", fontWeight: 900,
        color: "transparent", WebkitTextStroke: "1px rgba(201,162,39,0.04)",
        lineHeight: 1, pointerEvents: "none", userSelect: "none", letterSpacing: "-0.04em",
      }}>01</div>

      {/* Top gold shimmer line */}
      <div className="gold-line-anim" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />

      {/* Diagonal accent — bottom-left */}
      <div style={{
        position: "absolute", bottom: 0, left: 0,
        width: 1, height: "40%",
        background: "linear-gradient(to top, rgba(201,162,39,0.15), transparent)",
        marginLeft: "8%",
      }} />

      <div className="fade-up" style={{ position: "relative", maxWidth: 820 }}>
        {/* Version badge */}
        <button
          onClick={onChangelog}
          onMouseEnter={() => setHoverBadge(true)}
          onMouseLeave={() => setHoverBadge(false)}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            color: "var(--gold)", fontWeight: 600, fontSize: "0.78rem",
            letterSpacing: "0.12em", textTransform: "uppercase",
            marginBottom: "2rem", padding: "0.45rem 1.25rem",
            borderRadius: 999,
            border: "1px solid rgba(201,162,39,0.2)",
            background: hoverBadge ? "rgba(201,162,39,0.1)" : "rgba(201,162,39,0.05)",
            cursor: "pointer", transition: "all 0.3s var(--ease-spring)",
            transform: hoverBadge ? "scale(1.04)" : "scale(1)",
            boxShadow: hoverBadge ? "0 4px 20px rgba(201,162,39,0.15)" : "none",
          }}
        >
          <span className="pulse-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--gold)" }} />
          v{VERSION} — что нового?
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.3s", transform: hoverBadge ? "translateX(3px)" : "none" }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* FREE floating badge */}
        <div className="float-badge" style={{
          position: "absolute", top: "-0.25rem", right: "-0.5rem",
          background: "linear-gradient(135deg, var(--gold), #d4911a)",
          color: "#000", fontWeight: 900, fontSize: "0.65rem",
          letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "0.3rem 0.75rem", borderRadius: 999,
          boxShadow: "0 4px 24px rgba(201,162,39,0.5), 0 0 0 1px rgba(255,255,255,0.1)",
        }}>БЕСПЛАТНО</div>

        {/* Main headline */}
        <h1 style={{
          fontSize: "clamp(3rem, 9vw, 6rem)",
          fontWeight: 900, lineHeight: 0.92,
          letterSpacing: "-0.04em", marginBottom: "1.75rem",
          color: "var(--text-0)",
        }}>
          Стримить —<br />
          <span className="display-serif" style={{ fontSize: "1.1em" }}>просто</span>
        </h1>

        {/* Subheadline */}
        <p style={{
          fontSize: "1.15rem", color: "var(--text-1)", lineHeight: 1.75,
          marginBottom: "3rem", maxWidth: 520,
          marginLeft: "auto", marginRight: "auto", fontWeight: 400,
        }}>
          Распакуй. Открой. Нажми Стрим — ты на Twitch, YouTube или Kick.
          Никаких настроек. Никаких подписок.
        </p>

        {/* CTA buttons */}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <a href={downloadUrl} className="btn-gold btn-glow" style={{ fontSize: "1rem", padding: "1rem 2.5rem" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Скачать бесплатно
          </a>
          <a href="#features" className="btn-ghost" style={{ fontSize: "0.95rem", padding: "1rem 2rem" }}>
            Узнать больше
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </a>
        </div>

        {/* Stats row */}
        <div style={{ marginTop: "5rem", display: "flex", justifyContent: "center", gap: "2rem", flexWrap: "wrap" }}>
          {[
            { val: "0 ₽", label: "Навсегда бесплатно", sub: "Без подписок и лимитов" },
            { val: "<30с", label: "От запуска до стрима", sub: "Без настроек" },
            { val: "208МБ", label: "Размер приложения", sub: "Portable — без установки" },
          ].map((s) => (
            <div key={s.label} className="stat-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 900, color: "var(--gold)", letterSpacing: "-0.03em", lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-0)", marginTop: "0.4rem", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-2)", marginTop: "0.15rem" }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll hint */}
      <div style={{ position: "absolute", bottom: "2rem", left: "50%", transform: "translateX(-50%)" }}>
        <div style={{ width: 22, height: 38, borderRadius: 11, border: "1.5px solid rgba(201,162,39,0.2)", display: "flex", justifyContent: "center", paddingTop: 7 }}>
          <div className="scroll-dot" style={{ width: 2.5, height: 7, borderRadius: 2, background: "var(--gold)" }} />
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FEATURES
   ═══════════════════════════════════════════════════════════════ */
const FEATURES = [
  { icon: "stream", title: "RTMP стриминг", desc: "Twitch, YouTube, Kick — настоящий RTMP через FFmpeg. Автопереподключение, защита от зависаний.", tag: "Ключевое", span: 2 },
  { icon: "scene", title: "Композитор сцен", desc: "Камера, экран, окно — перетаскивай, вращай, обрезай. Маски, рамки со свечением.", tag: null, span: 1 },
  { icon: "audio", title: "Аудиомикшер с FX", desc: "Шумодав с пресетами и индикатором, 3-полосный EQ, компрессор, лимитер — на каждый источник.", tag: null, span: 1 },
  { icon: "p2p", title: "P2P со-стрим", desc: "Код комнаты — и друг на вашей сцене. WebRTC P2P с TURN fallback.", tag: "Уникальное", span: 1 },
  { icon: "record", title: "Запись в MP4", desc: "Локальная запись в высоком качестве. Стрим и запись одновременно.", tag: null, span: 1 },
  { icon: "wasapi", title: "Системный звук без кабелей", desc: "Нативный WASAPI захват — системный звук Windows без виртуальных кабелей. Один тоггл.", tag: "Только Windows", span: 2 },
  { icon: "security", title: "Шифрование ключей", desc: "Stream key зашифрован через Windows DPAPI. Данные никогда не покидают ваш ПК.", tag: null, span: 1 },
  { icon: "themes", title: "4 темы оформления", desc: "Тёмная, Светлая, Неон, Бумага — переключаются мгновенно.", tag: null, span: 1 },
  { icon: "vcam", title: "Виртуальная камера", desc: "Сцена StreamBro как вебкамера — Zoom, Discord, Teams видят её как обычную камеру.", tag: "Новое", span: 1 },
  { icon: "gate", title: "Продвинутый шумодав", desc: "4 пресета от лёгкого до заглушения + индикатор «открыт/закрыт» + измеритель уровня в реальном времени.", tag: "Новое", span: 1 },
];

const ICONS: Record<string, React.ReactNode> = {
  stream: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
  scene: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  audio: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  p2p: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  record: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>,
  wasapi: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/></svg>,
  security: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  themes: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>,
  vcam: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7 16 12 23 17V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/><circle cx="8" cy="12" r="2.5" fill="currentColor" opacity="0.3"/></svg>,
  gate: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h2l3-7 4 14 4-10 3 6h4"/></svg>,
};

function Features() {
  return (
    <section id="features" style={{ padding: "9rem 0" }}>
      <div className="container">
        <div className="reveal" style={{ textAlign: "center", marginBottom: "5rem" }}>
          <span className="label-overline">Возможности</span>
          <h2 style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", fontWeight: 900, letterSpacing: "-0.035em", marginBottom: "1rem", lineHeight: 1.05 }}>
            Всё для стрима.<br />
            <span className="display-serif">Ничего лишнего.</span>
          </h2>
          <p style={{ color: "var(--text-1)", fontSize: "1.05rem", maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.7 }}>
            Каждая функция — ради одного: чтобы вы стримили, а не настраивали.
          </p>
        </div>

        <div className="bento-grid reveal reveal-delay-1">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className={`bento-card ${f.span === 2 ? "bento-wide" : ""}`}
              style={{ transition: "all 0.4s var(--ease-spring)" }}
            >
              {f.tag && <span className={`feature-tag ${f.tag === "Уникальное" ? "tag-purple" : f.tag === "Только Windows" ? "tag-blue" : f.tag?.startsWith("Новое") ? "tag-purple" : "tag-gold"}`}>{f.tag}</span>}
              <div className="feature-icon">{ICONS[f.icon]}</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "-0.015em", color: "var(--text-0)" }}>{f.title}</h3>
              <p style={{ color: "var(--text-1)", lineHeight: 1.65, fontSize: "0.9rem" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HOW IT WORKS
   ═══════════════════════════════════════════════════════════════ */
function HowItWorks() {
  const STEPS = [
    { num: "01", title: "Скачайте", desc: "Распакуйте архив. Никакой установки — запустите StreamBro.exe прямо из папки.", icon: "⬇" },
    { num: "02", title: "Добавьте источники", desc: "Камера, экран, микрофон — нажмите + и выберите. Перетаскивайте, масштабируйте.", icon: "+" },
    { num: "03", title: "В эфире", desc: "Выберите платформу, вставьте ключ — и вы стримите. За 30 секунд.", icon: "▶" },
  ];

  return (
    <section style={{ padding: "8rem 0", background: "var(--bg-1)", position: "relative", overflow: "hidden" }}>
      {/* Section top/bottom accents */}
      <div className="gold-line" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />
      <div className="gold-line" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} />

      {/* BG radial glow */}
      <div style={{ position: "absolute", top: "50%", right: "-10%", transform: "translateY(-50%)", width: 500, height: 500, background: "radial-gradient(ellipse, rgba(201,162,39,0.04) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div className="container" style={{ position: "relative" }}>
        <div className="reveal" style={{ textAlign: "center", marginBottom: "5rem" }}>
          <span className="label-overline">Как начать</span>
          <h2 style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)", fontWeight: 900, letterSpacing: "-0.035em" }}>
            Три шага —<span className="display-serif"> и вы в эфире</span>
          </h2>
        </div>

        {/* Steps — horizontal large cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "1px", background: "var(--border)", borderRadius: "var(--r-xl)", overflow: "hidden" }}>
          {STEPS.map((s, i) => (
            <div
              key={s.num}
              className="step-card reveal"
              style={{
                background: "var(--bg-2)", padding: "2.5rem 2rem",
                position: "relative", overflow: "hidden",
                transition: "background 0.3s ease",
                animationDelay: `${i * 0.1}s`,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-3)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-2)"; }}
            >
              {/* Large numeral */}
              <div className="step-num">{s.num}</div>

              {/* Content */}
              <div style={{ marginTop: "1rem" }}>
                <h3 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem", letterSpacing: "-0.02em" }}>{s.title}</h3>
                <p style={{ color: "var(--text-1)", fontSize: "0.92rem", lineHeight: 1.65 }}>{s.desc}</p>
              </div>

              {/* Step indicator dot */}
              <div style={{ position: "absolute", top: "1.5rem", right: "1.5rem", width: 36, height: 36, borderRadius: "50%", background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>{s.icon}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SAFETY SECTION
   ═══════════════════════════════════════════════════════════════ */
function SafetySection() {
  return (
    <section id="safety" style={{ padding: "8rem 0" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3.5rem", alignItems: "start" }}>
          {/* Left */}
          <div className="reveal">
            <span className="label-overline">Безопасность</span>
            <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 900, letterSpacing: "-0.035em", marginBottom: "1rem", lineHeight: 1.1 }}>
              Ваш ключ под<br />
              <span className="display-serif">надёжной защитой</span>
            </h2>
            <p style={{ color: "var(--text-1)", fontSize: "1rem", lineHeight: 1.75, marginBottom: "2.5rem" }}>
              Stream key — это доступ к вашему каналу. Мы относимся к этому серьёзно.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {[
                { title: "DPAPI шифрование", desc: "Ключ стрима шифруется через Windows Data Protection API." },
                { title: "Данные на вашем ПК", desc: "Ничего не отправляется на серверы. Все настройки локально в %APPDATA%." },
                { title: "Context Isolation", desc: "Electron с изоляцией контекстов. Никакой доступ к Node.js из рендерера." },
                { title: "Open Source GPL-3.0", desc: "Весь код на GitHub. Проверьте сами — нам нечего скрывать." },
              ].map((item) => (
                <div key={item.title} style={{ display: "flex", gap: "1rem", alignItems: "start" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--gold-fog)", border: "1px solid var(--border-gold)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.93rem", marginBottom: "0.15rem" }}>{item.title}</p>
                    <p style={{ color: "var(--text-2)", fontSize: "0.86rem", lineHeight: 1.55 }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — SmartScreen info */}
          <div className="reveal reveal-delay-2">
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-xl)", padding: "2.5rem", position: "relative", overflow: "hidden", backdropFilter: "blur(20px)" }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 200, height: 200, background: "radial-gradient(ellipse at top right, rgba(201,162,39,0.06), transparent)", borderRadius: "var(--r-xl)", pointerEvents: "none" }} />

              <div style={{ width: 52, height: 52, borderRadius: "var(--r-md)", background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.2)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.5rem", fontSize: "1.3rem" }}>⚠️</div>

              <h3 style={{ fontSize: "1.15rem", fontWeight: 800, marginBottom: "0.75rem", letterSpacing: "-0.015em" }}>
                Windows SmartScreen предупреждает?
              </h3>
              <p style={{ color: "var(--text-1)", fontSize: "0.92rem", lineHeight: 1.65, marginBottom: "1rem" }}>
                {"При первом запуске SmartScreen показывает «Неизвестное приложение» для любого ПО без EV-сертификата ($400/год). "}<strong style={{ color: "var(--text-0)" }}>Это нормально и безопасно.</strong>
              </p>

              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: "1.25rem" }}>
                <p style={{ fontWeight: 700, fontSize: "0.87rem", marginBottom: "0.6rem", color: "var(--gold)" }}>Что делать:</p>
                <ol style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {["Нажмите «Подробнее»", "Нажмите «Выполнить в любом случае»", "Приложение запустится — всё готово!"].map((step, i) => (
                    <li key={i} style={{ color: "var(--text-1)", fontSize: "0.88rem", lineHeight: 1.5 }}>{step}</li>
                  ))}
                </ol>
              </div>

              <p style={{ color: "var(--text-2)", fontSize: "0.8rem", lineHeight: 1.55, marginTop: "1rem" }}>
                Код полностью открыт на GitHub — вы можете собрать приложение сами.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DOWNLOAD SECTION
   ═══════════════════════════════════════════════════════════════ */
function DownloadSection({ downloadUrl }: { downloadUrl: string }) {
  return (
    <section id="download" style={{ padding: "8rem 0" }}>
      <div className="container">
        <div className="download-card reveal">
          {/* Inner glow */}
          <div style={{ position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)", width: 700, height: 500, background: "radial-gradient(ellipse, rgba(201,162,39,0.07) 0%, transparent 65%)", pointerEvents: "none" }} />

          <div style={{ position: "relative", padding: "6rem 3rem", textAlign: "center" }}>
            {/* Free stamp */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              marginBottom: "1.75rem", fontSize: "0.72rem", fontWeight: 700,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: "var(--gold)", padding: "0.4rem 1.2rem",
              borderRadius: 999, background: "rgba(201,162,39,0.07)",
              border: "1px solid rgba(201,162,39,0.2)",
              animation: "btnBreath 3s ease-in-out infinite",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--gold)", display: "inline-block" }} />
              100% бесплатно — без карты, без лимитов, без подписок
            </div>

            <h2 style={{ fontSize: "clamp(2.2rem, 5.5vw, 3.6rem)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "0.75rem" }}>
              Скачать StreamBro
            </h2>
            <p style={{ color: "var(--text-1)", fontSize: "1.1rem", marginBottom: "0.5rem", maxWidth: 500, marginLeft: "auto", marginRight: "auto" }}>
              Все функции. Сразу. Навсегда.
            </p>
            <p style={{ color: "var(--text-2)", fontSize: "0.85rem", marginBottom: "3rem", letterSpacing: "0.02em" }}>
              Windows 10/11 x64 · ~208 МБ · Portable · v{VERSION}
            </p>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "2.5rem" }}>
              <a href={downloadUrl} className="btn-gold btn-glow" style={{ fontSize: "1.05rem", padding: "1.1rem 3rem" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Скачать бесплатно
              </a>
              <Link href="/register" className="btn-ghost" style={{ fontSize: "0.95rem", padding: "1.1rem 2rem" }}>
                Создать аккаунт
              </Link>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "2.5rem", flexWrap: "wrap" }}>
              {[
                { icon: "📦", text: "Без установки — распакуй и запускай" },
                { icon: "🔄", text: "Автообновление внутри приложения" },
                { icon: "🔓", text: "Open Source (GPL-3.0)" },
              ].map((t) => (
                <div key={t.text} style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-2)", fontSize: "0.83rem" }}>
                  <span>{t.icon}</span> {t.text}
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
   CTA BANNER
   ═══════════════════════════════════════════════════════════════ */
function CtaBanner({ downloadUrl }: { downloadUrl: string }) {
  return (
    <section style={{ padding: "6rem 0" }}>
      <div className="container">
        <div className="reveal" style={{
          position: "relative", padding: "5rem 3rem", borderRadius: "var(--r-xl)",
          background: "linear-gradient(135deg, rgba(201,162,39,0.06) 0%, rgba(124,92,191,0.04) 50%, var(--bg-1) 100%)",
          border: "1px solid var(--border-gold)", textAlign: "center", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 80% at 50% 100%, rgba(201,162,39,0.04), transparent)", pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <h2 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.8rem)", fontWeight: 900, letterSpacing: "-0.035em", marginBottom: "0.75rem" }}>
              Начните стримить
              <span className="display-serif"> прямо сейчас</span>
            </h2>
            <p style={{ color: "var(--text-1)", fontSize: "1.05rem", marginBottom: "2.5rem", maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
              Бесплатно. Без карты. Аккаунт нужен только для P2P и друзей.
            </p>
            <a href={downloadUrl} className="btn-gold btn-glow" style={{ fontSize: "1.05rem", padding: "1.1rem 3rem" }}>
              Скачать StreamBro
            </a>
          </div>
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
              <Image src="/logo.png" alt="StreamBro" width={24} height={24} style={{ borderRadius: 6 }} />
              <span style={{ fontWeight: 800, fontSize: "0.95rem", letterSpacing: "-0.02em" }}>StreamBro</span>
            </div>
            <p style={{ color: "var(--text-2)", fontSize: "0.83rem", maxWidth: 240, lineHeight: 1.55 }}>
              Стриминг-композитор для Windows. Простой. Быстрый. Бесплатный.
            </p>
          </div>
          <div style={{ display: "flex", gap: "3rem" }}>
            {[
              { title: "Продукт", links: [["#features", "Функции"], ["#safety", "Безопасность"], ["#download", "Скачать"], ["https://github.com/mrkryachkin-stack/StreamBro", "GitHub"]] },
              { title: "Поддержка", links: [["mailto:support@streambro.ru", "Email"]] },
            ].map((col) => (
              <div key={col.title}>
                <h4 style={{ fontWeight: 700, fontSize: "0.78rem", marginBottom: "0.75rem", color: "var(--text-2)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{col.title}</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                  {col.links.map(([href, label]) => (
                    <a key={href} href={href} style={{ color: "var(--text-2)", fontSize: "0.83rem", transition: "color 0.2s ease" }}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "var(--text-0)"; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "var(--text-2)"; }}>
                      {label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <p style={{ color: "var(--text-2)", fontSize: "0.78rem" }}>&copy; {new Date().getFullYear()} StreamBro. Все права защищены.</p>
          <p style={{ color: "var(--text-2)", fontSize: "0.78rem" }}>GPL-3.0 — Open Source</p>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAGE ROOT
   ═══════════════════════════════════════════════════════════════ */
export default function HomePage() {
  const [showChanges, setShowChanges] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(`/api/download/portable/StreamBro-${VERSION}-portable.zip`);

  useScrollReveal();
  useTiltCards();

  useEffect(() => {
    fetch("/api/download/latest")
      .then((r) => r.json())
      .then((d) => { if (d.url) setDownloadUrl(d.url); })
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
