# TinyStudio.io

TinyStudio is a boutique that finds where a high-ticket service website loses money, proves it, fixes it, and proves the fix. The offer is the Website Correction: $10,000 per site, six a month, with a free Appraisal first.

## Current plan

[docs/PLAN.md](docs/PLAN.md) is the single current plan. It defines the pages, the architecture and the milestones. Specs 001 to 004 are superseded by the plan and have been removed.

## Pages

- `/` the pitch and the appraisal request form
- `/appraisal` what the appraisal is and how the six-a-month queue works
- `/pricing` the price and terms
- `/specimen` a specimen appraisal of a public site
- `/waitlist` the six-a-month waitlist, and the form that holds a place in it
- `/contact`, `/privacy`, `/terms`
- `/llms.txt` and `/offer.md`, the agent-readable offer
- `/brief-requested` the confirmation page after a request

The plan also lists `/correction`, `/method` and `/records/{id}`; these are built in milestones M1 to M3.

## Endpoints

- `/api/signups` stores an email signup in Cloudflare D1.
- `/api/appraisal-requests` stores an appraisal request or, when the month is full, a waitlist place in Cloudflare D1.
- `/api/appraisal-slots` reports how many of the six appraisals this month are left, and the next open slot.
- `/api/agent-audit` is the existing audit generation endpoint. It runs at most 50 times a day across all callers, and setting `AGENT_AUDIT_DISABLED=1` turns it off.
- `/api/engagements/checkout` starts the Dodo checkout for the record's engagement, and returns the checkout URL the record page sends the customer to.
- `/api/webhooks/dodo` receives the signed Dodo payment event. The signature is verified before an engagement opens, and a replayed event opens nothing new.
- `/desk` is the reviewer's queue, and `/api/desk/correction-lines`, `/api/desk/correction-lines/{id}/review`, `/api/desk/kickoff`, `/api/desk/tracking-note`, `/api/desk/close-out` and `/api/desk/specimen-consent` write the correction lines, the review decisions, the kickoff note, the day-7 and day-14 tracking notes, the Close-out and the specimen consent. All seven answer 503 until `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set, and every write is journalled with the reviewer and the time.
- `/health` reports readiness, and `app.tinystudio.io` and `api.tinystudio.io` answer with a 410 retirement response.
- The scheduled clock runs nightly at 06:17 UTC. It queues a drift rerun job for the record of any paid engagement untouched for 90 days, and one tracking check per day for every engagement in tracking, up to day 14, both in the outbox shape the SEO Fix Kit engine already reads for audit jobs; the engine consumer that picks these two queues up is still owed (docs/PLAN.md, M3). A tracking note is written at day 7 and at day 14 in the reviewer's own words.
- The Close-out waits for both notes and for the fourteen days of tracking, ends the engagement, links the record and its Proof Receipt, and asks the one question: who else should see their record. Its referral code skips the waitlist for the month it was minted in.
- A drift rerun whose new faults cost at least the `drift.minNewMonthlyCost` floor in `config/costing.json` sends one email with the record link and the receipt link. A below-threshold rerun sends nothing, and so does every rerun during an active engagement.
- Every engine rerun writes a proof receipt at `/records/{receiptId}` that sets the two runs side by side, fault by fault. The record page links its latest receipt. A desk republish (a correction review or a kickoff note) re-renders the stored record and writes no receipt.
- `/specimen` lists the proof pairs whose clients agreed to have them on the wall, with the client's own words on file. Without that agreement the pair stays off the site.
## Agent dispatch

`.github/workflows/agent-dispatch.yml` starts the agent worker on issue, comment, PR and CI events, plus a six-hourly sweep. It holds only the repo's own triggers: the logic lives once in the reusable workflow at `Nishfleet/fleet-ops/.github/workflows/agent-dispatch.yml@main`, which this stub calls.

To switch it off, disable the workflow (`gh workflow disable agent-dispatch` or the Actions tab) or delete the file. With the workflow disabled, the automatic review-and-approve path does not run, so risky PRs stay on hold until you run `gh workflow enable agent-dispatch`.

## Run and deploy

```bash
npm ci
npm test               # site check, headings, sitemap, worker, UI, contract, viewport
npm run check          # static site and link check only
npm run dev            # wrangler dev on 127.0.0.1:8788
npm run deploy:dry-run
npm run deploy         # applies D1 migrations, then wrangler deploy
```

Deploys are guarded by the machine-level `safe-deploy` wrapper.

## Boundaries

This repo holds no client folders, analytics exports, payment data or ad-platform credentials. It makes no revenue, ranking or sales-lift promises: TinyStudio promises proof, not outcomes.
