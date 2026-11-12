import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

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

