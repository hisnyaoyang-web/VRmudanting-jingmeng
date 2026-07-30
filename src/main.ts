import { StoryStage } from "./story-stage";

console.log("[experience2] boot");
const stage = document.getElementById("stage") as HTMLDivElement;

const story = new StoryStage(stage);
(window as any).__story = story; // 调试/自动化测试钩子

let last = performance.now();
const loop = (now: number) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  story.update(dt);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

story.initPuppet()
  .then(() => {
    console.log("[experience2] 皮影就绪，等待开始");
    // 调试：?finale=awaken|explore|firm|free 直接预览结算页角色卡
    const finaleParam = new URLSearchParams(location.search).get("finale");
    if (finaleParam) {
      const s = story as any;
      s.introEl.classList.add("hidden");
      if (finaleParam === "firm") s.behavior.knockIntervals = [1000, 1080, 960];
      else if (finaleParam === "free") s.behavior.dirChanges = 12;
      else if (finaleParam === "explore") s.behavior.dirChanges = 5;
      else s.behavior.knockIntervals = [400, 520];
      s.startFinale();
    }
  })
  .catch((err) => {
    console.error("皮影加载失败", err);
    const dim = document.getElementById("stage-dim");
    if (dim) dim.classList.add("lit");
  });
