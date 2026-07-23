import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "幕影铸梦｜WebSpatial × Injective",
  description: "一座可透光、可遮挡、可铸造的空间皮影戏台。",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  openGraph: {
    title: "幕影铸梦",
    description: "WebSpatial × Injective：把一出皮影戏铸成链上藏品。",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "幕影铸梦",
    description: "WebSpatial × Injective：把一出皮影戏铸成链上藏品。",
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
