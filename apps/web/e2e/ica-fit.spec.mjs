// End-to-end smoke for the ICA fit WebSocket flow.
//
// Why this lives outside the unit test suite:
//   - It needs both the backend (port 8000) and frontend (port 3000)
//     up, plus a session whose source .bdf actually exists on disk.
//   - It runs the real ICA fit (~30-60s) against a real recording.
//
// Run locally with:
//   pnpm --filter @eegwebpype/web e2e
//
// Prerequisites:
//   - Backend: pnpm api:dev (must be on uvicorn --ws wsproto)
//   - Frontend: pnpm --filter @eegwebpype/web dev
//   - Session AK15_D1 visible in the workspace
//
// This script is what proved the websockets-lib vs wsproto handshake
// bug: with default uvicorn[standard] the fit WebSocket gets rejected
// 400 by the browser handshake; with --ws wsproto it completes.

import { chromium } from "playwright";

const SESSION = process.env.E2E_SESSION ?? "AK15_D1";
const URL = `http://localhost:3000/session/${SESSION}`;
const TIMEOUT = 300_000;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const wsAttempts = [];
page.on("websocket", (ws) => {
  const url = ws.url();
  if (!url.includes("/ws/sessions/")) return;
  const att = { url, opened: Date.now(), closed: null, frames: 0 };
  wsAttempts.push(att);
  ws.on("framereceived", () => att.frames++);
  ws.on("close", () => {
    att.closed = Date.now();
  });
});

const consoleErrors = [];
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle");

await page.locator("aside button", { hasText: /^ica$/i }).click();
await page.waitForTimeout(800);

const fitBtn = page.locator("button", { hasText: /fit\s*ica/i }).first();
await fitBtn.waitFor({ timeout: 10_000 });
await fitBtn.click();
console.log("clicked fit ICA");

const start = Date.now();
let finalState = "unknown";
while (Date.now() - start < TIMEOUT) {
  const errVisible = await page.getByText(/connection dropped/i).count();
  if (errVisible > 0) {
    finalState = "ERROR_TEXT_VISIBLE";
    break;
  }
  const hasIC = await page.getByText(/\bIC\s?0\b/).count();
  if (hasIC > 0) {
    finalState = "FIT_COMPLETED";
    break;
  }
  const fittedToast = await page.getByText(/ICA fitted/i).count();
  if (fittedToast > 0) {
    finalState = "FIT_COMPLETED";
    break;
  }
  await page.waitForTimeout(500);
}

console.log("final state:", finalState);
console.log("ica ws attempts:");
for (const a of wsAttempts) {
  console.log(
    `  ${a.url} frames=${a.frames} dur_ms=${a.closed ? a.closed - a.opened : "still-open"}`,
  );
}
if (consoleErrors.length > 0) {
  console.log("console errors:");
  for (const e of consoleErrors) console.log(`  ${e}`);
}

await browser.close();
process.exit(finalState === "FIT_COMPLETED" ? 0 : 1);
