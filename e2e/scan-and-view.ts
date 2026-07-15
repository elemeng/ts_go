#!/usr/bin/env -S deno run --allow-all --unstable-detect-cjs --unsafe-proto --node-modules-dir=auto
// E2E test: scan test project, verify existing mrc frames show PNG thumbnails
import { chromium } from "npm:playwright@1.61";
import { delay } from "jsr:@std/async@1/delay";

const PROJECT_ROOT = import.meta.dirname
  ? new URL("..", import.meta.url).pathname
  : ".";
const TEST_MDOC = `${PROJECT_ROOT}/test/mdoc`;
const TEST_MRC = `${PROJECT_ROOT}/test/mrc`;
const BACKEND_PORT = 8099;
const FRONTEND_PORT = 3099;
const BACKEND_BIN = `${PROJECT_ROOT}/backend/target/release/ts-sv-backend`;

async function waitForServer(url: string, maxSec = 30): Promise<void> {
  for (let i = 0; i < maxSec; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await delay(1000);
  }
  throw new Error(`Server at ${url} not ready after ${maxSec}s`);
}

async function main() {
  console.log("[e2e] E2E Test: Scan & View MRC Thumbnails");

  // 1. Ensure backend is built
  try {
    await Deno.stat(BACKEND_BIN);
  } catch {
    console.log("[e2e] Building backend...");
    const build = new Deno.Command("cargo", {
      args: ["build", "--release"],
      cwd: `${PROJECT_ROOT}/backend`,
      stdout: "inherit",
      stderr: "inherit",
    });
    const out = await build.output();
    if (!out.success) throw new Error("Backend build failed");
  }

  // 2. Start backend (no stdout reading to avoid lock issues)
  console.log(`[e2e] Starting backend on port ${BACKEND_PORT}...`);
  const be = new Deno.Command(BACKEND_BIN, {
    env: { PORT: String(BACKEND_PORT), FRONTEND_DIR: "" },
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  await waitForServer(`http://localhost:${BACKEND_PORT}/health`);
  console.log("[e2e] ✅ Backend ready");

  // 3. Build frontend
  console.log("[e2e] Building frontend...");
  const buildFe = new Deno.Command("deno", {
    args: ["task", "build"],
    cwd: `${PROJECT_ROOT}/frontend`,
    env: { NEXT_PUBLIC_API_BASE: `http://localhost:${BACKEND_PORT}` },
    stdout: "inherit",
    stderr: "inherit",
  });
  const buildOut = await buildFe.output();
  if (!buildOut.success) throw new Error("Frontend build failed");

  // 4. Start frontend (python http.server)
  console.log(`[e2e] Starting frontend on port ${FRONTEND_PORT}...`);
  const fe = new Deno.Command("python3", {
    args: [
      "-m",
      "http.server",
      String(FRONTEND_PORT),
      "--directory",
      `${PROJECT_ROOT}/frontend/out`,
      "--bind",
      "0.0.0.0",
    ],
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  await waitForServer(`http://localhost:${FRONTEND_PORT}`);
  console.log("[e2e] ✅ Frontend ready");

  let browser;
  try {
    // 5. Launch browser
    console.log("[e2e] Launching headless browser...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[browser:error] ${msg.text()}`);
    });

    // 6. Navigate
    console.log("[e2e] Opening app...");
    await page.goto(`http://localhost:${FRONTEND_PORT}`, { waitUntil: "networkidle" });
    const title = await page.title();
    console.log(`[e2e] Page title: ${title}`);
    if (!title.includes("CryoET")) throw new Error("Wrong page title");

    // 7. Click Scan Project
    console.log("[e2e] Clicking Scan Project...");
    await page.waitForSelector('button:has-text("Scan Project")', { timeout: 5000 });
    await page.click('button:has-text("Scan Project")');

    // 8. Wait for dialog
    console.log("[e2e] Waiting for scan dialog...");
    await page.waitForSelector("#mdoc_dir", { timeout: 5000 });
    await delay(500);

    // 9. Fill paths
    console.log(`[e2e] Filling mdoc_dir: ${TEST_MDOC}`);
    await page.fill("#mdoc_dir", TEST_MDOC);
    console.log(`[e2e] Filling image_dir: ${TEST_MRC}`);
    await page.fill("#image_dir", TEST_MRC);
    await page.fill("#png_dir", `${PROJECT_ROOT}/test/png_e2e`);

    // 10. Click Scan button
    console.log("[e2e] Clicking Scan button...");
    await page.click('button:has-text("Scan"):not(:has-text("Project"))');

    // 11. Wait for scan to complete - look for tilt series headings
    console.log("[e2e] Waiting for scan results...");
    try {
      await page.waitForSelector("h2:has-text('Position_1_4')", { timeout: 30000 });
      console.log("[e2e] ✅ Position_1_4 appeared");
    } catch {
      // Take screenshot for debugging
      await page.screenshot({ path: "/tmp/ts-go-e2e-scan-fail.png", fullPage: true });
      const text = await page.textContent("body");
      console.log(`[e2e] Page body text: ${text?.substring(0, 500)}`);
      throw new Error("Position_1_4 did not appear after scan");
    }

    await delay(2000); // let thumbnails start loading

    // 12. Count all <img> elements (including SVG placeholders and real PNGs)
    const images = page.locator("img");
    const imgCount = await images.count();
    console.log(`[e2e] Total <img> elements: ${imgCount}`);

    // 13. Wait for real PNGs (blob: URLs from MRC→PNG pipeline)
    //     Position_1_4 has 12 matching .mrc files in test/mrc/,
    //     so at least 12 frames should show real PNG images.
    let realImages = 0;
    let hasSvgPlaceholder = false;
    for (let attempt = 0; attempt < 15 && (realImages < 12 || !hasSvgPlaceholder); attempt++) {
      realImages = 0;
      hasSvgPlaceholder = false;
      for (let i = 0; i < imgCount; i++) {
        const src = await images.nth(i).getAttribute("src");
        if (src) {
          if (src.startsWith("blob:")) realImages++;
          if (src.startsWith("data:image/svg+xml")) hasSvgPlaceholder = true;
        }
      }
      if (realImages < 12 || !hasSvgPlaceholder) {
        console.log(`[e2e] Waiting for PNGs... (attempt ${attempt + 1}/15: ${realImages} real, SVG placeholders: ${hasSvgPlaceholder})`);
        await delay(2000);
      }
    }

    console.log(`[e2e] MRC-derived PNG thumbnails: ${realImages} (expected >= 12)`);
    console.log(`[e2e] SVG placeholders present for unmatched frames: ${hasSvgPlaceholder}`);

    // Assertions
    if (realImages < 12) {
      await page.screenshot({ path: "/tmp/ts-go-e2e-too-few-pngs.png", fullPage: true });
      throw new Error(
        `Expected at least 12 real PNGs from MRC files, but only ${realImages} found`
      );
    }

    // 14. Verify preview API directly — confirm MRC→PNG encoding works
    const previewRes = await fetch(
      `http://localhost:${BACKEND_PORT}/api/preview/Position_1_13/6?bin=8`,
    );
    if (previewRes.ok) {
      const blob = await previewRes.blob();
      console.log(`[e2e] ✅ Preview API: HTTP 200, ${blob.size} bytes (from MRC Position_1_13 frame 6)`);
      if (blob.size < 100) {
        throw new Error(`PNG too small (${blob.size} bytes), likely corrupt`);
      }
    } else {
      throw new Error(`Preview API returned ${previewRes.status}`);
    }

    console.log("[e2e] ✅ ALL E2E TESTS PASSED");
  } finally {
    // Cleanup
    if (browser) await browser.close();
    fe.kill();
    be.kill();
    console.log("[e2e] Cleanup done");
  }
}

if (import.meta.main) {
  await main();
}
