// TinyStudio — narrow-viewport overflow regression across all five public
// pages (sol-sweep finding product-live/tinystudio-io-agents-280px-heading-overflow).
//
// The /agents hero h1 ("Seven specialists, one human signature.") carries an
// 11-character unbreakable word ("specialists,") at the 70px Fraunces serif
// size; without `overflow-wrap: anywhere` on the shared `.phead h1` rule,
// the document scrolls horizontally at the 280px viewport (doc scrollWidth
// 291 vs clientWidth 280; h1 scrollWidth 271 inside a 240px content box) and
// the same defect class is invisible to the 320/360/390 sweep only because
// the words on /, /audit, /pricing, /specimen happen to break naturally.
//
// This check runs real Chromium against each page served statically and
// asserts, at 240/260/280/300/320/360/390px viewports, that
// `documentElement.scrollWidth === documentElement.clientWidth` on the four
// routes this packet owns — /agents, /audit, /pricing, /specimen. The home
// page (/) is also measured, but its 240px-only overflow is the
// `.browser`/`.mock` hero-mock card covered by the in-progress
// hero-mock-240px packet, which is out of scope here; home failures are
// reported but do not gate this packet's exit code so CI does not block on
// an unrelated defect.
//
// Run: node scripts/test-narrow-viewport-pages.mjs  (or `npm run test:narrow-pages`)

import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const VIEWPORTS = [240, 260, 280, 300, 320, 360, 390];
// The six live pages: home (/), /agents, /audit, /pricing, /specimen, /msp.
// Each is served as a static HTML file in public/ with its own CSS.
const PAGES = [
  { path: "/", file: "index.html" },
  { path: "/agents", file: "agents.html" },
  { path: "/audit", file: "audit.html" },
  { path: "/pricing", file: "pricing.html" },
  { path: "/specimen", file: "specimen.html" },
  { path: "/msp", file: "msp.html" }
];
// The routes this packet owns: every page except the home page, whose
// 240px-only hero-mock overflow is the responsibility of the
// hero-mock-240px packet. Failures on those owned routes gate exit code;
// home-page failures are reported but do not gate (out of scope).
const OWNED_PATHS = new Set(["/agents", "/audit", "/pricing", "/specimen", "/msp"]);

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
      else if (rel === "/agents") rel = "/agents.html";
      else if (rel === "/audit") rel = "/audit.html";
      else if (rel === "/pricing") rel = "/pricing.html";
      else if (rel === "/specimen") rel = "/specimen.html";
      else if (rel === "/msp") rel = "/msp.html";
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
      res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const failures = [];
const ownedFailures = [];
const outOfScope = [];
const rows = [];

const server = await startServer();
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });

try {
  for (const width of VIEWPORTS) {
    for (const route of PAGES) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true });
      await page.goto(`${origin}${route.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(600);

      const state = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth
      }));

      const problems = state.sw !== state.cw
        ? [`doc scrollWidth ${state.sw} != clientWidth ${state.cw}`]
        : [];

      const owned = OWNED_PATHS.has(route.path);
      rows.push({
        route: route.path,
        scope: owned ? "owned" : "out-of-scope",
        width,
        sw: state.sw,
        cw: state.cw,
        result: problems.length ? "FAIL" : "PASS"
      });
      if (problems.length) {
        const msg = `${route.path} @ ${width}px: ${problems.join("; ")}`;
        if (owned) {
          ownedFailures.push(msg);
          failures.push(msg);
        } else {
          outOfScope.push(msg);
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log("Narrow-viewport overflow check across all five pages (real Chromium):");
console.table(rows);

if (outOfScope.length) {
  console.warn("\nOut-of-scope failures (reported, do not gate exit code):");
  for (const failure of outOfScope) console.warn(`- ${failure}`);
}

if (failures.length) {
  console.error("\nNarrow-viewport failures (owned routes — gate exit code):");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("All four owned routes keep document scrollWidth === clientWidth at 240-390px.");
