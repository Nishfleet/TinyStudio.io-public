# TinyStudio: The Website Correction

**Status:** current plan, set by Nish on 2026-10-12. Supersedes specs 001 to 004 and the tinystudio-in product doc.
**One line:** a boutique that finds where a high-ticket service website loses money, proves it, fixes it, and proves the fix. Six clients a month. $10,000 per site.

---

## 1. Thesis

Every self-serve SEO or conversion tool ends the same way: a list of problems the customer never fixes. SEO Fix Kit solves the proof half for people who will do the work themselves. TinyStudio is for the owner who will not touch the site and should not have to. They want one firm to find the faults, show the cost of each fault in money, fix them, and show the result. They will pay a boutique price for that, once, and they will send their peers if the work was obviously made with care.

The bet is not "cheaper agency". The bet is "the only one that proves it". Every claim TinyStudio makes, before and after the sale, is backed by a record the customer can open. That is the moat, and it is why the price holds.

## 2. Who it is for

- **Customer:** owner or GM of a high-ticket service business. Law, dental and specialist medical, architecture, financial advice, B2B consultancies, agencies, specialist contractors. Revenue $500k to $20M. Average deal value above $2,000. The homepage is the main sales page and the owner knows it underperforms.
- **Buying moment:** they just lost a deal they should have won, a competitor's site looks sharper, or an ad spend produced visits and no calls.
- **Not for:** e-commerce, SaaS self-serve, content publishers, anyone who wants a dashboard, anyone who wants ongoing SEO retainers.

## 3. The offer

**The Website Correction. $10,000 per site. Six a month.**

Included, in this order, with an artifact at each step:

| Step | What the customer gets | Artifact |
|---|---|---|
| 1. Appraisal (free, gated) | Every fault on the homepage and the three pages that matter, named in order of what it costs them per month | The Appraisal Record |
| 2. Proposal | A fixed scope and price, the fault list they are buying out of, and what is not included | The Proposal |
| 3. Correction | Copy rewrite, technical SEO repair, conversion fixes, speed fixes, implemented on their site or handed over dev-ready | The Correction Record |
| 4. Proof | Rerun of the appraisal on the corrected site, before and after side by side | The Proof Receipt |
| 5. Tracking | 14 days of watching rankings, speed and conversion events, then a close-out note | The Close-out |

Explicitly not included: new brand identity, new site build from scratch, paid ads, content marketing, monthly retainers, guarantees of revenue. The no-guarantee language carries over from tinystudio-in's service contract: TinyStudio promises proof, not outcomes.

**Why six a month:** one reviewer can hold six sites in their head with full attention. Scarcity is real, not a marketing line, and it is the reason a waitlist exists.

**Why $10,000:** the good boutiques charge $10,000 to $30,000 for homepage positioning sprints (FletchPMM) and $5,000 to $25,000 for one-off conversion work (Growth Rock). None of them bundle the fix and the proof. TinyStudio does, at the bottom of that band, with a visible path to revenue-tiered pricing later.

## 4. Brand and voice

The name stays TinyStudio. "Tiny" means a small desk that does whole work, not a small ambition.

Voice rules, applied to every page, email and record:

1. **Name the fault, name the cost, name the fix.** Never "improve your SEO". Always "your contact form drops 38% of mobile visitors at the phone field; that is about $4,100 a month at your close rate".
2. **Plain, calm, specific.** No exclamation marks. No "unlock", "supercharge", "elevate". Numbers over adjectives.
3. **Proof before promise.** Every claim links to the record that supports it. If there is no record, the sentence does not ship.
4. **Short sentences, long thinking.** Copy reads like a letter from a senior partner, not a landing page.
5. **The customer is the subject.** "Your site loses…", "you will receive…", never "we are passionate about…".

Reference points for tone: Stripe's product pages (precise, unhurried), Basecamp's long-form (opinionated, plain), a good law firm engagement letter (clear scope, clear limits).

## 5. Design system

Target: the customer should feel the site was made by the same kind of people who made Stripe. Not Stripe's colours, Stripe's discipline.

- **Tokens:** keep the cream, ink and brass palette from the current `shared.css`. Add a strict type scale (one serif for display, one sans for UI and body, tabular numerals everywhere money appears), a 4-point spacing scale, and two elevation levels only.
- **Motion:** only state changes animate, 150 to 250 ms, ease-out. Nothing moves to decorate.
- **Components (all built once, used everywhere, including emails and records):** page header, section header, fault card (name, cost per month, severity, fix), proof pair (before/after with delta), record header (client, date, reviewer, record id), signature block, waitlist form, proposal table, timeline, footnote citation.
- **Pages:**
  - `/` The pitch, three fault examples with real costs, the specimen link, the request form.
  - `/appraisal` What the appraisal is, what a record looks like, how the six-a-month queue works.
  - `/correction` The full offer, the five steps, the price, what is not included.
  - `/specimen` One public appraisal of a well-known site, redone monthly. This is the sales page.
  - `/records/{id}` The customer's records. Static, shareable by link, printable, no login. This is the product's receipt, in the way a Stripe receipt is a product.
  - `/method` How faults are costed, how proof is run, what the desk refuses to do.
  - `/terms`, `/privacy`, `/contact`, `llms.txt`, `offer.md`.
- **Quality bar:** Lighthouse 100 on every page, zero layout shift, every page readable with CSS off, print stylesheet on every record.

## 6. The customer journey, end to end

Each step names the trigger, the human action, the system action and the artifact. Nothing happens without a record.

**6.1 Discover.** The customer arrives from a referral, the specimen, or an AI answer (llms.txt and offer.md keep the answer-readiness map current). No ads.

**6.2 Request the appraisal.** Form: site URL, business type, approximate average deal value, monthly leads, name, email. The six-a-month counter is real and shown. If the month is full, the form becomes a waitlist with the next open slot date. System: creates the request in D1, sends one confirmation email, queues the audit on the SEO Fix Kit engine.

**6.3 Appraisal built.** System: SEO Fix Kit engine crawls the site, produces faults with evidence. TinyStudio's costing layer converts each fault into a monthly cost estimate using the customer's deal value and lead count and documented conversion deltas. Human: the reviewer reads every fault, removes anything not worth the customer's attention, writes the one-paragraph summary. Artifact: the Appraisal Record at `/records/{id}`, emailed as a link, with a PDF.

**6.4 Proposal.** The record ends with the proposal: which faults the Correction removes, the price, the start date, the two things TinyStudio needs (site access and one decision-maker). Payment link (Dodo Payments, already wired in SEO Fix Kit, reused). Human: the reviewer sends it personally. No automation touches the customer's inbox twice in a day.

**6.5 Kickoff.** Trigger: payment received. System: opens the engagement, generates the access checklist. Human: 30-minute call, confirm owners, confirm what must not change (brand words, legal copy, phone numbers). Artifact: the Kickoff note, appended to the record.

**6.6 Correction.** Work is done in a branch or a staging copy, never live first. The service-contract guardrails from tinystudio-in apply: the desk never sends email on the customer's behalf, never publishes without approval, never spends their money, never changes legal copy without written consent. Each fix is a line in the Correction Record with before, after, and the fault it closes. Human: the reviewer approves every line before it goes live. Timeline: 10 working days.

**6.7 Proof.** System: reruns the appraisal on the corrected site. Artifact: the Proof Receipt, before and after side by side with the delta per fault, the same layout as the Appraisal Record so the customer can compare page to page.

**6.8 Tracking.** 14 days. System: daily check of speed, index status, key rankings, and form or call events if the customer allows a tag. Human: one note at day 7, one at day 14. Artifact: the Close-out, which ends the engagement and opens the referral.

**6.9 Referral and return.**
- The Close-out asks one question: "Who else should see their record?" A referred business skips the waitlist for the current month.
- With consent, the client's proof pair joins the specimen gallery. Clients refer when their own result is on the wall.
- Every 90 days, the system reruns the appraisal silently. If the site has drifted (new faults above a cost threshold), the customer receives one email with the new record and no sales copy. That is the only outbound TinyStudio sends. It is how customers come back when they have the need and not before.

## 7. Engine and architecture

- **Runtime:** one Cloudflare Worker (the current `src/worker.js`, rebuilt on Hono to match SEO Fix Kit), D1 for requests, engagements and records, R2 for PDFs and crawl evidence, a queue for audits, email via Cloudflare.
- **Engine:** SEO Fix Kit is a service, not a fork. TinyStudio calls its audit, uses its implementation-pack format for the fix list and its proof-receipt format for the rerun. Branding and the costing layer live in TinyStudio only. If the engine lacks an endpoint, the change is made in SEO Fix Kit so both products gain it.
- **Costing layer (TinyStudio-only):** fault type to conversion-delta table with cited sources, multiplied by the customer's deal value and lead volume. Every number in a record traces to a row in this table and to the customer's inputs.
- **Records:** static HTML rendered once per state change, stored in R2, served at `/records/{id}` with an unguessable id. No login, no dashboard, no app. Printable. The record is the product surface.
- **Payments:** Dodo Payments checkout, one product, one price, webhook signed and verified before an engagement opens.
- **Desk tooling:** internal only, behind Cloudflare Access. A queue view, the review screen for a record, approve or reject per line. Nothing the customer sees.
- **Guardrails:** `service-contract` rules ported from tinystudio-in as a module with tests: denied actions, state machine (requested, appraised, proposed, paid, in correction, proved, tracking, closed), no-guarantee copy.
- **Observability:** every state change is an event row. Weekly scorecard from those rows, nothing else.

## 8. Operations

- **Roles:** one reviewer owns every engagement end to end. Agents draft, the reviewer decides. The reviewer's name is on every record.
- **Checklists (ported from tinystudio-in growth-brain, trimmed):** appraisal review, correction approval, proof sign-off, close-out.
- **Quality gates:** no record ships with an uncited number. No fix goes live without a before capture. No email goes out without a record link. These are tests in CI against rendered records, not policy lines.
- **Service levels:** appraisal within 5 working days of request. Correction within 10 working days of kickoff. Proof within 2 days of correction. Written into the proposal.

## 9. Growth

- **The specimen.** Once a month, a public appraisal of a well-known service firm's homepage, costed and written exactly like a paid record. It is the best ad and the only one.
- **Answer-readiness.** `llms.txt` and `offer.md` stay current so AI answers describe the offer correctly.
- **Referral first.** Every close-out opens a referral. Referred businesses get the month's priority.
- **No ads, no cold outreach, no content calendar.** If the records are good, they travel.

## 10. Metrics

| Metric | Target by month 6 |
|---|---|
| Appraisals delivered per month | 6 |
| Appraisal to paid Correction | 50% |
| Mean cost-per-month removed per site, proven | published on the method page |
| Clients who refer without being asked | 1 in 2 |
| Clients who return on a drift email within 12 months | 1 in 3 |
| Records with an uncited number | 0 |

## 11. Milestones

Each milestone has a finish line and a proof. A milestone is done when the proof exists, not when the code merges.

- **M0. One clean repo (this week).** TinyStudio.io-public is the only repo. Retired Agent Desk surfaces, specs 001 to 004 and dead pages removed. README points at this plan. tinystudio-in archived. Proof: repo tree matches section 5 and 7, CI green.
- **M1. The site and the appraisal flow (2 weeks).** New design system, the seven pages, the request form with the real six-a-month counter, audit queued on the SEO Fix Kit engine, the Appraisal Record rendered and emailed. Proof: one real appraisal of a real site delivered end to end, record link opens, Lighthouse 100.
- **M2. Proposal, payment and correction (3 weeks).** Proposal block, Dodo checkout, engagement state machine, guardrails module, desk review screen, Correction Record. Shipped 2026-10-28 on `orch/issue-47`: the engagement table and its journal are in `migrations/0007_engagements.sql`, the state machine and the denied actions are in `src/guardrails.js`, checkout and the signed webhook are in `src/payments.js`, and the reviewer's queue is in `src/desk.js` behind Cloudflare Access. Proof still owed: one test payment opens a real engagement and a correction line goes from draft to approved to recorded, because that needs the Dodo keys and the Access application on the live zone.
- **M3. Proof, tracking, referral, return (2 weeks).** Proof Receipt, 14-day tracking, Close-out with referral, 90-day drift rerun. Shipped 2026-10-30 on `orch/issue-48`: the receipt and the drift rerun are in `src/record.js` with their tables in `migrations/0008_proof_receipts.sql`, the nightly clock queues the drift rerun jobs and the day-7 and day-14 notes in `src/tracking.js`, the Close-out and its referral are in `src/desk.js` with `src/record.js` rendering the page, and the specimen wall reads the consented proof pairs in `src/worker.js`. A proof receipt is written only by a real engine rerun; the desk's republishes re-render the stored record and write none. Still owed before M4: the SEO Fix Kit engine consumer that reads the drift rerun jobs and the tracking checks outboxes, so the nightly queue turns into real reruns and daily checks. Proof: a full engagement runs through to Close-out on a real site, drift email fires in a test clock.
- **M4. First paid client.** The specimen published, waitlist open, one paid Correction delivered and its proof pair on the wall with consent.

## 12. Non-goals

No customer dashboard. No self-serve plan. No monthly retainer. No white label. No second brand. No feature that only exists to look busy.

## 13. Decisions

- 2026-10-12, Nish: TinyStudio goes done-for-you on the SEO Fix Kit engine at boutique price. One repo remains.
- 2026-10-12, Nish: price $10,000 per site, matching the good boutiques.
- 2026-10-12, Nish: tinystudio-in is wiped. Promptly and Drishti pages are not carried over.
- 2026-08-07, Nish: both TinyStudio repos are one product. Resolved by keeping one.
