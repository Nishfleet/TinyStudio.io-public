=== TinyStudio Connector ===
Contributors: tinystudio
Tags: seo, rest-api, yoast-seo, headless
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Lets an approved TinyStudio change write the SEO fields a Yoast SEO site keeps out of reach of outside tools, through WordPress's own REST API.

== Description ==

Yoast SEO's REST API is documented as read-only (https://developer.yoast.com/customization/apis/rest-api/). Without this connector, a paid repair on a Yoast site cannot change a page's search description, preferred address or hide-from-search setting, and the fault we found becomes a to-do list for the owner.

The connector registers exactly those fields, and nothing else, for writing through WordPress's own core REST API (`/wp/v2`). It uses WordPress's own application passwords for sign-in. It adds no routes, no settings page, no options and no tracking.

= What can be written, per SEO plugin =

With the connector active:

* **Yoast SEO** — these fields become writable through `/wp/v2` for public post types:
  * `_yoast_wpseo_metadesc` (search description) — on every public post type except `post`. For `post`, Yoast itself already registers the field for REST writes on current versions, and the connector leaves Yoast's own registration untouched.
  * `_yoast_wpseo_canonical` (preferred address) — everywhere; must be an absolute `http(s)` address, rejected otherwise.
  * `_yoast_wpseo_meta-robots-noindex` (hide from search) — everywhere; only Yoast's own values `0` (post type default), `1` (noindex) and `2` (index) are accepted.
* **Rank Math SEO** — nothing. Its own `/rankmath/v1/updateMeta` REST route already writes titles, descriptions and robots settings, and the tests prove it.
* **All in One SEO** — nothing. Its own `aioseo_meta_data` field on the core REST endpoints already writes titles, descriptions, canonical addresses and robots settings, and the tests prove it.

Without the connector, on Yoast SEO, the three fields above are read-only over REST: an outside tool can read them but cannot change them.

Writes require an application password of a user who can edit the post (`edit_post`). Script tags in descriptions are stripped, non-URL addresses are rejected, unknown values are rejected and unknown keys are ignored.

Deactivating the plugin removes the fields from the REST API and leaves every stored value exactly as it is. The plugin stores nothing of its own, so uninstalling has nothing to clean.

== Installation ==

1. In your WordPress admin, open Plugins → Add New Plugin → Upload Plugin.
2. Upload `tinystudio-connector.zip` and activate it.

No configuration is needed. Sign-in stays WordPress's own application passwords.

== Frequently Asked Questions ==

= Does it change what Yoast writes to the page? =

No. The connector only makes the fields writable through WordPress's REST API; Yoast keeps rendering the head, from the values that were changed.

= Does it remove or change core REST fields? =

No. It adds fields. It never changes or removes a core response.

= What about other SEO plugins? =

Rank Math and All in One SEO already accept SEO writes over REST and are left alone. The plugin registers nothing for any SEO plugin it does not recognize.

== Changelog ==

= 1.0.0 =
Initial release.
