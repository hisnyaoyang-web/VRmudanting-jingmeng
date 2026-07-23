import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "园中影｜WebSpatial × Injective",
  description: "在方块苏州园林中，看一折会透光、会遮挡、可铸造的皮影戏。",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  openGraph: {
    title: "园中影",
    description: "走进方块苏州园林，把一折皮影戏铸成链上藏品。",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "园中影",
    description: "走进方块苏州园林，把一折皮影戏铸成链上藏品。",
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
