import { defineConfig } from "vite";

// 项目路径含中文字符时，esbuild 的依赖预打包读目录会失败，
// 因此把 three 排除在预打包之外，由 vite 直接按 ESM 源文件提供服务。
export default defineConfig({
  optimizeDeps: {
    exclude: ["three", "three/addons/loaders/GLTFLoader.js"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
