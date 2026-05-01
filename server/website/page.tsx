import Link from "next/link";
import Image from "next/image";

/* ──────────────────────────────────────────────────────────────
   NAVBAR
   ────────────────────────────────────────────────────────────── */
function Navbar() {
  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: "0 2rem",
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(8, 8, 12, 0.8)",
        backdropFilter: "blur(20px) saturate(1.2)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Image src="/logo.png" alt="StreamBro" width={36} height={36} style={{ borderRadius: 8 }} />
        <span style={{ fontWeight: 800, fontSize: "1.15rem", letterSpacing: "-0.02em" }}>StreamBro</span>
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <a href="#features" style={{ color: "var(--text-1)", fontSize: "0.9rem", fontWeight: 500 }}>Функции</a>
        <a href="#download" style={{ color: "var(--text-1)", fontSize: "0.9rem", fontWeight: 500 }}>Скачать</a>
        <Link href="/login" className="btn-ghost" style={{ padding: "0.55rem 1.4rem", fontSize: "0.85rem" }}>
          Войти
        </Link>
        <Link href="/register" className="btn-gold" style={{ padding: "0.55rem 1.4rem", fontSize: "0.85rem" }}>
          Начать
        </Link>
      </div>
    </nav>
  );
}

/* ──────────────────────────────────────────────────────────────
   HERO
   ────────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "8rem 2rem 6rem",
        overflow: "hidden",
      }}
    >
      {/* Radial gold glow */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 800,
          height: 800,
          background: "radial-gradient(ellipse, var(--gold-dim) 0%, transparent 60%)",
          pointerEvents: "none",
        }}
      />
      {/* Subtle top line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: "linear-gradient(90deg, transparent, var(--gold-glow), transparent)",
        }}
      />

      <div className="fade-up" style={{ position: "relative", maxWidth: 700 }}>
        <p
          style={{
            display: "inline-block",
            color: "var(--gold)",
            fontWeight: 600,
            fontSize: "0.85rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "1.5rem",
            padding: "0.4rem 1rem",
            borderRadius: 999,
            border: "1px solid rgba(255, 210, 60, 0.2)",
            background: "var(--gold-dim)",
          }}
        >
          Стриминг нового поколения
        </p>

        <h1
          style={{
            fontSize: "clamp(2.8rem, 7vw, 5rem)",
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            marginBottom: "1.5rem",
          }}
        >
          Стриминг.
          <br />
          <span style={{ color: "var(--gold)" }}>Простой.</span>
        </h1>

        <p
          style={{
            fontSize: "1.2rem",
            color: "var(--text-1)",
            lineHeight: 1.6,
            marginBottom: "2.5rem",
            maxWidth: 520,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          Лёгкий композитор для Windows. Трансляции на Twitch, YouTube, Kick.
          Запись в MP4. P2P со-стрим с другом. Бесплатно.
        </p>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/api/download/portable/StreamBro-1.1.0-portable.zip" className="btn-gold" style={{ fontSize: "1.05rem", padding: "1rem 2.5rem" }}>
            Скачать бесплатно
          </a>
          <a href="#features" className="btn-ghost" style={{ fontSize: "1.05rem", padding: "1rem 2.5rem" }}>
            Узнать больше
          </a>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   FEATURES
   ────────────────────────────────────────────────────────────── */
const FEATURES = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
    title: "RTMP стриминг",
    desc: "Реальный RTMP через FFmpeg на Twitch, YouTube, Kick и любой Custom-сервер с автопереподключением",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: "Сцены и источники",
    desc: "Камера, экран, окно, изображения — перетаскивайте, меняйте размер, вращайте и обрезайте",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    ),
    title: "Продвинутый микшер",
    desc: "Шумодав, 3-полосный EQ, компрессор, лимитер — для каждого канала отдельно",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "P2P со-стрим",
    desc: "Код комнаты — и друг на вашей сцене. WebRTC P2P с ICE restart и TURN fallback",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
      </svg>
    ),
    title: "4 темы оформления",
    desc: "Тёмная, Светлая, Неон, Бумага — переключаются мгновенно без перезапуска",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    ),
    title: "Запись в MP4",
    desc: "Локальная запись стрима в высоком качестве с отдельным битрейтом",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "Безопасность",
    desc: "Stream key зашифрован (DPAPI). Context isolation. Никаких данных на сервере без вашего согласия",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="2" x2="9" y2="4" /><line x1="15" y1="2" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="22" /><line x1="15" y1="20" x2="15" y2="22" /><line x1="20" y1="9" x2="22" y2="9" /><line x1="20" y1="14" x2="22" y2="14" /><line x1="2" y1="9" x2="4" y2="9" /><line x1="2" y1="14" x2="4" y2="14" />
      </svg>
    ),
    title: "WASAPI системный звук",
    desc: "Нативный захват системного звука Windows через WASAPI loopback — без виртуальных кабелей",
  },
];

function Features() {
  return (
    <section id="features" style={{ padding: "8rem 0" }}>
      <div className="container">
        <p style={{ color: "var(--gold)", fontWeight: 600, fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          Возможности
        </p>
        <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          Всё что нужно для стрима
        </h2>
        <p style={{ color: "var(--text-1)", fontSize: "1.1rem", marginBottom: "4rem", maxWidth: 480 }}>
          Без лишнего. Без перегруза. Просто работает. И всё бесплатно.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "1.25rem",
          }}
        >
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="card"
              style={{
                padding: "2rem",
                animationDelay: `${i * 0.08}s`,
              }}
            >
              <div style={{ marginBottom: "1.25rem", display: "flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 12, background: "var(--gold-dim)" }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "-0.01em" }}>
                {f.title}
              </h3>
              <p style={{ color: "var(--text-1)", lineHeight: 1.6, fontSize: "0.95rem" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   DOWNLOAD SECTION (replaces Pricing)
   ────────────────────────────────────────────────────────────── */
function DownloadSection() {
  return (
    <section id="download" style={{ padding: "8rem 0" }}>
      <div className="container">
        <div
          style={{
            position: "relative",
            padding: "5rem 3rem",
            borderRadius: "var(--radius)",
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          {/* Gold glow */}
          <div
            style={{
              position: "absolute",
              top: "-30%",
              left: "50%",
              transform: "translateX(-50%)",
              width: 600,
              height: 400,
              background: "radial-gradient(ellipse, var(--gold-dim) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          <div style={{ position: "relative" }}>
            <p style={{ color: "var(--gold)", fontWeight: 600, fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
              Скачать
            </p>
            <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "1rem" }}>
              StreamBro 1.1.0
            </h2>
            <p style={{ color: "var(--text-1)", fontSize: "1.1rem", marginBottom: "0.75rem", maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
              Бесплатно. Без карты. Без ограничений по времени.
              Все функции доступны сразу.
            </p>
            <p style={{ color: "var(--text-2)", fontSize: "0.9rem", marginBottom: "2.5rem" }}>
              Windows 10/11 x64 &middot; ~209 МБ (portable) &middot; Версия 1.1.0
            </p>

            <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
              <a href="/api/download/portable/StreamBro-1.1.0-portable.zip" className="btn-gold" style={{ fontSize: "1.1rem", padding: "1rem 3rem" }}>
                Скачать StreamBro
              </a>
              <Link href="/register" className="btn-ghost" style={{ fontSize: "1rem", padding: "1rem 2rem" }}>
                Создать аккаунт
              </Link>
            </div>

            <div style={{ marginTop: "2rem", display: "flex", justifyContent: "center", gap: "2rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-2)", fontSize: "0.85rem" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Без установки — распакуй и запускай
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-2)", fontSize: "0.85rem" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Автообновление
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-2)", fontSize: "0.85rem" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Open Source (GPL-3.0)
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   CTA
   ────────────────────────────────────────────────────────────── */
function CtaBanner() {
  return (
    <section style={{ padding: "6rem 0" }}>
      <div className="container">
        <div
          style={{
            position: "relative",
            padding: "4rem 3rem",
            borderRadius: "var(--radius)",
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          {/* Gold glow */}
          <div
            style={{
              position: "absolute",
              top: "-40%",
              left: "50%",
              transform: "translateX(-50%)",
              width: 500,
              height: 300,
              background: "radial-gradient(ellipse, var(--gold-dim) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <h2
            style={{
              fontSize: "clamp(1.8rem, 4vw, 2.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              marginBottom: "1rem",
              position: "relative",
            }}
          >
            Готовы начать стримить?
          </h2>
          <p
            style={{
              color: "var(--text-1)",
              fontSize: "1.1rem",
              marginBottom: "2rem",
              position: "relative",
            }}
          >
            Скачайте StreamBro бесплатно — без карты, без обязательств.
            Аккаунт нужен только для P2P со-стрима и друзей.
          </p>
          <a href="/api/download/portable/StreamBro-1.1.0-portable.zip" className="btn-gold" style={{ fontSize: "1.1rem", padding: "1rem 3rem", position: "relative" }}>
            Скачать StreamBro
          </a>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   FOOTER
   ────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "3rem 0 2rem",
      }}
    >
      <div className="container">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "start",
            flexWrap: "wrap",
            gap: "2rem",
            marginBottom: "2rem",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem" }}>
              <Image src="/logo.png" alt="StreamBro" width={28} height={28} style={{ borderRadius: 6 }} />
              <span style={{ fontWeight: 800, fontSize: "1rem" }}>StreamBro</span>
            </div>
            <p style={{ color: "var(--text-2)", fontSize: "0.9rem", maxWidth: 280, lineHeight: 1.5 }}>
              Лёгкий стриминг-композитор для Windows. Стримите просто.
            </p>
          </div>

          <div style={{ display: "flex", gap: "3rem" }}>
            <div>
              <h4 style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--text-1)" }}>Продукт</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <a href="#features" style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>Функции</a>
                <a href="#download" style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>Скачать</a>
                <a href="https://github.com/mrkryachkin-stack/StreamBro" target="_blank" rel="noopener" style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>GitHub</a>
              </div>
            </div>
            <div>
              <h4 style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--text-1)" }}>Поддержка</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <a href="mailto:support@streambro.ru" style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>Email</a>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: "1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <p style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>
            &copy; {new Date().getFullYear()} StreamBro. Все права защищены.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ──────────────────────────────────────────────────────────────
   PAGE
   ────────────────────────────────────────────────────────────── */
export default function HomePage() {
  return (
    <main>
      <Navbar />
      <Hero />
      <Features />
      <DownloadSection />
      <CtaBanner />
      <Footer />
    </main>
  );
}
