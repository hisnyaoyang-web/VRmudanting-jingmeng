import type { Metadata } from "next";
import ShadowplayApp from "./shadowplay-app";

export const metadata: Metadata = {
  title: "园中影铺｜WebXR 皮影掌柜",
  description: "经营一间支持 WebXR 与 WebSpatial 的皮影铺，为不同客人演出，并在 Injective 留下纪念。",
};

export default function Home() {
  return <ShadowplayApp />;
}
