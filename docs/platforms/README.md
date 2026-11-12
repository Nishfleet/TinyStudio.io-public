# Platform lanes: designs

TinyStudio repairs on more platforms than WordPress and GitHub. This folder holds
one short written design per platform, taken from the platform's own documentation.
This is a designs-only lane (issue #158): **no code until the code lane (#152) and
the WordPress lane (#153) have merged.**

## The method, restated per platform

Every repair stays a list of exact change lines. The owner approves, edits or skips
each line. Fixed code applies only the approved lines through the platform's
official door. A re-check proves each approved change on the live site. Nobody
logs into a customer's site: access is granted to a role-scoped account or a
scoped token in the owner's name, never the owner's password.

| File | Platform | Status |
|---|---|---|
| [shopify.md](shopify.md) | Shopify | design written, no lane |
| [webflow.md](webflow.md) | Webflow | design written, no lane |
| [wix.md](wix.md) | Wix | design written, no lane |
| [ghost.md](ghost.md) | Ghost | design written, no lane |
| [cloudflare-bridge.md](cloudflare-bridge.md) | Cloudflare edge | bridge design written, never a lane |

WordPress and GitHub are separate lanes (#153, #152) and are not designed here.

## Build order: demand counted from our own requests

Platforms are built in the order TinyStudio's own requests show demand, counted
over the sites that ask for a fix (`appraisal_requests.site_url`, plus the audit
that already crawls each site).

The count needs a platform value on the request row. The schema has no platform
column today (migrations/0005_appraisal_requests.sql), and this lane adds no code,
so the count is produced in two steps:

1. **Now, by hand.** The reviewer reads the request list and names the platform
   from the site URL and the crawl evidence the audit already returns.
2. **With the code lane (#152).** The detector records a `platform` value on the
   request row at request time, and one query ranks platforms by requests per
   month. That query is the permanent count; it is part of the code lane, not of
   this one.

No count is published here: this checkout has no read on the production D1 and
there is nothing to count against yet. A number without a record contradicts the
plan's quality gate (docs/PLAN.md 8), so the first count ships with the detector
that produces it.

## Until a platform is built

Until a platform has a tested lane, its customers receive the free fix files and
the steps to apply them, and are not charged. The lane is built when demand and
the two merged lanes allow it.

## Done when

Each platform has either a tested lane or a written reason we do not offer it.
Today every platform in this folder has a written design and the same written
reason for not offering it yet: the code lane (#152) and the WordPress lane
(#153) have not merged, so there is no lane code to test against. When a lane is
built, its row above changes to "tested lane" and this file names the proof
(the re-check run) next to it.

## The Cloudflare bridge is a bridge

Wherever a customer-facing surface mentions the Cloudflare edge change, it is
labelled a bridge: it reaches platforms nothing else does, but the fix vanishes
if we are removed. It is never counted as a platform lane.
