import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const HERO_OPEN = "<header>";
const HERO_CLOSE = "</header>";

const BUYER_LABEL = "owner, founder or marketer";
const BUYER_INDUSTRY = "high-ticket service business";

export function heroBlock(html) {
  const open = html.indexOf(HERO_OPEN);
  const close = html.indexOf(HERO_CLOSE, open >= 0 ? open + HERO_OPEN.length : 0);
  if (open === -1 || close === -1) return "";
  return html.slice(open, close + HERO_CLOSE.length);
}

export function heroBuyerIssues(hero) {
  const issues = [];
  if (hero === "") {
    return ["homepage must carry a <header> hero block"];
  }
  if (!hero.includes(BUYER_LABEL)) {
    issues.push(`hero must name the buyer as "${BUYER_LABEL}"`);
  }
  if (!hero.includes(BUYER_INDUSTRY)) {
    issues.push(`hero must tie the buyer to "${BUYER_INDUSTRY}"`);
  }
  return issues;
}

test("homepage first-viewport hero names the intended buyer", () => {
  const indexHtml = read("public/index.html");
  const hero = heroBlock(indexHtml);
  const issues = heroBuyerIssues(hero);
  assert.deepEqual(issues, [], issues.join("; "));
});

test("the buyer label is repo-truth-backed, not invented", () => {

  for (const [name, text] of [
    ["llms.txt", read("public/llms.txt")],
    ["offer.md", read("public/offer.md")]
  ]) {
    assert.ok(/high-ticket service businesses/i.test(text), `${name} must name high-ticket service businesses as the buyer`);
  }
  const offer = read("public/offer.md");
  assert.ok(offer.includes("## Buyer"), "offer.md must carry the Buyer section");
  assert.ok(offer.includes("clients are never named"), "offer.md Buyer must state clients are never named");

  const indexHtml = read("public/index.html");
  assert.ok(indexHtml.includes("approval owner"), "homepage must already use owner vocabulary (sourcing anchor)");
  assert.ok(indexHtml.includes("implementation owner"), "homepage must already use owner vocabulary (sourcing anchor)");
});

test("checker rejects a hero that does not name the buyer (fixtures)", () => {

  const preFixHero =
    "<header>\n" +
    "    <div class=\"orn\"><i></i><span class=\"sc\">The appraisal</span><b></b><i></i></div>\n" +
    "    <h1>Most of them leave <em>before they ever get in touch.</em></h1>\n" +
    "    <p class=\"sub\">We read the one page your revenue depends on the way a customer with intent reads it, and show you the exact points at which they go.</p>\n" +
    "  </header>";
  const preFixIssues = heroBuyerIssues(preFixHero);
  assert.ok(preFixIssues.some((issue) => issue.includes('"owner, founder or marketer"')), `pre-fix hero must be rejected, got: ${preFixIssues.join("; ")}`);

  const buyerOnlyBelowTheFold =
    "<header>\n" +
    "    <p class=\"sub\">We read the one page your revenue depends on the way a customer with intent reads it, and show you the exact points at which they go.</p>\n" +
    "  </header>\n" +
    "  <section>For the owner, founder or marketer of a high-ticket service business.</section>";
  const belowFoldIssues = heroBuyerIssues(heroBlock(buyerOnlyBelowTheFold));
  assert.ok(belowFoldIssues.some((issue) => issue.includes('"owner, founder or marketer"')), `a buyer label below the hero must not satisfy the hero check, got: ${belowFoldIssues.join("; ")}`);

  const roleOnlyHero =
    "<header>\n" +
    "    <p class=\"sub\">For the owner, founder or marketer — we read the one page your revenue depends on.</p>\n" +
    "  </header>";
  const roleOnlyIssues = heroBuyerIssues(roleOnlyHero);
  assert.ok(roleOnlyIssues.some((issue) => issue.includes('"high-ticket service business"')), `a role-only hero must be rejected, got: ${roleOnlyIssues.join("; ")}`);

  assert.ok(heroBuyerIssues("").some((issue) => issue.includes("<header>")), "a page without a hero block must be rejected");
});

test("the buyer-audience test is wired into npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["test:viewport"] === "node --test test/test-first-viewport-audience.mjs", "test:viewport must run the first-viewport audience test");
  assert.ok(pkg.scripts.test.includes("test:viewport"), "npm test must include the first-viewport audience test");
});
