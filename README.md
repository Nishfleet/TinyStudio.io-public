# TinyStudio.io

TinyStudio is a boutique that finds where a high-ticket service website loses money, proves it, fixes it, and proves the fix. The offer is the Website Correction: $10,000 per site, six a month, with a free Appraisal first.

## Current plan

[docs/PLAN.md](docs/PLAN.md) is the single current plan. It defines the pages, the architecture and the milestones. Specs 001 to 004 are superseded by the plan and have been removed.

## Pages

- `/` the pitch and the appraisal request form
- `/appraisal` what the appraisal is and how the six-a-month queue works
- `/pricing` the price and terms
- `/specimen` a specimen appraisal of a public site
- `/contact`, `/privacy`, `/terms`
- `/llms.txt` and `/offer.md`, the agent-readable offer
- `/brief-requested` the confirmation page after a request

The plan also lists `/correction`, `/method` and `/records/{id}`; these are built in milestones M1 to M3.

## Endpoints

- `/api/signups` stores an appraisal request in Cloudflare D1.
- `/api/agent-audit` is the existing audit generation endpoint. It runs at most 50 times a day across all callers, and setting `AGENT_AUDIT_DISABLED=1` turns it off.
- `/api/engagements/checkout` starts the Dodo checkout for the record's engagement, and returns the checkout URL the record page sends the customer to.
- `/api/webhooks/dodo` receives the signed Dodo payment event. The signature is verified before an engagement opens, and a replayed event opens nothing new.
- `/desk` is the reviewer's queue, and `/api/desk/correction-lines`, `/api/desk/correction-lines/{id}/review` and `/api/desk/kickoff` write the correction lines, the review decisions and the kickoff note. All four answer 503 until `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set, and every write is journalled with the reviewer and the time.
- `/health` reports readiness.
- `app.tinystudio.io` and `api.tinystudio.io` answer with a 410 retirement response.

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
