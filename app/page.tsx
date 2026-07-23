import type { Metadata } from "next";
import ShadowplayApp from "./shadowplay-app";

export const metadata: Metadata = {
  title: "园中影｜WebSpatial × Injective",
  description: "方块苏州园林中的空间皮影与链上藏品。",
};

export default function Home() {
  return <ShadowplayApp />;
}
