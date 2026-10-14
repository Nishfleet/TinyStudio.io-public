import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

const PLAN = "docs/PLAN.md";
const OFFER = "Website Correction";
const PRICE = "$10,000 per site";

test("docs/PLAN.md is the current plan and carries the offer, price and boundary", () => {
  const plan = read(PLAN);
  assert.match(plan, /^# TinyStudio: The Website Correction/m, "plan must be titled The Website Correction");
  assert.ok(plan.includes("**Status:** current plan"), "plan must declare itself the current plan");
  assert.ok(plan.includes(OFFER), "plan must name the offer");
  assert.ok(plan.includes(PRICE), "plan must state the price");
  assert.ok(plan.includes("Six clients a month") || plan.includes("Six a month"), "plan must keep the six-a-month cap");
  assert.ok(/promises proof, not outcomes/i.test(plan), "plan must keep the no-guarantee language");
  assert.ok(plan.includes("## 11. Milestones"), "plan must keep its milestones");
});

test("README.md and MEMORY.md point at the plan and mark the old specs superseded", () => {
  for (const file of ["README.md", "MEMORY.md"]) {
    const text = read(file);
    assert.ok(text.includes(PLAN), `${file} must point at ${PLAN}`);
    assert.ok(/specs 001 to 004[^.]*superseded/i.test(text), `${file} must say specs 001 to 004 are superseded`);
    assert.ok(text.includes(OFFER), `${file} must name the current offer`);
  }
  assert.ok(read("README.md").split("\n").length < 60, "README.md must stay under 60 lines");
  assert.ok(read("README.md").includes("/api/agent-audit"), "README must document the /api/agent-audit endpoint");
});

test("retired surfaces stay removed", () => {
  assert.equal(exists("specs"), false, "specs/ must stay removed");
  for (const file of [
    "public/agent-desk.html",
    "public/styles.css",
    "public/script.js",
    "public/agents.html",
    "public/agents.css",
    "public/agents.js",
    "public/msp.html",
    "public/msp.css",
    "public/msp.js",
    "public/audit.html",
    "public/audit.css",
    "public/audit.js"
  ]) {
    assert.equal(exists(file), false, `${file} must stay removed`);
  }
  assert.ok(exists("public/appraisal.html"), "public/appraisal.html must exist");
});

test("the worker keeps the kept endpoints and the /audit redirect, and drops retired routes", () => {
  const worker = read("src/worker.js");
  assert.ok(worker.includes('"/api/signups"'), "worker must keep /api/signups");
  assert.ok(worker.includes('"/api/agent-audit"'), "worker must keep /api/agent-audit");
  assert.ok(worker.includes("retiredAppResponse()") && worker.includes("retiredApiResponse()"), "worker must keep the app. and api. retirement responses");
  assert.ok(worker.includes('new Set(["/audit", "/audit.html"])'), "worker must redirect /audit to /appraisal");
  for (const retired of ['"/agent-desk', '"/agents', '"/msp', '"/styles.css"', '"/script.js"']) {
    assert.ok(!worker.includes(retired), `worker must not route ${retired}`);
  }
});

test("package.json describes the current product and wires this test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.description.includes(OFFER), "package.json description must name the Website Correction");
  assert.equal(pkg.scripts["test:contract"], "node --test test/test-product-contract.mjs");
  assert.ok(pkg.scripts.test.includes("test:contract"), "npm test must include the contract test");
});
