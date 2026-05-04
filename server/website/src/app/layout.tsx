import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#050510",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://streambro.ru"),
  title: "StreamBro — Стриминг-композитор для Windows",
  description: "Профессиональный лёгкий стриминг-композитор. RTMP на Twitch, YouTube, Kick. P2P со-стрим, микшер с FX, темы оформления.",
  keywords: ["стриминг", "стрим", "Twitch", "YouTube", "Kick", "OBS", "композитор", "RTMP"],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png" },
    ],
    apple: "/logo.png",
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "StreamBro — Стриминг-композитор",
    description: "Профессиональный лёгкий стриминг для Windows",
    url: "https://streambro.ru",
    siteName: "StreamBro",
    images: [{ url: "/logo.png", width: 512, height: 512 }],
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
