import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker, { AGENT_MODELS } from "../src/worker.js";

const METRIC_MARKER = "WEEKLY_SECRET_METRIC_7000";

const VALID_AGENT_OUTPUT = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.
- Recommended India-first path uses WhatsApp or lead forms before landing-page work.

# Implementation Checklist

- Set up the offer guardrails.
- Build WhatsApp or lead form validation before landing-page work.
- Keep all spend and publishing approval-gated.

# Weekly Fix Report

- Spend: WEEKLY_SECRET_METRIC_7000.
- Diagnose the current bottleneck from supplied weekly metrics.
- Fix booking friction before changing spend.`;

const TRACKER_AGENT_OUTPUT = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.
- Recommended first validation path.

# Implementation Checklist

- Set up the offer, funnel, creative, follow-up, CRM, and tracking work.
- Keep all spend and publishing approval-gated.

# Weekly Fix Report

- Metric tracker template: spend, raw leads, qualified leads, booked calls, showed calls, closed deals, and cash collected.
- Review the tracker weekly before changing campaign structure.`;

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  failIfInjected(method) {
    const failure = this.db.failures?.[method];
    if (failure && failure(this.sql)) {
      throw new Error(`injected ${method} failure`);
    }
  }

  async first() {
    this.failIfInjected("first");
    this.db.calls.push({ method: "first", sql: this.sql, values: this.values });
    return { count: 1 };
  }

  async run() {
    this.failIfInjected("run");
    this.db.calls.push({ method: "run", sql: this.sql, values: this.values });
    return { success: true };
  }

  async all() {
    this.db.calls.push({ method: "all", sql: this.sql, values: this.values });
    return { results: [] };
  }
}

class FakeDB {
  constructor(options = {}) {
    this.calls = [];
    this.failures = options.failures || null;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  joinedBinds() {
    return JSON.stringify(this.calls.map((call) => call.values));
  }
}

function failingDB({ runSql, firstSql } = {}) {
  return new FakeDB({
    failures: {
      run: runSql ? (sql) => sql.includes(runSql) : null,
      first: firstSql ? (sql) => sql.includes(firstSql) : null
    }
  });
}

class FakeAI {
  constructor(response) {
    this.response = response;
    this.calls = [];
  }

  async run(model, options) {
    this.calls.push({ model, options });
    const response = Array.isArray(this.response)
      ? this.response[Math.min(this.calls.length - 1, this.response.length - 1)]
      : this.response;
    return { response };
  }

  userPrompt() {
    return this.calls[0]?.options?.messages?.find((message) => message.role === "user")?.content || "";
  }
}

function agentRequest(body, headers = {}, url = "https://tinystudio.io/api/agent-audit") {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://tinystudio.io",
      "CF-Connecting-IP": "203.0.113.10",
      "User-Agent": "tinystudio-worker-test",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function validBody(overrides = {}) {
  return {
    email: "nish+worker-test@tinystudio.io",
    business: "India-based B2B growth consultant for service agencies.",
    offer: "INR 65000 guided setup sprint.",
    audience: "Agency founders in Tier 1 Indian cities.",
    proof: "Approved founder video and conservative screenshots.",
    market: "India-first validation",
    funnel: "WhatsApp or DMs",
    followup: "Spreadsheet and manual WhatsApp follow-up.",
    constraints: "No unapproved claims or ad account access.",
    ...overrides
  };
}

function minimalBody(overrides = {}) {
  return {
    email: "nish+minimal-test@tinystudio.io",
    business: "Solo founder sells a high-ticket offer to Indian agency owners through Instagram and WhatsApp.",
    ...overrides
  };
}

async function runAgent(response, body = validBody(), headers = {}, url) {
  const db = new FakeDB();
  const ai = new FakeAI(response);
  const res = await worker.fetch(agentRequest(body, headers, url), { DB: db, AI: ai });
  const json = await res.json();
  return { res, json, db, ai };
}

test("agent audit accepts minimal business snapshot and asks the model to infer missing context", async () => {
  const { json, ai } = await runAgent(VALID_AGENT_OUTPUT, minimalBody());

  assert.equal(json.ok, true);
  assert.match(ai.userPrompt(), /Offer: Not provided; infer from business snapshot/);
  assert.match(ai.userPrompt(), /Target buyer: Not provided; infer from business snapshot/);
  assert.match(ai.userPrompt(), /Only include blocker questions/);
  assert.match(ai.calls[0].options.messages[0].content, /Do not invent exact prices/);
  assert.match(ai.userPrompt(), /Keep assumptions directional/);
});

test("agent audit uses current metrics supplied inside the required business snapshot", async () => {
  const metricAwareOutput = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.
- Use WhatsApp or lead forms before landing-page work.

# Implementation Checklist

- Build the first validation loop from the supplied current numbers.
- Keep all spend and publishing approval-gated.

# Weekly Fix Report

- Raw leads: 42 and booked calls: 8 points to a qualification or confirmation leak.
- Fix booking friction before changing spend.`;
  const { json, ai } = await runAgent(metricAwareOutput, minimalBody({
    business: "India-based consultant. Last week spent INR 7,000, got 42 leads, and booked 8 calls from WhatsApp follow-up."
  }));

  assert.equal(json.ok, true);
  assert.match(ai.userPrompt(), /Weekly metrics mode: metrics provided/);
  assert.match(ai.userPrompt(), /Spend: INR 7,000/);
  assert.match(ai.userPrompt(), /Raw leads: 42/);
  assert.match(ai.userPrompt(), /Booked calls: 8/);
  assert.match(json.sections.weeklyFixReport, /\*\*Spend\*\*: INR 7,000/);
  assert.match(json.sections.weeklyFixReport, /\*\*Raw leads\*\*: 42/);
  assert.match(json.sections.weeklyFixReport, /\*\*Booked calls\*\*: 8/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Lead-to-Call Metric Tracker Template/);
});

test("agent audit accepts loopback preview origins on alternate local ports", async () => {
  const { json } = await runAgent(VALID_AGENT_OUTPUT, minimalBody(), {
    Origin: "http://127.0.0.1:8789"
  }, "http://127.0.0.1:8789/api/agent-audit");

  assert.equal(json.ok, true);
});

test("agent audit accepts loopback preview origins when remote dev preserves loopback host", async () => {
  const { json } = await runAgent(VALID_AGENT_OUTPUT, minimalBody(), {
    Origin: "http://127.0.0.1:8789",
    Host: "127.0.0.1:8789"
  }, "https://tinystudio-preview.example.workers.dev/api/agent-audit");

  assert.equal(json.ok, true);
});

test("agent audit rejects loopback origins against production hosts", async () => {
  const { res, json } = await runAgent(VALID_AGENT_OUTPUT, minimalBody(), {
    Origin: "http://127.0.0.1:8789"
  });

  assert.equal(res.status, 403);
  assert.equal(json.ok, false);
  assert.equal(json.error, "cross_site_blocked");
});

test("agent audit rejects missing business snapshot", async () => {
  const { res, json } = await runAgent(VALID_AGENT_OUTPUT, minimalBody({ business: "" }));

  assert.equal(res.status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error, "invalid_input");
  assert.equal(json.message, "Add a business snapshot first.");
});

test("agent audit scrubs exact prices and age ranges the model invents from minimal input", async () => {
  const inventedPrecisionOutput = `# Pipeline Brief

- Offer: A guided high-ticket setup sprint for agency founders, priced at USD 5,000-$7,000.
- Offer price is INR 75,000.
- Agency can charge $5k for this package.
- INR 75,000 sprint for agency founders.
- Validate the offer with INR 500-INR 1,000/day for 7 days.
- Target Buyer: Agency founders aged 25-45 looking to scale.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Fix booking friction before changing spend.`;
  const { json } = await runAgent(inventedPrecisionOutput, minimalBody());

  assert.equal(json.ok, true);
  assert.match(json.sections.pipelineBrief, /agency founders/);
  assert.doesNotMatch(json.sections.pipelineBrief, /foundeactual/);
  assert.match(json.sections.pipelineBrief, /price not supplied; use the actual offer price/);
  assert.match(json.sections.pipelineBrief, /age range not supplied/);
  assert.doesNotMatch(json.sections.pipelineBrief, /USD 5,000/);
  assert.doesNotMatch(json.sections.pipelineBrief, /\$7,000/);
  assert.doesNotMatch(json.sections.pipelineBrief, /INR 75,000/);
  assert.doesNotMatch(json.sections.pipelineBrief, /\$5k/);
  assert.match(json.sections.pipelineBrief, /INR 500-INR 1,000\/day/);
  assert.doesNotMatch(json.sections.pipelineBrief, /aged 25-45/);
});

test("agent audit preserves exact prices and age ranges when the user supplies them", async () => {
  const suppliedPrecisionOutput = `# Pipeline Brief

- Offer: A guided setup sprint, priced at INR 75,000.
- Target Buyer: Agency founders aged 25-45 looking to scale.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Fix booking friction before changing spend.`;
  const { json } = await runAgent(suppliedPrecisionOutput, validBody({
    offer: "INR 75,000 guided setup sprint.",
    audience: "Agency founders aged 25-45."
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.pipelineBrief, /priced at INR 75,000/);
  assert.match(json.sections.pipelineBrief, /aged 25-45/);
});

test("agent audit returns structured sections and avoids storing weekly metrics or artifacts", async () => {
  const markers = {
    business: "BUSINESS_SECRET_CONTEXT_001",
    offer: "OFFER_SECRET_CONTEXT_001",
    audience: "AUDIENCE_SECRET_CONTEXT_001",
    proof: "PROOF_SECRET_CONTEXT_001",
    followup: "FOLLOWUP_SECRET_CONTEXT_001",
    constraints: "CONSTRAINTS_SECRET_CONTEXT_001",
    metric: METRIC_MARKER,
    bottleneck: "BOTTLENECK_SECRET_CONTEXT_001"
  };
  const artifactMarker = "Readiness diagnosis for the offer";
  const { json, db, ai } = await runAgent(VALID_AGENT_OUTPUT, validBody({
    business: markers.business,
    offer: markers.offer,
    audience: markers.audience,
    proof: markers.proof,
    followup: markers.followup,
    constraints: markers.constraints,
    weeklySpend: markers.metric,
    rawLeads: "36",
    qualifiedLeads: "14",
    bookedCalls: "5",
    showedCalls: "3",
    closedDeals: "0",
    cashCollected: "INR 0",
    bottleneck: markers.bottleneck
  }));

  assert.equal(json.ok, true);
  assert.deepEqual(Object.keys(json.sections).sort(), ["implementationChecklist", "pipelineBrief", "weeklyFixReport"]);
  assert.equal(json.sections.pipelineBrief.startsWith("# Pipeline Brief"), true);
  assert.equal(json.sections.implementationChecklist.startsWith("# Implementation Checklist"), true);
  assert.equal(json.sections.weeklyFixReport.startsWith("# Weekly Fix Report"), true);
  assert.equal(json.safety.storesBusinessBrief, false);
  assert.match(ai.userPrompt(), new RegExp(markers.metric));

  const storedValues = db.joinedBinds();
  for (const marker of Object.values(markers)) {
    assert.doesNotMatch(storedValues, new RegExp(marker));
  }
  assert.doesNotMatch(storedValues, new RegExp(artifactMarker));
});

test("agent audit strips invented current metrics from brief and checklist sections", async () => {
  const crossSectionInventedMetrics = `# Pipeline Brief

- Use the business snapshot to build the first offer route.
- Assumption: 40 raw leads and 6 booked calls per week means follow-up is the bottleneck.
- Keep the first pass focused on WhatsApp or lead forms.

# Implementation Checklist

- Draft the first four creative tests from the business snapshot.
- 88 leads came in, so build the qualification sheet around that volume.
- Keep spend and publishing approval-gated.

# Weekly Fix Report

- For the next 7 days, track raw leads and booked calls before diagnosing the leak.`;
  const { json } = await runAgent(crossSectionInventedMetrics);

  assert.equal(json.ok, true);
  assert.match(json.sections.pipelineBrief, /Use the business snapshot/);
  assert.match(json.sections.implementationChecklist, /Draft the first four creative tests/);
  assert.doesNotMatch(json.brief, /40 raw leads/);
  assert.doesNotMatch(json.brief, /6 booked calls/);
  assert.doesNotMatch(json.brief, /88 leads came in/);
});

test("agent audit preserves contextual no-metrics weekly guidance and appends metrics to collect", async () => {
  const { json, ai } = await runAgent(TRACKER_AGENT_OUTPUT);

  assert.equal(json.ok, true);
  assert.match(ai.userPrompt(), /Spend: Not provided/);
  assert.match(json.sections.weeklyFixReport, /Review the tracker weekly before changing campaign structure/);
  assert.match(json.sections.weeklyFixReport, /Metrics To Collect/);
});

test("agent audit keeps cadence numbers from being treated as invented metrics", async () => {
  const cadenceReport = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- For the next 7 days, track raw leads and booked calls before diagnosing the leak.
- Use a 15-day review only if lead volume is too low.`;
  const { json } = await runAgent(cadenceReport);

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /For the next 7 days, track raw leads and booked calls/);
  assert.match(json.sections.weeklyFixReport, /Metrics To Collect/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Lead-to-Call Metric Tracker Template/);
});

test("agent audit treats bottleneck-only context as no weekly metrics", async () => {
  const { json, ai } = await runAgent(TRACKER_AGENT_OUTPUT, validBody({
    bottleneck: "Leads reply but do not book."
  }));

  assert.equal(json.ok, true);
  assert.match(ai.userPrompt(), /Weekly metrics mode: no metrics provided/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Current Metric Snapshot/);
  assert.match(json.sections.weeklyFixReport, /Metrics To Collect/);
});

test("agent audit replaces invented no-metrics diagnosis with the tracker fallback", async () => {
  const inventedNoMetricsReport = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Spend was INR 9,999 and raw leads were 88, so optimize the campaign.`;
  const { json } = await runAgent(inventedNoMetricsReport);

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Lead-to-Call Metric Tracker Template/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /INR 9,999/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /\b88\b/);
});

test("agent audit replaces invented no-metrics table values with the tracker fallback", async () => {
  const inventedNoMetricsTable = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

| Metric | Current week |
| --- | --- |
| Spend | INR 9,999 |
| Raw leads | 88 |`;
  const { json } = await runAgent(inventedNoMetricsTable);

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Lead-to-Call Metric Tracker Template/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /INR 9,999/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /\b88\b/);
});

test("agent audit replaces invented no-metrics values when values precede metric labels", async () => {
  const inventedNoMetricsBeforeLabel = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- INR 9,999 in spend and 88 raw leads suggests campaign structure is working.`;
  const { json } = await runAgent(inventedNoMetricsBeforeLabel);

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Lead-to-Call Metric Tracker Template/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /INR 9,999/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /\b88\b/);
});

test("agent audit replaces invented plain-language no-metrics values", async () => {
  const inventedPlainLanguageMetrics = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- 88 leads came in; fix qualification next.
- 6 calls showed last week, so tighten reminders.`;
  const { json } = await runAgent(inventedPlainLanguageMetrics);

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Lead-to-Call Metric Tracker Template/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /\b88\b/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /\b6\b/);
});

test("agent audit repairs a missing weekly report with the tracker fallback when no metrics are supplied", async () => {
  const missingWeeklyReport = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.`;
  const { json } = await runAgent(missingWeeklyReport);

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Lead-to-Call Metric Tracker Template/);
  assert.match(json.brief, /# Pipeline Brief/);
  assert.match(json.brief, /# Implementation Checklist/);
});

test("agent audit inserts a metric snapshot when the model omits supplied metrics", async () => {
  const outputWithoutMetricEcho = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Diagnose booking friction before changing spend.`;
  const { json } = await runAgent(outputWithoutMetricEcho, validBody({
    weeklySpend: "INR 7,000",
    rawLeads: "42",
    bottleneck: "Leads reply but do not book."
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Current Metric Snapshot/);
  assert.match(json.sections.weeklyFixReport, /INR 7,000/);
  assert.match(json.brief, /Leads reply but do not book\./);
});

test("agent audit strips exact values for weekly metrics the user did not supply", async () => {
  const outputWithInventedOmittedMetrics = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Spend: INR 7,000.
- Raw leads: 42.
- Closed deals: 2.
- Cash collected: USD 5,000.
- Diagnose booking friction before changing spend.`;
  const { json } = await runAgent(outputWithInventedOmittedMetrics, validBody({
    weeklySpend: "INR 7,000",
    rawLeads: "42"
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /\*\*Spend\*\*: INR 7,000/);
  assert.match(json.sections.weeklyFixReport, /\*\*Raw leads\*\*: 42/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Closed deals: 2/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Cash collected: USD 5,000/);
});

test("agent audit keeps cadence guidance when weekly metrics are partially supplied", async () => {
  const cadenceWithMetrics = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Spend: INR 7,000.
- For the next 7 days, track raw leads and booked calls before diagnosing the leak.`;
  const { json } = await runAgent(cadenceWithMetrics, validBody({
    weeklySpend: "INR 7,000"
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /\*\*Spend\*\*: INR 7,000/);
  assert.match(json.sections.weeklyFixReport, /For the next 7 days, track raw leads and booked calls/);
});

test("agent audit strips plain-language values for weekly metrics the user did not supply", async () => {
  const outputWithPlainLanguageOmittedMetrics = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Spend: INR 7,000.
- 88 leads came in; fix qualification next.
- 6 calls showed last week, so tighten reminders.`;
  const { json } = await runAgent(outputWithPlainLanguageOmittedMetrics, validBody({
    weeklySpend: "INR 7,000"
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /\*\*Spend\*\*: INR 7,000/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /\b88 leads\b/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /\b6 calls\b/);
});

test("agent audit strips conflicting model values for weekly metrics the user supplied", async () => {
  const outputWithConflictingMetricValues = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Spend: INR 70,000.
- Raw leads: 99.
- Booked calls: 80.
- Diagnose booking friction before changing spend.`;
  const { json } = await runAgent(outputWithConflictingMetricValues, validBody({
    weeklySpend: "INR 7,000",
    rawLeads: "42",
    bookedCalls: "8"
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /\*\*Spend\*\*: INR 7,000/);
  assert.match(json.sections.weeklyFixReport, /\*\*Raw leads\*\*: 42/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Spend: INR 70,000/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Raw leads: 99/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /Booked calls: 80/);
});

test("agent audit preserves metric diagnosis that matches supplied weekly values", async () => {
  const outputWithMatchingMetricDiagnosis = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Booked calls: 8 out of 18 qualified leads points to a booking or confirmation leak.
- Diagnose booking friction before changing spend.`;
  const { json } = await runAgent(outputWithMatchingMetricDiagnosis, validBody({
    qualifiedLeads: "18",
    bookedCalls: "8"
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Booked calls: 8 out of 18 qualified leads/);
  assert.match(json.sections.weeklyFixReport, /\*\*Qualified leads\*\*: 18/);
  assert.match(json.sections.weeklyFixReport, /\*\*Booked calls\*\*: 8/);
});

test("agent audit preserves partial metric diagnosis that names missing metrics without values", async () => {
  const partialMetricDiagnosis = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Spend: INR 7,000; raw leads not provided, so collect them before changing spend.`;
  const { json } = await runAgent(partialMetricDiagnosis, validBody({
    weeklySpend: "INR 7,000"
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /raw leads not provided/);
  assert.match(json.sections.weeklyFixReport, /\*\*Spend\*\*: INR 7,000/);
});

test("agent audit inserts the full metric snapshot when the model echoes only one metric", async () => {
  const partialMetricEcho = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Spend: INR 7,000.
- Diagnose booking friction before changing spend.`;
  const { json } = await runAgent(partialMetricEcho, validBody({
    weeklySpend: "INR 7,000",
    rawLeads: "42",
    qualifiedLeads: "21",
    bottleneck: "Leads reply but do not book."
  }));

  assert.equal(json.ok, true);
  assert.match(json.sections.weeklyFixReport, /Current Metric Snapshot/);
  assert.match(json.sections.weeklyFixReport, /\*\*Raw leads\*\*: 42/);
  assert.match(json.sections.weeklyFixReport, /\*\*Qualified leads\*\*: 21/);
  assert.match(json.sections.weeklyFixReport, /\*\*Current bottleneck\*\*: Leads reply but do not book\./);
});

test("agent audit replaces model-made metric snapshots with the server snapshot", async () => {
  const conflictingSnapshot = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

## Current Metric Snapshot
- Spend: INR 999
- Raw leads: 999

## Bottleneck Diagnosis
- Diagnose booking friction before changing spend.`;
  const { json } = await runAgent(conflictingSnapshot, validBody({
    weeklySpend: "INR 7,000",
    rawLeads: "42"
  }));

  const snapshotMatches = json.sections.weeklyFixReport.match(/Current Metric Snapshot/g) || [];
  assert.equal(json.ok, true);
  assert.equal(snapshotMatches.length, 1);
  assert.match(json.sections.weeklyFixReport, /INR 7,000/);
  assert.match(json.sections.weeklyFixReport, /\*\*Raw leads\*\*: 42/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /INR 999/);
});

test("agent audit replaces deeply nested model-made metric snapshots with the server snapshot", async () => {
  const conflictingSnapshot = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

### Current Metric Snapshot
- Spend: INR 999
- Raw leads: 999

### Bottleneck Diagnosis
- Diagnose booking friction before changing spend.`;
  const { json } = await runAgent(conflictingSnapshot, validBody({
    weeklySpend: "INR 7,000",
    rawLeads: "42"
  }));

  const snapshotMatches = json.sections.weeklyFixReport.match(/Current Metric Snapshot/g) || [];
  assert.equal(json.ok, true);
  assert.equal(snapshotMatches.length, 1);
  assert.match(json.sections.weeklyFixReport, /INR 7,000/);
  assert.match(json.sections.weeklyFixReport, /\*\*Raw leads\*\*: 42/);
  assert.doesNotMatch(json.sections.weeklyFixReport, /INR 999/);
});

test("agent audit rejects model output that only contains a metric snapshot for the weekly report", async () => {
  const snapshotOnly = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

## Current Metric Snapshot
- Spend: INR 7,000`;
  const { res, json } = await runAgent(snapshotOnly, validBody({
    weeklySpend: "INR 7,000"
  }));

  assert.equal(res.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.error, "empty_agent_output");
});

test("agent audit preserves zero-valued weekly metrics from JSON callers", async () => {
  const { json, ai } = await runAgent(VALID_AGENT_OUTPUT, validBody({
    weeklySpend: 0,
    rawLeads: 0,
    qualifiedLeads: 0,
    bookedCalls: 0,
    showedCalls: 0,
    closedDeals: 0,
    cashCollected: 0
  }));

  assert.equal(json.ok, true);
  assert.match(ai.userPrompt(), /Spend: 0/);
  assert.match(json.sections.weeklyFixReport, /\*\*Raw leads\*\*: 0/);
  assert.match(json.sections.weeklyFixReport, /\*\*Closed deals\*\*: 0/);
  assert.match(json.sections.weeklyFixReport, /\*\*Cash collected\*\*: 0/);
});

test("agent audit does not let the metric snapshot hide an empty weekly report", async () => {
  const emptyWeeklyReport = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report`;
  const { res, json } = await runAgent(emptyWeeklyReport, validBody({
    weeklySpend: "INR 7,000",
    rawLeads: "42"
  }));

  assert.equal(res.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.error, "empty_agent_output");
});

test("agent audit rejects ROI and ROAS calculations", async () => {
  const roiOutput = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- ROAS would be 8.6x and ROI of 760%.`;
  const { res, json } = await runAgent(roiOutput, validBody({
    weeklySpend: "INR 7,000",
    cashCollected: "INR 60,000"
  }));

  assert.equal(res.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.error, "empty_agent_output");
});

test("agent audit rejects unsafe generated claims before returning sections", async () => {
  const unsafeOutput = `# Pipeline Brief

- This plan has guaranteed revenue.

# Implementation Checklist

- Publish campaigns.

# Weekly Fix Report

- Guaranteed booked calls.`;
  const { res, json } = await runAgent(unsafeOutput);

  assert.equal(res.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.error, "empty_agent_output");
});

for (const [name, unsafeLine] of [
  ["specific lead promise", "This cannot guarantee calls, but it will generate 20 leads next week."],
  ["unqualified campaign publishing", "Publish campaigns."],
  ["unapproved publishing", "Publish ads without approval."],
  ["approval-first unapproved publishing", "Without approval, publish campaigns."],
  ["approval not needed publishing", "No approval needed to publish campaigns."],
  ["approval not needed account connection", "Approval is not needed to connect your Meta ad account."],
  ["unapproved spend change", "Change ad spend without approval."],
  ["autonomous ad buying", "This is fully autonomous ad buying."],
  ["ad account connection", "Connect your Meta ad account before reviewing the plan."],
  ["generic ad account connection", "Connect the ad account before reviewing the plan."],
  ["crm outcome sync", "Sync CRM outcomes back to Meta."]
]) {
  test(`agent audit rejects unsafe generated output: ${name}`, async () => {
    const unsafeOutput = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.
- ${unsafeLine}

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Fix booking friction before changing spend.`;
    const { res, json } = await runAgent(unsafeOutput);

    assert.equal(res.status, 502);
    assert.equal(json.ok, false);
    assert.equal(json.error, "empty_agent_output");
  });
}

test("agent audit allows explicit approval-gated negatives", async () => {
  const approvalGatedOutput = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.
- Do not publish ads without approval.

# Implementation Checklist

- Do not change ad spend without approval.
- After approval, publish campaigns.
- Publish campaigns only after approval.
- After human approval, connect your Meta ad account.
- Keep platform connection work approval-gated.

# Weekly Fix Report

- Fix booking friction before changing spend.`;
  const { json } = await runAgent(approvalGatedOutput);

  assert.equal(json.ok, true);
  assert.match(json.sections.pipelineBrief, /Do not publish ads without approval/);
});

for (const [name, unsafeLine] of [
  ["approval-gated lead promise", "This will generate 20 leads after approval."],
  ["approval-gated revenue guarantee", "This has guaranteed revenue once approved."]
]) {
  test(`agent audit rejects unsafe outcome claims even when approval-gated: ${name}`, async () => {
    const unsafeOutput = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.
- ${unsafeLine}

# Implementation Checklist

- Publish campaigns only after approval.

# Weekly Fix Report

- Fix booking friction before changing spend.`;
    const { res, json } = await runAgent(unsafeOutput);

    assert.equal(res.status, 502);
    assert.equal(json.ok, false);
    assert.equal(json.error, "empty_agent_output");
  });
}

test("agent audit rejects model output that adds a fourth top-level section", async () => {
  const extraSectionOutput = `# Pipeline Brief

- Readiness diagnosis for the offer and funnel.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Fix booking friction before changing spend.

# Acme Coaching Pipeline

- Extra model section that should not be returned.`;
  const warnings = [];
  const originalWarn = console.warn;

  console.warn = (...args) => warnings.push(args.join(" "));
  let result;
  try {
    result = await runAgent(extraSectionOutput);
  } finally {
    console.warn = originalWarn;
  }

  const { res, json } = result;
  assert.equal(res.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.error, "empty_agent_output");
  assert.match(warnings.join("\n"), /unknown top-level headings \(1\)/);
  assert.doesNotMatch(warnings.join("\n"), /Acme Coaching Pipeline/);
});

test("agent audit falls back to the next model after unsafe output", async () => {
  const firstUnsafeOutput = `# Pipeline Brief

- This plan has guaranteed revenue.

# Implementation Checklist

- Set up the offer and approval gates.

# Weekly Fix Report

- Fix booking friction before changing spend.`;
  const { json, ai } = await runAgent([firstUnsafeOutput, VALID_AGENT_OUTPUT]);

  assert.equal(json.ok, true);
  assert.equal(json.model, "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.equal(ai.calls.length, 2);
  assert.doesNotMatch(json.brief, /guaranteed revenue/i);
});

test("agent audit rejects model output that misses required sections", async () => {
  const incompleteOutput = `# Pipeline Brief

- Brief only.`;
  const { res, json } = await runAgent(incompleteOutput);

  assert.equal(res.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.error, "empty_agent_output");
});

test("signup handler accepts a bare-domain website with a test email and stores the normalized URL", async () => {
  const db = new FakeDB();
  const env = { DB: db, AI: new FakeAI("") };
  const res = await worker.fetch(
    new Request("https://tinystudio.io/api/signups", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://tinystudio.io",
        "Accept": "text/html",
        "User-Agent": "tinystudio-worker-test"
      },
      body: new URLSearchParams({ website: "example.com", email: "audit-check+test@example.com" }).toString()
    }),
    env
  );

  assert.equal(res.status, 303);
  assert.equal(new URL(res.headers.get("Location")).pathname, "/brief-requested");
  const insert = db.calls.find((call) => call.sql.includes("INSERT INTO email_signups"));
  assert.ok(insert, "signup handler must persist through the existing email_signups path");
  assert.equal(insert.values[0], "audit-check+test@example.com");
  assert.equal(insert.values[7], "https://example.com");

  assert.equal(insert.values[1], "website-appraisal", "current intake signups must carry the current-offer source label");
  assert.notEqual(insert.values[1], "agent-self-serve", "current intake signups must not carry the retired Agent Desk source label");
});

test("worker /health names the current Website Appraisal surface, not the retired Agent Desk", async () => {
  class HealthStatement extends FakeStatement {
    async all() {
      this.db.calls.push({ method: "all", sql: this.sql, values: this.values });
      return { results: [{ name: "email_signups" }, { name: "agent_runs" }, { name: "agent_usage_limits" }] };
    }
  }

  class HealthDB extends FakeDB {
    prepare(sql) {
      return new HealthStatement(this, sql);
    }
  }

  const res = await worker.fetch(new Request("https://tinystudio.io/health"), { DB: new HealthDB(), AI: {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, "tinystudio-io-public");
  assert.equal(body.surface, "website-appraisal", "health surface must name the current offer");
  assert.notEqual(body.surface, "agent-desk", "health surface must not name the retired Agent Desk");
  assert.equal(body.ok, true);
});

test("worker /health verdict keys off the current intake path, not the retired Agent Desk machinery", async () => {

  class HealthStatement extends FakeStatement {
    async all() {
      this.db.calls.push({ method: "all", sql: this.sql, values: this.values });
      return { results: [{ name: "email_signups" }] };
    }
  }

  class HealthDB extends FakeDB {
    prepare(sql) {
      return new HealthStatement(this, sql);
    }
  }

  const res = await worker.fetch(new Request("https://tinystudio.io/health"), { DB: new HealthDB() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true, "the current product is ready even without the retired Agent Desk machinery");
  assert.equal(body.checks.signupsTable, true, "the intake table is present");
  assert.equal(body.checks.ai, false, "the retired AI binding is absent");
  assert.equal(body.checks.agentRunsTable, false, "the retired agent_runs table is absent");
  assert.equal(body.checks.usageLimitsTable, false, "the retired usage-limits table is absent");
});

test("legacy /api/agent-audit still labels its rows with the retired self-serve source", async () => {
  const db = new FakeDB();
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const res = await worker.fetch(agentRequest(validBody()), { DB: db, AI: ai });
  assert.equal(res.status, 200);
  const signupInsert = db.calls.find((call) => call.sql.includes("INSERT INTO email_signups"));
  assert.ok(signupInsert, "agent audit must persist through the existing email_signups path");
  assert.equal(signupInsert.values[1], "agent-self-serve", "the legacy surface keeps its own source label");
  const runInsert = db.calls.find((call) => call.sql.includes("INSERT INTO agent_runs"));
  assert.ok(runInsert, "agent audit must record the legacy run");
  assert.equal(runInsert.values[2], "agent-self-serve", "the legacy run keeps its own source label");
});

test("the agent chain logs the winning model with per-attempt completion tokens", async () => {
  class ScriptedAI {
    constructor(results) {
      this.results = results;
      this.calls = [];
    }

    async run(model, options, gatewayOptions) {
      this.calls.push({ model, options, gatewayOptions });
      const result = this.results[this.calls.length - 1] ?? this.results.at(-1);
      if (result instanceof Error) throw result;
      return result;
    }
  }

  const invalid = { response: "# Pipeline Brief\n\n- readiness diagnosis without the other sections." };
  const valid = { response: VALID_AGENT_OUTPUT, usage: { prompt_tokens: 10, completion_tokens: 432 } };
  const ai = new ScriptedAI([invalid, valid]);
  const db = new FakeDB();
  const logs = [];
  const originalLog = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  try {
    const res = await worker.fetch(agentRequest(validBody()), { DB: db, AI: ai });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).model, "@cf/qwen/qwen3-30b-a3b-fp8");
  } finally {
    console.log = originalLog;
  }
  assert.equal(ai.calls[1].gatewayOptions.gateway.id, "default", "the winning call routes through the default gateway");
  assert.equal(ai.calls[1].options.gateway, undefined, "the gateway option is a run option, not a model input");
  const selection = logs.find((line) => line.startsWith("tinystudio_agent_model_selected"));
  assert.ok(selection, "the winning model must be logged");
  const payload = JSON.parse(selection.replace(/^tinystudio_agent_model_selected /, ""));
  assert.equal(payload.model, "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.equal(payload.attempts, 2);
  assert.equal(payload.modelAttempts[0].model, "@cf/mistralai/mistral-small-3.1-24b-instruct");
  assert.equal(payload.modelAttempts[0].completionTokens, null);
  assert.equal(payload.modelAttempts[1].completionTokens, 432);
});

test("the agent chain disables qwen3 thinking, sets gpt-oss low effort, and routes through the default gateway", async () => {
  class AllInvalidAI {
    constructor() {
      this.calls = [];
    }

    async run(model, options, gatewayOptions) {
      this.calls.push({ model, options, gatewayOptions });
      return { response: "# Pipeline Brief\n\n- readiness diagnosis without the other sections." };
    }
  }

  const ai = new AllInvalidAI();
  const db = new FakeDB();
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => logs.push(parts.join(" "));
  let status;
  try {
    status = (await worker.fetch(agentRequest(validBody()), { DB: db, AI: ai })).status;
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(status, 502, "every candidate fails on the same invalid output");
  assert.equal(ai.calls.length, AGENT_MODELS.length, "every model in the chain must be tried before giving up");
  assert.equal(new Set(ai.calls.map((call) => call.model)).size, AGENT_MODELS.length, "the chain tries each model once");
  const failure = logs.find((line) => line.startsWith("tinystudio_agent_ai_failed"));
  assert.ok(failure, "the all-models-failed path must be logged");
  const failurePayload = JSON.parse(failure.replace(/^tinystudio_agent_ai_failed /, ""));
  assert.equal(failurePayload.attempts, AGENT_MODELS.length, "the failure log counts every attempt");
  assert.equal(failurePayload.modelAttempts.length, AGENT_MODELS.length);
  assert.deepEqual(
    failurePayload.modelAttempts.map((entry) => entry.model),
    AGENT_MODELS,
    "the failure log names every model it tried"
  );
  const options = new Map(ai.calls.map((call) => [call.model, call.options]));
  const gatewayOptions = new Map(ai.calls.map((call) => [call.model, call.gatewayOptions]));
  const qwen = options.get("@cf/qwen/qwen3-30b-a3b-fp8");
  const gptOss = options.get("@cf/openai/gpt-oss-20b");
  assert.equal(qwen.chat_template_kwargs.enable_thinking, false, "qwen3 must not spend tokens thinking");
  assert.equal(qwen.reasoning_effort, undefined, "reasoning_effort is not a qwen3 parameter");
  assert.equal(gptOss.reasoning_effort, "low", "gpt-oss must run at low effort");
  assert.equal(gptOss.chat_template_kwargs, undefined, "chat_template_kwargs is not a gpt-oss parameter");
  for (const [model, runOptions] of options) {
    assert.equal(runOptions.gateway, undefined, `${model} must not carry the gateway as a model input`);
    assert.equal(runOptions.max_tokens, 2400);
  }
  for (const [model, runGatewayOptions] of gatewayOptions) {
    assert.equal(runGatewayOptions.gateway?.id, "default", `${model} must route through the default gateway`);
  }
});

test("signup handler redirects a rejected email to /?signal=invalid so the homepage can render it", async () => {

  const db = new FakeDB();
  const env = { DB: db, AI: new FakeAI("") };
  const res = await worker.fetch(
    new Request("https://tinystudio.io/api/signups", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://tinystudio.io",
        "Accept": "text/html",
        "User-Agent": "tinystudio-worker-test"
      },
      body: new URLSearchParams({ website: "example.com", email: "a@b" }).toString()
    }),
    env
  );

  assert.equal(res.status, 303);
  const location = new URL(res.headers.get("Location"));
  assert.equal(location.pathname, "/");
  assert.equal(location.searchParams.get("signal"), "invalid");
  const insert = db.calls.find((call) => call.sql.includes("INSERT INTO email_signups"));
  assert.equal(insert, undefined, "rejected signup must not persist a row");
});

test("worker serves the self-hosted font assets", async () => {
  const served = new Map([
    ["/fonts.css", "text/css;charset=UTF-8"],
    ["/fonts/fraunces-latin-opsz-normal.woff2", "font/woff2"]
  ]);
  const env = {
    ASSETS: {
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (!served.has(path)) return Promise.resolve(new Response("missing", { status: 404 }));
        return Promise.resolve(new Response("font", { status: 200, headers: { "Content-Type": served.get(path) } }));
      }
    }
  };
  for (const path of served.keys()) {
    const res = await worker.fetch(new Request(`https://tinystudio.io${path}`), env);
    assert.equal(res.status, 200, path);
  }
});

test("worker does not serve unlisted asset-like paths outside the public allow-list", async () => {
  const env = { ASSETS: { fetch: async () => new Response("should not be reached", { status: 200 }) } };
  const res = await worker.fetch(new Request("https://tinystudio.io/not-listed.js"), env);
  assert.equal(res.status, 404);
});

test("www host redirects permanently to the canonical apex host", async () => {
  const res = await worker.fetch(new Request("https://www.tinystudio.io/"), {});
  assert.equal(res.status, 301, "the duplicate www host must answer a permanent redirect, not 200");
  assert.equal(res.headers.get("Location"), "https://tinystudio.io/");
});

test("www host redirect preserves path and query, and upgrades plain http", async () => {
  const res = await worker.fetch(
    new Request("http://www.tinystudio.io/pricing?utm_source=x&utm_medium=y"),
    {}
  );
  assert.equal(res.status, 301);
  assert.equal(
    res.headers.get("Location"),
    "https://tinystudio.io/pricing?utm_source=x&utm_medium=y",
    "the redirect must keep the visitor's destination and campaign parameters intact"
  );
});

test("www host never serves a second copy of the public site", async () => {
  const env = {
    ASSETS: { fetch: async () => new Response("<html>duplicate site</html>", { status: 200 }) }
  };
  for (const target of [
    "https://www.tinystudio.io/",
    "https://www.tinystudio.io/audit",
    "https://www.tinystudio.io/agents",
    "https://www.tinystudio.io/agent-desk"
  ]) {
    const res = await worker.fetch(new Request(target), env);
    assert.equal(res.status, 301, `www must not serve ${target}`);
    const body = await res.text();
    assert.doesNotMatch(body, /duplicate site/, "www must not return public site HTML");
  }
});

test("/audit and /audit.html permanently redirect to /appraisal, keeping the query", async () => {
  const env = {
    ASSETS: { fetch: async () => new Response("<html>asset</html>", { status: 200 }) }
  };
  for (const path of ["/audit", "/audit.html"]) {
    const res = await worker.fetch(new Request(`https://tinystudio.io${path}?utm_source=x`), env);
    assert.equal(res.status, 301, `${path} must redirect`);
    assert.equal(res.headers.get("Location"), "https://tinystudio.io/appraisal?utm_source=x");
  }
});

test("/appraisal is served as an asset and the retired Agent Desk, desk and MSP paths are not", async () => {
  const served = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        served.push(new URL(request.url).pathname);
        return new Response("<html>asset</html>", { status: 200 });
      }
    }
  };
  const ok = await worker.fetch(new Request("https://tinystudio.io/appraisal", { headers: { Accept: "text/html" } }), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(served, ["/appraisal"], "/appraisal must be fetched as its own asset");
  for (const path of ["/agent-desk.html", "/agents.css", "/msp.js", "/styles.css", "/script.js"]) {
    const res = await worker.fetch(new Request(`https://tinystudio.io${path}`), env);
    assert.equal(res.status, 404, `${path} must be gone`);
  }
});

test("/waitlist is served as its own public asset with its page, stylesheet and script", async () => {
  const served = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        served.push(path);
        return new Response("<html>asset</html>", { status: 200 });
      }
    }
  };
  for (const path of ["/waitlist", "/waitlist.html", "/waitlist.css", "/waitlist.js"]) {
    const res = await worker.fetch(new Request(`https://tinystudio.io${path}`), env);
    assert.equal(res.status, 200, `${path} must be served`);
  }
  assert.deepEqual(served, ["/waitlist", "/waitlist.html", "/waitlist.css", "/waitlist.js"], "each waitlist path must be fetched as its own asset");
});

test("canonical host redirect leaves the apex and the retired hosts alone", async () => {
  const env = {
    ASSETS: { fetch: async () => new Response("<html>apex site</html>", { status: 200 }) }
  };
  const apex = await worker.fetch(new Request("https://tinystudio.io/"), env);
  assert.notEqual(apex.status, 301, "the apex host must keep serving the site, not redirect");

  const app = await worker.fetch(new Request("https://app.tinystudio.io/"), {});
  assert.equal(app.status, 410, "the retired app host keeps its own retired response");

  const api = await worker.fetch(new Request("https://api.tinystudio.io/"), {});
  assert.equal(api.status, 410, "the retired API host keeps its own retired response");
});

test("retired app host frames the current offer as The Website Appraisal, not the Agent Desk", async () => {
  const res = await worker.fetch(new Request("https://app.tinystudio.io/"), {});
  assert.equal(res.status, 410);
  const html = await res.text();
  assert.match(html, /The Website Appraisal/, "retired app host must name the current offer");
  assert.match(html, /free leak audit of high-ticket service homepages/, "retired app host must state the current offer truth");
  assert.doesNotMatch(html, /self-serve Agent Desk/, "retired app host must not point at the retired Agent Desk as the current offer");
});

test("retired API host frames the current offer as The Website Appraisal, not the Agent Desk", async () => {
  const res = await worker.fetch(new Request("https://api.tinystudio.io/"), {});
  assert.equal(res.status, 410);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "retired");
  assert.match(body.message, /The Website Appraisal/, "retired API host message must name the current offer");
  assert.match(body.message, /free leak audit of high-ticket service homepages/, "retired API host message must state the current offer truth");
  assert.doesNotMatch(body.message, /self-serve Agent Desk/, "retired API host message must not point at the retired Agent Desk as the current offer");
});

class CountingStatement extends FakeStatement {
  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, values: this.values });
    if (this.sql.includes("INSERT INTO agent_usage_limits")) {
      const bucketKey = this.values[0];
      const count = (this.db.counts.get(bucketKey) || 0) + 1;
      this.db.counts.set(bucketKey, count);
      return { count };
    }
    return { count: 1 };
  }
}

class CountingDB extends FakeDB {
  constructor() {
    super();
    this.counts = new Map();
  }

  prepare(sql) {
    return new CountingStatement(this, sql);
  }
}

function runAgentLimit(db, ai, body, headers, env = {}) {
  return worker.fetch(agentRequest(body, headers), { DB: db, AI: ai, ...env });
}

test("per-IP daily signup limit: 20 succeed, the 21st from the same IP returns 429 daily_ip_limit", async () => {
  const db = new CountingDB();
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const ip = "203.0.113.77";

  for (let i = 1; i <= 20; i += 1) {
    const res = await runAgentLimit(
      db,
      ai,
      validBody({ email: `ip-burst-${i}@tinystudio.io` }),
      { "CF-Connecting-IP": ip }
    );
    assert.equal(res.status, 200, `request ${i} (the 20th is the exact per-IP boundary) must succeed`);
  }

  const blocked = await runAgentLimit(
    db,
    ai,
    validBody({ email: "ip-burst-21@tinystudio.io" }),
    { "CF-Connecting-IP": ip }
  );
  assert.equal(blocked.status, 429, "the 21st request from the same IP must be refused");
  const body = await blocked.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "daily_ip_limit");
  assert.match(blocked.headers.get("Content-Type") || "", /application\/json/);
});

test("per-email daily signup limit: 5 succeed, the 6th for the same email returns 429 daily_email_limit", async () => {
  const db = new CountingDB();
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const email = "email-burst@tinystudio.io";

  for (let i = 1; i <= 5; i += 1) {
    const res = await runAgentLimit(
      db,
      ai,
      validBody({ email }),
      { "CF-Connecting-IP": `203.0.113.1${i}` }
    );
    assert.equal(res.status, 200, `request ${i} (the 5th is the exact per-email boundary) must succeed`);
  }

  const blocked = await runAgentLimit(
    db,
    ai,
    validBody({ email }),
    { "CF-Connecting-IP": "203.0.113.99" }
  );
  assert.equal(blocked.status, 429, "the 6th request for the same email must be refused");
  const body = await blocked.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "daily_email_limit");
  assert.match(blocked.headers.get("Content-Type") || "", /application\/json/);
});

test("daily email limit resets after the day rolls over (controlled clock, no sleeping)", async () => {
  const db = new CountingDB();
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const email = "rollover-email@tinystudio.io";
  const dayOne = "2026-08-12T10:00:00.000Z";
  const dayTwo = "2026-08-13T02:00:00.000Z";

  for (let i = 1; i <= 5; i += 1) {
    const res = await runAgentLimit(db, ai, validBody({ email }), {}, { AGENT_LIMITS_NOW: dayOne });
    assert.equal(res.status, 200, `request ${i} on day one must succeed`);
  }

  const blocked = await runAgentLimit(db, ai, validBody({ email }), {}, { AGENT_LIMITS_NOW: dayOne });
  assert.equal(blocked.status, 429, "the 6th request on day one must be refused");
  assert.equal((await blocked.json()).error, "daily_email_limit");

  const allowed = await runAgentLimit(db, ai, validBody({ email }), {}, { AGENT_LIMITS_NOW: dayTwo });
  assert.equal(allowed.status, 200, "the same email must be allowed again once the day rolls over");
});

test("daily IP limit resets after the day rolls over (controlled clock, no sleeping)", async () => {
  const db = new CountingDB();
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const ip = "203.0.113.55";
  const dayOne = "2026-08-12T10:00:00.000Z";
  const dayTwo = "2026-08-13T02:00:00.000Z";

  for (let i = 1; i <= 20; i += 1) {
    const res = await runAgentLimit(
      db,
      ai,
      validBody({ email: `ip-rollover-${i}@tinystudio.io` }),
      { "CF-Connecting-IP": ip },
      { AGENT_LIMITS_NOW: dayOne }
    );
    assert.equal(res.status, 200, `request ${i} on day one must succeed`);
  }

  const blocked = await runAgentLimit(
    db,
    ai,
    validBody({ email: "ip-rollover-blocked@tinystudio.io" }),
    { "CF-Connecting-IP": ip },
    { AGENT_LIMITS_NOW: dayOne }
  );
  assert.equal(blocked.status, 429, "the 21st request on day one must be refused");
  assert.equal((await blocked.json()).error, "daily_ip_limit");

  const allowed = await runAgentLimit(
    db,
    ai,
    validBody({ email: "ip-rollover-blocked@tinystudio.io" }),
    { "CF-Connecting-IP": ip },
    { AGENT_LIMITS_NOW: dayTwo }
  );
  assert.equal(allowed.status, 200, "the same IP must be allowed again once the day rolls over");
});

test("global daily agent audit cap: 50 runs a day across all callers, then 429 daily_global_limit without running the model", async () => {
  const db = new CountingDB();
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const env = { AGENT_LIMITS_NOW: "2026-08-13T10:00:00.000Z" };

  for (let i = 1; i <= 50; i += 1) {
    const res = await runAgentLimit(
      db,
      ai,
      validBody({ email: `global-${i}@tinystudio.io` }),
      { "CF-Connecting-IP": `198.51.100.${i}` },
      env
    );
    assert.equal(res.status, 200, `run ${i} of 50 must succeed`);
  }
  const modelCallsBefore = ai.calls.length;

  const blocked = await runAgentLimit(
    db,
    ai,
    validBody({ email: "global-51@tinystudio.io" }),
    { "CF-Connecting-IP": "198.51.100.51" },
    env
  );
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, "daily_global_limit");
  assert.equal(ai.calls.length, modelCallsBefore, "the capped run must never reach the model");

  const nextDay = await runAgentLimit(
    db,
    ai,
    validBody({ email: "global-52@tinystudio.io" }),
    { "CF-Connecting-IP": "198.51.100.52" },
    { AGENT_LIMITS_NOW: "2026-08-14T10:00:00.000Z" }
  );
  assert.equal(nextDay.status, 200, "the global cap resets with the day");
});

test("AGENT_AUDIT_DISABLED turns the agent audit off before any storage or model call", async () => {
  for (const flag of ["1", "true"]) {
    const db = new FakeDB();
    const ai = new FakeAI(VALID_AGENT_OUTPUT);
    const res = await worker.fetch(agentRequest(validBody()), { DB: db, AI: ai, AGENT_AUDIT_DISABLED: flag });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "agent_audit_disabled");
    assert.equal(ai.calls.length, 0, "a disabled audit must not run the model");
    assert.equal(db.calls.length, 0, "a disabled audit must not touch storage");
  }
});

function signupRequest({ accept = "application/json" } = {}) {
  return new Request("https://tinystudio.io/api/signups", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://tinystudio.io",
      "Accept": accept,
      "User-Agent": "tinystudio-worker-test"
    },
    body: new URLSearchParams({ website: "example.com", email: "storage-failure+test@example.com" }).toString()
  });
}

test("storage failure: signup returns 503 storage_unavailable when D1 is absent (no success signal)", async () => {
  const res = await worker.fetch(signupRequest(), {});

  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Location"), null, "no success redirect may be issued without storage");
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "storage_unavailable");
});

test("storage failure: signup returns 503 storage_unavailable when the D1 insert write throws (never 201, never the saved redirect)", async () => {
  const env = { DB: failingDB({ runSql: "INSERT INTO email_signups" }) };

  const jsonRes = await worker.fetch(signupRequest({ accept: "application/json" }), env);
  assert.equal(jsonRes.status, 503, "a thrown signup write must never surface as a 201 success");
  const body = await jsonRes.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "storage_unavailable");

  const htmlRes = await worker.fetch(signupRequest({ accept: "text/html" }), env);
  assert.equal(htmlRes.status, 503, "the saved redirect must not fire when the write failed");
  assert.equal(htmlRes.headers.get("Location"), null);
});

test("storage failure: agent audit returns 503 storage_unavailable when D1 is absent and never runs the model", async () => {
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const res = await worker.fetch(agentRequest(validBody()), { AI: ai });

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "storage_unavailable");
  assert.equal(ai.calls.length, 0, "no model call may happen without working storage");
  assert.equal(body.model, undefined, "no success payload may claim a model");
});

test("storage failure: agent audit returns 503 storage_unavailable when the usage counter write throws and records no usage", async () => {
  const db = failingDB({ firstSql: "INSERT INTO agent_usage_limits" });
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const res = await worker.fetch(agentRequest(validBody()), { DB: db, AI: ai });

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "storage_unavailable");
  assert.equal(ai.calls.length, 0, "the model must not run after a storage failure");
  assert.equal(
    db.calls.some((call) => call.method === "run" && call.sql.includes("INSERT INTO agent_runs")),
    false,
    "no agent run may be recorded when the usage counter failed"
  );
  assert.equal(
    db.calls.some((call) => call.sql.includes("INSERT INTO agent_usage_limits")),
    false,
    "no usage count may be recorded when the counter write failed"
  );
});

test("storage failure: agent audit returns 503 storage_unavailable when a usage write throws and never claims success or writes usage", async () => {
  const db = failingDB({ runSql: "INSERT INTO agent_runs" });
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const res = await worker.fetch(agentRequest(validBody()), { DB: db, AI: ai });

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "storage_unavailable");
  assert.equal(ai.calls.length, 0, "the model must not run when the usage write failed");
  assert.equal(
    db.calls.some((call) => call.sql.includes("INSERT INTO agent_runs")),
    false,
    "the failed agent run must not be recorded as usage"
  );
});

test("storage failure: agent audit returns 503 storage_unavailable when the email_signups write throws and never runs the model", async () => {
  const db = failingDB({ runSql: "INSERT INTO email_signups" });
  const ai = new FakeAI(VALID_AGENT_OUTPUT);
  const res = await worker.fetch(agentRequest(validBody()), { DB: db, AI: ai });

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "storage_unavailable");
  assert.equal(ai.calls.length, 0, "no model call may happen when the signup write failed");
  assert.equal(body.model, undefined, "no success payload may claim a model");
});

const MIGRATION_FILES = [
  "0001_email_signups.sql",
  "0002_agent_runs.sql",
  "0003_agent_usage_limits.sql",
  "0004_signup_website.sql"
];

function applyD1Migrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const applied = new Set(
    db.prepare("SELECT name FROM d1_migrations").all().map((row) => row.name)
  );
  let appliedNow = 0;
  for (const file of MIGRATION_FILES) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(file);
    appliedNow += 1;
  }
  return appliedNow;
}

const EXPECTED_COLUMNS = {
  email_signups: [
    { name: "id", type: "INTEGER", notnull: 0, pk: 1, dflt_value: null },
    { name: "email", type: "TEXT", notnull: 1, pk: 0, dflt_value: null },
    { name: "source", type: "TEXT", notnull: 1, pk: 0, dflt_value: "'cryptic-landing-page'" },
    { name: "page_path", type: "TEXT", notnull: 1, pk: 0, dflt_value: "'/'" },
    { name: "referer", type: "TEXT", notnull: 0, pk: 0, dflt_value: null },
    { name: "user_agent", type: "TEXT", notnull: 0, pk: 0, dflt_value: null },
    { name: "created_at", type: "TEXT", notnull: 1, pk: 0, dflt_value: null },
    { name: "updated_at", type: "TEXT", notnull: 1, pk: 0, dflt_value: null },
    { name: "website", type: "TEXT", notnull: 0, pk: 0, dflt_value: null }
  ],
  agent_runs: [
    { name: "id", type: "TEXT", notnull: 0, pk: 1, dflt_value: null },
    { name: "email", type: "TEXT", notnull: 1, pk: 0, dflt_value: null },
    { name: "source", type: "TEXT", notnull: 1, pk: 0, dflt_value: "'agent-self-serve'" },
    { name: "page_path", type: "TEXT", notnull: 1, pk: 0, dflt_value: "'/'" },
    { name: "ip_hash", type: "TEXT", notnull: 0, pk: 0, dflt_value: null },
    { name: "user_agent", type: "TEXT", notnull: 0, pk: 0, dflt_value: null },
    { name: "created_at", type: "TEXT", notnull: 1, pk: 0, dflt_value: null }
  ],
  agent_usage_limits: [
    { name: "bucket_key", type: "TEXT", notnull: 0, pk: 1, dflt_value: null },
    { name: "count", type: "INTEGER", notnull: 1, pk: 0, dflt_value: "0" },
    { name: "first_seen_at", type: "TEXT", notnull: 1, pk: 0, dflt_value: null },
    { name: "updated_at", type: "TEXT", notnull: 1, pk: 0, dflt_value: null }
  ]
};

const EXPECTED_INDEXES = {
  email_signups: [{ name: "idx_email_signups_updated_at", columns: ["updated_at"] }],
  agent_runs: [
    { name: "idx_agent_runs_email_created_at", columns: ["email", "created_at"] },
    { name: "idx_agent_runs_ip_hash_created_at", columns: ["ip_hash", "created_at"] }
  ],
  agent_usage_limits: [{ name: "idx_agent_usage_limits_updated_at", columns: ["updated_at"] }]
};

function schemaColumnList(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      pk: column.pk,
      dflt_value: column.dflt_value
    }));
}

function schemaIndexList(db, table) {
  return db
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .filter((index) => !index.name.startsWith("sqlite_autoindex_"))
    .map((index) => ({
      name: index.name,
      columns: db.prepare(`PRAGMA index_info(${index.name})`).all().map((column) => column.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function schemaFingerprint(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  const fingerprint = {};
  for (const table of tables) {
    fingerprint[table] = {
      columns: schemaColumnList(db, table),
      indexes: schemaIndexList(db, table)
    };
  }
  return fingerprint;
}

function assertSchemaDriftFree(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ["agent_runs", "agent_usage_limits", "d1_migrations", "email_signups"]);
  for (const table of Object.keys(EXPECTED_COLUMNS)) {
    assert.deepEqual(
      schemaColumnList(db, table),
      EXPECTED_COLUMNS[table],
      `column contract for ${table} must match the real migrations`
    );
    assert.deepEqual(
      schemaIndexList(db, table),
      EXPECTED_INDEXES[table],
      `index contract for ${table} must match the real migrations`
    );
  }
}

const WORKER_SIGNUP_SQL = `
  INSERT INTO email_signups (email, source, page_path, referer, user_agent, created_at, updated_at, website)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET
    source = excluded.source,
    website = COALESCE(excluded.website, email_signups.website),
    page_path = excluded.page_path,
    referer = excluded.referer,
    user_agent = excluded.user_agent,
    updated_at = excluded.updated_at`;

const WORKER_USAGE_COUNTER_SQL = `
  INSERT INTO agent_usage_limits (bucket_key, count, first_seen_at, updated_at)
  VALUES (?, 1, ?, ?)
  ON CONFLICT(bucket_key) DO UPDATE SET
    count = count + 1,
    updated_at = excluded.updated_at
  RETURNING count`;

const WORKER_AGENT_RUNS_SQL = `
  INSERT INTO agent_runs (id, email, source, page_path, ip_hash, user_agent, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

const WORKER_HEALTH_TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('agent_runs', 'agent_usage_limits')";

test("real D1 migrations apply to a fresh node:sqlite database and build the exact production schema", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(applyD1Migrations(db), 4, "all four migration files must apply once on a fresh database");
  assertSchemaDriftFree(db);
  db.close();
});

test("reapplying the real D1 migrations is idempotent and never rewrites the schema", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(applyD1Migrations(db), 4, "first apply runs all four migrations");
  const before = schemaFingerprint(db);
  assert.equal(applyD1Migrations(db), 0, "a reapply must skip every already-recorded migration");
  assert.deepEqual(schemaFingerprint(db), before, "a reapply must leave the schema byte-identical");
  assert.deepEqual(
    db.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((row) => row.name),
    MIGRATION_FILES,
    "the tracking table must record each migration exactly once, in order"
  );
  db.close();
});

test("the exact worker signup SQL runs on the migrated schema with its upsert semantics", () => {
  const db = new DatabaseSync(":memory:");
  applyD1Migrations(db);
  const now = "2026-08-13T12:00:00.000Z";

  db.prepare(WORKER_SIGNUP_SQL).run(
    "audit-check+test@example.com", "agent-self-serve", "/", null, "tinystudio-worker-test", now, now, "https://example.com"
  );

  db.prepare(WORKER_SIGNUP_SQL).run(
    "audit-check+test@example.com", "agent-self-serve", "/audit", null, "tinystudio-worker-test", now, now, null
  );

  db.prepare(WORKER_SIGNUP_SQL).run(
    "audit-check+test@example.com", "agent-self-serve", "/audit", null, "tinystudio-worker-test", now, now, "https://new.example.com"
  );

  const rows = db.prepare("SELECT email, source, page_path, referer, user_agent, created_at, updated_at, website FROM email_signups").all();
  assert.equal(rows.length, 1, "the upsert must keep one row per email");
  assert.equal(rows[0].email, "audit-check+test@example.com");
  assert.equal(rows[0].website, "https://new.example.com");
  assert.equal(rows[0].page_path, "/audit");
  assert.equal(rows[0].source, "agent-self-serve");
  assert.equal(rows[0].created_at, now);
  assert.equal(rows[0].updated_at, now);
  db.close();
});

test("the exact worker agent SQL runs on the migrated schema: usage counters increment and runs persist", () => {
  const db = new DatabaseSync(":memory:");
  applyD1Migrations(db);
  const now = "2026-08-13T12:00:00.000Z";
  const bucketKey = "ip:2026-08-13:5d3d0e9e1f2a3b4c5d6e7f8a9b0c1d2e";

  const first = db.prepare(WORKER_USAGE_COUNTER_SQL).get(bucketKey, now, now);
  assert.equal(Number(first.count), 1, "first hit in the bucket must start the counter at 1");
  const second = db.prepare(WORKER_USAGE_COUNTER_SQL).get(bucketKey, now, now);
  assert.equal(Number(second.count), 2, "second hit in the bucket must increment the counter");

  db.prepare(WORKER_AGENT_RUNS_SQL).run(
    "6f0d0a5c-9a2e-4b1f-8c3d-1e2f3a4b5c6d", "nish+agent-test@tinystudio.io", "agent-self-serve", "/", "5d3d0e9e1f2a3b4c5d6e7f8a9b0c1d2e", "tinystudio-worker-test", now
  );
  db.prepare(WORKER_AGENT_RUNS_SQL).run(
    "7f1e1b6d-0b3f-4c2e-9d4e-2f3a4b5c6d7e", "nish+agent-test@tinystudio.io", "agent-self-serve", "/agents", "5d3d0e9e1f2a3b4c5d6e7f8a9b0c1d2e", "tinystudio-worker-test", now
  );

  const healthTables = db.prepare(WORKER_HEALTH_TABLES_SQL).all().map((row) => row.name).sort();
  assert.deepEqual(healthTables, ["agent_runs", "agent_usage_limits"], "the worker health query must see both tables");

  const usage = db.prepare("SELECT bucket_key, count FROM agent_usage_limits ORDER BY bucket_key").all()
    .map((row) => ({ bucket_key: row.bucket_key, count: row.count }));
  assert.deepEqual(usage, [{ bucket_key: bucketKey, count: 2 }]);
  const runs = db.prepare("SELECT id, email, ip_hash, page_path FROM agent_runs ORDER BY id").all();
  assert.equal(runs.length, 2, "each agent run must persist");
  assert.equal(runs[0].email, "nish+agent-test@tinystudio.io");
  assert.equal(runs[0].ip_hash, "5d3d0e9e1f2a3b4c5d6e7f8a9b0c1d2e");
  db.close();
});

const BRIEF_REQUESTED_HTML = '<!doctype html><html><head><title>brief</title></head><body>ok</body></html>';

function adsEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () =>
        new Response(BRIEF_REQUESTED_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        })
    },
    GOOGLE_ADS_CONVERSION_ID: "AW-1234567890",
    GOOGLE_ADS_CONVERSION_LABEL: "AbCdEfGhIjKlMnOpQrSt",
    ...overrides
  };
}

test("brief-requested ships no Google Ads tag while the conversion env is not configured", async () => {
  const env = adsEnv({ GOOGLE_ADS_CONVERSION_ID: "", GOOGLE_ADS_CONVERSION_LABEL: "" });
  const res = await worker.fetch(new Request("https://tinystudio.io/brief-requested"), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes("googletagmanager.com"), "no tag may ship while unconfigured");
  const csp = res.headers.get("Content-Security-Policy") || "";
  assert.ok(!csp.includes("googletagmanager.com"), "CSP must stay strict while unconfigured");
  const js = await (await worker.fetch(new Request("https://tinystudio.io/brief-requested.js"), env)).text();
  assert.ok(!js.includes("gtag("), "no conversion event may fire while unconfigured");
});

test("worker injects the configured Google Ads conversion tag on /brief-requested only", async () => {
  const env = adsEnv();
  const res = await worker.fetch(new Request("https://tinystudio.io/brief-requested"), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(
    body.includes('src="https://www.googletagmanager.com/gtag/js?id=AW-1234567890"'),
    "gtag loader must be injected with the real conversion id"
  );
  assert.ok(body.includes("</head>"), "injected loader must sit inside the head");
  const csp = res.headers.get("Content-Security-Policy") || "";
  assert.ok(csp.includes("https://www.googletagmanager.com"), "brief-requested CSP must allow the gtag script origin");
  assert.ok(csp.includes("googleads.g.doubleclick.net"), "brief-requested CSP must allow the conversion beacon");

  const js = await (await worker.fetch(new Request("https://tinystudio.io/brief-requested.js"), env)).text();
  assert.ok(js.includes("gtag('config', 'AW-1234567890')"), "generated script must configure the real conversion id");
  assert.ok(js.includes("AW-1234567890/AbCdEfGhIjKlMnOpQrSt"), "generated script must send the real conversion label");

  const other = await worker.fetch(new Request("https://tinystudio.io/pricing.html"), env);
  const otherCsp = other.headers.get("Content-Security-Policy") || "";
  assert.ok(!otherCsp.includes("googletagmanager.com"), "other pages must keep the strict CSP");
});

test("worker refuses to emit a Google Ads tag for a partial or malformed conversion config", async () => {
  const malformed = [
    adsEnv({ GOOGLE_ADS_CONVERSION_LABEL: "" }),
    adsEnv({ GOOGLE_ADS_CONVERSION_ID: "AW-123" }),
    adsEnv({ GOOGLE_ADS_CONVERSION_ID: "javascript:alert(1)" })
  ];
  for (const env of malformed) {
    const res = await worker.fetch(new Request("https://tinystudio.io/brief-requested"), env);
    const body = await res.text();
    assert.ok(!body.includes("googletagmanager.com"), "no tag may emit for a partial or malformed config");
    assert.equal(body, BRIEF_REQUESTED_HTML, "unconfigured page must pass through untouched");
  }
});

class CountingFakeDB extends FakeDB {
  constructor() {
    super();
    this.counts = new Map();
  }

  prepare(sql) {
    return new CountingFakeStatement(this, sql);
  }
}

class CountingFakeStatement extends FakeStatement {
  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, values: this.values });
    if (this.sql.includes("agent_usage_limits") && this.values[0] && String(this.values[0]).startsWith("signup:")) {
      const key = this.values[0];
      const next = (this.db.counts.get(key) || 0) + 1;
      this.db.counts.set(key, next);
      return { count: next };
    }
    return { count: 1 };
  }
}

function capSignupRequest(email, website, accept = "text/html") {
  return new Request("https://tinystudio.io/api/signups", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://tinystudio.io",
      "Accept": accept,
      "User-Agent": "tinystudio-worker-test"
    },
    body: new URLSearchParams({ website, email }).toString()
  });
}

test("signup handler accepts six signups in a calendar month, then closes the intake truthfully (JSON)", async () => {
  const db = new CountingFakeDB();
  const env = { DB: db, AI: new FakeAI("") };

  for (let i = 1; i <= 6; i++) {
    const res = await worker.fetch(capSignupRequest(`cap-json-${i}@example.com`, `example-${i}.com`, "application/json"), env);
    assert.equal(res.status, 201, `signup ${i} of 6 must succeed`);
  }

  const seventh = await worker.fetch(capSignupRequest("cap-json-7@example.com", "example-7.com", "application/json"), env);
  assert.equal(seventh.status, 409, "the seventh signup in the month must be rejected");
  const body = await seventh.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "intake_closed");
  assert.match(body.message, /six appraisals for this month are taken/, "the closed signal must state the six-a-month truth");

  const buckets = [...db.counts.keys()];
  assert.equal(buckets.length, 1, "all signups in one month share one bucket");
  assert.match(buckets[0], /^signup:\d{4}-\d{2}$/, "the bucket key must be signup:YYYY-MM");
  assert.equal(db.counts.get(buckets[0]), 7, "the counter records all seven attempts so the intake stays closed");

  const signupInserts = db.calls.filter((call) => call.sql.includes("INSERT INTO email_signups"));
  assert.equal(signupInserts.length, 6, "the closed seventh signup must not be stored");
});

test("signup handler serves the truthful closed-intake page to a browser form post after six signups", async () => {
  const db = new CountingFakeDB();
  const env = { DB: db, AI: new FakeAI("") };

  for (let i = 1; i <= 6; i++) {
    const res = await worker.fetch(capSignupRequest(`cap-html-${i}@example.com`, `example-${i}.com`), env);
    assert.equal(res.status, 303, `browser signup ${i} of 6 must redirect to the thank-you page`);
    assert.equal(new URL(res.headers.get("Location")).pathname, "/brief-requested");
  }

  const seventh = await worker.fetch(capSignupRequest("cap-html-7@example.com", "example-7.com"), env);
  assert.equal(seventh.status, 409, "the seventh browser form post must not land on the thank-you page");
  const html = await seventh.text();
  assert.match(html, /The six appraisals for this month are taken/, "the closed page must state the six-a-month truth");
  assert.match(html, /intake closes until the next/, "the closed page must echo the public promise wording");
  assert.doesNotMatch(html, /request received/i, "the closed page must not impersonate the success page");

  const signupInserts = db.calls.filter((call) => call.sql.includes("INSERT INTO email_signups"));
  assert.equal(signupInserts.length, 6, "the closed seventh browser signup must not be stored");
});

test("signup handler does not consume a monthly slot for an invalid email", async () => {
  const db = new CountingFakeDB();
  const env = { DB: db, AI: new FakeAI("") };

  const invalid = await worker.fetch(capSignupRequest("not-an-email", "example.com"), env);
  assert.equal(invalid.status, 303, "invalid email still takes the existing invalid-signal redirect");
  assert.equal(new URL(invalid.headers.get("Location")).search, "?signal=invalid");

  const valid = await worker.fetch(capSignupRequest("cap-valid-1@example.com", "example.com", "application/json"), env);
  assert.equal(valid.status, 201, "a valid signup after an invalid attempt must still be accepted");

  const buckets = [...db.counts.keys()].filter((key) => key.startsWith("signup:"));
  assert.equal(buckets.length, 1, "only the valid signup created a monthly bucket");
  assert.equal(db.counts.get(buckets[0]), 1, "the invalid attempt must not consume a slot");
});

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  applyD1Migrations(sqlite);
  return {
    sqlite,
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bound) {
          values = bound;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        }
      };
      return statement;
    }
  };
}

function monthSlotsUsed(db) {
  const row = db.sqlite
    .prepare("SELECT count FROM agent_usage_limits WHERE bucket_key = ?")
    .get(`signup:${new Date().toISOString().slice(0, 7)}`);
  return Number(row?.count || 0);
}

test("signup handler counts one email once a month: repeat posts do not take another slot", async () => {
  const db = sqliteD1();
  const env = { DB: db };

  for (let i = 0; i < 3; i++) {
    const res = await worker.fetch(capSignupRequest("Repeat@Example.com", "example.com", "application/json"), env);
    assert.equal(res.status, 201, `repeat post ${i + 1} from the same email must still succeed`);
  }
  assert.equal(monthSlotsUsed(db), 1, "three posts from one email take one slot");

  for (let i = 2; i <= 6; i++) {
    const res = await worker.fetch(capSignupRequest(`dedupe-${i}@example.com`, `example-${i}.com`, "application/json"), env);
    assert.equal(res.status, 201, `distinct email ${i} of 6 must succeed`);
  }
  assert.equal(monthSlotsUsed(db), 6);

  const seventh = await worker.fetch(capSignupRequest("dedupe-7@example.com", "example-7.com", "application/json"), env);
  assert.equal(seventh.status, 409, "a seventh distinct email closes the intake");
  const seventhAgain = await worker.fetch(capSignupRequest("dedupe-7@example.com", "example-7.com", "application/json"), env);
  assert.equal(seventhAgain.status, 409, "a refused email stays refused when it posts again");

  const acceptedAgain = await worker.fetch(capSignupRequest("repeat@example.com", "example.com", "application/json"), env);
  assert.equal(acceptedAgain.status, 201, "an email already accepted this month is not turned away when it posts again");

  assert.equal(monthSlotsUsed(db), 7, "repeat posts from known emails never move the monthly counter");
  const stored = db.sqlite.prepare("SELECT email FROM email_signups ORDER BY email").all().map((row) => row.email);
  assert.equal(stored.length, 6, "only the six accepted emails are stored");
  assert.ok(!stored.includes("dedupe-7@example.com"));
});

test("signup handler retries a duplicate whose first post failed to store, within the cap", async () => {
  const db = sqliteD1();
  const env = { DB: db };
  const realPrepare = db.prepare.bind(db);
  let failNextSave = true;
  db.prepare = (sql) => {
    if (failNextSave && sql.includes("INSERT INTO email_signups")) {
      failNextSave = false;
      return { bind: () => ({ run: async () => { throw new Error("injected"); } }) };
    }
    return realPrepare(sql);
  };

  const first = await worker.fetch(capSignupRequest("retry@example.com", "example.com", "application/json"), env);
  assert.equal(first.status, 503);
  const retry = await worker.fetch(capSignupRequest("retry@example.com", "example.com", "application/json"), env);
  assert.equal(retry.status, 201, "the retry is stored");
  assert.equal(monthSlotsUsed(db), 1, "the retry does not take a second slot");
});

function originSignupRequest(headers) {
  return new Request("https://tinystudio.io/api/signups", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      ...headers
    },
    body: new URLSearchParams({ website: "example.com", email: "origin-check@example.com" }).toString()
  });
}

test("signup handler refuses a POST without a same-origin Origin or Referer, before touching storage", async () => {
  const refused = [
    {},
    { Origin: "https://evil.example" },
    { Origin: "null" },
    { Referer: "https://evil.example/page" },
    { Referer: "not a url" },
    { Origin: "https://tinystudio.io", "Sec-Fetch-Site": "cross-site" }
  ];
  for (const headers of refused) {
    const db = new FakeDB();
    const res = await worker.fetch(originSignupRequest(headers), { DB: db });
    assert.equal(res.status, 403, `headers ${JSON.stringify(headers)} must be refused`);
    assert.equal((await res.json()).error, "cross_site_blocked");
    assert.equal(db.calls.length, 0, "a refused POST must not count or store anything");
  }
});

test("signup handler accepts a same-origin Origin, or a same-origin Referer when Origin is absent", async () => {
  for (const headers of [
    { Origin: "https://tinystudio.io" },
    { Referer: "https://tinystudio.io/pricing" }
  ]) {
    const res = await worker.fetch(originSignupRequest(headers), { DB: new FakeDB() });
    assert.equal(res.status, 201, `headers ${JSON.stringify(headers)} must be accepted`);
  }
});
