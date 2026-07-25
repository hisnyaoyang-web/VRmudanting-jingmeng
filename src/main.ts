import { FlatStage } from "./scene";

console.log("[main] boot");
const stage = document.getElementById("stage") as HTMLDivElement;

const flat = new FlatStage(stage);

let last = performance.now();
const loop = (now: number) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  flat.update(dt);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// 加载皮影 GLB 模型；开场说明页等待玩家点击「开始体验」，由 FlatStage 接管流程
flat.initPuppet()
  .then(() => {
    console.log("[main] 皮影就绪，等待开始");
  })
  .catch((err) => {
    console.error("皮影加载失败", err);
    const dim = document.getElementById("stage-dim");
    if (dim) dim.classList.add("lit");
  });
