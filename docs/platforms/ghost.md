# Ghost lane design

**Status:** design only, no lane. Reason: the code lane (#152) and the WordPress
lane (#153) have not merged. Until a lane exists, Ghost customers get the free
fix files and steps and are not charged (docs/platforms/README.md).

## Access without a password

The official door is the **Admin API** with an integration key: the owner creates
a **Custom Integration** in Ghost Admin (Settings → Integrations) and the key is
exchanged for short-lived signed JWTs (five minutes at most) on every call. The
owner's password is never shared, and the key can be regenerated at any time.
If a human seat fits better, the owner invites a staff user
(`POST /admin/invites/`, role id plus email) who then works under one of Ghost's
five roles — Contributor, Author, Editor, Administrator, Owner — with their own
login, or issues a **staff access token** from that user's profile, which carries
that user's role permissions.

Sources: [Admin API](https://docs.ghost.org/admin-api),
[invites](https://docs.ghost.org/admin-api/users/invites),
[roles](https://docs.ghost.org/admin-api/users/roles),
[staff users](https://docs.ghost.org/staff).

## What the platform permits and blocks

- **Permits:** posts, pages, tags and images through the Admin API; site
  settings, including **code injection** in the site header; themes, uploaded as
  a ZIP and activated (`POST /admin/themes/upload/`,
  `PUT /admin/themes/{name}/activate/`). Uploads are validated by gscan, and
  fatal errors block the theme from being used.
- **Blocks:** integrations carry a fixed permission set; **staff tokens cannot
  transfer ownership or delete all content**, and the Owner role cannot be
  deleted. Ghost core and server configuration are outside the door. On
  Ghost(Pro) the Starter plan runs official themes only, so a custom theme
  upload needs the customer's plan to allow it.

Sources: [Admin API permissions](https://docs.ghost.org/admin-api),
[themes overview](https://docs.ghost.org/admin-api/themes/overview),
[staff users](https://docs.ghost.org/staff).

## Preview

Ghost has **no theme preview domain**, so preview is three honest gates: gscan
on the ZIP before upload; the admin theme editor, where edits are **saved
separately from going live** ("Replace theme" is the act that pushes them live);
and the editor's own preview for post and page content. A theme reaches visitors
only when it is activated, so the activation step is the approved action, taken
after the owner has seen the gates above.

Sources: [installing a theme](https://ghost.org/help/installing-a-theme),
[GScan](https://docs.ghost.org/themes).

## Undo

Settings → Site → Theme keeps the **installed theme history**: any previously
installed theme can be made active again, and copies of installed themes can be
downloaded. Undo of one theme line is re-uploading that file's before-content in
the same way it was applied; undo of a whole theme is re-activating the previous
install. Undo of a settings line is writing the before-value back. The **history
log** shows staff events per user for administrators, and all content and data
can be exported as JSON or CSV at any time, so the owner always holds a copy.

Sources: [installing a theme](https://ghost.org/help/installing-a-theme),
[history log](https://ghost.org/help/history),
[exports](https://ghost.org/help/exports).

## The method, on this platform

Audit names the fault lines → the owner approves, edits or skips each → approved
lines are applied through the Admin API (theme ZIP or settings write) behind the
preview gates → activation on the owner's word → the re-check reruns the same
fault query against the live site and proves each line.
