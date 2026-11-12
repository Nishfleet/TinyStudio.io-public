# Wix lane design

**Status:** design only, no lane. Reason: the code lane (#152) and the WordPress
lane (#153) have not merged. Until a lane exists, Wix customers get the free fix
files and steps and are not charged (docs/platforms/README.md).

## Access without a password

The official door is **Roles & Permissions**. The owner opens Roles &
Permissions in the site's dashboard, clicks Invite Collaborators, enters the
collaborator's email and assigns a **predefined role** (Website Manager or
Website Designer fit the work) or a **custom role**. The invitation email or
link is valid for 30 days and the collaborator accepts it by logging in with
**their own Wix account** — the owner's password is never shared. The owner can
change the role or remove the collaborator at any time. Wix sites have 1 free
collaborator seat, Wix Studio accounts 5.

Source: [inviting people to collaborate](https://support.wix.com/en/article/inviting-people-to-contribute-to-your-site),
[roles and permissions overview](https://support.wix.com/en/article/roles-permissions-overview).

## What the platform permits and blocks

- **Permits:** within the role's permission set, site design and content, page
  SEO panel values, and apps the role is allowed to touch.
- **Blocks, for every collaborator regardless of role:** delete, duplicate or
  transfer the site; connect a domain the collaborator owns; assign or reassign
  Premium plans; purchase or manage business emails; create or change custom
  roles and permissions; invite or remove collaborators with more permissions;
  access account-wide information, the Wix Payments dashboard or refunds.
  **We do not ask for the Admin (Co-Owner) role**: it carries billing-wide
  access the work does not need.
- One editor at a time in the classic Wix Editor; concurrent editing exists only
  in the Studio Editor, so our changes are applied in one open editor session.

Sources: [information for site collaborators](https://support.wix.com/en/article/roles-permissions-information-for-site-collaborators).

## Preview

The editor's **Preview** shows the site to the collaborators without publishing
it; saving is separate from publishing, and autosave keeps the working copy.
**Publish is an explicit act that replaces the live version**, so every approved
batch is previewed first and published once, on the owner's word.

Wix also has **test sites** via the Release Manager, but publishing a test site
sets its exposure to 100% **and replaces the published version** — a test-site
publish is a live publish, so we do not use it as a preview door.

Sources: [saving, previewing and publishing](https://support.wix.com/en/article/wix-editor-saving-previewing-and-publishing-your-site),
[publishing a test site](https://support.wix.com/en/article/publishing-a-test-site).

## Undo

**Site history** holds every saved or published version with who made it and
when, and any older version can be restored; restoring erases the changes made
after that version and reverts per-page SEO panel values. A restore does not
revert Wix app content (Stores, Blog, Bookings and others), contacts, email
marketing, media galleries, the multilingual language list, site-level SEO
Settings or CMS collection content — those need item history or CMS backups.
Our per-line undo is the line's before-value, re-applied through the same role;
a batch undo is a named restore from site history, with these limits named to
the owner first.

Sources: [viewing and managing site history](https://support.wix.com/en/article/viewing-and-managing-your-site-history),
[limitations of restoring a saved version](https://support.wix.com/en/article/limitations-of-restoring-a-saved-version-of-your-site).

## The method, on this platform

Audit names the fault lines → the owner approves, edits or skips each → approved
lines are applied with the collaborator role, previewed, then published once →
the re-check reruns the same fault query against the published site and proves
each line.
