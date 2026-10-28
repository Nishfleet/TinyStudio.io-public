import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITEMAP_PATH = "public/sitemap.xml";
const ROBOTS_PATH = "public/robots.txt";

const EXPECTED_LOCS = [
  "https://tinystudio.io/",
  "https://tinystudio.io/appraisal",
  "https://tinystudio.io/pricing",
  "https://tinystudio.io/specimen",
  "https://tinystudio.io/waitlist",
  "https://tinystudio.io/privacy",
  "https://tinystudio.io/terms",
  "https://tinystudio.io/contact",
  "https://tinystudio.io/offer.md",
  "https://tinystudio.io/llms.txt"
];

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SITE_PREFIX = "https://tinystudio.io/";

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

export function parseLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

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

test("checker rejects the old three-URL sitemap (missing /appraisal /pricing /specimen)", () => {
  const issues = sitemapIssues(OLD_THREE_URL_SITEMAP);
  assert.ok(issues.some((issue) => issue.includes("missing: https://tinystudio.io/appraisal")), `got: ${issues.join("; ")}`);
  assert.ok(issues.some((issue) => issue.includes("/privacy")), `got: ${issues.join("; ")}`);
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
    <loc>https://tinystudio.io/appraisal</loc>
  </url>
  <url>
    <loc>https://tinystudio.io/contact</loc>
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
