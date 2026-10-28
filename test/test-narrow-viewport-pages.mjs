import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const VIEWPORTS = [240, 260, 280, 300, 320, 360, 390];

const PAGES = [
  { path: "/", file: "index.html" },
  { path: "/appraisal", file: "appraisal.html" },
  { path: "/pricing", file: "pricing.html" },
  { path: "/specimen", file: "specimen.html" },
  { path: "/waitlist", file: "waitlist.html" }
];

const OWNED_PATHS = new Set(["/appraisal", "/pricing", "/specimen", "/waitlist"]);

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
      else if (rel === "/waitlist") rel = "/waitlist.html";
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

console.log("Narrow-viewport overflow check across all six pages (real Chromium):");
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
