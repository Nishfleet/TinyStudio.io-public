# The Cloudflare bridge — a bridge, not a lane

**Label rule:** wherever a customer-facing surface mentions this option, it is
written as a **bridge**. It reaches platforms nothing else does, but the fix
vanishes if we are removed. It is offered as a bridge and labelled as one, and it
is never counted as a platform lane (docs/platforms/README.md). For customers
whose domain already runs through Cloudflare, it is the only door that can touch
a page a platform lane cannot reach.

**Status:** design only. No bridge code in this lane (#158): the code lane
(#152) and the WordPress lane (#153) have not merged.

## Access without a password

The bridge lives in the **customer's own Cloudflare account**. The owner creates
a scoped **API token** (My Profile → API Tokens) with exactly the permissions the
bridge needs, on exactly one zone, with an expiry and client IP filtering. Or the
owner adds the Worker and its route themselves from the dashboard. The owner's
account password is never shared, and the token can be rolled or revoked at any
time.

Source: [create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## What the bridge permits and blocks

Routes run a Worker **in front of proxied origins**: requests matching the route
pattern execute the Worker before reaching the origin. What the bridge can change
is the response as it passes the edge — HTML rewrites through `HTMLRewriter`,
response headers, redirects, caching rules.

What it **cannot** change is the origin itself: the CMS, the theme files, the
platform's stored content. The platform's own editor always shows the unmodified
source, so anything the bridge fixes lives in our rule set, is ours to maintain,
and is ours to remove. That is exactly why it is a bridge and not a lane.

Sources: [routes](https://developers.cloudflare.com/workers/configuration/routing/routes/),
[HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/).

## Preview

**Version URLs** (`<version-prefix>-<worker-name>.<subdomain>.workers.dev`) serve
an uploaded version before it is deployed to production, and **version overrides**
test a version against the zone's own performance and security settings. Gradual
deployments split traffic between versions by percentage, so a bridge change is
proven on a version URL and only then deployed.

Sources: [version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/),
[versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/).

## Undo

`wrangler rollback`, or Rollback in the dashboard, creates a new deployment set
to 100% of traffic for the selected version — the bridge reverts in one step.
Deleting the route disables the bridge entirely. The rule set is versioned in
TinyStudio's repository, so the bridge can be rebuilt from the record, and a
drift review compares the served page against the origin so a stale bridge is
caught.

Source: [rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## The method, on this bridge

Audit names the fault lines → the owner approves, edits or skips each → each
approved line becomes one named rule in the versioned rule set → the rule set is
proven on a version URL → deployed on the owner's word → the re-check fetches
through the edge, names the bridge in the receipt, and proves each line.
