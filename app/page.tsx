import type { Metadata } from "next";
import ShadowplayApp from "./shadowplay-app";

export const metadata: Metadata = {
  title: "幕影铸梦｜WebSpatial × Injective",
  description: "一座可透光、可遮挡、可铸造的空间皮影戏台。",
};

export default function Home() {
  return <ShadowplayApp />;
}
