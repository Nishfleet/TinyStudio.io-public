// TinyStudio — narrow-viewport overflow regression for the homepage hero mock
// (sol-sweep finding product-live/tinystudio-io-hero-mock-240px-overflow).
//
// The `.browser`/`.mock` hero preview card and its `.flag` annotations have no
// minimum-width cap, so below ~252px the absolutely-positioned nowrap flags
// stretched the card past the viewport and the whole document shifted
// sideways (doc scrollWidth 252 at a 240px viewport). Earlier sweeps only
// tested 320/360/390, so the sub-320 overflow was never caught.
//
// This check runs real Chromium against the homepage served statically (the
// routes /, /appraisal and /desk — the latter two resolve to the homepage on
// the live site) and asserts, at 240/260/280/320px viewports:
//
//   1. documentElement.scrollWidth === documentElement.clientWidth (no
//      document-level horizontal overflow),
//   2. the `.browser`/`.mock` card's right edge stays inside the viewport,
//   3. every `.flag` annotation's right edge stays inside the card.
//
// The card is decorative; the failure mode it guards is the document shifting
// sideways on real small-mobile devices.
//
// Run: node scripts/test-narrow-viewport.mjs  (or `npm run test:narrow`)

import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const VIEWPORTS = [240, 260, 280, 320];
// The packet's named routes: the home hero-mock card is served at /, and
// /appraisal and /desk resolve to the same homepage (the live site serves
// the homepage for those paths). The distinct appraisal/desk pages (/audit,
// /agents) are covered by the sibling test:narrow-pages regression.
const ROUTES = ["/", "/appraisal", "/desk"];

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
      // Mirrors the live site: /appraisal and /desk serve the homepage.
      if (rel === "/" || rel === "/appraisal" || rel === "/desk") rel = "/index.html";
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
const rows = [];

const server = await startServer();
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });

try {
  for (const width of VIEWPORTS) {
    for (const route of ROUTES) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true });
      await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(600);

      const state = await page.evaluate(() => {
        const card = document.querySelector(".browser,.mock");
        const cardRect = card?.getBoundingClientRect();
        const flags = Array.from(document.querySelectorAll(".flag")).map((el) => ({
          text: (el.innerText || "").slice(0, 40),
          right: el.getBoundingClientRect().right
        }));
        return {
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
          cardRight: cardRect ? cardRect.right : null,
          flags
        };
      });

      const problems = [];
      if (state.sw !== state.cw) {
        problems.push(`document scrollWidth ${state.sw} != clientWidth ${state.cw}`);
      }
      if (state.cardRight === null) {
        problems.push("homepage carries no .browser/.mock hero card");
      } else if (Math.round(state.cardRight) > state.cw) {
        problems.push(`hero card right edge ${Math.round(state.cardRight)} exceeds viewport ${state.cw}`);
      }
      if (state.cardRight !== null) {
        for (const flag of state.flags) {
          if (Math.round(flag.right) > Math.round(state.cardRight)) {
            problems.push(`flag "${flag.text}" right edge ${Math.round(flag.right)} exceeds card right edge ${Math.round(state.cardRight)}`);
          }
        }
      }

      rows.push({ route, width, sw: state.sw, cw: state.cw, cardRight: state.cardRight ? Math.round(state.cardRight) : null, problems });
      if (problems.length) failures.push(`route ${route} @ ${width}px: ${problems.join("; ")}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log("Narrow-viewport hero mock check (real Chromium):");
console.table(
  rows.map((r) => ({
    route: r.route,
    viewport: `${r.width}px`,
    "doc sw": r.sw,
    "doc cw": r.cw,
    "card right": r.cardRight,
    result: r.problems.length ? "FAIL" : "PASS"
  }))
);

if (failures.length) {
  console.error("\nNarrow-viewport failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("All narrow viewports keep the hero mock and its flags inside the viewport.");
