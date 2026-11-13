import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const llms = read("public/llms.txt");
const offer = read("public/offer.md");
const sitemap = read("public/sitemap.xml");
const worker = read("src/worker.js");
const wranglerConfig = JSON.parse(read("wrangler.jsonc"));

const failures = [];

const requiredPublicArtifacts = [
  "The Website Appraisal",
  "free leak audit of high-ticket service homepages",
  "human-reviewed desk",
  "clinics, surgeons, dentists, spas",
  "clients are never named",
  "not autonomous software",
  "No call at any point.",
  "There are no revenue, ranking, ROAS, conversion, booked-call, or sales-volume guarantees",
  "https://tinystudio.io/pricing",
  "Six appraisals a month, done by hand. When the sixth is taken, the intake closes until the next."
];

const forbiddenClaims = [
  "guaranteed revenue",
  "guaranteed ROAS",
  "guaranteed booked calls",
  "guaranteed calls",
  "guaranteed rankings",
  "guaranteed sales",
  "guaranteed profit",
  "10x revenue",
  "10x sales",
  "rank #1",
  "rank number one",
  "fully autonomous ad buying",
  "autonomously publish",
  "change ad spend for you",
  "30% booking rate",
  "80% show-up rate",
  "10%-18% close rate"
];

if (worker.includes("checks.ai && checks.db")) {
  failures.push("Worker /health verdict must not gate on the retired Agent Desk AI binding");
}

for (const text of requiredPublicArtifacts) {

  const normalized = (content) => content.toLowerCase().replace(/\s+/g, " ");
  const needle = normalized(text);
  if (!normalized(llms).includes(needle)) failures.push(`Missing offer fact in llms.txt: ${text}`);
  if (!normalized(offer).includes(needle)) failures.push(`Missing offer fact in offer.md: ${text}`);
}

const siteHome = read("public/index.html");
const siteAudit = read("public/appraisal.html");

const VALID_WEBSITES = ["example.com", "www.example.com", "https://example.com", "example.com/page", "https://example.com/"];
const INVALID_WEBSITES = ["example", "not a domain", "example..com", "example.com/with space", "https://"];

function websiteField(html) {
  return html.match(/<input\b[^>]*name="website"[^>]*>/i)?.[0] || "";
}

for (const [pageName, pageHtml] of [["homepage", siteHome], ["audit page", siteAudit]]) {
  const field = websiteField(pageHtml);
  if (!field) {
    failures.push(`Signup form on ${pageName} must keep a website input.`);
    continue;
  }
  if (/\btype="url"/i.test(field)) {
    failures.push(`Signup website field on ${pageName} must not use type="url" (rejects bare domains like example.com).`);
  }
  if (!/\srequired(?:\s|>|=)/i.test(field)) {
    failures.push(`Signup website field on ${pageName} must stay required.`);
  }
  const pattern = field.match(/\bpattern="([^"]+)"/i)?.[1];
  if (!pattern) {
    failures.push(`Signup website field on ${pageName} must carry a domain pattern.`);
    continue;
  }
  const compiled = new RegExp(`^(?:${pattern})$`, "i");
  for (const value of VALID_WEBSITES) {
    if (!compiled.test(value)) failures.push(`Signup website pattern on ${pageName} must accept ${value}.`);
  }
  for (const value of INVALID_WEBSITES) {
    if (compiled.test(value)) failures.push(`Signup website pattern on ${pageName} must reject ${JSON.stringify(value)}.`);
  }
}

const sitePricing = read("public/pricing.html");
const pricingBand = sitePricing.match(/<div class="band">([\s\S]*?)<\/div>\s*<section id="confidential">/)?.[1] ?? "";
const pricingForm = pricingBand.match(/<form\b[^>]*class="lead[^>]*"[^>]*>[\s\S]*?<\/form>/i)?.[0] ?? "";

if (!pricingForm || !pricingForm.includes('action="/api/signups"') || !pricingForm.includes('method="post"')) {
  failures.push("Pricing closing callout must carry the real signup form (form.lead posting website + email to /api/signups) so the appraisal ask is actionable in place.");
}
for (const input of pricingForm.matchAll(/<input\b[^>]*>/gi)) {
  const tag = input[0];
  if (!/\bname="(?:website|email)"/.test(tag)) continue;
  const aria = tag.match(/\baria-label="([^"]*)"/)?.[1] ?? "";
  if (!aria.trim()) {
    failures.push(`Pricing intake input must carry a persistent programmatic aria-label (placeholder-only labels disappear as buyers type): ${tag}`);
  }
}
const currentClaimPages = [
  siteHome,
  siteAudit,
  read("public/pricing.html"),
  read("public/specimen.html"),
  read("public/waitlist.html")
];

for (const claim of forbiddenClaims) {
  const haystack = [...currentClaimPages, llms, offer].join("\n").toLowerCase();
  if (haystack.includes(claim.toLowerCase())) {
    failures.push(`Forbidden claim found: ${claim}`);
  }
}

for (const database of wranglerConfig.d1_databases || []) {
  if (database.preview_database_id === database.database_id) {
    failures.push("D1 preview database must not point at the production database.");
  }
}

const fontPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["waitlist page", read("public/waitlist.html")],
  ["brief-requested page", read("public/brief-requested.html")]
];
for (const [pageName, pageHtml] of fontPages) {
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(pageHtml)) {
    failures.push(`${pageName} must not load fonts from Google (third-party chain delays LCP).`);
  }
  if (/rel="preload"[^>]*as="font"/.test(pageHtml)) {
    failures.push(`${pageName} must not preload fonts: with font-display: optional a preload lands the font inside the block period and puts it back in the LCP path.`);
  }
}
if (existsSync(new URL("../public/fonts.js", import.meta.url))) {
  failures.push("public/fonts.js (Google Fonts promotion) must not return.");
}
const fontsCss = read("public/fonts.css");
if (/url\(\s*['"]?https?:/i.test(fontsCss)) {
  failures.push("fonts.css must be same-origin, font-display: optional, with size-adjust fallback faces.");
}
const adsHtml = read("public/brief-requested.html");
const adsScript = read("public/brief-requested.js");
for (const placeholder of ["AW-XXXXXXXXX", "YYYYYYYYYYYYYYYYYYY"]) {
  for (const [label, content] of [
    ["public/brief-requested.html", adsHtml],
    ["public/brief-requested.js", adsScript],
    ["src/worker.js", worker]
  ]) {
    if (content.includes(placeholder)) {
      failures.push(`Google Ads placeholder must never ship (dead conversion): ${placeholder} in ${label}.`);
    }
  }
}
if (adsHtml.includes("googletagmanager.com")) {
  failures.push("public/brief-requested.html must not hardcode the Google Ads tag; the worker injects it from env at request time.");
}
if (adsScript.includes("gtag(") || adsScript.includes("dataLayer")) {
  failures.push("public/brief-requested.js must not fire a conversion statically; the worker generates it from env when configured.");
}
if (existsSync(new URL("../public/pipeline-sprint/index.html", import.meta.url))) {
  failures.push("Pipeline Sprint page should not remain as a separate stale public asset.");
}

const AI_STATES = ["found", "wrong", "absent", "not-tested"];
let aiQuestions = null;
let aiEvidence = null;
const aiFixturePath = "evidence-fixtures/ai-search/controlled-questions.json";
const aiEvidencePath = "evidence-fixtures/ai-search/evidence.json";
if (existsSync(aiFixturePath) && existsSync(aiEvidencePath)) {
  try {
    aiQuestions = JSON.parse(read(aiFixturePath));
    aiEvidence = JSON.parse(read(aiEvidencePath));
  } catch (error) {
    failures.push(`AI-search fixture must be valid JSON: ${error.message}`);
  }
}

if (aiQuestions && aiEvidence) {
  for (const fixture of ["evidence-fixtures/ai-search/controlled-questions.json", "evidence-fixtures/ai-search/evidence.json", "evidence-fixtures/ai-search/README.md"]) {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", fixture], {
        cwd: new URL("..", import.meta.url),
        stdio: "ignore"
      });
    } catch {
      failures.push(`AI-search fixture must be tracked by git: ${fixture}`);
    }
  }

  const bundleMatch = siteAudit.match(/<script type="application\/json" id="ai-search-evidence">([\s\S]*?)<\/script>/);
  if (!bundleMatch) {
    failures.push("Audit page must embed the AI-search evidence bundle.");
  } else {
    let embedded = null;
    try {
      embedded = JSON.parse(bundleMatch[1]);
    } catch {
      failures.push("Audit page AI-search bundle must be valid JSON.");
    }
    if (embedded) {
      const expected = { questions: aiQuestions, evidence: aiEvidence };
      if (JSON.stringify(embedded) !== JSON.stringify(expected)) {
        failures.push("Audit page AI-search bundle must match evidence-fixtures/ai-search/ (regenerate the embed).");
      }
    }
  }

  const questions = aiQuestions.questions || [];
  const questionIds = new Set();
  for (const question of questions) {
    for (const field of ["id", "name", "prompt", "truth"]) {
      if (typeof question[field] !== "string" || !question[field]) {
        failures.push(`AI-search question must carry ${field}: ${JSON.stringify(question.id || question)}`);
      }
    }
    if (questionIds.has(question.id)) failures.push(`AI-search question id must be unique: ${question.id}`);
    questionIds.add(question.id);
  }
  if (!questions.length) failures.push("AI-search fixture must name at least one controlled question.");

  const engines = new Map((aiEvidence.engines || []).map((engine) => [engine.id, engine]));
  for (const engine of aiEvidence.engines || []) {
    if (!engine.id || !engine.name) failures.push("AI-search engine entries must carry id and name.");
  }

  const runs = aiEvidence.runs || [];
  if (!runs.length) failures.push("AI-search fixture must carry at least one captured run.");
  for (const run of runs) {
    if (!AI_STATES.includes(run.state)) failures.push(`AI-search run has an unknown state: ${run.state}`);
    if (!questionIds.has(run.questionId)) failures.push(`AI-search run references an unknown question: ${run.questionId}`);
    if (!engines.has(run.engine)) failures.push(`AI-search run references an unknown engine: ${run.engine}`);
    if (!run.testedAt) failures.push(`AI-search run must record when it was tested: ${run.questionId}/${run.engine}`);
    if (run.state === "not-tested") {
      if (!run.reason) failures.push(`not-tested run must state a reason: ${run.questionId}/${run.engine}`);
      if (run.captured || (run.sources || []).length) {
        failures.push(`not-tested run must not carry an answer or sources: ${run.questionId}/${run.engine}`);
      }
    } else {
      if (!run.captured) failures.push(`run must capture what was observed: ${run.questionId}/${run.engine}`);
      if (run.state !== "absent" && !(run.sources || []).length) {
        failures.push(`run must cite its sources: ${run.questionId}/${run.engine}`);
      }
      if (run.state === "absent" && (run.sources || []).length) {
        failures.push(`absent run must not carry sources: ${run.questionId}/${run.engine}`);
      }
    }
    if (run.remediation && run.remediation.page) {
      let siteHost = "";
      try {
        siteHost = new URL(aiEvidence.business.site).hostname;
      } catch {
        failures.push("AI-search business site must be a valid URL.");
      }
      const sameDomain = (run.sources || []).some((source) => {
        try {
          return new URL(source.url).hostname === siteHost;
        } catch {
          return false;
        }
      });
      if (siteHost && !sameDomain) {
        failures.push(`page-specific remediation needs same-domain evidence: ${run.questionId}/${run.engine}`);
      }
    }
  }

  for (const run of runs) {
    const citedUrls = new Set();
    for (const source of run.sources || []) {
      if (typeof source.title !== "string" || !source.title.trim()) {
        failures.push(`AI-search source must carry a title: ${run.questionId}/${run.engine} ${JSON.stringify(source.url)}`);
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(source.url);
      } catch {
        parsedUrl = null;
      }
      if (!parsedUrl || !/^https?:$/.test(parsedUrl.protocol) || !parsedUrl.hostname || !parsedUrl.hostname.includes(".") || /\s/.test(source.url)) {
        failures.push(`AI-search source URL must be a valid absolute http(s) URL: ${run.questionId}/${run.engine} ${JSON.stringify(source.url)}`);
      }
      if (citedUrls.has(source.url)) {
        failures.push(`AI-search source URLs must be unique within a run: ${run.questionId}/${run.engine} ${JSON.stringify(source.url)}`);
      }
      citedUrls.add(source.url);
    }
  }

  for (const run of runs) {
    for (const source of run.sources || []) {
      let parsedUrl;
      try {
        parsedUrl = new URL(source.url);
      } catch {
        parsedUrl = null;
      }
      if (!parsedUrl) continue;
      const host = parsedUrl.hostname.replace(/^www\./, "");
      if (host === "apps.apple.com" || host === "itunes.apple.com") {
        const path = parsedUrl.pathname;
        const carriesAppId = /^\/app\/\d+/.test(path) || /\/id\d+/.test(path);
        if (!carriesAppId) {
          failures.push(`AI-search source URL is a dead App Store form (must carry an app id): ${run.questionId}/${run.engine} ${JSON.stringify(source.url)}`);
        }
      }
    }
  }

  let businessHost = "";
  try {
    businessHost = new URL(aiEvidence.business.site).hostname;
  } catch {
    failures.push("AI-search business site must be a valid URL.");
  }
  if (businessHost) {
    for (const run of runs) {
      if (run.state === "found") {
        const citesOwnSite = (run.sources || []).some((source) => {
          try {
            return new URL(source.url).hostname === businessHost;
          } catch {
            return false;
          }
        });
        if (!citesOwnSite) {
          failures.push(`found run must cite the tested business's own site: ${run.questionId}/${run.engine}`);
        }
      }
    }
  }

  const homepageIdentitySection = siteHome.match(/<section[^>]*id="identity"[\s\S]*?<\/section>/i)?.[0] || "";
  const referencedQuestionIds = [...homepageIdentitySection.matchAll(/\bdata-ai-question="([^"]+)"/gi)]
    .flatMap((match) => match[1].trim().split(/\s+/))
    .filter(Boolean);
  const referencedSet = new Set(referencedQuestionIds);
  if (!homepageIdentitySection.includes("data-ai-identity")) {
    failures.push("Homepage disambiguation block must carry data-ai-identity.");
  }
  for (const question of questions) {
    if (!referencedSet.has(question.id)) {
      failures.push(`Homepage disambiguation block must answer the controlled question: ${question.id}`);
    }
  }
  for (const ref of referencedSet) {
    if (!questionIds.has(ref)) {
      failures.push(`Homepage disambiguation block references an unknown question id: ${ref}`);
    }
  }

  const fixtureText = JSON.stringify(aiQuestions) + "\n" + JSON.stringify(aiEvidence);
  if (/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(fixtureText)) {
    failures.push("AI-search fixture must not capture email addresses.");
  }
  if (/\+\d[\d\s()-]{6,}\d/.test(fixtureText)) {
    failures.push("AI-search fixture must not capture phone numbers.");
  }
  if (/\b(password|credential|api[_-]?key|secret token|client brief|customer brief)\b/i.test(fixtureText)) {
    failures.push("AI-search fixture must not capture credentials or customer briefs.");
  }

  const aiSection = siteAudit.match(/<section id="ai-search">[\s\S]*?<\/section>/i)?.[0] || "";
  const artifactCopy = aiSection.replace(/<script[\s\S]*?<\/script>/, "");
  const promisePatterns = [
    /\bguarantee\w*\b/i,
    /\bautonomous\b/i,
    /\bpublish\w*\b/i,
    /\bwill\s+(rank|publish|deliver|generate)\b/i,
    /\brank\s*(#\s*\d|number\s+one|first)\b/i
  ];
  for (const pattern of promisePatterns) {
    if (pattern.test(artifactCopy)) failures.push(`Forbidden claim in AI-search artifact copy: ${pattern}`);
  }

  const narrativeFields = [];
  questions.forEach((question) => narrativeFields.push(question.truth));
  runs.forEach((run) => {
    if (run.remediation) narrativeFields.push(run.remediation.text);
    if (run.reason) narrativeFields.push(run.reason);
  });
  (aiEvidence.engines || []).forEach((engine) => narrativeFields.push(engine.note));
  narrativeFields.push(aiEvidence.business?.note || "");
  const narrativeText = narrativeFields.filter(Boolean).join("\n");
  for (const pattern of [
    /\bguarantee\w*\b/i,
    /\bautonomous\b/i,
    /\bwill\s+(rank|publish|deliver|generate)\b/i,
    /\brank\s*(#\s*\d|number\s+one|first)\b/i
  ]) {
    if (pattern.test(narrativeText)) failures.push(`Forbidden claim in AI-search fixture narrative: ${pattern}`);
  }
}

const ANSWER_READINESS_HEADING = "## Answer Readiness: Preferred Source Pages";

const servedPageUrls = new Set(
  [...sitemap.matchAll(/<loc>(https:\/\/tinystudio\.io\/[^<]*)<\/loc>/g)]
    .map((match) => match[1])
    .filter((url) => url !== "https://tinystudio.io/llms.txt" && url !== "https://tinystudio.io/offer.md")
);
for (const [clean, html] of [
  ["/appraisal", "/appraisal.html"],
  ["/pricing", "/pricing.html"],
  ["/specimen", "/specimen.html"],
  ["/waitlist", "/waitlist.html"]
]) {
  if (servedPageUrls.has(`https://tinystudio.io${clean}`)) servedPageUrls.add(`https://tinystudio.io${html}`);
}

const readinessSection = (content) => {
  const start = content.indexOf(ANSWER_READINESS_HEADING);
  if (start === -1) return "";
  const after = content.slice(start + ANSWER_READINESS_HEADING.length);
  const end = after.search(/\n## /);
  return end === -1 ? after : after.slice(0, end);
};

for (const [fileName, content] of [["llms.txt", llms], ["offer.md", offer]]) {
  if (!content.includes(ANSWER_READINESS_HEADING)) {
    failures.push(`${fileName} must carry the Answer Readiness section with preferred source pages.`);
  }
}

if (aiQuestions && Array.isArray(aiQuestions.questions)) {
  const llmsSection = readinessSection(llms);
  const offerSection = readinessSection(offer);
  for (const question of aiQuestions.questions) {
    const llmsLine = llmsSection.split("\n").find((line) => line.includes(question.id));
    if (!llmsLine) {
      failures.push(`llms.txt must map the controlled question to a preferred source page: ${question.id}`);
      continue;
    }
    const urls = [...llmsLine.matchAll(/https:\/\/tinystudio\.io\/[^\s]*/g)].map((match) => match[0]);
    if (urls.length !== 1) {
      failures.push(`Preferred source mapping must name exactly one page: ${question.id}`);
      continue;
    }
    const preferred = urls[0];
    if (!servedPageUrls.has(preferred)) {
      failures.push(`Preferred source page must be a served page: ${question.id} ${preferred}`);
    }
    const isPriceQuestion =
      question.id === "q2-what-tinystudio-charges" || question.id === "q7-what-tinystudio-io-charges";
    if (isPriceQuestion && preferred !== "https://tinystudio.io/pricing") {
      failures.push(`Price question ${question.id} must map to the clean /pricing (the pricing page owns the price).`);
    }
    const offerLine = offerSection.split("\n").find((line) => line.includes(question.id));
    if (!offerLine || !offerLine.includes(preferred)) {
      failures.push(`offer.md must mirror the preferred source page for ${question.id}: ${preferred}`);
    }
  }
}

const ownedPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["specimen page", read("public/specimen.html")],
  ["pricing page", read("public/pricing.html")],
  ["waitlist page", read("public/waitlist.html")],
  ["brief-requested page", read("public/brief-requested.html")]
];

const identityFacts = [
  "tinystudio.io",
  "Mac subtitle app",
  "fibre-arts magazine",
  "human-reviewed",
  "states no base city or office address"
];

for (const phrase of identityFacts) {
  if (!siteHome.includes(phrase)) failures.push(`Homepage must state the TinyStudio identity: ${phrase}`);
  if (!siteAudit.includes(phrase)) failures.push(`Audit page must state the TinyStudio identity: ${phrase}`);
  if (!llms.includes(phrase)) failures.push(`llms.txt must state the TinyStudio identity: ${phrase}`);
  if (!offer.includes(phrase)) failures.push(`offer.md must state the TinyStudio identity: ${phrase}`);
}

const identityDisambiguation = [
  "Mac subtitle app",
  "fibre-arts magazine",
  "design agency",
  "video production studio",
  "Los Angeles venue",
  "unrelated studio LLC",
  "states no base city or office address",
  "run by Nish"
];

for (const phrase of identityDisambiguation) {
  if (!llms.toLowerCase().includes(phrase.toLowerCase())) {
    failures.push(`llms.txt must mirror the disambiguation fact: ${phrase}`);
  }
  if (!offer.toLowerCase().includes(phrase.toLowerCase())) {
    failures.push(`offer.md must mirror the disambiguation fact: ${phrase}`);
  }
}

if (!/^## Identity$/m.test(llms)) {
  failures.push("llms.txt must carry the machine-readable Identity section.");
}
if (!llms.includes("https://tinystudio.io/offer.md")) {
  failures.push("llms.txt must link its machine-readable mirror: offer.md.");
}
if (!offer.includes("https://tinystudio.io/llms.txt")) {
  failures.push("offer.md must link its machine-readable mirror: llms.txt.");
}
if (!llms.includes("https://tinystudio.io/appraisal")) {
  failures.push("llms.txt must point at the appraisal page that carries the AI-search evidence artifact.");
}

const staleOfferPhrases = [
  "founder pilot",
  "founder-pilot",
  "Managed IT, MSP"
];
for (const phrase of staleOfferPhrases) {
  if (llms.toLowerCase().includes(phrase.toLowerCase())) {
    failures.push(`llms.txt must not revive the retired offer framing: ${phrase}`);
  }
  if (offer.toLowerCase().includes(phrase.toLowerCase())) {
    failures.push(`offer.md must not revive the retired offer framing: ${phrase}`);
  }
}

const OFFER_PRICES = ["$10,000 per site", "$149", "$349", "$699", "$299", "$599"];
const stateOnlyPlanPrice = (content) =>
  /\$\s?\d/.test(OFFER_PRICES.reduce((text, price) => text.replaceAll(price, ""), content));
if (stateOnlyPlanPrice(llms)) {
  failures.push("llms.txt may state only the offer prices in the 2026-11-12 offer table; the pricing page owns the terms.");
}
if (stateOnlyPlanPrice(offer)) {
  failures.push("offer.md may state only the offer prices in the 2026-11-12 offer table; the pricing page owns the terms.");
}

if (!siteHome.includes('id="identity"')) {
  failures.push("Homepage must carry the identity clarification (id=\"identity\").");
}
if (!siteAudit.includes('id="identity"')) {
  failures.push("Audit page must carry the identity clarification (id=\"identity\").");
}
if (!offer.includes("## Identity")) {
  failures.push("offer.md must carry the machine-readable Identity section.");
}

const staleIdentityStrings = [
  "The Tiny Studio",
  "Tiny Studio",
  "self-serve",
  "Pipeline Brief",
  "Agent Desk"
];

for (const [pageName, pageHtml] of ownedPages) {
  const visibleCopy = pageHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  for (const stale of staleIdentityStrings) {
    if (visibleCopy.toLowerCase().includes(stale.toLowerCase())) {
      failures.push(`Stale identity string on ${pageName}: ${stale}`);
    }
  }
}

const metaDescriptionPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["waitlist page", read("public/waitlist.html")]
];

const seenDescriptions = new Map();
for (const [pageName, pageHtml] of metaDescriptionPages) {
  const tags = [...pageHtml.matchAll(/<meta\b[^>]*\bname="description"[^>]*>/gi)].map((match) => match[0]);
  if (tags.length !== 1) {
    failures.push(`Meta description must appear exactly once in the head of ${pageName} (found ${tags.length}).`);
    continue;
  }
  const content = tags[0].match(/\bcontent="([^"]*)"/i)?.[1] ?? "";
  const trimmed = content.trim();
  if (!trimmed) {
    failures.push(`Meta description on ${pageName} must not be empty.`);
    continue;
  }
  if (trimmed.length > 160) {
    failures.push(`Meta description on ${pageName} must fit a search snippet (${trimmed.length} > 160 chars).`);
  }
  const prior = seenDescriptions.get(trimmed);
  if (prior) {
    failures.push(`Meta description on ${pageName} must be unique; it duplicates ${prior}.`);
  } else {
    seenDescriptions.set(trimmed, pageName);
  }
  for (const claim of forbiddenClaims) {
    if (trimmed.toLowerCase().includes(claim.toLowerCase())) {
      failures.push(`Meta description on ${pageName} must not promise: ${claim}`);
    }
  }
}

const ICON_PAGE_NAMES = new Map([
  ["index.html", "homepage"],
  ["appraisal.html", "appraisal page"],
  ["pricing.html", "pricing page"],
  ["specimen.html", "specimen page"],
  ["waitlist.html", "waitlist page"],
  ["brief-requested.html", "brief-requested page"]
]);
const publicHtmlFiles = readdirSync(new URL("../public", import.meta.url))
  .filter((name) => name.endsWith(".html"))
  .sort();

for (const knownFile of ICON_PAGE_NAMES.keys()) {
  if (!publicHtmlFiles.includes(knownFile)) {
    failures.push(`Served page public/${knownFile} is missing; every public HTML page must stay served with an apple touch icon.`);
  }
}
const iconPages = publicHtmlFiles.map((file) => [
  ICON_PAGE_NAMES.get(file) ?? `public/${file}`,
  read(`public/${file}`)
]);

for (const [pageName, pageHtml] of iconPages) {
  const head = pageHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const links = [...head.matchAll(/<link\b[^>]*\brel="apple-touch-icon"[^>]*>/gi)].map((match) => match[0]);
  if (links.length !== 1) {
    failures.push(`Apple touch icon link must appear exactly once in the head of ${pageName} (found ${links.length}).`);
    continue;
  }
  const href = links[0].match(/\bhref="([^"]*)"/i)?.[1] ?? "";
  if (href.trim() !== "/apple-touch-icon.png") {
    failures.push(`Apple touch icon on ${pageName} must point at /apple-touch-icon.png (found ${JSON.stringify(href)}).`);
  }
}

const iconBytes = readFileSync(new URL("../public/apple-touch-icon.png", import.meta.url), "latin1");
if (!iconBytes.startsWith("\x89PNG\r\n\x1a\n")) {
  failures.push("public/apple-touch-icon.png must be a valid PNG file.");
}
try {
  execFileSync("git", ["ls-files", "--error-unmatch", "public/apple-touch-icon.png"], {
    cwd: new URL("..", import.meta.url),
    stdio: "ignore"
  });
} catch {
  failures.push("public/apple-touch-icon.png must be tracked by git.");
}

const faviconPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["waitlist page", read("public/waitlist.html")],
  ["brief-requested page", read("public/brief-requested.html")],
];

for (const [pageName, pageHtml] of faviconPages) {
  const head = pageHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const links = [...head.matchAll(/<link\b[^>]*\brel="icon"[^>]*>/gi)].map((match) => match[0]);
  if (links.length !== 1) {
    failures.push(`Favicon link must appear exactly once in the head of ${pageName} (found ${links.length}).`);
    continue;
  }
  const href = links[0].match(/\bhref="([^"]*)"/i)?.[1] ?? "";
  if (href.trim() !== "/favicon.svg") {
    failures.push(`Favicon on ${pageName} must point at /favicon.svg (found ${JSON.stringify(href)}).`);
  }
}

const faviconBytes = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
if (!faviconBytes.trimStart().startsWith("<svg")) {
  failures.push("public/favicon.svg must be a valid SVG file.");
}
try {
  execFileSync("git", ["ls-files", "--error-unmatch", "public/favicon.svg"], {
    cwd: new URL("..", import.meta.url),
    stdio: "ignore"
  });
} catch {
  failures.push("public/favicon.svg must be tracked by git.");
}
const beaconPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["waitlist page", read("public/waitlist.html")],
  ["brief-requested page", read("public/brief-requested.html")],
];

for (const [pageName, pageHtml] of beaconPages) {
  const cfBeaconTags = [...pageHtml.matchAll(/<script\b[^>]*\bdata-cf-beacon\b[^>]*>/gi)];
  if (cfBeaconTags.length > 0) {
    failures.push(`Cloudflare Web Analytics beacon tag must not appear in the served body of ${pageName} (found ${cfBeaconTags.length} <script data-cf-beacon> tag(s); the zone's auto-injected snippet 404s because the underlying /cdn-cgi/rum endpoint is unprovisioned and the only known site token is revoked — see docs/evidence/web-analytics-beacon-404-reverify-2026-08-14.md).`);
  }
  const beaconScriptRefs = [...pageHtml.matchAll(/<script\b[^>]*\bsrc="[^"]*beacon\.min\.js[^"]*"[^>]*>/gi)];
  if (beaconScriptRefs.length > 0) {
    failures.push(`Cloudflare Web Analytics beacon.min.js script must not be referenced from the served body of ${pageName} (found ${beaconScriptRefs.length} reference(s); the broken 2026-08-09 injection path is documented in docs/evidence/web-analytics-beacon-404-reverify-2026-08-14.md).`);
  }
}

const socialSharePages = [
  ["homepage", siteHome, "https://tinystudio.io/"],
  ["audit page", siteAudit, "https://tinystudio.io/appraisal"],
  ["pricing page", read("public/pricing.html"), "https://tinystudio.io/pricing"],
  ["specimen page", read("public/specimen.html"), "https://tinystudio.io/specimen"],
  ["waitlist page", read("public/waitlist.html"), "https://tinystudio.io/waitlist"],
  ["privacy page", read("public/privacy.html"), "https://tinystudio.io/privacy"],
  ["terms page", read("public/terms.html"), "https://tinystudio.io/terms"],
  ["contact page", read("public/contact.html"), "https://tinystudio.io/contact"]
];
const SOCIAL_IMAGE_URL = "https://tinystudio.io/og-image.png";

const socialShareAttr = (key) => (key.startsWith("og:") ? "property" : "name");
const shareTagIn = (html, key) =>
  [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => new RegExp(`(?:^|\\s)${socialShareAttr(key)}="${key}"`, "i").test(tag));

const ogImage = readFileSync(new URL("../public/og-image.png", import.meta.url));
if (!ogImage.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
  failures.push("public/og-image.png must be a PNG file (the social share image).");
} else if (ogImage.readUInt32BE(16) !== 1200 || ogImage.readUInt32BE(20) !== 630) {
  failures.push(`og-image.png must be 1200x630 to match og:image:width/height (found ${ogImage.readUInt32BE(16)}x${ogImage.readUInt32BE(20)}).`);
}

for (const [pageName, pageHtml, pageUrl] of socialSharePages) {
  const head = pageHtml.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? "";
  const description = pageHtml.match(/<meta\b[^>]*\bname="description"[^>]*>/i)?.[0]?.match(/\bcontent="([^"]*)"/i)?.[1] ?? "";
  const expected = new Map([
    ["og:title", ""],
    ["og:description", description],
    ["og:type", "website"],
    ["og:url", pageUrl],
    ["og:image", SOCIAL_IMAGE_URL],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["og:image:alt", ""],
    ["twitter:card", "summary_large_image"],
    ["twitter:title", ""],
    ["twitter:description", description],
    ["twitter:image", SOCIAL_IMAGE_URL]
  ]);
  for (const [key, expectedContent] of expected) {
    const inDoc = shareTagIn(pageHtml, key);
    if (inDoc.length !== 1) {
      failures.push(`Social share tag ${key} must appear exactly once on ${pageName} (found ${inDoc.length}).`);
      continue;
    }
    const inHead = shareTagIn(head, key);
    if (inHead.length !== 1) {
      failures.push(`Social share tag ${key} on ${pageName} must sit inside <head>.`);
      continue;
    }
    const content = inHead[0].match(/\bcontent="([^"]*)"/i)?.[1] ?? "";
    if (expectedContent === "" && !content.trim()) {
      failures.push(`Social share tag ${key} on ${pageName} must not be empty.`);
    } else if (expectedContent !== "" && content !== expectedContent) {
      failures.push(`Social share tag ${key} on ${pageName} must be ${JSON.stringify(expectedContent)} (found ${JSON.stringify(content)}).`);
    }
  }
}

const structuredDataPages = [
  ["homepage", siteHome, "https://tinystudio.io/"],
  ["audit page", siteAudit, "https://tinystudio.io/appraisal"],
  ["pricing page", read("public/pricing.html"), "https://tinystudio.io/pricing"],
  ["specimen page", read("public/specimen.html"), "https://tinystudio.io/specimen"],
  ["waitlist page", read("public/waitlist.html"), "https://tinystudio.io/waitlist"],
];

const ORGANIZATION_ID = "https://tinystudio.io/#organization";
const WEBSITE_ID = "https://tinystudio.io/#website";
const ORGANIZATION_NAME = "TinyStudio";
const ORGANIZATION_LOGO = "https://tinystudio.io/apple-touch-icon.png";
const ORGANIZATION_DESCRIPTION =
  siteHome.match(/<meta\b[^>]*\bname="description"[^>]*\bcontent="([^"]*)"/i)?.[1] ?? "";

const decodeEntities = (text) =>
  text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const jsonLdBlocksIn = (html) =>
  [...html.matchAll(/<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]);

const ogTitleOf = (html) =>
  html.match(/<meta\b[^>]*\bproperty="og:title"[^>]*\bcontent="([^"]*)"/i)?.[1] ?? "";

for (const [pageName, pageHtml, pageUrl] of structuredDataPages) {
  const blocks = jsonLdBlocksIn(pageHtml);
  if (blocks.length !== 1) {
    failures.push(`Structured data must appear exactly once on ${pageName} (found ${blocks.length}).`);
    continue;
  }
  const head = pageHtml.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? "";
  if (jsonLdBlocksIn(head).length !== 1) {
    failures.push(`Structured data on ${pageName} must sit inside <head>.`);
  }

  let graph;
  try {
    graph = JSON.parse(blocks[0]);
  } catch (error) {
    failures.push(`Structured data on ${pageName} must be valid JSON (${error.message}).`);
    continue;
  }
  if (graph["@context"] !== "https://schema.org") {
    failures.push(`Structured data on ${pageName} must use the schema.org context.`);
  }
  if (!Array.isArray(graph["@graph"])) {
    failures.push(`Structured data on ${pageName} must use an @graph array.`);
    continue;
  }

  const nodes = graph["@graph"];
  const nodeIds = nodes.map((node) => node["@id"]).filter(Boolean);
  if (new Set(nodeIds).size !== nodeIds.length) {
    failures.push(`Structured data on ${pageName} must use unique @id values within the graph.`);
  }

  const orgNodes = nodes.filter((node) => node["@type"] === "Organization");
  const siteNodes = nodes.filter((node) => node["@type"] === "WebSite");
  const pageNodes = nodes.filter((node) => node["@type"] === "WebPage");
  if (orgNodes.length !== 1) {
    failures.push(`Structured data on ${pageName} must carry exactly one Organization node (found ${orgNodes.length}).`);
  } else {
    const org = orgNodes[0];
    if (org["@id"] !== ORGANIZATION_ID) {
      failures.push(`Organization on ${pageName} must use the stable @id ${ORGANIZATION_ID}.`);
    }
    if (org.name !== ORGANIZATION_NAME) {
      failures.push(`Organization on ${pageName} must be named ${ORGANIZATION_NAME} (found ${JSON.stringify(org.name)}).`);
    }
    if (org.url !== "https://tinystudio.io/") {
      failures.push(`Organization on ${pageName} must point at https://tinystudio.io/ (found ${JSON.stringify(org.url)}).`);
    }
    if (org.logo !== ORGANIZATION_LOGO) {
      failures.push(`Organization on ${pageName} must use the served logo ${ORGANIZATION_LOGO} (found ${JSON.stringify(org.logo)}).`);
    }
    if (org.description !== ORGANIZATION_DESCRIPTION) {
      failures.push(`Organization description on ${pageName} must match the homepage meta description (stable entity).`);
    }
  }

  if (siteNodes.length !== 1) {
    failures.push(`Structured data on ${pageName} must carry exactly one WebSite node (found ${siteNodes.length}).`);
  } else {
    const site = siteNodes[0];
    if (site["@id"] !== WEBSITE_ID) {
      failures.push(`WebSite on ${pageName} must use the stable @id ${WEBSITE_ID}.`);
    }
    if (site.url !== "https://tinystudio.io/" || site.name !== ORGANIZATION_NAME) {
      failures.push(`WebSite on ${pageName} must carry the site url and the TinyStudio name.`);
    }
    if (site.inLanguage !== "en") {
      failures.push(`WebSite on ${pageName} must declare inLanguage "en".`);
    }
    if (site.publisher?.["@id"] !== ORGANIZATION_ID) {
      failures.push(`WebSite on ${pageName} must name the Organization as its publisher.`);
    }
  }

  const metaDescription = pageHtml.match(/<meta\b[^>]*\bname="description"[^>]*\bcontent="([^"]*)"/i)?.[1] ?? "";
  const ogTitle = ogTitleOf(pageHtml);
  if (pageNodes.length !== 1) {
    failures.push(`Structured data on ${pageName} must carry exactly one WebPage node (found ${pageNodes.length}).`);
  } else {
    const page = pageNodes[0];
    if (page["@id"] !== `${pageUrl}#webpage`) {
      failures.push(`WebPage on ${pageName} must use the @id ${pageUrl}#webpage.`);
    }
    if (page.url !== pageUrl) {
      failures.push(`WebPage on ${pageName} must carry its own url ${pageUrl} (found ${JSON.stringify(page.url)}).`);
    }
    if (page.name !== decodeEntities(ogTitle)) {
      failures.push(`WebPage name on ${pageName} must equal the og:title (${JSON.stringify(decodeEntities(ogTitle))}).`);
    }
    if (page.description !== metaDescription) {
      failures.push(`WebPage description on ${pageName} must equal the meta description.`);
    }
    if (page.inLanguage !== "en") {
      failures.push(`WebPage on ${pageName} must declare inLanguage "en".`);
    }
    if (page.isPartOf?.["@id"] !== WEBSITE_ID) {
      failures.push(`WebPage on ${pageName} must belong to the WebSite node.`);
    }
    if (page.about?.["@id"] !== ORGANIZATION_ID) {
      failures.push(`WebPage on ${pageName} must be about the Organization node.`);
    }
  }

  if (pageName !== "pricing page" && /\$\s?\d/.test(blocks[0])) {
    failures.push(`Structured data on ${pageName} must not restate a dollar amount; pricing.html owns the price.`);
  }
  for (const claim of forbiddenClaims) {
    if (blocks[0].toLowerCase().includes(claim.toLowerCase())) {
      failures.push(`Structured data on ${pageName} must not promise: ${claim}`);
    }
  }
  if (/\+\d[\d\s()-]{6,}\d/.test(blocks[0])) {
    failures.push(`Structured data on ${pageName} must not capture phone numbers.`);
  }
}

const internalLinkPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["waitlist page", read("public/waitlist.html")],
  ["brief-requested page", read("public/brief-requested.html")]
];

const htmlPageTargets = {
  "index.html": "/",
  "appraisal.html": "/appraisal",
  "pricing.html": "/pricing",
  "specimen.html": "/specimen",
  "waitlist.html": "/waitlist",
  "privacy.html": "/privacy",
  "terms.html": "/terms",
  "contact.html": "/contact",

  "brief-requested.html": "/brief-requested"
};

const siteHosts = new Set(["tinystudio.io", "www.tinystudio.io"]);

function internalPageTarget(rawHref) {
  const href = rawHref.trim();
  if (!href || href.startsWith("#")) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return "";

  let path = href.split("#")[0].split("?")[0];
  if (!path) return "";

  if (/^(?:https?:)?\/\//i.test(path)) {
    let url;
    try {
      url = new URL(path.startsWith("//") ? `https:${path}` : path);
    } catch {
      return "";
    }
    if (!siteHosts.has(url.hostname.toLowerCase())) return "";
    path = url.pathname;
  }

  return path.replace(/^(?:\.\.?\/)+/, "").replace(/^\/+/, "");
}

for (const [pageName, pageHtml] of internalLinkPages) {
  const anchors = [...pageHtml.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]);
  for (const anchor of anchors) {
    const href = anchor.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const target = internalPageTarget(href);
    if (Object.prototype.hasOwnProperty.call(htmlPageTargets, target)) {
      failures.push(
        `Internal page link on ${pageName} must point at the clean destination ${JSON.stringify(htmlPageTargets[target])} (found ${JSON.stringify(href)}).`
      );
    }
  }
}

const indexablePages = [
  { path: "/", html: siteHome },
  { path: "/appraisal", html: siteAudit },
  { path: "/pricing", html: read("public/pricing.html") },
  { path: "/specimen", html: read("public/specimen.html") },
  { path: "/waitlist", html: read("public/waitlist.html") },
  { path: "/privacy", html: read("public/privacy.html") },
  { path: "/terms", html: read("public/terms.html") },
  { path: "/contact", html: read("public/contact.html") }
];

function indexableAnchorTarget(rawHref) {
  const href = rawHref.trim();
  if (!href || href.startsWith("#")) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return "";

  let path = href.split("#")[0].split("?")[0];
  if (!path) return "";

  if (/^(?:https?:)?\/\//i.test(path)) {
    let url;
    try {
      url = new URL(path.startsWith("//") ? `https:${path}` : path);
    } catch {
      return "";
    }
    if (!siteHosts.has(url.hostname.toLowerCase())) return "";
    path = url.pathname;
  }

  if (/\.html?$/i.test(path.replace(/\/+$/, ""))) return "";
  if (!path.startsWith("/")) return "";
  return path === "/" ? "/" : path.replace(/\/+$/, "");
}

const hasInlink = new Map(indexablePages.map((page) => [page.path, false]));
for (const page of indexablePages) {
  const anchors = [...page.html.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]);
  for (const anchor of anchors) {
    const href = anchor.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const target = indexableAnchorTarget(href);
    if (!target || target === page.path) continue;
    if (hasInlink.has(target)) hasInlink.set(target, true);
  }
}
for (const page of indexablePages) {
  if (!hasInlink.get(page.path)) {
    failures.push(`Indexable page ${page.path} is an orphan: no other indexable page links to it.`);
  }
}

const canonicalPages = [
  ["homepage", siteHome, "https://tinystudio.io/"],
  ["audit page", siteAudit, "https://tinystudio.io/appraisal"],
  ["pricing page", read("public/pricing.html"), "https://tinystudio.io/pricing"],
  ["specimen page", read("public/specimen.html"), "https://tinystudio.io/specimen"],
  ["waitlist page", read("public/waitlist.html"), "https://tinystudio.io/waitlist"],
  ["privacy page", read("public/privacy.html"), "https://tinystudio.io/privacy"],
  ["terms page", read("public/terms.html"), "https://tinystudio.io/terms"],
  ["contact page", read("public/contact.html"), "https://tinystudio.io/contact"]
];

const canonicalLinkPattern = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi;
const canonicalHrefPattern = /\bhref\s*=\s*["']([^"']*)["']/i;

const seenCanonicals = new Map();
for (const [pageName, pageHtml, expected] of canonicalPages) {

  const liveHtml = pageHtml.replace(/<!--[\s\S]*?-->/g, "");
  const links = [...liveHtml.matchAll(canonicalLinkPattern)].map((match) => match[0]);
  if (links.length !== 1) {
    failures.push(`Canonical link must appear exactly once across ${pageName} (found ${links.length}).`);
    continue;
  }
  const head = liveHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const headLinks = [...head.matchAll(canonicalLinkPattern)].length;
  if (headLinks !== 1) {
    failures.push(`Canonical link on ${pageName} must sit inside the head (found ${headLinks} in head, ${links.length} total).`);
  }
  const href = links[0].match(canonicalHrefPattern)?.[1] ?? "";
  const trimmed = href.trim();
  if (!trimmed) {
    failures.push(`Canonical link on ${pageName} must not have an empty href.`);
    continue;
  }
  if (trimmed !== expected) {
    failures.push(`Canonical link on ${pageName} must point at ${expected} (found ${trimmed}).`);
  }
  const prior = seenCanonicals.get(trimmed);
  if (prior) {
    failures.push(`Canonical URL on ${pageName} must be unique; it duplicates ${prior}.`);
  } else {
    seenCanonicals.set(trimmed, pageName);
  }
}

const titlePages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["waitlist page", read("public/waitlist.html")],
  ["brief-requested page", read("public/brief-requested.html")]
];

for (const [pageName, pageHtml] of titlePages) {
  const title = pageHtml.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";
  if (!title) {
    failures.push(`Document title must exist on ${pageName}.`);
    continue;
  }
  if (!title.includes("TinyStudio")) {
    failures.push(`Document title on ${pageName} must name TinyStudio (found ${JSON.stringify(title)}).`);
  }
  if (title.includes("The Tiny Studio")) {
    failures.push(`Document title on ${pageName} must not use the spaced "The Tiny Studio" form (found ${JSON.stringify(title)}).`);
  }
}

const intakePages = [
  ["homepage", siteHome],
  ["audit page", siteAudit]
];

for (const [pageName, pageHtml] of intakePages) {
  for (const input of pageHtml.matchAll(/<input\b[^>]*>/gi)) {
    const tag = input[0];
    if (!/\bname="(?:website|email)"/.test(tag)) continue;
    const id = tag.match(/\bid="([^"]*)"/)?.[1] ?? "";
    if (!id.trim()) {
      failures.push(`Intake input on ${pageName} must carry an id so a persistent <label> can bind to it: ${tag}`);
      continue;
    }
    const labelBody = pageHtml.match(
      new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)<\\/label>`, "i")
    )?.[1] ?? "";
    if (!labelBody.trim()) {
      failures.push(`Intake input on ${pageName} must be bound to a persistent programmatic <label for="${id}"> (placeholder-only labels disappear as buyers type): ${tag}`);
    }
  }
}

const waitlistFormHtml = read("public/waitlist.html");
const waitlistFormAction = waitlistFormHtml.match(/<form\b[^>]*\baction="([^"]*)"/i)?.[1] ?? "";
if (waitlistFormAction !== "/api/appraisal-requests") {
  failures.push("The waitlist page must post to /api/appraisal-requests, the endpoint that fills the waitlist table and moves the six-a-month counter.");
}
if (!/<label\b[^>]*\bfor="intake-email"/i.test(waitlistFormHtml)) {
  failures.push("The waitlist page must keep the labelled email input, so the waitlist row can be confirmed.");
}
for (const migration of ["migrations/0002_agent_runs.sql", "migrations/0003_agent_usage_limits.sql"]) {  if (!existsSync(new URL(`../${migration}`, import.meta.url))) {
    failures.push(`Missing migration: ${migration}`);
    continue;
  }

  try {
    execFileSync("git", ["ls-files", "--error-unmatch", migration], {
      cwd: new URL("..", import.meta.url),
      stdio: "ignore"
    });
  } catch {
    failures.push(`Migration must be tracked by git: ${migration}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("TinyStudio.io checks passed.");
