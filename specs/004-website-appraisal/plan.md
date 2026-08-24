# Spec 004: The Website Appraisal — Implementation Plan

> Status: CURRENT. The current product contract for this repo.

The current product is The Website Appraisal — the free leak audit of
high-ticket service homepages — delivered through a human-reviewed desk
that closes what the audit finds.

## Surfaces

- /audit — the free leak appraisal surface.
- /agents — the human-reviewed desk surface.
- /pricing — pricing and terms.
- /agent-desk — the retired self-serve desk, kept as a legacy surface.
- /api/agent-audit — the legacy generation endpoint, kept operational as legacy mechanics.

## Boundaries

- No revenue, ranking, ROAS, conversion, booked-call, or sales-volume guarantees: there are no guarantees and no promises of any outcome.
- No promise of conversion lift or booked calls.
- The normalized submitted website URL is persisted in D1 alongside the email and lightweight request metadata; nothing else from the submission is stored.

## Verification

- node --test scripts/test-product-contract.mjs
- npm test
