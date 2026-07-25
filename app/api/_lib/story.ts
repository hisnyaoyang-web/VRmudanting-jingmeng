import storyJson from "../../../public/stories/moongate-night/story.json";
import { validateStory } from "../../story-runtime";

export const story = validateStory(storyJson);
export const STORY_VERSION = "1.0.0";

export function getStory(storyId: string) {
  return storyId === story.id ? story : null;
}
