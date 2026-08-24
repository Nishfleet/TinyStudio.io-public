// Heading-hierarchy regression test for the six served public pages.
//
// The TinyStudio.io dogfood audit found skipped heading levels on the home,
// agents, pricing, specimen and brief-requested pages (h1 -> h3, h2 -> h4).
// This test parses the real heading outline of the served HTML and enforces
// the corrected contract:
//
//   1. exactly one h1 per page, and it is the first heading;
//   2. no skipped levels when the outline descends (each heading is at most
//      one level deeper than the previous one; returning to a shallower
//      level is fine);
//   3. the exact corrected outline per page stays locked, so a future edit
//      that reintroduces a skip fails deterministically.
//
// The same parser is used against embedded "known bad shape" fixtures so the
// test also proves it rejects the pre-fix hierarchy, not just the current one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = [
  "public/index.html",
  "public/audit.html",
  "public/agents.html",
  "public/pricing.html",
  "public/specimen.html",
  "public/msp.html",
  "public/brief-requested.html"
];

// The corrected outlines, locked as level sequences. Anything that reopens a
// skip (or drops the single h1) changes these and fails the test.
const EXPECTED_OUTLINES = {
  "public/index.html": [1, 2, 2, 2, 3, 3, 3, 3, 2, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 3, 3, 3, 3, 3, 2],
  "public/audit.html": [1, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 2],
  "public/agents.html": [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  "public/pricing.html": [1, 2, 2, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 2, 2],
  "public/specimen.html": [1, 2, 2, 2, 2, 3, 2, 2],
  "public/msp.html": [1, 2, 2, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2],
  "public/brief-requested.html": [1, 2, 2, 2]
};

// Parse the headings that would actually be rendered: comments, <script> and
// <style> content never contribute to the visual heading outline, so they are
// stripped first. Handles attributes on heading tags (<h2 class="xi20">) and
// nested inline markup in the heading text.
export function headingOutline(html) {
  const rendered = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const outline = [];
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  for (const match of rendered.matchAll(pattern)) {
    const text = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    outline.push({ level: Number(match[1]), text });
  }
  return outline;
}

// Structural contract check. Returns a list of human-readable violations;
// an empty list means the outline is correct.
export function outlineIssues(outline) {
  const issues = [];
  if (outline.length === 0) {
    issues.push("page has no headings");
    return issues;
  }
  if (outline[0].level !== 1) {
    issues.push(`first heading is h${outline[0].level}, must be h1 (${outline[0].text})`);
  }
  const h1Count = outline.filter((heading) => heading.level === 1).length;
  if (h1Count !== 1) {
    issues.push(`expected exactly one h1, found ${h1Count}`);
  }
  for (let i = 1; i < outline.length; i++) {
    const prev = outline[i - 1];
    const current = outline[i];
    if (current.level > prev.level + 1) {
      issues.push(
        `heading level skips from h${prev.level} to h${current.level}: "${current.text}" after "${prev.text}"`
      );
    }
  }
  return issues;
}

test("every owned public page has a correct heading outline", () => {
  for (const page of PAGES) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    const outline = headingOutline(html);
    const issues = outlineIssues(outline);
    assert.deepEqual(issues, [], `${page} heading hierarchy: ${issues.join("; ") || "ok"}`);
  }
});

test("every owned public page matches its locked corrected outline", () => {
  for (const page of PAGES) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    const levels = headingOutline(html).map((heading) => heading.level);
    assert.deepEqual(levels, EXPECTED_OUTLINES[page], `${page} outline must stay ${EXPECTED_OUTLINES[page].join("-")}`);
  }
});

test("checker rejects the known bad shape: h2 -> h4 skips (homepage stops, identity, faq)", () => {
  const bad = [
    "<h1>Most of them leave</h1>",
    "<h2>How the work runs</h2>",
    "<h4>Everything on the table</h4>",
    "<h4>The loop</h4>",
    "<h2>This one. tinystudio.io.</h2>",
    "<h4>What TinyStudio does</h4>",
    "<h2>Before you ask</h2>",
    "<h4>What exactly do I get for free?</h4>"
  ].join("");
  const issues = outlineIssues(headingOutline(bad));
  assert.ok(issues.some((issue) => issue.includes("skips from h2 to h4")), `expected h2->h4 skips, got: ${issues.join("; ")}`);
});

test("checker rejects the known bad shape: h1 -> h3 roster, specimen and brief-requested", () => {
  const bad = [
    "<h1>Seven specialists</h1>",
    "<h3>Landing Page Fixer</h3>",
    "<h3>Weekly Performance Analyst</h3>",
    "<h4>What the desk does</h4>",
    "<h2>Why this isn't something you can just prompt</h2>",
    "<h1>Four ways this clinic loses people</h1>",
    "<h3>The fee list is excellent</h3>",
    "<h3>The proof is real</h3>",
    "<h4>Two passes not run</h4>",
    "<h2>Confidentiality</h2>",
    "<h1>That's it. Nothing else needed from you.</h1>",
    "<h3>We read the page</h3>",
    "<h3>Findings land in your inbox</h3>",
    "<h3>Then nothing, unless you want something</h3>"
  ].join("");
  const issues = outlineIssues(headingOutline(bad));
  assert.ok(issues.some((issue) => issue.includes("skips from h1 to h3")), `expected h1->h3 skips, got: ${issues.join("; ")}`);
});

test("checker rejects a page that does not start with a single h1", () => {
  const noH1 = "<h2>Starts at h2</h2>";
  const twoH1 = "<h1>First</h1><p>gap</p><h1>Second</h1>";
  const firstIssues = outlineIssues(headingOutline(noH1));
  assert.ok(firstIssues.some((issue) => issue.includes("first heading is h2")), `got: ${firstIssues.join("; ")}`);
  const countIssues = outlineIssues(headingOutline(twoH1));
  assert.ok(countIssues.some((issue) => issue.includes("exactly one h1")), `got: ${countIssues.join("; ")}`);
});

test("checker ignores headings hidden in comments, scripts and styles", () => {
  const html = [
    "<h1>Real</h1>",
    "<!-- <h2>comment fake</h2> -->",
    "<script>const template = \"<h2>script fake</h2>\";</script>",
    "<style>h3.fake { display: none }</style>",
    "<h2>Real section</h2>"
  ].join("");
  const outline = headingOutline(html);
  assert.deepEqual(outline.map((heading) => heading.level), [1, 2]);
  assert.equal(outline[0].text, "Real");
  assert.equal(outline[1].text, "Real section");
});
