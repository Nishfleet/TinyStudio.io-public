# Shopify lane design

**Status:** design only, no lane. Reason: the code lane (#152) and the WordPress
lane (#153) have not merged. Until a lane exists, Shopify customers get the free
fix files and steps and are not charged (docs/platforms/README.md).

## Access without a password

The official door is the **collaborator account**. The store owner opens
Settings → Users → Security, generates a **collaborator access code** and shares
that code with our Shopify Partner account. We submit a collaborator request with
the code; the owner approves it and assigns a role with exactly the permissions
the work needs. Our staff then log in with **their own Shopify accounts and
two-step authentication** — the owner's password is never shared. Access expires
automatically if the collaborator has not logged in for 90 days, and the owner
can remove the collaborator or regenerate the code at any time.

For theme-only work there is a second official door: the **Theme Access app**,
where the owner creates a password scoped to the `write_themes` access scope,
used by Shopify CLI. It is scoped to themes and can be deleted at any time.

Sources: [collaborator accounts](https://help.shopify.com/en/manual/your-account/users/security/collaborator-accounts),
[Theme Access](https://shopify.dev/docs/storefronts/themes/tools/theme-access).

## What the platform permits and blocks

- **Permits:** theme files (templates, snippets, assets) through the theme code
  editor or the Admin API Asset resource (`themes` access scope); theme editor
  settings; pages, blogs and menus; up to 20 themes with one published.
- **Blocks:** the checkout is locked by Shopify and is not ours to change;
  platform core, other apps' code, billing and DNS are out of reach. The
  **Administrator store role cannot be assigned to a collaborator**, nor can
  organization roles; collaborators get no Shopify POS or Point of Sales channel
  access, and ownership cannot be transferred to them. Permissions can be scoped
  per app and per channel when the request is approved.

Sources: [Theme resource](https://shopify.dev/docs/api/admin-rest/latest/resources/theme),
[Asset resource](https://shopify.dev/docs/api/admin-rest/latest/resources/asset),
[collaborator accounts](https://help.shopify.com/en/manual/your-account/users/security/collaborator-accounts).

## Preview

Duplicate the published theme first. The copy appears in Draft themes named
"Copy of …"; every approved line is applied to the duplicate, and the theme
editor previews the draft. **Customers cannot see unpublished themes.** From the
CLI, `shopify theme preview --overrides` applies virtual, in-memory changes on
top of the remote theme with **no files permanently changed** — the cleanest way
to prove a fix line before it is written.

Sources: [duplicating themes](https://help.shopify.com/en/manual/online-store/themes/managing-themes/duplicating-themes),
[theme preview overrides](https://shopify.dev/docs/storefronts/themes/tools/cli/theme-preview-overrides),
[publishing themes](https://help.shopify.com/en/manual/online-store/themes/managing-themes/publishing-themes).

## Undo

Publishing a new theme keeps the previously published theme in Draft themes with
none of its changes lost, so undo of a publish is publishing the previous theme
again. Undo of one applied line is re-applying that file's before-content
through the same door; we keep the before-content of every line for exactly
this. Deleting a theme is permanent, so we never delete: we duplicate or download
copies instead.

Sources: [publishing themes](https://help.shopify.com/en/manual/online-store/themes/managing-themes/publishing-themes),
[duplicating themes](https://help.shopify.com/en/manual/online-store/themes/managing-themes/duplicating-themes).

## The method, on this platform

Audit names the fault lines → the owner approves, edits or skips each → approved
lines are applied to a duplicate of the published theme through the official
door (code editor, Theme Access + CLI, or the Asset API) → the duplicate is
previewed → publish on the owner's word → the re-check reruns the same fault
query against the live domain and proves each line.
