import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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
  const url = new URL("../public/appraisal.js", import.meta.url);
  url.searchParams.set("testRun", crypto.randomUUID());
  await import(url.href);
  return globalThis.TinyStudioAudit;
}

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
  "https://tinystudio.io/pricing"
];

test("offer facts are mirrored by llms.txt and offer.md", () => {

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
