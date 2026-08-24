// First-viewport buyer-audience regression test for the public homepage.
//
// The TinyStudio.io homepage hero describes a revenue-page appraisal and a
// customer's intent but must also name the intended buyer in the first mobile
// viewport (390x844). Before the fix, the hero said "We read the one page your
// revenue depends on the way a customer with intent reads it..." — it never
// named the owner, founder, marketer, or other intended buyer.
//
// This test guards the correction deterministically:
//
//   1. the served homepage hero block (`<header>`, the first-viewport
//      appraisal description) names the buyer — "owner, founder or marketer"
//      of a "high-ticket service business" — not merely somewhere further down
//      the page;
//   2. the buyer label is repo-truth-backed: llms.txt and offer.md both carry
//      the "Buyer" section naming high-ticket service businesses, and the
//      homepage's own "approval owner and implementation owner" vocabulary
//      backs the owner role;
//   3. a known-bad fixture (the pre-fix hero without a buyer label) is
//      rejected, so the checker proves it rejects the regression it guards;
//   4. the test is wired into `npm test`.
//
// The check is scoped to the hero block on purpose: an unscoped search would
// pass on a hero that only names the buyer further down the page, which is the
// defect being guarded against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The hero block is the homepage's `<header>`, which holds the first-viewport
// appraisal description (h1 + sub). The lead form and everything below the
// fold live outside it.
const HERO_OPEN = "<header>";
const HERO_CLOSE = "</header>";

// Buyer phrases the hero must carry. Each is sourced from repository truth,
// not invented:
// - "owner, founder or marketer": the buyer roles the finding names; the
//   homepage itself already speaks of "the approval owner and the
//   implementation owner" (Day 0) and the defect report names owner, founder
//   and marketer as the intended buyers.
// - "high-ticket service business": the llms.txt / offer.md `## Buyer` truth
//   ("High-ticket service businesses — clinics, surgeons, dentists, spas,
//   dealers, brokers").
const BUYER_LABEL = "owner, founder or marketer";
const BUYER_INDUSTRY = "high-ticket service business";

// Returns the homepage hero block, or "" when the block is missing.
export function heroBlock(html) {
  const open = html.indexOf(HERO_OPEN);
  const close = html.indexOf(HERO_CLOSE, open >= 0 ? open + HERO_OPEN.length : 0);
  if (open === -1 || close === -1) return "";
  return html.slice(open, close + HERO_CLOSE.length);
}

// Returns a list of human-readable violations for the hero block's buyer
// naming; an empty list means the first-viewport description names the buyer.
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
  // llms.txt and offer.md carry the Buyer truth for TinyStudio's offer:
  // offer.md as a `## Buyer` section, llms.txt as its mirroring `Buyer:`
  // paragraph. Both name high-ticket service businesses.
  for (const [name, text] of [
    ["llms.txt", read("public/llms.txt")],
    ["offer.md", read("public/offer.md")]
  ]) {
    assert.ok(/high-ticket service businesses/i.test(text), `${name} must name high-ticket service businesses as the buyer`);
  }
  const offer = read("public/offer.md");
  assert.ok(offer.includes("## Buyer"), "offer.md must carry the Buyer section");
  assert.ok(offer.includes("clients are never named"), "offer.md Buyer must state clients are never named");
  // The homepage's own Day-0 copy already speaks of owners, so the role is
  // established on the page itself.
  const indexHtml = read("public/index.html");
  assert.ok(indexHtml.includes("approval owner"), "homepage must already use owner vocabulary (sourcing anchor)");
  assert.ok(indexHtml.includes("implementation owner"), "homepage must already use owner vocabulary (sourcing anchor)");
});

test("checker rejects a hero that does not name the buyer (fixtures)", () => {
  // The exact pre-fix hero: describes the appraisal and the customer's intent
  // but names no buyer.
  const preFixHero =
    "<header>\n" +
    "    <div class=\"orn\"><i></i><span class=\"sc\">The appraisal</span><b></b><i></i></div>\n" +
    "    <h1>Most of them leave <em>before they ever get in touch.</em></h1>\n" +
    "    <p class=\"sub\">We read the one page your revenue depends on the way a customer with intent reads it, and show you the exact points at which they go.</p>\n" +
    "  </header>";
  const preFixIssues = heroBuyerIssues(preFixHero);
  assert.ok(preFixIssues.some((issue) => issue.includes('"owner, founder or marketer"')), `pre-fix hero must be rejected, got: ${preFixIssues.join("; ")}`);

  // A hero naming the buyer only somewhere else on the page is not enough: an
  // unscoped search would pass, but the first-viewport description must carry
  // the label itself.
  const buyerOnlyBelowTheFold =
    "<header>\n" +
    "    <p class=\"sub\">We read the one page your revenue depends on the way a customer with intent reads it, and show you the exact points at which they go.</p>\n" +
    "  </header>\n" +
    "  <section>For the owner, founder or marketer of a high-ticket service business.</section>";
  const belowFoldIssues = heroBuyerIssues(heroBlock(buyerOnlyBelowTheFold));
  assert.ok(belowFoldIssues.some((issue) => issue.includes('"owner, founder or marketer"')), `a buyer label below the hero must not satisfy the hero check, got: ${belowFoldIssues.join("; ")}`);

  // A hero naming the role but not the industry is incomplete.
  const roleOnlyHero =
    "<header>\n" +
    "    <p class=\"sub\">For the owner, founder or marketer — we read the one page your revenue depends on.</p>\n" +
    "  </header>";
  const roleOnlyIssues = heroBuyerIssues(roleOnlyHero);
  assert.ok(roleOnlyIssues.some((issue) => issue.includes('"high-ticket service business"')), `a role-only hero must be rejected, got: ${roleOnlyIssues.join("; ")}`);

  // A hero with no <header> block is rejected outright.
  assert.ok(heroBuyerIssues("").some((issue) => issue.includes("<header>")), "a page without a hero block must be rejected");
});

test("the buyer-audience test is wired into npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["test:viewport"] === "node --test scripts/test-first-viewport-audience.mjs", "test:viewport must run the first-viewport audience test");
  assert.ok(pkg.scripts.test.includes("test:viewport"), "npm test must include the first-viewport audience test");
});
