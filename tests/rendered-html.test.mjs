import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("preview server did not start");
}

test("production server renders the garden shadowplay experience shell", { timeout: 30_000 }, async () => {
  const port = 4197;
  const server = spawn("npm", ["run", "start", "--", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NO_COLOR: "1" },
    stdio: "ignore",
  });
  try {
    const response = await waitForServer(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /<title>园中影/);
    assert.match(html, /WebSpatial/);
    assert.match(html, /Injective/);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  }
});
