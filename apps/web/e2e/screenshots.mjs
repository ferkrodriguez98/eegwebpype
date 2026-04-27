// Generates README screenshots from a synthetic session.
//
// Prerequisites (run separately):
//   - Fixture exists at docs/fixtures/DEMO01_synthetic_D1_REST.fif
//     (regenerate with: python scripts/generate_fixture.py)
//   - Backend on :8000 with PYPE_EXTERNAL_ROOTS pointing to docs/fixtures/
//   - Frontend on :3000
//
// Run:
//   pnpm --filter @eegwebpype/web exec node e2e/screenshots.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// e2e/ -> apps/web/ -> apps/ -> repo root
const REPO_ROOT = resolve(__dirname, "../../..");
const OUT_DIR = resolve(REPO_ROOT, "docs/screenshots");
const SESSION = "DEMO01_D1";
const BASE = "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };

mkdirSync(OUT_DIR, { recursive: true });

async function ensureScanned() {
  const res = await fetch("http://localhost:8000/api/workspace/scan", {
    method: "POST",
  });
  if (!res.ok) throw new Error(`scan failed: ${res.status}`);
}

async function resetSession() {
  // Clean slate so screenshots are reproducible across runs.
  const res = await fetch(
    `http://localhost:8000/api/sessions/${SESSION}/reset`,
    { method: "POST" },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`reset failed: ${res.status}`);
  }
}

async function shoot(page, name) {
  const path = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`wrote ${path}`);
}

async function gotoSession(page) {
  await page.goto(`${BASE}/session/${SESSION}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");
  // Give uPlot a beat to draw.
  await page.waitForTimeout(800);
}

async function main() {
  await ensureScanned();
  await resetSession();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // Hide Next.js dev-mode error overlay (the red "N errors" pill bottom-left).
  // It is a dev-only artifact and does not belong in product screenshots.
  await page.addInitScript(() => {
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inject, { once: true });
    } else {
      inject();
    }
  });

  // Surface anything that goes wrong so the toast is not a silent mystery.
  page.on("pageerror", (err) => console.error("pageerror:", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("console.error:", msg.text());
  });
  page.on("requestfailed", (req) => {
    console.error("requestfailed:", req.url(), req.failure()?.errorText);
  });

  // 1. Raw time-scroll (overview tab is default).
  await gotoSession(page);
  // Switch window from 10s to 20s for a denser-looking sparkline panel.
  // Custom Select (shadcn-style): click trigger, then click the option button.
  await page.getByLabel("Window length").click();
  // Dropdown is a plain <ul>; pick the option whose visible text is "20s".
  await page.locator("li > button", { hasText: /^20s$/ }).click();
  await page.waitForTimeout(1500);
  await shoot(page, "raw");

  // 2. Bad channels view. Tighten detector thresholds via URL rewrite so the
  // DETECTED list is a handful (not 128). The synthetic fixture has uniform
  // spectra so we need stricter MAD multipliers than the production default.
  // We run auto-detect but do NOT apply: marking 19 channels bad would knock
  // out downstream filter PSD / ICLabel reference pipelines.
  await page.route("**/detect-bad-channels*", (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("mad_k", "2");
    url.searchParams.set("pot_z_extreme", "4");
    url.searchParams.set("neighbor_corr_thr", "0.04");
    route.continue({ url: url.toString() });
  });

  // Workaround: backend's /psd and /psd-with-filter crash when called with
  // fmax=100 because the spectrum picks logic yields zero channels. Cap
  // fmax at 47 (the bandpass cutoff) so the request returns 200 and the
  // filter view actually renders before/after curves.
  await page.route(/\/psd(-with-filter)?\?/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("fmax") === "100") {
      url.searchParams.set("fmax", "47");
      url.searchParams.set("fmin", "0.5");
    }
    route.continue({ url: url.toString() });
  });
  await page.locator("aside button", { hasText: /^bad channels$/i }).click();
  await page.waitForTimeout(800);
  await page.locator("button", { hasText: /^auto-detect$/i }).first().click();
  await page.waitForFunction(
    () => /apply detected \(\d+\)/i.test(document.body.innerText),
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1500);
  await shoot(page, "bad-channels");

  // 3. Filter tab. Apply a bandpass so an apply_filter event commits, and
  // wait long enough for the post-filter PSD to redraw alongside the before.
  await page.locator("aside button", { hasText: /^filter$/i }).click();
  await page.waitForTimeout(1200);
  // Button label is "apply filter (0.5–47 Hz)" — match by prefix.
  await page
    .locator("button", { hasText: /^apply filter\b/i })
    .first()
    .click();
  // Wait until the button stops saying "applying…" (mutation done).
  await page.waitForFunction(
    () => !/applying…/.test(document.body.innerText),
    null,
    { timeout: 60_000 },
  );
  // Then wait for the redraw — the PSD chart needs to refresh with both
  // before+after series visible. uPlot redraws on the next animation frame.
  await page.waitForTimeout(3500);
  await shoot(page, "filter");

  // 3. ICA tab. Run fit so the grid shows real topomaps + ICLabel labels.
  await page.locator("aside button", { hasText: /^ica$/i }).click();
  await page.waitForTimeout(800);
  const fitBtn = page.locator("button", { hasText: /fit\s*ica/i }).first();
  await fitBtn.waitFor({ timeout: 10_000 });
  await fitBtn.click();
  // Wait for the fit to finish. Empty-grid text disappears and ICLabel
  // probabilities populate (numeric value next to PROB, not "—").
  await page.waitForFunction(
    () => {
      const txt = document.body.innerText;
      if (/ICA not fitted yet/i.test(txt)) return false;
      // ICLabel renders categorical labels like "brain", "eye", "muscle",
      // "heart", "line_noise", "channel_noise", "other".
      return /\b(brain|eye|muscle|heart|line[_ ]?noise|channel[_ ]?noise|other)\b/i.test(
        txt,
      );
    },
    null,
    { timeout: 180_000 },
  );
  // Dismiss the "done 100% OK" completion modal so it does not cover the grid.
  const okBtn = page.locator("button", { hasText: /^ok$/i }).first();
  if ((await okBtn.count()) > 0) {
    await okBtn.click().catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
  // Let topomaps finish rendering after the modal closes.
  await page.waitForTimeout(2000);
  await shoot(page, "ica");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
