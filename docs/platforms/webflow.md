# Webflow lane design

**Status:** design only, no lane. Reason: the code lane (#152) and the WordPress
lane (#153) have not merged. Until a lane exists, Webflow customers get the free
fix files and steps and are not charged (docs/platforms/README.md).

## Access without a password

Two official doors, both granted in the owner's name:

1. **Site token.** The site administrator opens Site settings → Apps &
   integrations → API access and generates a token with the scopes the work
   needs. Up to 5 tokens per site; a token expires after 365 days of inactivity
   and can be revoked at any time. The owner's password is never shared.
2. **OAuth authorization-code grant.** The owner is shown the permission screen
   and authorizes specific sites; only workspace administrators can view a
   client secret.

Sandbox share links (temporary changes that are not saved) and comment-only
links are for showing a draft to the owner, never for applying fixes.

Sources: [site token](https://developers.webflow.com/data/v2.0.0/reference/authentication/site-token.md),
[OAuth](https://developers.webflow.com/data/v2.0.0/reference/oauth-app.md),
[sandbox links](https://help.webflow.com/hc/en-us/articles/33961254829843-Invite-new-Workspace-members-or-share-a-sandbox-site-link).

## What the platform permits and blocks

- **Permits** (Data API v2, scoped): page metadata (title, description, slug,
  noindex, open-graph), static page content, component content, CMS collections
  and items, custom code (Data Client apps only), site publish, URL redirects
  (site configuration), assets.
- **Blocks:** the Designer canvas and style system are not API-writable — a fix
  that needs a new visual layout is out of scope for this lane. Site tokens
  cannot access the custom code endpoints; that needs a registered Data Client
  app. Publishing is rate-limited to one successful publish queue per minute.
  Billing, plans and workspace seats are never part of the fix.

Sources: [scopes](https://developers.webflow.com/data/v2.0.0/reference/scopes.md),
[publish site](https://developers.webflow.com/data/v2.0.0/reference/sites/publish.md).

## Preview

Publish only to the **Webflow staging subdomain** (`yoursite.webflow.io`) and
leave the custom domain unchecked: the API's publish endpoint takes
`publishToWebflowSubdomain` separately from the custom domains. The staging
subdomain sits on the Public Suffix List and can be kept out of search indexes.
Custom-code changes are visible in Webflow's preview mode.

Sources: [staging subdomain](https://help.webflow.com/hc/en-us/articles/33961419650067-Webflow-staging-subdomain),
[publish site](https://developers.webflow.com/data/v2.0.0/reference/sites/publish.md),
[custom code preview mode](https://developers.webflow.com/data/docs/custom-code-preview-mode.md).

## Undo

Webflow keeps **backups**: a restore point on every 50th auto-save, plus manual
backups (Command+Shift+S), with unlimited backups on all site plans. Restoring
an older backup reverts the site but does not restore everything — CMS
collection and item IDs are preserved on backups taken after 25 March 2024, and
ecommerce IDs and inventory, reCAPTCHA keys, comments and locales can be
affected by a restore. So the first undo for a single line is the line's
before-value, re-applied through the same endpoint; a full undo is a backup
restore, offered to the owner with its limits named.

Sources: [save and restore backups](https://help.webflow.com/hc/en-us/articles/33961244069395-Save-and-restore-backups).

## The method, on this platform

Audit names the fault lines → the owner approves, edits or skips each → approved
lines are applied as scoped API calls, staged by publishing to the staging
subdomain → the owner checks the staging URL → publish to the custom domain on
the owner's word → the re-check reruns the same fault query against the live
domain and proves each line.
