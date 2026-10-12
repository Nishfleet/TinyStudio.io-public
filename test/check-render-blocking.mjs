// TinyStudio - browser font and render-blocking guard.
//
// Serves the six public pages statically under the exact production
// Content-Security-Policy the worker emits and asserts in real Chromium:
//
//   1. no request leaves the origin (fonts are self-hosted, no Google chain),
//   2. the only render-blocking resources are same-origin stylesheets,
//   3. the preloaded Fraunces file is the one the page then uses (no second
//      fetch of it) and both families really load under the CSP.
//
// Run: npm run check:render-blocking  (it builds public/fonts first)

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

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const PAGES = [
  ["homepage", "index.html"],
  ["appraisal page", "appraisal.html"],
  ["pricing page", "pricing.html"],
  ["specimen page", "specimen.html"],
  ["brief-requested page", "brief-requested.html"]
];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
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

async function measurePage(page, pageUrl) {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(pageUrl, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => ({
    families: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
    blocking: performance
      .getEntriesByType("resource")
      .filter((r) => r.renderBlockingStatus === "blocking")
      .map((r) => r.name),
    fraunces: performance.getEntriesByType("resource").filter((r) => r.name.includes("fraunces-latin-opsz-normal")).length
  }));
  return { requests, ...state };
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

    const problems = [];
    const offOrigin = result.requests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:"));
    if (offOrigin.length) problems.push(`requests left the origin: ${offOrigin.join(", ")}`);
    const disallowedBlocking = result.blocking.filter((name) => {
      const u = new URL(name);
      return u.origin !== origin || !u.pathname.endsWith(".css");
    });
    if (disallowedBlocking.length) {
      problems.push(`render-blocking resources other than same-origin stylesheets: ${disallowedBlocking.join(", ")}`);
    }
    if (!result.families.includes("Fraunces") || !result.families.includes("Karla")) {
      problems.push(`Fraunces and Karla must both load (loaded: ${result.families.join(", ") || "none"})`);
    }
    if (result.fraunces !== 1) problems.push(`the preloaded Fraunces file must be fetched exactly once (saw ${result.fraunces})`);

    rows.push({ pageName, families: result.families.join("+"), fraunces: result.fraunces, problems });
    if (problems.length) failures.push(`${pageName}: ${problems.join("; ")}`);
  }
} finally {
  await browser.close();
  server.close();
}

console.log("Font and render-blocking check (real Chromium, production CSP):");
console.table(rows.map((r) => ({ page: r.pageName, "fonts loaded": r.families, "fraunces fetches": r.fraunces, result: r.problems.length ? "FAIL" : "PASS" })));

if (failures.length) {
  console.error("\nFailures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("All five pages load self-hosted fonts with only same-origin stylesheets blocking.");
