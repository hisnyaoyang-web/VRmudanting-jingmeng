import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "园中影铺",
    short_name: "园中影铺",
    description: "在 WebSpatial 剧场中照着剧本操纵皮影，为不同客人演出。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#071216",
    theme_color: "#071216",
    icons: [
      {
        src: "/icons/pwa-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/pwa-1024x1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    xr_main_scene: {
      default_size: {
        width: 1280,
        height: 820,
      },
    },
  } as MetadataRoute.Manifest;
}
