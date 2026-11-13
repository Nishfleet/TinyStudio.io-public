import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = [
  "public/index.html",
  "public/appraisal.html",
  "public/pricing.html",
  "public/specimen.html",
  "public/waitlist.html",
  "public/brief-requested.html",
  "public/privacy.html",
  "public/terms.html",
  "public/contact.html"
];

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
