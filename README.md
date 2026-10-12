# TinyStudio.io

TinyStudio is a boutique that finds where a high-ticket service website loses money, proves it, fixes it, and proves the fix. The offer is the Website Correction: $10,000 per site, six a month, with a free Appraisal first.

## Current plan

[docs/PLAN.md](docs/PLAN.md) is the single current plan. It defines the pages, the architecture and the milestones. Specs 001 to 004 are superseded by the plan.

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
- `/api/agent-audit` is the existing audit generation endpoint.
- `/health` reports readiness.
- `app.tinystudio.io` and `api.tinystudio.io` answer with a 410 retirement response.

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
