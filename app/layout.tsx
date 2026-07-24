import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "园中影：月门照影｜WebXR 节奏皮影",
  description: "跟随鼓点完成一折空间皮影戏，支持 WebXR、WebSpatial 与链上纪念藏品。",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  openGraph: {
    title: "园中影",
    description: "跟随鼓点合拍入戏，把一折空间皮影演出铸成链上藏品。",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "园中影",
    description: "跟随鼓点合拍入戏，把一折空间皮影演出铸成链上藏品。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
