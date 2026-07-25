import { StoryStage } from "./story-stage";

console.log("[experience2] boot");
const stage = document.getElementById("stage") as HTMLDivElement;

const story = new StoryStage(stage);

let last = performance.now();
const loop = (now: number) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  story.update(dt);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

story.initPuppet()
  .then(() => console.log("[experience2] 皮影就绪，等待开始"))
  .catch((err) => {
    console.error("皮影加载失败", err);
    const dim = document.getElementById("stage-dim");
    if (dim) dim.classList.add("lit");
  });
