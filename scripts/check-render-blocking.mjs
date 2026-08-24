// TinyStudio — browser render-blocking guard (dogfood finding b8f6046e942a).
//
// The static guards in check-site.mjs prove the served HTML cannot contain the
// blocking font shape, but they cannot see the behavior: a regression could
// still ship if the served HTML drifts and CI stays green. This check runs
// real Chromium against the six public pages, served statically under the
// exact production Content-Security-Policy the worker emits, and asserts:
//
//   1. the Google Fonts css2 stylesheet is fetched non-blocking
//      (renderBlockingStatus !== "blocking"),
//   2. first-contentful-paint does not wait for it (the css2 response is
//      intercepted and delayed, so a blocking shape deterministically delays
//      first paint),
//   3. the only render-blocking resources are the site's own same-origin
//      stylesheets,
//   4. the preload link is still promoted to a real stylesheet under the
//      production CSP (the inline-onload shape the CSP forbids would leave
//      link.sheet null).
//
// The css2 response is stubbed so the check has no external network
// dependency; the real font URL and the no-JS fallback are kept honest by the
// static guards in scripts/check-site.mjs.
//
// Run: node scripts/check-render-blocking.mjs  (or `npm run check:render-blocking`)

import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Mirrors SECURITY_HEADERS in src/worker.js. The promotion script is only
// required because this exact header forbids inline handlers; the check must
// run under it or it would not exercise the production shape.
const PRODUCTION_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

const FONT_CSS_PATTERN = "**fonts.googleapis.com/css2**";
const CSS2_DELAY_MS = 2500; // generous: a slow CI runner still paints first before this
const STUB_CSS = "/* TinyStudio render-blocking check: stubbed font stylesheet */";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const PAGES = [
  ["homepage", "index.html"],
  ["audit page", "audit.html"],
  ["desk page", "agents.html"],
  ["pricing page", "pricing.html"],
  ["specimen page", "specimen.html"],
  ["msp page", "msp.html"],
  ["brief-requested page", "brief-requested.html"]
];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";
      const file = normalize(join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      try {
        statSync(file);
      } catch {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        "Content-Security-Policy": PRODUCTION_CSP
      });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measurePage(page, pageUrl) {
  // Delay the css2 response: if the stylesheet is ever fetched render-blocking
  // again, first paint is held until it responds and the check fails.
  await page.route(FONT_CSS_PATTERN, async (route) => {
    await sleep(CSS2_DELAY_MS);
    await route.fulfill({
      status: 200,
      contentType: "text/css; charset=utf-8",
      body: STUB_CSS
    });
  });

  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  let fcp = null;
  let css2 = null;
  for (let i = 0; i < 160; i++) {
    const state = await page.evaluate(() => {
      const paint = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
      const resources = performance.getEntriesByType("resource").map((r) => ({
        name: r.name,
        responseEnd: r.responseEnd,
        renderBlockingStatus: r.renderBlockingStatus
      }));
      return {
        fcp: paint ? Math.round(paint.startTime) : null,
        resources
      };
    });
    fcp = state.fcp;
    css2 = state.resources.find((r) => r.name.includes("css2")) ?? null;
    if (fcp !== null && css2 !== null) break;
    await sleep(50);
  }

  // Give the (stubbed, delayed) stylesheet time to finish loading so the
  // promotion result is observable.
  await sleep(1500);
  const promotion = await page.evaluate(() => {
    // fonts.js creates a NEW stylesheet link for the same URL; the original
    // preload link keeps rel="preload" and never gets a sheet. Match the
    // promoted stylesheet link by the font URL (as the evidence receipt does).
    const promoted = [...document.querySelectorAll("link[href*='fonts.googleapis.com/css2']")].find(
      (l) => l.rel === "stylesheet"
    );
    return { exists: !!promoted, sheetApplied: !!promoted && !!promoted.sheet };
  });

  const blocking = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((r) => r.renderBlockingStatus === "blocking")
      .map((r) => r.name)
  );

  return { fcp, css2, promotion, blocking };
}

const failures = [];
const rows = [];

const server = await startServer();
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });

try {
  for (const [pageName, file] of PAGES) {
    const page = await browser.newPage();
    const result = await measurePage(page, `${origin}/${file}`);
    await page.close();

    const css2Status = result.css2?.renderBlockingStatus ?? null;
    const waitedForCss2 =
      result.fcp !== null && result.css2 !== null ? result.fcp >= Math.round(result.css2.responseEnd) : null;

    const problems = [];
    if (css2Status !== "non-blocking") {
      problems.push(`font stylesheet renderBlockingStatus is ${JSON.stringify(css2Status)}, expected "non-blocking"`);
    }
    if (waitedForCss2 !== false) {
      problems.push(`first-contentful-paint waited for the font stylesheet (fcp=${result.fcp}ms, css2 end=${result.css2 ? Math.round(result.css2.responseEnd) : null}ms)`);
    }
    const disallowedBlocking = result.blocking.filter((name) => {
      const u = new URL(name);
      return u.origin !== origin || !u.pathname.endsWith(".css");
    });
    if (disallowedBlocking.length) {
      problems.push(`render-blocking resources other than same-origin stylesheets: ${disallowedBlocking.join(", ")}`);
    }
    if (!result.promotion.exists || !result.promotion.sheetApplied) {
      problems.push("font preload link was not promoted to a stylesheet under the production CSP (link.sheet is null)");
    }

    rows.push({ pageName, css2Status, fcp: result.fcp, waitedForCss2, disallowedBlocking, sheetApplied: result.promotion.sheetApplied, problems });
    if (problems.length) failures.push(`${pageName}: ${problems.join("; ")}`);
  }
} finally {
  await browser.close();
  server.close();
}

console.log("Render-blocking check (real Chromium, production CSP, css2 delayed " + CSS2_DELAY_MS + "ms):");
console.table(
  rows.map((r) => ({
    page: r.pageName,
    "css2 status": r.css2Status,
    "fcp (ms)": r.fcp,
    "fcp waited for css2": r.waitedForCss2,
    "other blocking": r.disallowedBlocking.length ? r.disallowedBlocking.join(",") : "-",
    "sheet applied": r.sheetApplied,
    result: r.problems.length ? "FAIL" : "PASS"
  }))
);

if (failures.length) {
  console.error("\nRender-blocking failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("All six pages load the font stylesheet without render-blocking under the production CSP.");
