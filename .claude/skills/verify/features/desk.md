# Desk

The desk is the reviewer's queue at `/desk`. The reviewer writes correction lines, review decisions, the kickoff note, the tracking notes, the close-out and the specimen consent.

## Sub-features

- `desk-gate` answers 503 until Cloudflare Access is set (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`).
- `desk-writes` journal every write with the reviewer and the time.

## How to get to it (user POV)

- The reviewer opens `https://tinystudio.io/desk` behind Cloudflare Access.

## Driving it with curl and node --test

Preconditions:

- DOCTOR passes.

- **Gate.** Run `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8788/desk`. Locally Access is not set, so expect `503`.
- **Writes.** Run `npm run test:desk`. It ends `# fail 0`.

## Gotchas

- No agent has a Cloudflare Access identity. Report a real desk session as not run.
