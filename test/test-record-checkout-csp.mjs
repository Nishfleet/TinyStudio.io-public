import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordsMock } from "./records-mock.js";
import { chromium } from "playwright";
import worker from "../src/worker.js";
import { publishRecord } from "../src/record.js";

const CHECKOUT_URL = "https://checkout.dodopayments.com/checkout-abc123";

function d1(sqlite) {
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bound) { values = bound; return statement; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; }
      };
      return statement;
    }
  };
}

function freshEnv() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  sqlite.prepare(
    "INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at) VALUES ('req-1','https://clinic.example','Dental clinic',8000,40,'Dana Reyes','dana@clinic.example','2026-10','2026-10-12T09:00:00.000Z')"
  ).run();
  const objects = new Map();
  const env = {
    DB: d1(sqlite),
    EMAIL: { async send() {} },
    RECORDS: recordsMock(objects)
  };
  return { sqlite, env, objects };
}

const faults = [
  { id: "f1", type: "slow-load", title: "Home page loads in 6.1 seconds", url: "https://clinic.example/", evidence: "Largest Contentful Paint 6.1 s on mobile." }
];
const review = { keep: ["f1"], summary: "The home page is slow on phones." };

async function submitCheckoutForm(recordHtml, recordCsp) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const responses = [];
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => responses.push(`${response.request().method()} ${response.url()}`));
  page.on("requestfailed", (request) => failures.push(`${request.method()} ${request.url()}`));
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("https://tinystudio.io/records/")) {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: { "Content-Security-Policy": recordCsp },
        body: recordHtml
      });
      return;
    }
    if (url === "https://tinystudio.io/api/engagements/checkout") {
      await route.fulfill({ status: 303, headers: { location: CHECKOUT_URL }, body: "" });
      return;
    }
    if (url === CHECKOUT_URL) {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Dodo checkout</h1>" });
      return;
    }
    await route.abort();
  });
  try {
    await page.goto("https://tinystudio.io/records/rec-1", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.click('button:has-text("Start the correction")', { noWaitAfter: true });
    await Promise.race([
      page.waitForResponse((response) => response.url() === CHECKOUT_URL),
      page.waitForEvent("requestfailed", (request) => request.url().includes("/api/engagements/checkout")),
      page.waitForTimeout(10000)
    ]);
  } finally {
    await browser.close();
  }
  return {
    responses,
    failures,
    cspRefusals: consoleErrors.filter((line) => /Content Security Policy/i.test(line))
  };
}

test("the record page sends a CSP that lets the checkout form submit and reach Dodo", async () => {
  const { env, objects } = freshEnv();
  const { id } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const response = await worker.fetch(new Request(`https://tinystudio.io/records/${id}`), env);
  assert.equal(response.status, 200);
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /form-action 'self'/, "the record page allows its own form to submit");
  assert.match(csp, /https:\/\/\*\.dodopayments\.com/, "the record page allows the payment redirect to Dodo");
  assert.match(csp, /https:\/\/dodopayments\.com/, "the record page allows the bare Dodo host too");
  assert.ok(objects.get(`records/${id}.html`).includes('action="/api/engagements/checkout"'), "the record carries the checkout form");
});

test("the checkout form reaches Dodo under the record page's own CSP (real Chromium)", async () => {
  const { env, objects } = freshEnv();
  const { id } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const recordHtml = objects.get(`records/${id}.html`);
  const response = await worker.fetch(new Request(`https://tinystudio.io/records/${id}`), env);
  const csp = response.headers.get("content-security-policy");

  const outcome = await submitCheckoutForm(recordHtml, csp);
  assert.deepEqual(outcome.cspRefusals, [], "the browser refused nothing");
  assert.ok(
    outcome.responses.includes("POST https://tinystudio.io/api/engagements/checkout"),
    `the form reached the worker, saw ${JSON.stringify(outcome.responses)}`
  );
  assert.ok(
    outcome.responses.includes(`GET ${CHECKOUT_URL}`),
    `the customer reached Dodo, saw ${JSON.stringify(outcome.responses)}`
  );
});

test("a record CSP of only 'self' blocks the checkout, so the Dodo origin is required", async () => {
  const { env, objects } = freshEnv();
  const { id } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const recordHtml = objects.get(`records/${id}.html`);

  const outcome = await submitCheckoutForm(
    recordHtml,
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  assert.ok(outcome.cspRefusals.length > 0, "the browser refused the form, so the Dodo origin in the CSP is what makes checkout work");
  assert.ok(
    !outcome.responses.includes("POST https://tinystudio.io/api/engagements/checkout"),
    "the form never reached the worker"
  );
  assert.ok(!outcome.responses.includes(`GET ${CHECKOUT_URL}`), "the customer never reached Dodo");
  assert.ok(
    outcome.failures.some((line) => line.includes("/api/engagements/checkout")),
    `the browser failed the blocked form, saw ${JSON.stringify(outcome.failures)}`
  );
});
