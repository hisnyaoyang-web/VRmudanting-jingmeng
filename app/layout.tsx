import type { Metadata } from "next";
import "./globals.css";
import SpatialProvider from "./spatial-provider";

export const metadata: Metadata = {
  title: "园中影铺｜WebXR 皮影掌柜",
  description: "经营一间皮影铺，照着剧本操纵角色，为不同客人演出属于你的故事。",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  openGraph: {
    title: "园中影铺",
    description: "看剧本、操纵皮影、招待客人，把今晚的演出变成你的故事。",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "园中影铺",
    description: "看剧本、操纵皮影、招待客人，把今晚的演出变成你的故事。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="manifest" href="/app.webmanifest" />
      </head>
      <body><SpatialProvider>{children}</SpatialProvider></body>
    </html>
  );
}
