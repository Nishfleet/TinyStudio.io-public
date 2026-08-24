# TinyStudio.io

TinyStudio's public website: The Website Appraisal — the free leak audit of
high-ticket service homepages — and the human-reviewed desk that closes what
the audit finds.

## Current Plan

The current product contract is `specs/004-website-appraisal/plan.md`. Specs
001 and 002 are historical records of the retired Agent Desk, and spec 003 is
a superseded campaign plan.

## What This Repo Owns

- The public `tinystudio.io` and `www.tinystudio.io` Website Appraisal site: the homepage, the appraisal flow, the human-reviewed desk, pricing, specimen, the MSP/IT buyer-intent page at `/msp`, and the agent-readable truth at `/llms.txt` and `/offer.md`.
- The retired self-serve Agent Desk, still served at `/agent-desk` as a legacy surface, and the legacy `/api/agent-audit` generation endpoint, which remain operational but are not the current product.
- Email capture through `/api/signups`, stored in Cloudflare D1.
- Lightweight agent usage metadata in Cloudflare D1, including daily rate-limit counters.
- The intentional retirement responses for `app.tinystudio.io` and `api.tinystudio.io`.
- Agent-readable public product truth at `/llms.txt` and `/offer.md`.

## What This Repo Does Not Own

- Any live private TinyStudio app/API product.
- Client folders, analytics exports, payment data, private sprint work, or ad-platform credentials.
- Revenue claims, ROAS claims, booked-call claims, ranking claims, sales-lift promises, autonomous ad buying, ad spend changes, campaign publishing, or ad-platform write actions.
- Storage of submitted business snapshots, optional detail inputs, weekly metrics, or generated artifacts; the public app processes submitted context to generate output and stores only email plus lightweight usage metadata.

## Commands

```bash
npm test
npm run dev
npm run deploy:dry-run
npm run deploy
```

Deploys are guarded by the machine-level `safe-deploy` wrapper.
