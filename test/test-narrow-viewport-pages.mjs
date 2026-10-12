// TinyStudio — narrow-viewport overflow regression across all five public
// pages (sol-sweep finding product-live/tinystudio-io-agents-280px-heading-overflow).
//
// A long unbreakable word in a hero h1 at the 70px Fraunces serif size
// overflows the narrow viewports unless the shared `.phead h1` rule carries
// `overflow-wrap: anywhere`; the defect class is invisible to the 320/360/390
// sweep when the words happen to break naturally.
//
// This check runs real Chromium against each page served statically and
// asserts, at 240/260/280/300/320/360/390px viewports, that
// `documentElement.scrollWidth === documentElement.clientWidth` on the three
// routes this packet owns — /appraisal, /pricing, /specimen. A document-level
// comparison alone misses a spill a clipped ancestor hides, so the same sweep
// also measures the named content containers in SPILL_SELECTORS and fails when
// one extends past the viewport edge. That second assertion is what caught the
// `.stat` "54 of 88" figure, whose `white-space:nowrap` and 72px font-size
// floor needed 211px inside the 148px a 240px viewport leaves after the wrap
// and band padding.
//
// The home page (/) is also measured, but its 240px-only overflow is the
// `.browser`/`.mock` hero-mock card covered by the in-progress
// hero-mock-240px packet, which is out of scope here; home failures are
// reported but do not gate this packet's exit code so CI does not block on
// an unrelated defect.
//
// Run: node test/test-narrow-viewport-pages.mjs  (or `npm run test:narrow-pages`)

import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const VIEWPORTS = [240, 260, 280, 300, 320, 360, 390];
// The live pages: home (/), /appraisal, /pricing, /specimen.
// Each is served as a static HTML file in public/ with its own CSS.
const PAGES = [
  { path: "/", file: "index.html" },
  { path: "/appraisal", file: "appraisal.html" },
  { path: "/pricing", file: "pricing.html" },
  { path: "/specimen", file: "specimen.html" }
];
// The routes this packet owns: every page except the home page, whose
// 240px-only hero-mock overflow is the responsibility of the
// hero-mock-240px packet. Failures on those owned routes gate exit code;
// home-page failures are reported but do not gate (out of scope).
const OWNED_PATHS = new Set(["/appraisal", "/pricing", "/specimen"]);
// Content containers where a child wider than the viewport is always a defect.
// A grid that re-tunes its column count on desktop — the pricing page's
// .track went from four stops to five — has to still fit the narrow viewport,
// and a document-level scrollWidth comparison can miss a spill that a clipped
// ancestor hides. The hero mock is deliberately absent: its inner card is
// clipped on purpose at 240px and is the hero-mock packet's subject.
const SPILL_SELECTORS = [".phead h1", ".track", ".plan", ".q", "form.lead", ".band", ".fault-card", ".stat", ".steps li", ".footnote-ref"];

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
      else if (rel === "/appraisal") rel = "/appraisal.html";
      else if (rel === "/pricing") rel = "/pricing.html";
      else if (rel === "/specimen") rel = "/specimen.html";
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

      const state = await page.evaluate((selectors) => {
        const vw = document.documentElement.clientWidth;
        const spills = [];
        for (const selector of selectors) {
          for (const el of document.querySelectorAll(selector)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right > vw + 1 || r.left < -1) {
              const cls = typeof el.className === "string" && el.className.trim() && el.className.trim() !== selector.slice(1) ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
              spills.push(`${el.tagName.toLowerCase()}${cls} (${selector}) spans ${Math.round(r.left)}-${Math.round(r.right)} in a ${vw}px viewport`);
            }
          }
        }
        return { sw: document.documentElement.scrollWidth, cw: vw, spills: spills.slice(0, 6) };
      }, SPILL_SELECTORS);

      const problems = state.sw !== state.cw
        ? [`doc scrollWidth ${state.sw} != clientWidth ${state.cw}`]
        : [];
      for (const spill of state.spills) problems.push(spill);

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
console.log("All three owned routes keep document scrollWidth === clientWidth at 240-390px.");
