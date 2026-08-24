// Sitemap regression test for the complete public surface.
//
// The sitemap previously listed only the root, /offer.md and /llms.txt, so the
// four remaining human-facing pages (/audit, /agents, /pricing, /specimen)
// were invisible to crawlers even though robots.txt allows them all. This test
// locks the complete indexable surface and the urlset shape:
//
//   1. the exact ordered loc set stays the five pages plus the two
//      machine-readable mirrors (adding, dropping or reordering a loc fails);
//   2. every loc is an absolute https://tinystudio.io/ URL, HTML pages use the
//      clean extensionless path (the worker serves /audit, /agents, /pricing,
//      /specimen), and the trailing slash appears only on the root;
//   3. /brief-requested (noindex signup redirect) and /agent-desk (legacy)
//      never reappear;
//   4. the urlset schema stays byte-shape-identical: standard XML declaration,
//      the sitemaps 0.9 namespace, and url blocks that carry only <loc>;
//   5. robots.txt keeps pointing at the sitemap.
//
// The same parser runs against embedded "known bad shape" fixtures (the old
// three-URL sitemap, stale paths, schema drift) so the test also proves it
// rejects every regression it guards, not just the current file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITEMAP_PATH = "public/sitemap.xml";
const ROBOTS_PATH = "public/robots.txt";

// The complete indexable surface. Root keeps its trailing slash; every HTML
// page uses the clean extensionless twin; the machine-readable mirrors stay
// as they were. Locked in canonical order: any edit that changes this array
// fails deterministically.
const EXPECTED_LOCS = [
  "https://tinystudio.io/",
  "https://tinystudio.io/audit",
  "https://tinystudio.io/agents",
  "https://tinystudio.io/pricing",
  "https://tinystudio.io/specimen",
  "https://tinystudio.io/msp",
  "https://tinystudio.io/offer.md",
  "https://tinystudio.io/llms.txt"
];

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SITE_PREFIX = "https://tinystudio.io/";

// The pre-fix sitemap (three URLs) as it existed on origin/main. Used as a
// fixture so the test proves the checker rejects the old shape, not only that
// the current file passes.
const OLD_THREE_URL_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://tinystudio.io/</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/offer.md</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/llms.txt</loc>
  </url>
</urlset>`;

// Extract the <loc> contents in document order.
export function parseLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

// Structural contract check. Returns a list of human-readable violations; an
// empty list means the sitemap is correct.
export function sitemapIssues(xml, expected = EXPECTED_LOCS) {
  const issues = [];

  if (!xml.startsWith(XML_DECLARATION)) {
    issues.push(`sitemap must start with the XML declaration ${XML_DECLARATION}`);
  }
  if (!xml.includes(`<urlset xmlns="${SITEMAP_NS}">`)) {
    issues.push(`urlset must keep the sitemaps 0.9 namespace ${SITEMAP_NS}`);
  }
  if ((xml.match(/<urlset\b/g) || []).length !== 1 || (xml.match(/<\/urlset>/g) || []).length !== 1) {
    issues.push("sitemap must contain exactly one urlset element");
  }

  // Every url block must carry exactly one <loc> and nothing else (no
  // lastmod/changefreq/priority or foreign elements: the schema stays
  // urlset -> url -> loc only).
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
  for (const block of blocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    if (!locMatch) {
      issues.push(`url block must carry a <loc> element: ${JSON.stringify(block.trim())}`);
      continue;
    }
    const remainder = block.replace(locMatch[0], "").trim();
    if (remainder) {
      issues.push(`url block must not carry elements beyond <loc>: ${JSON.stringify(remainder)}`);
    }
  }

  const locs = parseLocs(xml);
  if (blocks.length !== locs.length) {
    issues.push(`expected ${blocks.length} url blocks to carry exactly one <loc> each, found ${locs.length}`);
  }

  for (const loc of locs) {
    if (!loc.startsWith(SITE_PREFIX)) {
      issues.push(`loc must be an absolute https://tinystudio.io/ URL: ${loc}`);
    } else if (loc !== SITE_PREFIX && loc.endsWith("/")) {
      issues.push(`only the root may carry a trailing slash: ${loc}`);
    }
  }

  for (const stale of ["/brief-requested", "/agent-desk"]) {
    if (locs.some((loc) => loc.includes(stale))) {
      issues.push(`stale path must not be listed: ${stale}`);
    }
  }

  const missing = expected.filter((loc) => !locs.includes(loc));
  const extra = locs.filter((loc) => !expected.includes(loc));
  if (missing.length || extra.length || JSON.stringify(locs) !== JSON.stringify(expected)) {
    issues.push(
      `loc set must be exactly [${expected.join(", ")}] (missing: ${missing.join(", ") || "none"}, extra: ${extra.join(", ") || "none"})`
    );
  }

  return issues;
}

test("sitemap lists the complete indexable public surface in the locked order", () => {
  const xml = readFileSync(new URL(`../${SITEMAP_PATH}`, import.meta.url), "utf8");
  assert.deepEqual(parseLocs(xml), EXPECTED_LOCS);
});

test("sitemap passes the full structural contract", () => {
  const xml = readFileSync(new URL(`../${SITEMAP_PATH}`, import.meta.url), "utf8");
  const issues = sitemapIssues(xml);
  assert.deepEqual(issues, [], issues.join("; "));
});

test("robots.txt keeps pointing at the sitemap", () => {
  const robots = readFileSync(new URL(`../${ROBOTS_PATH}`, import.meta.url), "utf8");
  assert.ok(robots.includes("Sitemap: https://tinystudio.io/sitemap.xml"), "robots.txt must keep the Sitemap directive");
});

test("checker rejects the old three-URL sitemap (missing /audit /agents /pricing /specimen)", () => {
  const issues = sitemapIssues(OLD_THREE_URL_SITEMAP);
  assert.ok(issues.some((issue) => issue.includes("missing: https://tinystudio.io/audit")), `got: ${issues.join("; ")}`);
  assert.ok(issues.some((issue) => issue.includes("/agents")), `got: ${issues.join("; ")}`);
  assert.ok(issues.some((issue) => issue.includes("/pricing")), `got: ${issues.join("; ")}`);
  assert.ok(issues.some((issue) => issue.includes("/specimen")), `got: ${issues.join("; ")}`);
});

test("checker rejects /brief-requested and /agent-desk entries", () => {
  const withStalePaths = `${OLD_THREE_URL_SITEMAP}
  <url>
    <loc>https://tinystudio.io/brief-requested</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/agent-desk</loc>
  </url>`;
  const issues = sitemapIssues(withStalePaths);
  assert.ok(issues.some((issue) => issue.includes("stale path must not be listed: /brief-requested")), `got: ${issues.join("; ")}`);
  assert.ok(issues.some((issue) => issue.includes("stale path must not be listed: /agent-desk")), `got: ${issues.join("; ")}`);
});

test("checker rejects schema drift (extra url elements and wrong host/trailing slash)", () => {
  const drifted = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://tinystudio.io/</loc>
    <lastmod>2026-08-09</lastmod>
  </url>
  <url>
    <loc>https://tinystudio.io/audit/</loc>
  </url>
  <url>
    <loc>http://tinystudio.io/agents</loc>
  </url>
</urlset>`;
  const issues = sitemapIssues(drifted);
  assert.ok(issues.some((issue) => issue.includes("must not carry elements beyond <loc>")), `got: ${issues.join("; ")}`);
  assert.ok(issues.some((issue) => issue.includes("only the root may carry a trailing slash")), `got: ${issues.join("; ")}`);
  assert.ok(issues.some((issue) => issue.includes("absolute https://tinystudio.io/ URL")), `got: ${issues.join("; ")}`);
});

test("checker rejects a reordered or duplicated loc set", () => {
  const reordered = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://tinystudio.io/</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/pricing</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/pricing</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/audit</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/agents</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/specimen</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/offer.md</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/llms.txt</loc>
  </url>
</urlset>`;
  const issues = sitemapIssues(reordered);
  assert.ok(issues.some((issue) => issue.includes("loc set must be exactly")), `got: ${issues.join("; ")}`);
});
