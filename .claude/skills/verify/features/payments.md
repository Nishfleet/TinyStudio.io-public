# Checkout and Dodo webhook

On a record page the customer starts checkout for their engagement. Dodo sends a signed payment event to `/api/webhooks/dodo`, which opens the engagement once, even if the event is replayed.

## Sub-features

- `checkout-start` returns the Dodo checkout URL (`/api/engagements/checkout`).
- `webhook-verify` refuses an unsigned or badly signed event (standardwebhooks).
- `webhook-once` opens nothing new on a replayed event.

## How to get to it (user POV)

- A customer opens `/records/<id>` and chooses to start the correction.

## Driving it with node --test

Preconditions:

- `npm ci` has run. No Dodo key is used.

- **Unit proof.** Run `npm run test:payments` and `npm run test:engagements`. Both end `# fail 0`.
- **Local endpoint refuses an unsigned event.** Run `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8788/api/webhooks/dodo -H 'Content-Type: application/json' --data '{}'`. Locally it prints `503`, because no webhook secret is set. It must never be 2xx.

## Gotchas

- Real checkout needs the Dodo key and a live deployment. Production is down (#74), so report it as not run.
