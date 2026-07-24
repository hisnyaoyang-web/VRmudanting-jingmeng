import type { Metadata } from "next";
import ShadowplayApp from "./shadowplay-app";

export const metadata: Metadata = {
  title: "园中影：月门照影｜WebXR 节奏皮影",
  description: "跟随鼓点完成一折空间皮影戏，支持 WebXR、WebSpatial 与 Injective。",
};

export default function Home() {
  return <ShadowplayApp />;
}
