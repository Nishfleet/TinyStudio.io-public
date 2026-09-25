import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const SAMPLE_SECTIONS = {
  pipelineBrief: "# Pipeline Brief\n\n## Assumptions\n- **Offer**: <script>alert(1)</script>\n\nBrief body",
  implementationChecklist: "# Implementation Checklist\n\n- Checklist body",
  weeklyFixReport: "# Weekly Fix Report\n\n| Metric | Current week |\n| --- | --- |\n| Spend | INR 7,000 |\n\nWeekly body"
};

class FakeElement {
  constructor({ textContent = "", dataset = {}, disabled = false, hidden = false, value = "" } = {}) {
    this.textContent = textContent;
    this.dataset = dataset;
    this.disabled = disabled;
    this.hidden = hidden;
    this.value = value;
    this.tabIndex = 0;
    this.attributes = new Map();
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.dataset[key];
    }
    return this.attributes.get(name) ?? null;
  }

  focus() {
    globalThis.document.activeElement = this;
  }
}

class FakeForm extends FakeElement {
  constructor(values, submitButton) {
    super();
    this.values = values;
    this.submitButton = submitButton;
  }

  querySelector(selector) {
    if (selector === "button[type='submit']") return this.submitButton;
    return null;
  }
}

class FakeFormData {
  constructor(form) {
    this.form = form;
  }

  entries() {
    return Object.entries(this.form.values);
  }
}

function setupDom() {
  const submitButton = new FakeElement();
  const elements = {
    agentStatus: new FakeElement(),
    agentOutput: new FakeElement({ hidden: true }),
    outputEmpty: new FakeElement({ textContent: "empty" }),
    outputTitle: new FakeElement({ textContent: "Pipeline Brief" }),
    copyButton: new FakeElement({ disabled: true }),
    submitButton
  };

  const formValues = {
    email: "nish+ui-test@tinystudio.io",
    business: "B2B growth consultant",
    weeklySpend: "INR 7000"
  };
  elements.agentForm = new FakeForm(formValues, submitButton);

  const tabs = [
    new FakeElement({ textContent: "Brief", dataset: { outputTab: "pipelineBrief" } }),
    new FakeElement({ textContent: "Checklist", dataset: { outputTab: "implementationChecklist" } }),
    new FakeElement({ textContent: "Weekly Report", dataset: { outputTab: "weeklyFixReport" } })
  ];

  const selectorMap = new Map([
    ["[data-agent-form]", elements.agentForm],
    ["[data-agent-status]", elements.agentStatus],
    ["[data-agent-output]", elements.agentOutput],
    ["[data-output-empty]", elements.outputEmpty],
    ["[data-output-title]", elements.outputTitle],
    ["[data-copy-output]", elements.copyButton]
  ]);

  globalThis.document = {
    activeElement: null,
    querySelector(selector) {
      return selectorMap.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-output-tab]") return tabs;
      return [];
    }
  };
  globalThis.FormData = FakeFormData;

  let clipboardText = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        async writeText(text) {
          clipboardText = text;
        }
      }
    }
  });

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/agent-audit");
    const payload = JSON.parse(options.body);
    assert.equal(payload.business, "B2B growth consultant");
    assert.equal(payload.offer, undefined);
    assert.equal(payload.audience, undefined);
    assert.equal(payload.weeklySpend, "INR 7000");
    return Response.json({ ok: true, sections: SAMPLE_SECTIONS });
  };

  return {
    ...elements,
    tabs,
    clipboardText: () => clipboardText
  };
}

async function loadScript() {
  const url = new URL("../public/script.js", import.meta.url);
  url.searchParams.set("testRun", crypto.randomUUID());
  await import(url.href);
}

test("agent UI renders generated sections, switches tabs, supports keyboard tabs, and copies the active section", async () => {
  const dom = setupDom();
  await loadScript();

  await dom.agentForm.dispatch("submit", {
    preventDefault() {}
  });

  assert.equal(dom.agentStatus.textContent, "Pipeline loop generated. Review before using anything in campaigns.");
  assert.equal(dom.outputTitle.textContent, "Pipeline Brief");
  assert.match(dom.agentOutput.innerHTML, /<h3>Assumptions<\/h3>/);
  assert.match(dom.agentOutput.innerHTML, /<strong>Offer<\/strong>/);
  assert.match(dom.agentOutput.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(dom.agentOutput.innerHTML, /<script>/);
  assert.equal(dom.copyButton.disabled, false);
  assert.equal(dom.outputEmpty.hidden, true);

  await dom.tabs[1].dispatch("click");
  assert.equal(dom.outputTitle.textContent, "Implementation Checklist");
  assert.match(dom.agentOutput.innerHTML, /<ul><li>Checklist body<\/li><\/ul>/);
  assert.equal(dom.tabs[1].getAttribute("aria-selected"), "true");

  await dom.tabs[1].dispatch("keydown", {
    key: "ArrowRight",
    preventDefault() {
      this.prevented = true;
    }
  });
  assert.equal(dom.outputTitle.textContent, "Weekly Fix Report");
  assert.match(dom.agentOutput.innerHTML, /<table>/);
  assert.match(dom.agentOutput.innerHTML, /INR 7,000/);
  assert.equal(globalThis.document.activeElement, dom.tabs[2]);
  assert.equal(dom.tabs[2].tabIndex, 0);

  await dom.copyButton.dispatch("click");
  assert.equal(dom.clipboardText(), SAMPLE_SECTIONS.weeklyFixReport);
});

// ---- AI-search evidence artifact ---------------------------------------

const AI_QUESTIONS = JSON.parse(
  readFileSync(new URL("../evidence-fixtures/ai-search/controlled-questions.json", import.meta.url), "utf8")
);
const AI_EVIDENCE = JSON.parse(
  readFileSync(new URL("../evidence-fixtures/ai-search/evidence.json", import.meta.url), "utf8")
);

function auditDocumentStub({ mount = null, source = null } = {}) {
  return {
    readyState: "complete",
    querySelector(selector) {
      return selector === "[data-ai-search-evidence]" ? mount : null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById(id) {
      return id === "ai-search-evidence" ? source : null;
    }
  };
}

async function loadAuditScript() {
  const url = new URL("../public/audit.js", import.meta.url);
  url.searchParams.set("testRun", crypto.randomUUID());
  await import(url.href);
  return globalThis.TinyStudioAudit;
}

test("AI-search fixture runs carry the right structure for their states", () => {
  const states = [...new Set(AI_EVIDENCE.runs.map((run) => run.state))].sort();
  assert.deepEqual(states, ["absent", "found", "not-tested", "wrong"]);

  const questionIds = new Set(AI_QUESTIONS.questions.map((question) => question.id));
  const engineIds = new Set(AI_EVIDENCE.engines.map((engine) => engine.id));

  for (const run of AI_EVIDENCE.runs) {
    assert.ok(questionIds.has(run.questionId), `known question for ${run.questionId}/${run.engine}`);
    assert.ok(engineIds.has(run.engine), `known engine for ${run.questionId}/${run.engine}`);
    assert.ok(run.testedAt, `testedAt recorded for ${run.questionId}/${run.engine}`);
    if (run.state === "not-tested") {
      assert.ok(run.reason, `not-tested reason for ${run.questionId}/${run.engine}`);
      assert.equal(run.captured, undefined, `not-tested must not capture an answer for ${run.questionId}/${run.engine}`);
      assert.deepEqual(run.sources || [], [], `not-tested must not cite sources for ${run.questionId}/${run.engine}`);
    } else {
      assert.ok(run.captured, `captured observation for ${run.questionId}/${run.engine}`);
      if (run.state !== "absent") {
        assert.ok(run.sources.length, `cited sources for ${run.questionId}/${run.engine}`);
      } else {
        assert.deepEqual(run.sources || [], [], `absent must not cite sources for ${run.questionId}/${run.engine}`);
      }
    }
  }

  for (const question of AI_QUESTIONS.questions) {
    assert.ok(question.id && question.name && question.prompt && question.truth, `named question ${question.id}`);
  }
});

test("AI-search q5 found run cites the tested business and claims no page-specific fix", () => {
  const run = AI_EVIDENCE.runs.find(
    (candidate) => candidate.questionId === "q5-what-is-tinystudio-io" && candidate.engine === "google"
  );
  assert.ok(run, "google/q5 run exists");
  assert.equal(run.state, "found");
  assert.ok(run.remediation, "q5 carries a remediation note");
  assert.equal(run.remediation.page, undefined, "q5 must not claim a page-specific fix");
  assert.ok(run.sources.some((source) => source.url.startsWith("https://tinystudio.io")), "q5 cites the tested business's site");
  assert.match(run.captured, /free website "leak audits" for high-ticket service homepages/);
});

test("AI-search renderer shows all four states and keeps not-tested distinct from absent", async () => {
  globalThis.document = auditDocumentStub();
  const api = await loadAuditScript();
  const data = {
    questions: { questions: [{ id: "q1", name: "Q", prompt: "p", truth: "t" }] },
    evidence: {
      testedOn: "2026-08-06",
      business: { name: "B", site: "https://tinystudio.io/" },
      engines: [{ id: "e1", name: "E" }],
      runs: [
        { questionId: "q1", engine: "e1", state: "found", captured: "x", sources: [{ title: "me", url: "https://tinystudio.io/" }] },
        { questionId: "q1", engine: "e1", state: "wrong", captured: "y", sources: [{ title: "other", url: "https://other.example/" }] },
        { questionId: "q1", engine: "e1", state: "absent", captured: "no AI answer came back" },
        { questionId: "q1", engine: "e1", state: "not-tested", reason: "sign-in required" }
      ]
    }
  };
  const html = api.renderArtifact(data);

  for (const state of ["found", "wrong", "absent", "not-tested"]) {
    assert.match(html, new RegExp(`data-state="${state}"`), `rendered state ${state}`);
  }
  assert.match(html, />Found</);
  assert.match(html, />Wrong</);
  assert.match(html, />Absent</);
  assert.match(html, />Not tested</);
  assert.match(html, /The questions, exactly as asked/);

  const chunks = html.split('<div class="row"').slice(1);
  assert.equal(chunks.length, 4, "all four states render as rows");
  for (const chunk of chunks) {
    const state = chunk.match(/data-state="([^"]+)"/)?.[1];
    assert.ok(state, "every row carries a state");
    if (state === "not-tested") {
      assert.match(chunk, /Not run &mdash;/);
      assert.doesNotMatch(chunk, /Answer \(verbatim\)|Sources:/);
    } else if (state === "absent") {
      assert.match(chunk, /Observed:/);
      assert.doesNotMatch(chunk, /Not run/);
    } else {
      assert.match(chunk, /Answer \(verbatim\):/);
      assert.match(chunk, /Sources:/);
    }
  }
});

test("AI-search renderer escapes hostile text and only links safe http(s) URLs", async () => {
  globalThis.document = auditDocumentStub();
  const api = await loadAuditScript();
  const hostile = {
    questions: {
      questions: [{ id: "q1", name: "<script>steal()</script>", prompt: 'p"rompt', truth: "t" }]
    },
    evidence: {
      testedOn: "2026-08-06",
      business: { name: "<b>X</b>", site: "https://tinystudio.io/" },
      engines: [{ id: "e1", name: "Engine", surface: "Web" }],
      runs: [
        {
          questionId: "q1",
          engine: "e1",
          state: "found",
          captured: '<script>alert(1)</script> & "quoted"',
          sources: [
            { title: "<i>bad</i>", url: "javascript:alert(1)" },
            { title: "https://example.com/", url: "https://example.com/path" },
            { title: "spaced", url: "https://exa mple.com/" }
          ]
        },
        {
          questionId: "q1",
          engine: "e1",
          state: "not-tested",
          reason: "because <script> was blocked"
        }
      ]
    }
  };

  const html = api.renderArtifact(hostile);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<i>bad|javascript:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;i&gt;bad&lt;\/i&gt;/);
  assert.match(html, /href="https:\/\/example.com\/path"/);
  assert.doesNotMatch(html, /href="https:\/\/exa mple/);
});

test("AI-search renderer shows remediation only when evidence supports it", async () => {
  globalThis.document = auditDocumentStub();
  const api = await loadAuditScript();
  const base = {
    questions: { questions: [{ id: "q1", name: "Q", prompt: "p", truth: "t" }] },
    evidence: {
      testedOn: "2026-08-06",
      business: { name: "B", site: "https://tinystudio.io/" },
      engines: [{ id: "e1", name: "E" }],
      runs: []
    }
  };

  const withoutRemediation = {
    ...base,
    evidence: {
      ...base.evidence,
      runs: [{ questionId: "q1", engine: "e1", state: "absent", captured: "nothing came back" }]
    }
  };
  assert.doesNotMatch(api.renderArtifact(withoutRemediation), /Remediation:/);

  const externalOnly = {
    ...base,
    evidence: {
      ...base.evidence,
      runs: [
        {
          questionId: "q1",
          engine: "e1",
          state: "wrong",
          captured: "x",
          sources: [{ title: "other", url: "https://other.example/" }],
          remediation: { page: "/", text: "fix it" }
        }
      ]
    }
  };
  const externalHtml = api.renderArtifact(externalOnly);
  assert.match(externalHtml, /Remediation: fix it/);
  assert.doesNotMatch(externalHtml, /href="https:\/\/tinystudio\.io\/"/);

  const ownSite = {
    ...base,
    evidence: {
      ...base.evidence,
      runs: [
        {
          questionId: "q1",
          engine: "e1",
          state: "found",
          captured: "x",
          sources: [{ title: "me", url: "https://tinystudio.io/" }],
          remediation: { page: "/pricing.html", text: "fix it" }
        }
      ]
    }
  };
  assert.match(api.renderArtifact(ownSite), /href="https:\/\/tinystudio\.io\/pricing\.html"/);
});

test("AI-search renderer boots from the JSON embedded on the audit page", async () => {
  const mount = { innerHTML: "" };
  const source = { textContent: JSON.stringify({ questions: AI_QUESTIONS, evidence: AI_EVIDENCE }) };
  globalThis.document = auditDocumentStub({ mount, source });
  const api = await loadAuditScript();
  assert.ok(api, "audit script exposes the renderer");
  assert.match(mount.innerHTML, /data-state="wrong"/);
  assert.match(mount.innerHTML, /data-state="not-tested"/);
});

test("AI-search remediation links resolve defensively and reject cross-host or invalid pages", async () => {
  globalThis.document = auditDocumentStub();
  const api = await loadAuditScript();
  const base = {
    questions: { questions: [{ id: "q1", name: "Q", prompt: "p", truth: "t" }] },
    evidence: {
      testedOn: "2026-08-06",
      business: { name: "B", site: "https://tinystudio.io/" },
      engines: [{ id: "e1", name: "E" }],
      runs: []
    }
  };

  const noBusiness = {
    ...base,
    evidence: {
      ...base.evidence,
      business: undefined,
      runs: [
        {
          questionId: "q1",
          engine: "e1",
          state: "wrong",
          captured: "x",
          sources: [{ title: "me", url: "https://tinystudio.io/" }],
          remediation: { page: "/pricing.html", text: "fix it" }
        }
      ]
    }
  };
  const noBusinessHtml = api.renderArtifact(noBusiness);
  assert.match(noBusinessHtml, /Remediation: fix it/);
  assert.doesNotMatch(noBusinessHtml, /href="https:\/\/tinystudio\.io\/pricing\.html"/);

  const crossHost = {
    ...base,
    evidence: {
      ...base.evidence,
      runs: [
        {
          questionId: "q1",
          engine: "e1",
          state: "found",
          captured: "x",
          sources: [{ title: "me", url: "https://tinystudio.io/" }],
          remediation: { page: "https://evil.example/pricing.html", text: "fix it" }
        }
      ]
    }
  };
  const crossHostHtml = api.renderArtifact(crossHost);
  assert.match(crossHostHtml, /Remediation: fix it/);
  assert.doesNotMatch(crossHostHtml, /href="https:\/\/evil\.example/);

  const invalid = {
    ...base,
    evidence: {
      ...base.evidence,
      runs: [
        {
          questionId: "q1",
          engine: "e1",
          state: "found",
          captured: "x",
          sources: [{ title: "me", url: "https://tinystudio.io/" }],
          remediation: { page: "javascript:alert(1)", text: "fix it" }
        }
      ]
    }
  };
  const invalidHtml = api.renderArtifact(invalid);
  assert.match(invalidHtml, /Remediation: fix it/);
  assert.doesNotMatch(invalidHtml, /javascript:/);
});

// ---- Candidate 2: identity tie, offer mirror, source-host validation --------

const HOME_HTML = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const AUDIT_HTML = readFileSync(new URL("../public/audit.html", import.meta.url), "utf8");
const LLMS_TXT = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
const OFFER_MD = readFileSync(new URL("../public/offer.md", import.meta.url), "utf8");

const OFFER_FACTS = [
  "The Website Appraisal",
  "free leak audit of high-ticket service homepages",
  "human-reviewed desk",
  "clinics, surgeons, dentists, spas",
  "clients are never named",
  "not autonomous software",
  "There are no revenue, ranking, ROAS, conversion, booked-call, or sales-volume guarantees",
  "Client-side code does not call model providers",
  "No campaign publishing",
  "No ad spend changes",
  "https://tinystudio.io/pricing"
];

test("homepage disambiguation block answers every controlled question", () => {
  const section = HOME_HTML.match(/<section[^>]*id="identity"[\s\S]*?<\/section>/i)?.[0] ?? "";
  assert.ok(section, "homepage carries the identity section");
  assert.match(section, /data-ai-identity/);
  const refs = new Set(
    [...section.matchAll(/\bdata-ai-question="([^"]+)"/gi)]
      .flatMap((match) => match[1].trim().split(/\s+/))
      .filter(Boolean)
  );
  for (const question of AI_QUESTIONS.questions) {
    assert.ok(refs.has(question.id), `homepage answers the controlled question ${question.id}`);
  }
  for (const ref of refs) {
    assert.ok(
      AI_QUESTIONS.questions.some((question) => question.id === ref),
      `homepage references a known question id: ${ref}`
    );
  }
});

test("every owned identity surface states the human-reviewed outcome", () => {
  for (const [name, text] of [
    ["homepage", HOME_HTML],
    ["audit page", AUDIT_HTML],
    ["llms.txt", LLMS_TXT],
    ["offer.md", OFFER_MD]
  ]) {
    assert.match(text, /human-reviewed/, `${name} must state the human-reviewed outcome`);
  }
});

const IDENTITY_MIRROR_FACTS = [
  "Mac subtitle app",
  "fibre-arts magazine",
  "design agency",
  "video production studio",
  "Los Angeles venue",
  "unrelated studio LLC",
  "states no base city or office address",
  "run by Nish"
];

test("identity disambiguation facts are mirrored by llms.txt and offer.md", () => {
  // The engines' wrong answers (evidence.json) were built from exactly these
  // same-name businesses, so the disambiguation list must live in both files
  // of the machine-readable pair, and the pair must link each other.
  for (const fact of IDENTITY_MIRROR_FACTS) {
    assert.ok(LLMS_TXT.toLowerCase().includes(fact.toLowerCase()), `llms.txt must state: ${fact}`);
    assert.ok(OFFER_MD.toLowerCase().includes(fact.toLowerCase()), `offer.md must state: ${fact}`);
  }
  assert.match(LLMS_TXT, /^## Identity$/m, "llms.txt must carry the machine-readable Identity section");
  assert.ok(LLMS_TXT.includes("https://tinystudio.io/offer.md"), "llms.txt must link offer.md as its mirror");
  assert.ok(OFFER_MD.includes("https://tinystudio.io/llms.txt"), "offer.md must link llms.txt as its mirror");
  assert.ok(LLMS_TXT.includes("https://tinystudio.io/audit"), "llms.txt must point at the audit page's evidence artifact");
});

test("every controlled question maps to a preferred source page, mirrored by llms.txt and offer.md", () => {
  // Dogfood finding 4473a99a9bc9 ("AI Answer Readiness: preferred source
  // pages are unclear"): an engine that cited tinystudio.io described the
  // retired Agent Desk, and the pricing answer came back "Missing: pricing".
  // The machine-readable pair must declare, per controlled question, the
  // preferred source page an engine should read first — exactly one served
  // page per question, the clean /pricing for price questions, and the same
  // mapping in both files.
  const ANSWER_READINESS_HEADING = "## Answer Readiness: Preferred Source Pages";
  for (const [name, text] of [
    ["llms.txt", LLMS_TXT],
    ["offer.md", OFFER_MD]
  ]) {
    assert.ok(text.includes(ANSWER_READINESS_HEADING), `${name} must carry the Answer Readiness section`);
  }
  const sectionOf = (content) => {
    const start = content.indexOf(ANSWER_READINESS_HEADING);
    const after = content.slice(start + ANSWER_READINESS_HEADING.length);
    const end = after.search(/\n## /);
    return end === -1 ? after : after.slice(0, end);
  };
  const servedPages = [
    "https://tinystudio.io/",
    "https://tinystudio.io/audit",
    "https://tinystudio.io/agents",
    "https://tinystudio.io/pricing",
    "https://tinystudio.io/specimen"
  ];
  const llmsSection = sectionOf(LLMS_TXT);
  const offerSection = sectionOf(OFFER_MD);
  for (const question of AI_QUESTIONS.questions) {
    const llmsLine = llmsSection.split("\n").find((line) => line.includes(question.id));
    assert.ok(llmsLine, `llms.txt must map the controlled question to a preferred source page: ${question.id}`);
    const urls = [...(llmsLine ?? "").matchAll(/https:\/\/tinystudio\.io\/[^\s]*/g)].map((match) => match[0]);
    assert.equal(urls.length, 1, `preferred source mapping must name exactly one page: ${question.id}`);
    const preferred = urls[0];
    assert.ok(servedPages.includes(preferred), `preferred source page must be a served page: ${question.id}`);
    const isPriceQuestion =
      question.id === "q2-what-tinystudio-charges" || question.id === "q7-what-tinystudio-io-charges";
    if (isPriceQuestion) {
      assert.equal(preferred, "https://tinystudio.io/pricing", `price question ${question.id} must map to the clean /pricing`);
    }
    const offerLine = offerSection.split("\n").find((line) => line.includes(question.id));
    assert.ok(offerLine?.includes(preferred), `offer.md must mirror the preferred source page for ${question.id}`);
  }
});

test("offer facts are mirrored by llms.txt and offer.md", () => {
  // Whitespace- and case-insensitive, matching the check-site guard: one file
  // may head a fact while the other embeds it mid-sentence, and llms.txt
  // wraps its prose across lines.
  const normalized = (text) => text.toLowerCase().replace(/\s+/g, " ");
  for (const fact of OFFER_FACTS) {
    assert.ok(normalized(LLMS_TXT).includes(normalized(fact)), `llms.txt must state: ${fact}`);
    assert.ok(normalized(OFFER_MD).includes(normalized(fact)), `offer.md must state: ${fact}`);
  }

  assert.match(LLMS_TXT, /^## Data Handling$/m, "llms.txt must carry a Data Handling section");
  assert.match(OFFER_MD, /^## Data Handling$/m, "offer.md must carry a Data Handling section");

  const DATA_HANDLING_FACTS = [
    "The public app stores email signup and lightweight usage metadata in Cloudflare D1, including daily rate-limit counters and a daily IP-derived rate-limit key.",
    "Submitted business context is processed to generate output and is not stored by this app.",
    "There is no public endpoint for reading collected emails or usage metadata."
  ];
  for (const fact of DATA_HANDLING_FACTS) {
    assert.ok(normalized(LLMS_TXT).includes(normalized(fact)), `llms.txt must state: ${fact}`);
    assert.ok(normalized(OFFER_MD).includes(normalized(fact)), `offer.md must state: ${fact}`);
  }
});

test("llms.txt and offer.md point at the clean /pricing and never restate price or refund terms", () => {
  // The pricing page owns price, refund and guarantee terms; the machine-
  // readable pair points at its clean /pricing address instead of restating
  // dollar amounts, refund language, or the retired Website Correction /
  // founder-pilot framing.
  for (const [name, text] of [
    ["llms.txt", LLMS_TXT],
    ["offer.md", OFFER_MD]
  ]) {
    assert.ok(text.includes("https://tinystudio.io/pricing"), `${name} must point at the clean /pricing`);
    assert.doesNotMatch(text, /\$\s?\d/, `${name} must not restate a dollar amount`);
    assert.doesNotMatch(text, /\brefund\w*\b/i, `${name} must not restate refund terms`);
    assert.doesNotMatch(text, /Website Correction/i, `${name} must not revive the retired offer framing`);
    assert.doesNotMatch(text, /founder[- ]?pilot/i, `${name} must not revive the founder-pilot pricing`);
    assert.doesNotMatch(text, /Managed IT, MSP/i, `${name} must not revive the MSP-only buyer framing`);
  }
});

test("every cited source has a title and a valid absolute http(s) URL, unique within its run", () => {
  for (const run of AI_EVIDENCE.runs) {
    const citedUrls = new Set();
    for (const source of run.sources || []) {
      assert.ok(source.title && String(source.title).trim(), `source title for ${run.questionId}/${run.engine}`);
      assert.ok(!citedUrls.has(source.url), `source URL unique within run (${run.questionId}/${run.engine}): ${source.url}`);
      citedUrls.add(source.url);
      assert.doesNotMatch(source.url, /\s/, `source URL must not contain whitespace (${run.questionId}/${run.engine})`);
      let parsed;
      assert.doesNotThrow(() => {
        parsed = new URL(source.url);
      }, `source URL must parse (${run.questionId}/${run.engine})`);
      assert.match(parsed.protocol, /^https?:$/, `source URL must be http(s) (${run.questionId}/${run.engine})`);
      assert.ok(parsed.hostname.includes("."), `source URL host must be a real hostname (${run.questionId}/${run.engine})`);
    }
  }
});

test("found runs must cite the tested business's own site", () => {
  const siteHost = new URL(AI_EVIDENCE.business.site).hostname;
  for (const run of AI_EVIDENCE.runs) {
    if (run.state !== "found") continue;
    const citesOwnSite = (run.sources || []).some((source) => {
      try {
        return new URL(source.url).hostname === siteHost;
      } catch {
        return false;
      }
    });
    assert.ok(citesOwnSite, `found run must cite the site: ${run.questionId}/${run.engine}`);
  }
});
