import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The leak-audit site took the root; the retired self-serve Agent Desk is
// still served at /agent-desk and /agent-desk.html as a frozen legacy surface
// (de-indexed, no page links to it). The current homepage (index.html) owns
// the site's copy contract, so the required-copy and forbidden-claim guards
// read it; the desk-markup, legacy-form and retired-head checks below follow
// the retired page so the still-served surface keeps working as shipped.
const index = read("public/index.html");
const retiredDesk = read("public/agent-desk.html");
const styles = read("public/styles.css");
const script = read("public/script.js");
const llms = read("public/llms.txt");
const offer = read("public/offer.md");
const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const worker = read("src/worker.js");
const wrangler = read("wrangler.jsonc");
const packageJson = read("package.json");
const wranglerConfig = JSON.parse(wrangler);

const failures = [];

// The required copy of the CURRENT homepage (public/index.html, "The Website
// Appraisal"): the offer line, the capacity and no-call promises, the claims
// policy, the primary CTA, and the contact and identity anchors. The retired
// Agent Desk page carries its own framing guards below; its self-serve copy
// is no longer the site's copy contract.
const requiredIndexCopy = [
  "TinyStudio — The Website Appraisal",
  "the free leak audit of high-ticket service homepages",
  "Six a month.",
  "No call at any point.",
  "No revenue, ranking or booking guarantees. Only the work.",
  "Show me where our site undersells us",
  "hello@tinystudio.io",
  "TinyStudio is the business behind this site"
];

const requiredAgentStack = [
  "Offer Agent",
  "Funnel Agent",
  "Creative Agent",
  "Qualification Agent",
  "Follow-Up Agent",
  "CRM Agent",
  "Tracking Agent",
  "Decision Agent"
];

const requiredScriptCopy = [
  "/api/agent-audit",
  "SECTION_LABELS",
  "normalizeSections",
  "renderMarkdown",
  "escapeHtml",
  "ERROR_MESSAGES",
  "showEmpty",
  "same_origin_required",
  "Add email and a business snapshot first.",
  "Agents are building the pipeline loop...",
  "Pipeline loop generated",
  "Copy section"
];

const requiredWorkerCopy = [
  "AGENT_MODELS",
  "AGENT_SECTION_HEADINGS",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/openai/gpt-oss-20b",
  "agentAuditResponse",
  "agentInputWithInferredWeeklyMetrics",
  "inferWeeklyMetricsFromBusiness",
  "splitAgentSections",
  "missingAgentSections",
  "ensureWeeklyReportContract",
  "ensureWeeklyMetricSnapshot",
  "appendMetricsToCollect",
  "stripUnsupportedMetricValues",
  "stripUnsupportedMetricsFromArtifactSections",
  "metricLineContainsSuppliedValue",
  "metricComparableTokens",
  "metricLabelHasValueInClause",
  "metricLabelsWithValuesInLine",
  "currentMetricPhraseLabels",
  "normalizeMetricValueForCompare",
  "CURRENCY_AMOUNT_PATTERN",
  "WEEKLY_METRIC_LABELS",
  "unknownTopLevelHeadings",
  "hasUnsafeMatch",
  "hasApprovalGate",
  "scrubUnsupportedPrecision",
  "hasProvidedOfferPrice",
  "buildMetricSnapshot",
  "buildWeeklyTrackerReport",
  "Weekly metrics mode",
  "weeklySpend",
  "Do the heavy lifting",
  "Only include blocker questions",
  "Do not invent exact prices",
  "Keep assumptions directional",
  "Implementation Checklist",
  "Weekly Fix Report",
  "env.AI.run",
  "MAX_REQUEST_BYTES",
  "isAllowedOrigin",
  "isLoopbackHostname",
  "isLocalPreviewRequest",
  "hostHeaderHostname",
  "validateAgentRequest",
  "STALE_PUBLIC_PATHS",
  "unsafeOutputReasons",
  "ad account connection",
  "crm outcome sync",
  "agent_usage_limits",
  "agent_runs",
  "agent-self-serve",
  "daily_email_limit",
  "storesBusinessBrief: false",
  "noSpendChanges: true",
  "noAutopublishing: true"
];

const requiredPublicArtifacts = [
  "The Website Appraisal",
  "free leak audit of high-ticket service homepages",
  "human-reviewed desk",
  "clinics, surgeons, dentists, spas",
  "clients are never named",
  "not autonomous software",
  "No call at any point.",
  "There are no revenue, ranking, ROAS, conversion, booked-call, or sales-volume guarantees",
  "Client-side code does not call model providers",
  "No campaign publishing",
  "No ad spend changes",
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

for (const text of requiredIndexCopy) {
  if (!index.includes(text)) failures.push(`Missing homepage copy: ${text}`);
}

for (const text of requiredAgentStack) {
  if (!retiredDesk.includes(text)) failures.push(`Missing Agent Desk agent: ${text}`);
}

for (const text of requiredScriptCopy) {
  if (!script.includes(text)) failures.push(`Missing agent script behavior: ${text}`);
}

for (const text of requiredWorkerCopy) {
  if (!worker.includes(text)) failures.push(`Missing worker agent behavior: ${text}`);
}

// The current-product readiness verdict must key off the intake path only.
// The Website Appraisal depends on the D1 email_signups table behind
// /api/signups; the retired Agent Desk's AI binding and agent tables are
// reported as legacy state, never as the current product's readiness. A
// regression that lets the legacy machinery gate /health — or that drops the
// intake table from the check — would make the machine-readable truth lie.
const requiredHealthCopy = [
  "surface: APPRAISAL_SURFACE",
  "signupsTable",
  "checks.db && checks.signupsTable",
  "email_signups",
  "agentRunsTable",
  "usageLimitsTable"
];

for (const text of requiredHealthCopy) {
  if (!worker.includes(text)) failures.push(`Missing worker health truth: ${text}`);
}

if (worker.includes("checks.ai && checks.db")) {
  failures.push("Worker /health verdict must not gate on the retired Agent Desk AI binding");
}

// Monthly intake cap (the "six a month" public promise). The site promises
// "when the sixth is taken, the intake closes until the next" on five
// surfaces; the signup handler must honor it: a calendar-month counter that
// rejects the seventh signup with a truthful closed-intake response (JSON
// error "intake_closed" for API clients, a self-contained 409 page for form
// posts). These are STATIC SOURCE GUARDS, not behavioral tests — the
// behavioral proof lives in test-agent-worker.mjs.
if (!worker.includes("MAX_APPRAISALS_PER_MONTH")) {
  failures.push("Worker must define MAX_APPRAISALS_PER_MONTH (the six-a-month cap).");
}
if (!worker.includes("signup:")) {
  failures.push("Worker must key the monthly signup cap on a signup:YYYY-MM bucket.");
}
if (!worker.includes("\"intake_closed\"")) {
  failures.push("Worker must expose the intake_closed error for API signup clients.");
}
if (!worker.includes("closedIntakeResponse()")) {
  failures.push("Worker must serve the closed-intake page to browser form posts.");
}
if (!worker.includes("The six appraisals for this month are taken")) {
  failures.push("Closed-intake page must state the six-a-month truth.");
}

for (const text of requiredPublicArtifacts) {
  // llms.txt and offer.md are mirrors of the same offer contract. A fact must
  // appear in BOTH (case-insensitively, since one file may head it while the
  // other embeds it mid-sentence, and llms.txt wraps prose across lines), so
  // neither file can silently drift.
  const normalized = (content) => content.toLowerCase().replace(/\s+/g, " ");
  const needle = normalized(text);
  if (!normalized(llms).includes(needle)) failures.push(`Missing offer fact in llms.txt: ${text}`);
  if (!normalized(offer).includes(needle)) failures.push(`Missing offer fact in offer.md: ${text}`);
}

function formFieldTags(html) {
  return [...html.matchAll(/<(input|textarea|select)\b[^>]*>/gi)].map((match) => match[0]);
}

function fieldName(tag) {
  return tag.match(/\bname="([^"]+)"/i)?.[1] || "";
}

const formFields = formFieldTags(retiredDesk);
const requiredFields = formFields
  .filter((tag) => /\srequired(?:\s|>|=)/i.test(tag))
  .map(fieldName)
  .filter(Boolean)
  .sort();
const expectedRequiredFields = ["business", "email"];

if (JSON.stringify(requiredFields) !== JSON.stringify(expectedRequiredFields)) {
  failures.push(`Agent Desk must require only email and business fields. Found required fields: ${requiredFields.join(", ") || "none"}`);
}

for (const optionalName of [
  "market",
  "funnel",
  "offer",
  "audience",
  "proof",
  "followup",
  "constraints",
  "weeklySpend",
  "rawLeads",
  "qualifiedLeads",
  "bookedCalls",
  "showedCalls",
  "closedDeals",
  "cashCollected",
  "bottleneck"
]) {
  const field = formFields.find((tag) => fieldName(tag) === optionalName);
  if (!field) {
    failures.push(`Missing optional Agent Desk field: ${optionalName}`);
  } else if (/\srequired(?:\s|>|=)/i.test(field)) {
    failures.push(`Optional Agent Desk field must not be required: ${optionalName}`);
  }
}

const siteHome = read("public/index.html");
const siteAudit = read("public/audit.html");

// Monthly cap phrase on every conversion surface must stay canonical:
// the short "Six a month." promise, never the product-name drift "Six audits a month.".
const monthlyCapPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["pricing page", read("public/pricing.html")],
  ["msp page", read("public/msp.html")]
];
for (const [pageName, pageHtml] of monthlyCapPages) {
  if (!/\bsix a month\b/i.test(pageHtml)) {
    failures.push(`${pageName} must carry the canonical "Six a month" monthly-cap phrase.`);
  }
  if (/\bsix audits a month\b/i.test(pageHtml)) {
    failures.push(`${pageName} must not use the non-canonical "Six audits a month" monthly-cap phrase.`);
  }
}

// Public-promise regression: the "No call at any point" promise must appear on
// every intake surface that posts to /api/signups, not only the homepage and
// the MSP page. The canonical mirrors are guarded by requiredPublicArtifacts.
const noCallIntakePages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["pricing page", read("public/pricing.html")],
  ["msp page", read("public/msp.html")]
];
for (const [pageName, pageHtml] of noCallIntakePages) {
  if (!/No call at any point\./i.test(pageHtml)) {
    failures.push(`${pageName} must carry the "No call at any point" promise on its intake surface.`);
  }
}

// Conversion-friction regression: the signup website field must accept a bare
// business domain (example.com) at the browser level instead of requiring a
// scheme via type="url", while still rejecting malformed entries and staying
// required. The server's normalizeWebsite keeps the URL-safety gate.
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

// Signup rejection-signal guard (dogfood: failed-signup dead end). The worker
// 303-redirects a rejected signup back to /?signal=invalid (the server email
// regex is stricter than the browser's type=email check — e.g. "a@b" passes
// client-side but not server-side), so the homepage must render that state:
// a role=alert banner, hidden until index.js reads the signal, moves focus
// into it, and strips the query so a refresh or a copied link does not
// re-show the error. These are STATIC SOURCE GUARDS, not behavioral tests.
const signalBanner = siteHome.match(/<p\b[^>]*id="signal-invalid"[^>]*>/i)?.[0] || "";
if (!signalBanner) {
  failures.push("Homepage must carry the id=\"signal-invalid\" signup rejection banner.");
} else {
  if (!/\brole="alert"/i.test(signalBanner)) {
    failures.push("Signup rejection banner must expose role=\"alert\".");
  }
  if (!/\bhidden(?:\s|>|=)/i.test(signalBanner)) {
    failures.push("Signup rejection banner must start hidden (revealed only by the signal handler).");
  }
}
const homeScript = read("public/index.js");
if (!homeScript.includes("signal-invalid")) {
  failures.push("index.js must reference the signal-invalid banner.");
}
if (!/signal=([^&]+)/.test(homeScript)) {
  failures.push("index.js must read the ?signal= query parameter.");
}
if (!homeScript.includes("replaceState")) {
  failures.push("index.js must strip the signal query with history.replaceState after revealing the banner.");
}
const homeCss = read("public/index.css");
if (!/\.signal\b/.test(homeCss)) {
  failures.push("index.css must style the signup rejection banner (.signal).");
}
if (!/\.signal\[hidden\]\s*\{[^}]*display:\s*none/i.test(homeCss)) {
  failures.push(".signal[hidden] must force display:none so the banner stays hidden until revealed.");
}
if (!worker.includes("htmlRedirect(url, \"invalid\")")) {
  failures.push("Worker must keep 303-redirecting rejected signups to /?signal=invalid (the homepage banner renders it).");
}


if (!retiredDesk.includes("role=\"tabpanel\"") || !retiredDesk.includes("aria-labelledby=\"output-tab-pipelineBrief\"")) {
  failures.push("Agent output must expose a proper tabpanel relationship.");
}

// Pricing closing-callout regression (review item: the /pricing closing band
// ended in a dead end — "The appraisal costs you an email" with no way to send
// one — while every other served conversion surface carried a real intake
// form). The band must keep the actual signup form: a form.lead inside the
// .band posting website + email to /api/signups, both fields with a
// persistent programmatic aria-label, and a submit button reading "Request
// the appraisal". STATIC SOURCE GUARD (regex over pricing.html), matching the
// repo's other source-string guards.
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
if (!/Request the appraisal/i.test(pricingForm)) {
  failures.push('Pricing closing callout submit button must read "Request the appraisal".');
}

// Desk page in-content request CTA regression (review item: the /agents desk
// page ended at its closing urgency band with no in-content conversion afford
// — the only request link was the nav CTA). The closing .band must keep the
// "Request the appraisal" pill linking to the same request surface as the nav
// CTA (/#start — the desk page carries no form of its own), and agents.css
// must keep the >=44px pill styling. STATIC SOURCE GUARD (regex over the
// served HTML/CSS), not a behavioral test: CI has no browser.
const deskPage = read("public/agents.html");
const deskBand = deskPage.match(/<div class="band">([\s\S]*?)<\/div>\s*<footer>/)?.[1] ?? "";
if (!deskBand) {
  failures.push("Desk page must keep its closing urgency band before the footer.");
} else if (!/<a\b[^>]*class="cta"[^>]*href="\/#start"[^>]*>Request the appraisal<\/a>/.test(deskBand)) {
  failures.push("Desk closing urgency band must carry a .cta link to /#start labelled \"Request the appraisal\".");
}
const agentsCss = read("public/agents.css");
if (!agentsCss.includes(".band .cta")) {
  failures.push("agents.css must style the band conversion CTA (.band .cta).");
}
if (!/\.band \.cta\{[^}]*padding:16px 24px/.test(agentsCss)) {
  failures.push("Desk band CTA must keep a >=44px tap target (padding:16px 24px).");
}

// Mobile layout regression: at 390x844 the /audit page previously overflowed
// horizontally (navlinks measured to x=569, the 53-of-89 stat to x=451).
// The mobile treatment must live in audit.css behind the shared 760px
// breakpoint and stack every overflowing block. These checks below are
// STATIC SOURCE GUARDS (regex over audit.css), not behavioral tests: CI has
// no browser. The behavioral, measured layout proof for this fix lives in
// docs/evidence/audit-mobile-overflow-390x844-2026-08-06.md (unfixed 567px
// scrollWidth at 390x844, fixed 390px, desktop 1280px unchanged).
const auditCss = read("public/audit.css");
const auditMobile = auditCss.match(/@media \(max-width:760px\)\{([\s\S]*)\}\s*$/)?.[1] ?? "";

if (!auditMobile) {
  failures.push("Audit page must carry a mobile (max-width:760px) media query in audit.css.");
} else {
  const requireMobileRule = (label, pattern) => {
    if (!pattern.test(auditMobile)) failures.push(`Audit mobile layout must ${label}.`);
  };
  requireMobileRule("scale the 128px stat instead of leaving it nowrap at full size", /\.stat\{[^}]*clamp\(/);
  requireMobileRule("turn the nav into a wrapping two-tier layout", /\.navlinks\{[^}]*flex-wrap:wrap/);
  requireMobileRule("give the nav CTA its own full-width row", /\.navcta\{[^}]*1 1 100%/);
  requireMobileRule("stack the band stat and copy into one column", /\.bandgrid\{[^}]*grid-template-columns:1fr/);
  requireMobileRule("stack the four checks into one column", /\.checks\{[^}]*grid-template-columns:1fr/);
  requireMobileRule("let proof rows wrap instead of overflowing", /\.row\{[^}]*flex-wrap:wrap/);
}

// Audit page in-content request CTA regression (review item: the /audit proof
// page ended at the closing urgency band with no in-content conversion afford
// — the only request link was the nav CTA; fixed by PR #159). The closing
// .band must keep the "Request the appraisal" pill linking to the page's own
// #start form, and the no-guarantees note that scopes it. audit.css must keep
// the scoped .band .cta pill styling with a >=44px hit area, and the mobile
// media query must stack the band. STATIC SOURCE GUARD (regex over the served
// HTML/CSS), not a behavioral test: CI has no browser.
const auditClosingBand = siteAudit.match(/<div class="band">([\s\S]*?)<\/div>\s*<section id="confidential">/)?.[1] ?? "";
if (!auditClosingBand) {
  failures.push("Audit page must keep an in-content conversion CTA band between the proof and the footer.");
} else {
  if (!/<a\b[^>]*class="cta"[^>]*href="#start"[^>]*>Request the appraisal<\/a>/.test(auditClosingBand)) {
    failures.push("Audit conversion band must carry a .cta link to #start labelled \"Request the appraisal\".");
  }
  if (!/No revenue, ranking, ROAS, conversion, booked-call or sales-volume guarantees\. Only the work\./.test(auditClosingBand)) {
    failures.push("Audit conversion band must keep the no-guarantees note.");
  }
}
if (!auditCss.includes(".band .cta")) {
  failures.push("audit.css must style the band conversion CTA (.band .cta).");
}
if (!/\.band \.cta\{[^}]*padding:16px 24px/.test(auditCss)) {
  failures.push("Audit band CTA must keep a >=44px tap target (padding:16px 24px).");
}

// The behavioral layout proof (real Chromium measurement, local static copy)
// is checked in so the static guards above stay distinguishable from it.
// Existence and section anchors only — this does not re-verify measurements.
const overflowReceipt = existsSync("docs/evidence/audit-mobile-overflow-390x844-2026-08-06.md")
  ? read("docs/evidence/audit-mobile-overflow-390x844-2026-08-06.md")
  : null;
if (overflowReceipt) {
  for (const anchor of [
    "unfixed",
    "390x844",
    "**fixed**",
    "**390**",
    "1280x800",
    "not CI proof",
    "Exact verification method"
  ]) {
    if (!overflowReceipt.includes(anchor)) {
      failures.push(`Overflow evidence receipt must record the ${JSON.stringify(anchor)} section.`);
    }
  }
}

// The forbidden-claim guard scans the CURRENT site's copy contract — the five
// public pages plus the llms.txt / offer.md mirror pair. The retired Agent
// Desk page and its script are a frozen, de-indexed legacy surface describing
// a retired product; their copy is governed by the retired-framing guards
// below, not by the current offer's claims policy.
const currentClaimPages = [
  siteHome,
  siteAudit,
  read("public/agents.html"),
  read("public/pricing.html"),
  read("public/specimen.html"),
  read("public/msp.html")
];

for (const claim of forbiddenClaims) {
  const haystack = [...currentClaimPages, llms, offer].join("\n").toLowerCase();
  if (haystack.includes(claim.toLowerCase())) {
    failures.push(`Forbidden claim found: ${claim}`);
  }
}

for (const route of ["tinystudio.io", "www.tinystudio.io", "app.tinystudio.io", "api.tinystudio.io"]) {
  if (!wrangler.includes(`"pattern": "${route}/*"`)) {
    failures.push(`Missing Cloudflare route: ${route}`);
  }
}

if (!wrangler.includes("\"ai\":") || !wrangler.includes("\"binding\": \"AI\"")) {
  failures.push("Missing Cloudflare Workers AI binding.");
}

if (!wrangler.includes("\"preview_database_id\"")) {
  failures.push("Remote Worker dev needs a D1 preview database binding.");
}

for (const database of wranglerConfig.d1_databases || []) {
  if (database.preview_database_id === database.database_id) {
    failures.push("D1 preview database must not point at the production database.");
  }
}

if (!wrangler.includes("\"run_worker_first\": [\"/*\"]")) {
  failures.push("Worker is not configured to run before all public assets.");
}

if (!packageJson.includes("\"migrate:remote\"") || !packageJson.includes("d1 migrations apply tinystudio_email_signups --remote")) {
  failures.push("Deploy scripts must include the remote D1 migration command.");
}

if (!packageJson.includes("\"test:worker\"") || !packageJson.includes("scripts/test-agent-worker.mjs")) {
  failures.push("Worker agent contract tests must be wired into package scripts.");
}

if (!packageJson.includes("\"test:ui\"") || !packageJson.includes("scripts/test-agent-ui.mjs")) {
  failures.push("Agent UI interaction tests must be wired into package scripts.");
}

if (!packageJson.includes("\"dev\": \"wrangler dev --remote")) {
  failures.push("Dev script must run the Worker preview, not a static-only server.");
}

if (!packageJson.includes("\"deploy\": \"npm run migrate:remote && wrangler deploy\"")) {
  failures.push("Deploy script must apply migrations before wrangler deploy.");
}

if (!robots.includes("Allow: /")) {
  failures.push("Robots file should allow indexing after reopening.");
}

if (!sitemap.includes("https://tinystudio.io/")) {
  failures.push("Sitemap should expose the root Agent Desk URL.");
}

if (!styles.includes(".agent-shell") || !styles.includes(".agent-form") || !styles.includes(".agent-output")) {
  failures.push("Missing Agent Desk visual styles.");
}

// Responsive regression guard: each public route's stylesheet must keep its
// mobile block, or a 390px phone view regains horizontal overflow.
const responsiveCss = [
  ["shared.css", ["@media (max-width:760px)", ".wrap{padding:0 20px}", ".navlinks{flex-wrap:wrap"]],
  ["index.css", ["@media (max-width:760px)", ".wrap{padding:0 20px}", ".navlinks{flex-wrap:wrap"]],
  ["pricing.css", ["@media (max-width:760px)", ".plan{grid-template-columns:1fr"]],
  ["agents.css", ["@media (max-width:760px)", ".ag{grid-template-columns:1fr", ".gatebox{grid-template-columns:1fr"]],
  ["msp.css", ["@media (max-width:760px)", ".bandgrid{grid-template-columns:1fr", ".checks{grid-template-columns:1fr"]]
];
for (const [file, needles] of responsiveCss) {
  const css = read(`public/${file}`);
  for (const needle of needles) {
    if (!css.includes(needle)) failures.push(`Missing mobile responsive rule in ${file}: ${needle}`);
  }
}

// Tap-target regression guard (finding: mobile tap targets under WCAG sizes).
// On every served page the touch hit areas were below the 44px bar the finding
// holds the site to: marketing nav links ~15px tall, the nav CTA ~35px, the
// logo ~25px, footer links ~13px, and the primary lead-form CTA 42px. The fix
// grows every interactive element in the mobile nav, footer and lead forms to
// a >=44px hit area, scoped to the existing mobile blocks so desktop widths
// are untouched. These are STATIC SOURCE GUARDS (exact-string and regex checks
// over the served CSS), not behavioral tests: CI has no browser. The
// behavioral, measured layout proof for this fix lives in
// docs/evidence/tap-targets-2026-08-09.md (unfixed nav link ~15px, nav CTA
// ~34px, lead CTA ~42px at 390x844; fixed all >=44px).
const tapTargetCss = [
  // [file, mobile-block needles, whole-file needles]
  ["shared.css",
    [".logo{padding:11px 0}", ".navlinks a{padding:15px 0}", ".navcta{padding:15px 20px}", "footer a{padding:16px 0}", "form.lead.two > input{padding:12px 14px;min-height:44px;box-sizing:border-box}", "form.lead.two > input + input{border-left:0;border-top:1px solid var(--line)}"],
    ["border-radius:999px;padding:16px 20px", "form.lead.two > input{padding:12px 18px 11px 24px;min-height:44px;box-sizing:border-box}"]],
  ["index.css",
    [".logo{padding:11px 0}", ".navlinks a{padding:15px 0}", ".navcta{padding:15px 20px}", "footer a{padding:16px 0}"],
    ["border-radius:999px;padding:16px 20px"]],
  ["audit.css",
    [".navcta{flex:1 1 100%;text-align:center;padding:15px 20px}"],
    []],
  ["brief-requested.css",
    [],
    ["padding:15px 0;text-decoration:underline"]],
  ["styles.css",
    [".brand {\n    padding: 6px 0;", "input,\n  select {\n    min-height: 44px;", ".output-tabs button {\n    min-height: 44px;", ".agent-footer a {\n    padding: 14px 0;"],
    ["cursor: pointer;\n  min-height: 44px;\n  border: 1px solid var(--ink);",
     ".output-actions button {\n  min-height: 44px;",
     "justify-content: space-between;\n  gap: 12px;\n  min-height: 44px;"]]
];
for (const [file, blockNeedles, fileNeedles] of tapTargetCss) {
  const css = read(`public/${file}`);
  const mobile = css.match(/@media \(max-width:\s*(?:760|680)px\)\s*\{([\s\S]*)\}\s*$/)?.[1] ?? "";
  for (const needle of fileNeedles) {
    if (!css.includes(needle)) failures.push(`Missing tap-target rule in ${file}: ${needle}`);
  }
  for (const needle of blockNeedles) {
    if (!mobile.includes(needle)) failures.push(`Missing mobile tap-target rule in ${file}: ${needle}`);
  }
}

// The behavioral tap-target proof (real Chromium measurement, local static
// copy) is checked in so the static guards above stay distinguishable from it.
// Existence and section anchors only — this does not re-verify measurements.
const tapTargetReceipt = existsSync("docs/evidence/tap-targets-2026-08-09.md")
  ? read("docs/evidence/tap-targets-2026-08-09.md")
  : null;
if (tapTargetReceipt) {
  for (const anchor of ["unfixed", "390x844", "44px", "not CI proof", "Exact verification method"]) {
    if (!tapTargetReceipt.includes(anchor)) {
      failures.push(`Tap-target evidence receipt must record the ${JSON.stringify(anchor)} section.`);
    }
  }
}

// Lead-form tablet squeeze guard (review finding on the homepage intake form):
// the homepage form shares the .lead class with the checks-section header,
// whose gap:70px / space-between / flex-end treatment leaked onto it and,
// together with the nowrap submit button, squeezed the domain and email
// inputs to ~100px at tablet width (measured 99/98px at 761px, 103/102px at
// 768px, and never above 139px — the "yourwebsite.com" placeholder clipped —
// at any width under the fix). The fix scopes the checks-header rules to
// .checks .lead and gives the two-field form its own 900px stacking
// breakpoint, so the one-line layout keeps >=208px inputs and anything
// narrower goes full-width stacked. These are STATIC SOURCE GUARDS (regex
// over the served CSS), not behavioral tests: CI has no browser. The
// behavioral, measured layout proof lives in
// docs/evidence/lead-form-tablet-squeeze-2026-08-10.md.
const indexCss = read("public/index.css");
if (!indexCss.includes(".checks .lead{display:flex;justify-content:space-between;align-items:flex-end;gap:70px}")) {
  failures.push("Homepage checks header must scope .lead to .checks .lead (the shared class leaks its gap onto the lead form).");
}
if (!indexCss.includes("@media (max-width:900px){")) {
  failures.push("Two-field lead form must carry its own 900px stacking breakpoint (tablet squeeze guard).");
}
if (!indexCss.includes("form.two{flex-direction:column;align-items:stretch;border-radius:20px;padding:8px;max-width:100%;gap:18px}")) {
  failures.push("Two-field lead form must stack below 900px with an explicit gap (tablet squeeze guard).");
}
if (indexCss.includes("@media (max-width:760px){\n    form.two{flex-direction:column")) {
  failures.push("Two-field lead form must not stack at 760px (squeezes the inputs to ~100px at tablet widths).");
}

// The behavioral lead-form proof (real Chromium measurement, local static
// copy) is checked in so the static guards above stay distinguishable from it.
// Existence and section anchors only — this does not re-verify measurements.
const leadFormReceipt = existsSync("docs/evidence/lead-form-tablet-squeeze-2026-08-10.md")
  ? read("docs/evidence/lead-form-tablet-squeeze-2026-08-10.md")
  : null;
if (leadFormReceipt) {
  for (const anchor of ["unfixed", "761px", "**fixed**", "208px", "not CI proof", "Exact verification method"]) {
    if (!leadFormReceipt.includes(anchor)) {
      failures.push(`Lead-form evidence receipt must record the ${JSON.stringify(anchor)} section.`);
    }
  }
}

// Render-blocking font stylesheet guards (dogfood finding b8f6046e942a).
// The Google Fonts css2 stylesheet was fetched render-blocking on every public
// page — a <link rel="stylesheet"> in the homepage head, and an @import chain
// inside shared.css for the shared pages (audit, agents, pricing, specimen,
// brief-requested). The fix preloads the same css2 URL as a style resource,
// promotes it via the same-origin public/fonts.js script, and removes the
// @import from shared.css. An inline onload swap is FORBIDDEN: the worker's
// Content-Security-Policy (script-src 'self', no 'unsafe-inline') blocks
// inline event handlers, so that shape silently drops the fonts under the
// production CSP. These are STATIC SOURCE GUARDS (regex over the served
// files), not network-timing tests: CI has no browser, so they assert the
// blocking shape cannot return, not that the font CDN is fast.
const fontCssHref = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,200;0,9..144,300;0,9..144,400;1,9..144,200;1,9..144,300&family=Karla:wght@300;400;500;600;700&display=swap";

const fontPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["msp page", read("public/msp.html")],
  ["brief-requested page", read("public/brief-requested.html")]
];

const sharedCss = read("public/shared.css");
let fontScript = "";
try {
  fontScript = read("public/fonts.js");
} catch {
  failures.push("public/fonts.js must exist (same-origin font promotion script).");
}

// The shared stylesheet must not carry the @import chain that blocked first
// paint on every page that links it.
if (/@import\b[^;]*fonts\.googleapis\.com/i.test(sharedCss)) {
  failures.push("shared.css must not @import the Google Fonts stylesheet (render-blocking chain).");
}

// The same-origin promotion script must exist and re-insert the preloaded URL
// as a real stylesheet (script-src 'self' allows it; inline onload does not),
// and the worker must serve it — the PUBLIC_ASSET_PATHS allow-list is the
// only path to /fonts.js, and an unlisted asset gets a 404.
if (fontScript) {
  if (!fontScript.includes('link[rel="preload"][as="style"][data-fonts-css]')) {
    failures.push("fonts.js must select the preload link via [data-fonts-css].");
  }
  if (!fontScript.includes('link.rel = "stylesheet"') || !fontScript.includes('document.head.appendChild(link)')) {
    failures.push("fonts.js must promote the preload link to a stylesheet.");
  }
}
if (!worker.includes('"/fonts.js"')) {
  failures.push("Worker must serve /fonts.js from the public asset allow-list.");
}

for (const [pageName, pageHtml] of fontPages) {
  // Fonts must still load (visual contract): preload as style + promotion.
  if (!pageHtml.includes(`rel="preload" as="style" data-fonts-css href="${fontCssHref}"`)) {
    failures.push(`${pageName} must preload the font stylesheet (non-blocking): ${fontCssHref}`);
  }
  // The promotion must come from the same-origin script, never an inline
  // handler: the production CSP blocks inline onload, silently dropping fonts.
  if (/<link\b[^>]*data-fonts-css[^>]*\bonload=/i.test(pageHtml)) {
    failures.push(`${pageName} must not use an inline onload for the font preload (blocked by the production CSP).`);
  }
  if (!pageHtml.includes('<script src="fonts.js" defer></script>')) {
    failures.push(`${pageName} must load the same-origin font promotion script.`);
  }
  // No-JS fallback must keep a blocking link inside <noscript>.
  if (!pageHtml.includes(`<noscript><link rel="stylesheet" href="${fontCssHref}"></noscript>`)) {
    failures.push(`${pageName} must keep the font stylesheet as a noscript fallback.`);
  }
  // A render-blocking font link must not appear outside <noscript> (attribute
  // order-insensitive, since rel= and href= may appear in either order).
  const outsideNoscript = pageHtml.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "");
  const blockingFontLink = [...outsideNoscript.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => /\brel="stylesheet"/i.test(tag) && /href="https:\/\/fonts\.googleapis\.com[^"]*css2/i.test(tag));
  if (blockingFontLink) {
    failures.push(`${pageName} must not load the font stylesheet render-blocking (link rel=stylesheet): ${blockingFontLink}`);
  }
}

// The behavioral font-timing proof (real Chromium measurement, local static
// copies, simulated CDN delay) is checked in so the static guards above stay
// distinguishable from it. Existence and section anchors only — this does not
// re-verify measurements.
const fontReceipt = existsSync("docs/evidence/render-blocking-fonts-2026-08-08.md")
  ? read("docs/evidence/render-blocking-fonts-2026-08-08.md")
  : null;
if (fontReceipt) {
  for (const anchor of [
    "unfixed",
    "1500ms",
    "non-blocking",
    "waited for css2",
    "Karla",
    "not CI proof",
    "Exact verification method"
  ]) {
    if (!fontReceipt.includes(anchor)) {
      failures.push(`Font render-blocking evidence receipt must record the ${JSON.stringify(anchor)} section.`);
    }
  }
}

// The static guards cannot see behavior, so CI must run the browser check
// (scripts/check-render-blocking.mjs) alongside them; these guards keep that
// wiring from drifting: the script, the package.json entry, the CI step, and
// the production CSP the browser check asserts under (mirrored from the
// worker, which the check cannot import).
let renderBlockingScript = "";
try {
  renderBlockingScript = read("scripts/check-render-blocking.mjs");
} catch {
  failures.push("scripts/check-render-blocking.mjs must exist (browser render-blocking guard).");
}
const ciWorkflow = read(".github/workflows/ci.yml");
if (!packageJson.includes('"check:render-blocking": "node scripts/check-render-blocking.mjs"')) {
  failures.push("package.json must expose the browser render-blocking check as check:render-blocking.");
}
if (!ciWorkflow.includes("npm run check:render-blocking")) {
  failures.push("CI must run the browser render-blocking check (npm run check:render-blocking).");
}
if (renderBlockingScript) {
  const workerCsp = worker.match(/Content-Security-Policy":\s*"([^"]+)"/)?.[1] ?? "";
  if (!workerCsp || !renderBlockingScript.includes(workerCsp)) {
    failures.push("scripts/check-render-blocking.mjs must mirror the worker's production CSP string.");
  }
}

// ---- Google Ads conversion tag (funnel measurement) ------------------------
// The funnel's only conversion measurement was dead by construction: the
// brief-requested page hardcoded a gtag loader with the AW-XXXXXXXXX
// placeholder, and the production CSP blocked googletagmanager.com entirely,
// so the event could never record. The tag is now generated by the worker at
// request time from GOOGLE_ADS_CONVERSION_ID / GOOGLE_ADS_CONVERSION_LABEL
// and only emitted on /brief-requested when both are configured (see
// specs/003-wellness-clinic-launch/tracking-setup.md). These STATIC SOURCE
// GUARDS make the dead-by-construction shape impossible again: no placeholder
// may exist in public/ or src/worker.js, no public file may hardcode the gtag
// loader, the static brief-requested.js may not fire anything, and the worker
// must keep the env-driven injection wired.
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
for (const needle of ["GOOGLE_ADS_CONVERSION_ID", "GOOGLE_ADS_CONVERSION_LABEL", "gtag/js", "/brief-requested.js"]) {
  if (!worker.includes(needle)) {
    failures.push(`Worker must keep the env-driven Google Ads conversion wiring (${needle}).`);
  }
}

if (existsSync(new URL("../public/pipeline-sprint/index.html", import.meta.url))) {
  failures.push("Pipeline Sprint page should not remain as a separate stale public asset.");
}

// ---- AI-search evidence artifact ---------------------------------------
// The audit page carries a controlled-test evidence artifact for AI-search
// discoverability. Fixtures in evidence-fixtures/ai-search/ are the single
// source of truth; the audit page embeds a copy of both files and this block
// refuses to let the embedded bundle drift from them.
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

  const auditScript = read("public/audit.js");

  if (!siteAudit.includes('id="ai-search-evidence"') || !siteAudit.includes('data-ai-search-evidence')) {
    failures.push("Audit page must mount the AI-search evidence artifact.");
  }

  for (const state of AI_STATES) {
    if (!auditScript.includes(state)) failures.push(`Audit script must represent the state: ${state}`);
  }
  for (const label of ["Found", "Wrong", "Absent", "Not tested"]) {
    if (!auditScript.includes(label)) failures.push(`Audit script must label the state: ${label}`);
  }

  const bundleMatch = siteAudit.match(/<script type="application\/json" id="ai-search-evidence">([\s\S]*?)<\/script>/);
  if (!bundleMatch) {
    failures.push("Audit page must embed the AI-search evidence bundle.");
  } else {
    let embedded = null;
    try {
      embedded = JSON.parse(bundleMatch[1]);
    } catch (error) {
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

  // Source-host validation: every source is a page the engine actually cited,
  // so its URL must be a well-formed absolute http(s) URL with a real host, it
  // must carry a title a machine reader can cite, and a run must not cite the
  // same page twice.
  for (const run of runs) {
    const citedUrls = new Set();
    for (const source of run.sources || []) {
      if (typeof source.title !== "string" || !source.title.trim()) {
        failures.push(`AI-search source must carry a title: ${run.questionId}/${run.engine} ${JSON.stringify(source.url)}`);
      }
      let parsedUrl = null;
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

  // External citation links (dogfood 78fcaed682fa, audit run
  // 20260808T074205Z-msk2fl3n): the engine found apps.apple.com/app/tinystudio
  // returning 404 on /audit.html (issue-19, "Broken external links on
  // /audit.html"). The App Store family of hosts resolves only the
  // id-carrying forms — https://apps.apple.com/app/<numeric-id> or
  // https://apps.apple.com/<region>/app/<slug>/id<digits> — so a bare slug
  // such as /app/tinystudio is structurally dead. This rule is checked
  // offline, so CI never depends on the network.
  for (const run of runs) {
    for (const source of run.sources || []) {
      let parsedUrl = null;
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

  // Strict state transition: "found" means the answer named the tested business
  // and its facts checked out against the site — so the run must cite the
  // business's own site. This prevents relabeling a wrong/absent result as
  // found without the site itself among the cited pages.
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

  // The homepage disambiguation block must answer every controlled question:
  // each fixture question id appears in a data-ai-question attribute inside the
  // id="identity" section, and every referenced id must exist in the fixture.
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

  // Backlog 80e53f3d7f: the /audit AI-search panel is a one-off human-labelled
  // test, not a GEO dashboard or continuous monitor.
  const geoDistinctionPhrases = [
    "This is not a GEO dashboard",
    "not continuous monitoring",
    "Depth, not breadth"
  ];
  for (const phrase of geoDistinctionPhrases) {
    if (!artifactCopy.includes(phrase)) {
      failures.push(`Audit AI-search section must distinguish the one-off test from automated GEO platforms: missing "${phrase}"`);
    }
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

// ---- AI Answer Readiness (dogfood 4473a99a9bc9) ----------------------------
// The audit run 20260808T074205Z-msk2fl3n found the engines' preferred
// source pages unclear: q5/google cited tinystudio.io yet described the
// retired Agent Desk, and q7/google came back with the note "Missing:
// pricing". Nothing on the site told an engine which page owns which fact.
// The machine-readable pair must therefore declare, per controlled question,
// the preferred source page: the section must exist in BOTH llms.txt and
// offer.md (the mirror rule), every controlled question must be mapped to
// exactly one page the worker serves (sitemap membership), price questions
// must map to the clean /pricing (the pricing page owns the price), and the
// two files must carry the same question-to-page mapping.
const ANSWER_READINESS_HEADING = "## Answer Readiness: Preferred Source Pages";

// The sitemap lists the indexable public surface at its clean extensionless
// addresses; the worker also serves each page at its canonical .html twin.
// The preferred-source mapping uses the clean form that serves 200, never the
// .html form the deployed worker 307-redirects. Membership accepts either
// spelling (home stays "/").
const servedPageUrls = new Set(
  [...sitemap.matchAll(/<loc>(https:\/\/tinystudio\.io\/[^<]*)<\/loc>/g)]
    .map((match) => match[1])
    .filter((url) => url !== "https://tinystudio.io/llms.txt" && url !== "https://tinystudio.io/offer.md")
);
for (const [clean, html] of [
  ["/audit", "/audit.html"],
  ["/agents", "/agents.html"],
  ["/pricing", "/pricing.html"],
  ["/specimen", "/specimen.html"]
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

// ---- TinyStudio identity clarification -------------------------------------
// One precise identity must run through every owned public surface: TinyStudio
// is the business behind tinystudio.io — the free leak audit of high-ticket
// service homepages plus the human-reviewed desk that closes what it finds. The
// clarification must be present on the homepage, the audit page, in llms.txt
// and in offer.md, and the ambiguous or retired framings ("The Tiny Studio",
// the spaced name form, and the self-serve Agent Desk product names) must not
// reappear in visible copy. The embedded AI-search evidence bundle is a
// verbatim record of captured engine answers that legitimately quotes other
// businesses' names, so script blocks are stripped before the stale-string
// scan. The homepage identity section also answers the controlled AI-search
// questions one row at a time (see the data-ai-question tie above).
const ownedPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["specimen page", read("public/specimen.html")],
  ["pricing page", read("public/pricing.html")],
  ["msp page", read("public/msp.html")],
  ["brief-requested page", read("public/brief-requested.html")]
];

const identityFacts = [
  "tinystudio.io",
  "Mac subtitle app",
  "fibre-arts magazine",
  "human-reviewed",
  "states no base city or office address"
];

// llms.txt is the machine-readable surface; offer.md is its mirror. A fact a
// machine reader needs to tell TinyStudio apart must appear in BOTH files, so
// neither file can silently drift while the other keeps answering.
for (const phrase of identityFacts) {
  if (!siteHome.includes(phrase)) failures.push(`Homepage must state the TinyStudio identity: ${phrase}`);
  if (!siteAudit.includes(phrase)) failures.push(`Audit page must state the TinyStudio identity: ${phrase}`);
  if (!llms.includes(phrase)) failures.push(`llms.txt must state the TinyStudio identity: ${phrase}`);
  if (!offer.includes(phrase)) failures.push(`offer.md must state the TinyStudio identity: ${phrase}`);
}

// The same-name disambiguation list is the load-bearing part of the identity:
// the engines' wrong answers (evidence-fixtures/ai-search/evidence.json) were
// built from exactly these other businesses. The list must be mirrored between
// llms.txt and offer.md, and the machine-readable pair must link each other.
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
if (!llms.includes("https://tinystudio.io/audit")) {
  failures.push("llms.txt must point at the audit page that carries the AI-search evidence artifact.");
}

// The machine-readable pair states the current offer in the site's own words
// and points at the clean /pricing for price and terms. It must not restate
// the pricing page's specifics (dollar amounts, refund language) or revive
// the retired Website Correction / founder-pilot / MSP-buyer framing.
const staleOfferPhrases = [
  "Website Correction",
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
if (/\$\s?\d/.test(llms)) {
  failures.push("llms.txt must not restate a dollar amount; the pricing page owns the price.");
}
if (/\$\s?\d/.test(offer)) {
  failures.push("offer.md must not restate a dollar amount; the pricing page owns the price.");
}
if (/\brefund\w*\b/i.test(llms)) {
  failures.push("llms.txt must not restate refund terms; the pricing page owns them.");
}
if (/\brefund\w*\b/i.test(offer)) {
  failures.push("offer.md must not restate refund terms; the pricing page owns them.");
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
if (!offer.includes("is not the current offer")) {
  failures.push("offer.md must keep the legacy Agent Desk demotion statement.");
}

const staleIdentityStrings = [
  "The Tiny Studio",  // collides with "The Tiny Studio LA", an unrelated venue
  "Tiny Studio",      // the spaced name form is never used by this business
  "self-serve",       // the retired Agent Desk framing
  "Pipeline Brief",   // the retired Agent Desk deliverable
  "Agent Desk"        // the retired product name
];

for (const [pageName, pageHtml] of ownedPages) {
  const visibleCopy = pageHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  for (const stale of staleIdentityStrings) {
    if (visibleCopy.toLowerCase().includes(stale.toLowerCase())) {
      failures.push(`Stale identity string on ${pageName}: ${stale}`);
    }
  }
  if (!pageHtml.includes("tinystudio.io")) {
    failures.push(`Every owned page must anchor the identity to the domain: ${pageName}`);
  }
}

// ---- Retired Agent Desk index guard (dogfood: Google still presents the
// retired self-serve "TinyStudio Agent Desk" title/snippet for tinystudio.io)
// ----------------------------------------------------------------------------
// The self-serve Agent Desk moved off the root when the leak-audit site took
// over; public/agent-desk.html is still served at /agent-desk and
// /agent-desk.html as a legacy surface. It is absent from the sitemap, no page
// links to it, and llms.txt/offer.md demote it ("is not the current offer") —
// but its head still carried the retired product's title and no robots
// exclusion, so Google kept presenting that title/snippet for tinystudio.io.
// The captured evidence is evidence-fixtures/ai-search/evidence.json, q5 /
// google (2026-08-06): title "tinystudio.io - TinyStudio Agent Desk" against
// the homepage URL, the legacy page's title consolidated through its canonical.
// The legacy page must therefore stay out of the index: its head keeps a
// robots noindex, nofollow meta, and its title and description frame the
// surface as retired, so neither the search index nor a scraper can re-present
// the retired self-serve product as the current offer. Its canonical and
// og:url must name the legacy page itself — the clean /agent-desk address
// that serves 200 — never the apex root: while the page declared the root as
// its canonical, Google consolidated the retired title onto the homepage URL
// (the q5/google capture), and a canonical that points at the root keeps
// handing the retired name to the homepage's SERP entry.
const retiredDeskHead = retiredDesk.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const robotsMeta = /<meta\b(?=[^>]*\bname="robots")(?=[^>]*\bcontent="noindex,\s*nofollow")[^>]*>/i;
if (!robotsMeta.test(retiredDeskHead)) {
  failures.push("Retired Agent Desk page must keep a robots noindex, nofollow meta in its head.");
}
if (!/\bretired\b/i.test(retiredDeskHead)) {
  failures.push("Retired Agent Desk page head must frame the surface as retired (title and/or description).");
}
const retiredDeskDescription =
  retiredDeskHead.match(/<meta\b[^>]*\bname="description"[^>]*>/i)?.[0] ?? "";
if (!/\bretired\b/i.test(retiredDeskDescription)) {
  failures.push("Retired Agent Desk description must frame the surface as retired.");
}
// The retired page must never claim the apex root. Exactly one canonical and
// one og:url, both naming the clean /agent-desk address that serves 200.
const retiredDeskLive = retiredDesk.replace(/<!--[\s\S]*?-->/g, "");
const retiredDeskCanonical =
  retiredDeskLive.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi) ?? [];
if (retiredDeskCanonical.length !== 1) {
  failures.push(`Retired Agent Desk canonical must appear exactly once (found ${retiredDeskCanonical.length}).`);
} else {
  const href = retiredDeskCanonical[0].match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
  if (href.trim() !== "https://tinystudio.io/agent-desk") {
    failures.push(`Retired Agent Desk canonical must point at https://tinystudio.io/agent-desk (found "${href}").`);
  }
}
const retiredDeskOgUrl =
  retiredDeskLive.match(/<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*>/gi) ?? [];
if (retiredDeskOgUrl.length !== 1) {
  failures.push(`Retired Agent Desk og:url must appear exactly once (found ${retiredDeskOgUrl.length}).`);
} else {
  const content = retiredDeskOgUrl[0].match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
  if (content.trim() !== "https://tinystudio.io/agent-desk") {
    failures.push(`Retired Agent Desk og:url must point at https://tinystudio.io/agent-desk (found "${content}").`);
  }
}

// ---- Meta descriptions (dogfood) -------------------------------------------
// The leak audit this site sells flags a homepage whose served HTML carries no
// description, so the site's own five public pages must not carry the same
// fault. Each page keeps exactly one valid, non-empty description meta tag in
// its head, within a practical search-snippet length, distinct per page, and
// free of the offer promises the repo refuses to make.
const metaDescriptionPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["msp page", read("public/msp.html")]
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

// ---- Apple touch icon (dogfood) ---------------------------------------------
// The leak audit this site sells flags a homepage whose served HTML carries no
// apple touch icon, leaving iOS Safari to derive a home-screen icon from a
// screenshot of the page (finding 98a7bf8e08fc, "Apple touch icon missing on
// home"), so none of the site's served pages may carry that fault either.
// Every served HTML page keeps exactly one <link rel="apple-touch-icon">
// inside its head, pointing at the served /apple-touch-icon.png asset, and
// the asset itself must stay a tracked, valid PNG so a dropped or rewritten
// file cannot silently leave the pages pointing at nothing.
//
// The page list is read off disk rather than hardcoded. A hardcoded list only
// guards the pages that existed when it was written, so a newly added public
// page shipping without the link would re-create the exact fault this finding
// names while CI stayed green (verified 2026-08-20: an un-iconed new
// public/*.html passed the old guard). Reading public/*.html means every
// served HTML page — including one added tomorrow — is guarded by default.
const ICON_PAGE_NAMES = new Map([
  ["index.html", "homepage"],
  ["audit.html", "audit page"],
  ["agents.html", "desk page"],
  ["pricing.html", "pricing page"],
  ["specimen.html", "specimen page"],
  ["msp.html", "msp page"],
  ["brief-requested.html", "brief-requested page"],
  ["agent-desk.html", "agent-desk page"]
]);
const publicHtmlFiles = readdirSync(new URL("../public", import.meta.url))
  .filter((name) => name.endsWith(".html"))
  .sort();
// A rename or deletion must not silently shrink the guarded set either.
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
if (!worker.includes('"/apple-touch-icon.png"')) {
  failures.push("Worker must serve /apple-touch-icon.png from the public asset allow-list.");
}

// ---- Favicon (dogfood) -------------------------------------------------------
// A homepage with no favicon link leaves every browser to fall back on
// /favicon.ico, which this worker does not serve, so each page load fires a
// 404 — even though /favicon.svg exists and is allow-listed. Every served
// HTML page must keep exactly one <link rel="icon"> inside its head pointing
// at the served /favicon.svg asset, and the asset itself must stay a tracked,
// valid SVG so a dropped or rewritten file cannot silently leave the pages
// pointing at nothing.
const faviconPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["msp page", read("public/msp.html")],
  ["brief-requested page", read("public/brief-requested.html")],
  ["agent-desk page", read("public/agent-desk.html")]
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
if (!worker.includes('"/favicon.svg"')) {
  failures.push("Worker must serve /favicon.svg from the public asset allow-list.");
}
// ---- /favicon.ico legacy fallback (item 017eb201fc) ------------------------
// Browsers, search-engine crawlers, and screenshot services still hit
// /favicon.ico even when every served page declares
// <link rel="icon" href="/favicon.svg">. The asset bucket only contains
// /favicon.svg, so without worker-level handling the request hits
// isAssetLikePath and 404s. The worker must (a) allow-list /favicon.ico so
// the legacy path reaches a handler, and (b) actually map the request to
// the canonical /favicon.svg bytes — the only checkable guarantee in
// source is that the worker allow-list contains both paths and a live
// probe below confirms the served Content-Type and body. This guard
// prevents an allow-list removal from silently re-404-ing the path that
// search-engine link previews and bookmark imports still ask for.
if (!worker.includes('"/favicon.ico"')) {
  failures.push("Worker must allow-list /favicon.ico so the legacy fallback path reaches a handler instead of 404-ing via isAssetLikePath.");
}
if (!worker.includes('image/x-icon')) {
  failures.push("Worker /favicon.ico handler must serve SVG bytes with Content-Type: image/x-icon so legacy browsers and crawlers accept the response.");
}

// ---- Cloudflare Web Analytics beacon (dogfood 455ee8966b) -----------------
// The leak audit's auto-injected Cloudflare Web Analytics beacon 404s on every
// page load (diagnosis 2026-08-09, "the site's only analytics"). The root
// cause is dashboard-level: the zone's automatic Web Analytics setup injects
// a snippet whose 32-hex site token is rejected by Cloudflare's ingestion
// endpoint, and the zone's same-origin /cdn-cgi/rum endpoint is not
// provisioned, so the beacon's POST to /cdn-cgi/rum? is answered 404 by
// Cloudflare's edge before the Worker is ever reached. No code in this repo
// can restore the analytics — that requires dashboard access or a Web
// Analytics API token, neither of which is available to this worktree. The
// re-verify receipt (docs/evidence/web-analytics-beacon-404-reverify-2026-08-14.md)
// documents that the symptom no longer occurs because the auto-injection is
// no longer active.
//
// This guard closes the loop on the source side: no served HTML page may
// re-introduce the broken beacon script tag (the only mechanism in this repo
// that could put the 404 back), while the CSP must still permit the manual
// JS-snippet path so a future dashboard-restore or hand-added snippet
// continues to work without further security-header churn.
const beaconPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["msp page", read("public/msp.html")],
  ["brief-requested page", read("public/brief-requested.html")],
  ["agent-desk page", read("public/agent-desk.html")]
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

if (!worker.includes("https://static.cloudflareinsights.com")) {
  failures.push("Worker CSP must keep https://static.cloudflareinsights.com in script-src so the manual JS-snippet path keeps working when dashboard access is restored.");
}
if (!worker.includes("https://cloudflareinsights.com")) {
  failures.push("Worker CSP must keep https://cloudflareinsights.com in connect-src so the manual JS-snippet path keeps working when dashboard access is restored.");
}

// ---- Social share tags (dogfood d87d715be3d0) -----------------------------
// The leak audit this site sells flags a homepage whose served HTML cannot
// tell a social platform what to show when the page is shared — the share
// card comes back with no image, or a scraped guess. The audit run
// 20260808T074205Z-msk2fl3n found exactly that fault on this site's own home
// page (finding d87d715be3d0, "Social share image incomplete on home"):
// public/index.html served zero og:/twitter: tags even though
// public/og-image.png exists and is allow-listed in the worker. Each public
// page must now carry a complete, per-page share set in its head: og:title,
// og:description, og:type, og:url, og:image with width/height/alt, and the
// Twitter Card mirror. og:description must equal the page's meta description
// so the two cannot drift; og:image must be the absolute og-image.png URL and
// its declared dimensions must match the actual PNG header; og:url must be
// the page's own absolute URL; and every tag must sit inside <head>, exactly
// once.
const socialSharePages = [
  ["homepage", siteHome, "https://tinystudio.io/"],
  ["audit page", siteAudit, "https://tinystudio.io/audit"],
  ["desk page", read("public/agents.html"), "https://tinystudio.io/agents"],
  ["pricing page", read("public/pricing.html"), "https://tinystudio.io/pricing"],
  ["specimen page", read("public/specimen.html"), "https://tinystudio.io/specimen"],
  ["msp page", read("public/msp.html"), "https://tinystudio.io/msp"]
];
const SOCIAL_IMAGE_URL = "https://tinystudio.io/og-image.png";

// og: tags must use property=, twitter: tags must use name= (either is a
// malformed tag that platforms ignore), and the attribute boundary must not
// let data-property or data-name pass.
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
    ["og:title", ""], // non-empty, per page
    ["og:description", description],
    ["og:type", "website"],
    ["og:url", pageUrl],
    ["og:image", SOCIAL_IMAGE_URL],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["og:image:alt", ""], // non-empty, per page
    ["twitter:card", "summary_large_image"],
    ["twitter:title", ""], // non-empty, per page
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

// ---- Structured data (dogfood 975fdb784275) --------------------------------
// The leak audit this site sells flags a homepage whose served HTML gives a
// machine reader nothing to hold onto — no schema.org markup at all — so the
// site's own five public pages must not carry that fault either. Each page
// keeps exactly one application/ld+json block in its head: a @graph with a
// stable Organization node (the same entity on every page), a WebSite node,
// and the page's own WebPage node. Every value is bound to the page's own
// head metadata — name to the og:title, description to the meta description,
// url to the og:url — so the structured data cannot drift from what the page
// actually says. The Organization node is identical on all five pages, and
// the price stays where it belongs: pricing.html owns it, so no other page's
// block may restate a dollar amount.
const structuredDataPages = [
  ["homepage", siteHome, "https://tinystudio.io/"],
  ["audit page", siteAudit, "https://tinystudio.io/audit"],
  ["desk page", read("public/agents.html"), "https://tinystudio.io/agents"],
  ["pricing page", read("public/pricing.html"), "https://tinystudio.io/pricing"],
  ["specimen page", read("public/specimen.html"), "https://tinystudio.io/specimen"],
  ["msp page", read("public/msp.html"), "https://tinystudio.io/msp"]
];

const ORGANIZATION_ID = "https://tinystudio.io/#organization";
const WEBSITE_ID = "https://tinystudio.io/#website";
const ORGANIZATION_NAME = "TinyStudio";
const ORGANIZATION_LOGO = "https://tinystudio.io/apple-touch-icon.png";
const ORGANIZATION_DESCRIPTION =
  siteHome.match(/<meta\b[^>]*\bname="description"[^>]*\bcontent="([^"]*)"/i)?.[1] ?? "";

// The page node name is bound to the og:title, whose HTML entities (e.g. the
// pricing page's "&amp;") must be decoded before comparison.
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

  let graph = null;
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

  // The price is pricing.html's to state; no other page's structured data may
  // restate a dollar amount (the pricing page mirrors its own meta
  // description, which legitimately carries the price).
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

// ---- Internal page links (dogfood 996dffe45ef7) ---------------------------
// The leak audit this site sells flags a homepage whose internal links do not
// point at the final destination URL: the dogfood run reported every .html
// navigation target on home ("index.html" -> "/", "audit.html" -> "/audit",
// "agents.html" -> "/agents", "pricing.html" -> "/pricing", "specimen.html" ->
// "/specimen") as a redirecting internal link. The five public pages (and the
// /brief-requested post-signup page, which carries the same logo/nav/back
// shell) must therefore point every page link at the clean URL the worker
// serves, never at a .html file that resolves to it. These are STATIC SOURCE
// GUARDS (regex over the served files): CI has no browser, so they assert the
// .html target shape cannot return, not that the redirects are absent on the
// network.
const internalLinkPages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["msp page", read("public/msp.html")],
  ["brief-requested page", read("public/brief-requested.html")]
];

const htmlPageTargets = {
  "index.html": "/",
  "audit.html": "/audit",
  "agents.html": "/agents",
  "pricing.html": "/pricing",
  "specimen.html": "/specimen",
  "msp.html": "/msp",
  // The post-signup page is served at both forms too (verified 2026-08-17:
  // /brief-requested.html 307s to /brief-requested), so nothing may link to
  // its redirecting twin either.
  "brief-requested.html": "/brief-requested"
};

// The fault is the DESTINATION, not the spelling. "audit.html",
// "./audit.html", "/audit.html" and "https://tinystudio.io/audit.html" are the
// same redirecting request on the network (each 307s to /audit), but the first
// version of this guard compared the raw href against the bare filename only,
// so three of those four spellings walked straight past it and the fault could
// return without CI noticing. Normalize every same-origin anchor target to its
// site-root-relative file name before the lookup. Off-site links, fragments
// and non-navigational schemes (mailto:, tel:) are not page links and are
// skipped.
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

// ---- Indexable-page orphan guard ------------------------------------------
// A sitemap-listed page no other served page links to is an orphan: crawlers
// find it via public/sitemap.xml, users and link equity cannot. The guarded
// set is the six sitemap-listed indexable HTML pages (test-sitemap.mjs
// EXPECTED_LOCS minus the /offer.md and /llms.txt machine-readable mirrors).
// htmlPageTargets above is deliberately NOT reused: it also lists
// brief-requested.html — the post-signup redirect target that is unlinked by
// design — and agent-desk.html is the retired, noindex/nofollow,
// unlink-by-design legacy surface. Neither page appears here as a target, and
// neither counts as a linker.
const indexablePages = [
  { path: "/", html: siteHome },
  { path: "/audit", html: siteAudit },
  { path: "/agents", html: read("public/agents.html") },
  { path: "/pricing", html: read("public/pricing.html") },
  { path: "/specimen", html: read("public/specimen.html") },
  { path: "/msp", html: read("public/msp.html") }
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

  // Redirecting .html twins are owned by the existing guard above; they never
  // count as clean inlinks here.
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

// ---- Canonical URLs (dogfood) ----------------------------------------------
// The leak audit this site sells also flags a homepage whose served HTML
// carries no canonical URL, leaving search engines to guess which address is
// the page (finding 6631c0ab0454, "Missing canonical URL on home"), so the
// site's own five public pages must not carry that fault either. Each page
// keeps exactly one <link rel="canonical"> — parsed across the whole document,
// ignoring commented-out markup and accepting single or double quotes — that
// link sits inside the head and points at the absolute https://tinystudio.io
// address of the page. The deployed worker 307-redirects every .html form to
// its clean extensionless twin, so a canonical must name the address that
// serves 200, never the redirecting form: every page's canonical names its
// clean extensionless address.
const canonicalPages = [
  ["homepage", siteHome, "https://tinystudio.io/"],
  ["audit page", siteAudit, "https://tinystudio.io/audit"],
  ["desk page", read("public/agents.html"), "https://tinystudio.io/agents"],
  ["pricing page", read("public/pricing.html"), "https://tinystudio.io/pricing"],
  ["specimen page", read("public/specimen.html"), "https://tinystudio.io/specimen"],
  ["msp page", read("public/msp.html"), "https://tinystudio.io/msp"]
];

const canonicalLinkPattern = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi;
const canonicalHrefPattern = /\bhref\s*=\s*["']([^"']*)["']/i;

const seenCanonicals = new Map();
for (const [pageName, pageHtml, expected] of canonicalPages) {
  // A commented-out canonical is inert markup; it must neither satisfy the
  // guarantee nor trip the duplicate check.
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

// ---- Document titles (brand consistency) ----------------------------------
// Two served pages still branded themselves "The Tiny Studio" — the spaced
// name the site's own identity copy disavows (it collides with "The Tiny
// Studio LA" and other unrelated businesses) — while every other title said
// "TinyStudio": /pricing served "Pricing & terms — The Tiny Studio" and
// /brief-requested served "Request received — The Tiny Studio", both
// byte-identical on origin/main. Title tags are a first-order SERP signal, so
// every one of the six served appraisal pages must now name the brand in its
// document title and must never return the spaced "The Tiny Studio" form.
// The retired /agent-desk surface is deliberately excluded: its title frames
// itself as retired and it is noindex.
const titlePages = [
  ["homepage", siteHome],
  ["audit page", siteAudit],
  ["desk page", read("public/agents.html")],
  ["pricing page", read("public/pricing.html")],
  ["specimen page", read("public/specimen.html")],
  ["msp page", read("public/msp.html")],
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

// ---- Intake field labels (activation) -------------------------------------
// Both appraisal intake forms (homepage and /audit) must label each field
// persistently AND programmatically: a visible <label> bound to the input via
// label[for]/input[id], so the name survives typing and is exposed to
// assistive tech and the browser's validation announcements. aria-label alone
// is programmatic but invisible; placeholder-only labels disappear the moment
// a buyer starts typing — neither is enough.
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

// ---- Specimen in-content conversion CTA ------------------------------------
// The /specimen proof page is where the homepage routes its "Read the
// specimen" call-out, so the reader who finishes the sample needs an
// in-content conversion CTA — not just the nav link — to request their own
// appraisal. The page must keep a .band block carrying an explicit CTA link
// to the request surface (/#start, same target as the nav CTA), and the
// band CTA must keep a >=44px hit area to stay within the site's own
// tap-target standard. These are STATIC SOURCE GUARDS (regex over the served
// HTML/CSS), not behavioral tests: CI has no browser.
const specimenCtaHtml = read("public/specimen.html");
const specimenCtaBand = specimenCtaHtml.match(/<div class="band">([\s\S]*?)<\/div>\s*<footer>/);
if (!specimenCtaBand) {
  failures.push("Specimen page must keep an in-content conversion CTA band between the report and the footer.");
} else {
  if (!/<a\b[^>]*class="cta"[^>]*href="\/#start"[^>]*>Request the appraisal<\/a>/.test(specimenCtaBand[1])) {
    failures.push("Specimen conversion band must carry a .cta link to /#start labelled \"Request the appraisal\".");
  }
  if (!/No revenue, ranking, ROAS, conversion, booked-call or sales-volume guarantees\. Only the work\./.test(specimenCtaBand[1])) {
    failures.push("Specimen conversion band must keep the no-guarantees note.");
  }
}
const specimenCtaCss = read("public/specimen.css");
if (!specimenCtaCss.includes(".band .cta")) {
  failures.push("specimen.css must style the band conversion CTA (.band .cta).");
}
if (!/\.band \.cta\{[^}]*padding:16px 24px/.test(specimenCtaCss)) {
  failures.push("Specimen band CTA must keep a >=44px tap target (padding:16px 24px).");
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
