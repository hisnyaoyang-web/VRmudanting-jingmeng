import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { createElement } from "react";
import { RhythmExperience, type RhythmExperienceProps } from "./rhythm-experience";

export type { Root } from "react-dom/client";
export type { RhythmExperienceProps } from "./rhythm-experience";

// Mounts the original (React + R3F) rhythm game into a container element so it
// can be embedded into the long-scroll show, then unmounts it cleanly on exit.
export function mountRhythm(
  container: HTMLElement,
  props: RhythmExperienceProps,
): Root {
  container.innerHTML = "";
  const root = createRoot(container);
  root.render(createElement(RhythmExperience, props));
  return root;
}

export function unmountRhythm(root: Root | null): void {
  if (!root) return;
  try {
    root.unmount();
  } catch {
    // ignore double-unmount
  }
}
