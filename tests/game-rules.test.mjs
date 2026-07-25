import assert from "node:assert/strict";
import test from "node:test";
import { currentChallenge, playableCues, scoreRun } from "../app/game-rules.ts";

const story = {
  performance: {
    cues: [
      { id: "a", atMs: 1000, windowMs: 800, action: "salute", points: 100 },
      { id: "b", atMs: 2000, windowMs: 800, action: "right", points: 100 },
      { id: "c", atMs: 3000, windowMs: 800, action: "run", points: 100 },
      { id: "d", atMs: 4000, windowMs: 800, action: "flying", points: 100 },
      { id: "e", atMs: 5000, windowMs: 800, action: "left", points: 100 },
      { id: "f", atMs: 6000, windowMs: 800, action: "salute", points: 100 },
    ],
    scoring: {
      perfectRatio: 0.28,
      grades: [
        { id: "excellent", minScoreRatio: 0.82 },
        { id: "good", minScoreRatio: 0.55 },
        { id: "bad", minScoreRatio: 0 },
      ],
    },
  },
};

const perfectEvents = story.performance.cues.map(({ action, atMs }) => ({ action, atMs }));

test("perfect stage performance receives excellent", () => {
  const result = scoreRun(story, "stage", perfectEvents);
  assert.equal(result.grade, "excellent");
  assert.equal(result.score, 600);
  assert.equal(result.bestCombo, 6);
});

test("wrong actions cannot score even at the correct time", () => {
  const result = scoreRun(story, "stage", perfectEvents.map((event) => ({ ...event, action: "left" })));
  assert.ok(result.score < 600);
  assert.notEqual(result.grade, "excellent");
});

test("a single input event cannot satisfy two cues", () => {
  const result = scoreRun(story, "stage", [{ action: "salute", atMs: 1000 }]);
  assert.equal(result.score, 100);
  assert.equal(result.judgments.filter((value) => value !== "miss").length, 1);
});

test("apprentice mode uses four cues and wider windows", () => {
  assert.equal(playableCues(story, "apprentice").length, 4);
  assert.equal(playableCues(story, "apprentice")[0].windowMs, 1240);
  const result = scoreRun(story, "apprentice", perfectEvents.slice(0, 4));
  assert.equal(result.maxScore, 320);
});

test("master mode has tighter windows and score multiplier", () => {
  assert.equal(playableCues(story, "master")[0].windowMs, 576);
  const result = scoreRun(story, "master", perfectEvents);
  assert.equal(result.score, 750);
  assert.equal(result.maxScore, 750);
});

test("events outside the timing window are misses", () => {
  const result = scoreRun(story, "stage", perfectEvents.map((event) => ({ ...event, atMs: event.atMs + 401 })));
  assert.equal(result.score, 0);
  assert.equal(result.grade, "bad");
});

test("challenge dates and 28-day seasons are deterministic", () => {
  assert.deepEqual(currentChallenge(new Date("2026-01-01T23:59:00Z")), {
    date: "2026-01-01",
    seasonId: "2026-S01",
  });
  assert.deepEqual(currentChallenge(new Date("2026-01-29T00:00:00Z")), {
    date: "2026-01-29",
    seasonId: "2026-S02",
  });
});
