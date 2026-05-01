import Link from "next/link";
import Image from "next/image";

export default function DownloadPage() {
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
        <Link href="/register" className="btn-gold" style={{ padding: "0.55rem 1.4rem", fontSize: "0.85rem" }}>
          Создать аккаунт
        </Link>
      </header>

      <main
        style={{
          maxWidth: 700,
          margin: "0 auto",
          padding: "4rem 2rem",
          textAlign: "center",
          position: "relative",
        }}
      >
        {/* Glow */}
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 500,
            height: 500,
            background: "radial-gradient(ellipse, var(--gold-dim) 0%, transparent 60%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative" }}>
          <Image
            src="/logo.png"
            alt="StreamBro"
            width={80}
            height={80}
            style={{ borderRadius: 20, marginBottom: "2rem" }}
          />

          <h1 style={{ fontSize: "2.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "1rem" }}>
            Скачать StreamBro
          </h1>

          <p style={{ color: "var(--text-1)", fontSize: "1.15rem", lineHeight: 1.6, marginBottom: "2rem" }}>
            Бесплатно. Без карты. Без ограничений.
          </p>

          {/* Download button */}
          <a
            href="/api/download/portable/StreamBro-1.1.0-portable.zip"
            className="btn-gold"
            style={{ fontSize: "1.2rem", padding: "1.25rem 3.5rem", display: "inline-block", marginBottom: "2rem" }}
          >
            Скачать для Windows
          </a>

          {/* Info */}
          <div
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "2rem",
              textAlign: "left",
              marginBottom: "2rem",
            }}
          >
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "1.25rem" }}>Информация</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[
                ["Версия", "1.1.0"],
                ["Платформа", "Windows 10/11 x64"],
                ["Размер", "~209 МБ"],
                ["Формат", "Portable (.zip) — без установки"],
                ["Лицензия", "GPL-3.0 (Open Source)"],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
                  <span style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>{label}</span>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Features checklist */}
          <div
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "2rem",
              textAlign: "left",
              marginBottom: "2rem",
            }}
          >
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "1.25rem" }}>Что включено</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {[
                "RTMP стриминг (Twitch/YouTube/Kick)",
                "Запись в MP4",
                "Сцены и источники",
                "Шумодав + EQ + компрессор",
                "P2P со-стрим (WebRTC)",
                "4 темы оформления",
                "Системный звук (WASAPI)",
                "Автообновление",
              ].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span style={{ color: "var(--text-1)" }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick start */}
          <div
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "2rem",
              textAlign: "left",
            }}
          >
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "1rem" }}>Быстрый старт</h3>
            <ol style={{ paddingLeft: "1.5rem", color: "var(--text-1)", fontSize: "0.9rem", lineHeight: 1.8 }}>
              <li>Распакуйте zip-архив в любую папку</li>
              <li>Запустите <strong>StreamBro.exe</strong></li>
              <li>Нажмите «+» чтобы добавить камеру или экран</li>
              <li>В настройках введите stream key с Twitch/YouTube/Kick</li>
              <li>Нажмите «Стрим» — и вы в эфире!</li>
            </ol>
          </div>

          <p style={{ color: "var(--text-2)", fontSize: "0.85rem", marginTop: "2rem" }}>
            Аккаунт не обязателен для стриминга. Он нужен только для P2P со-стрима и списка друзей.{" "}
            <Link href="/register" style={{ color: "var(--gold)", fontWeight: 600 }}>
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
