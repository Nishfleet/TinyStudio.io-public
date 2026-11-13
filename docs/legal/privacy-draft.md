# Privacy policy draft for tinystudio.io

**Status:** draft for Nish to approve. Written from what the Worker actually
stores (`migrations/0001`–`0009`, `src/worker.js` and the modules it imports).
Not published yet. Every line Nish must fill starts with `NISH:`.
When approved, this text goes onto `/privacy` as HTML; do not paste the
`NISH:` markers into the page.

---

## 1. Who we are (the controller)

TinyStudio ("we", "us") operates the website tinystudio.io and the Website
Appraisal service described on it.

`NISH:` Full controller identity and address (legal name, trading name if
different, postal address or registered office, company/registration number,
VAT or tax ID if applicable).
`NISH:` Stand-in controller or team contact for holiday/writing gaps.

## 2. What we collect

We collect only what the forms on this site ask for and the technical fields
described below. We do not ask for passwords, card details on this site
(checkout happens on the payment provider's page), or website logins.

### 2.1 What you type into the forms

| Purpose | Fields stored |
| --- | --- |
| Newsletter / leak-audit signup and the self-serve agent desk signup | email address; which page you signed up on (page path); the website you want audited (agent desk only); how you were referred (referrer), when present |
| Website Appraisal request or waitlist entry | your website (site URL); what kind of business it is (business type); your average deal value per customer; your rough number of leads per month; your name; your email address; the request month; a referral code, when you quote one |
| Paid correction engagement (created for you) | kickoff note with what you asked us to change; checkout session identifier; whether you consented to your record appearing in the specimen gallery |
| Anything you write to us by email or in the desk workflow | the text you send, and the work we write back (correction before/after lines, day-7 and day-14 tracking notes) — this is our working file with you |

### 2.2 What the forms store about your visit (technical fields)

For anti-abuse and basic sign-up bookkeeping, the following technical fields are
stored when you submit a form:

- **IP address, hashed.** The IP address is combined with the day's date and
  one-way hashed (SHA-256) before storage, so we cannot see the raw address
  back. Used only to apply the daily request-per-visitor limits; the daily
  usage counters store the same hash as part of their key.
- **Email address in the usage counters.** The daily counter for the
  self-serve agent desk stores your email address in plain text as part of
  its key (`email:<date>:<your email address>`), next to the hashed-IP key
  (`ip:<date>:<hash>`), to apply the daily per-email limit.
- **User agent** (the browser string your browser sends, truncated).
- **Referrer** (the page you came from, truncated) for email signups, and the
  page path you were on when you signed up.
- **Timestamps** of each form submission and each state change.
- **Rate limiting.** Requests that flood the appraisal form are limited per
  visitor IP and email through Cloudflare's rate-limiter binding; the raw IP
  is used for the limit check and is not written into our database.

### 2.3 What we store from the payment flow

When you start checkout for the paid Website Correction, the payment provider
(Dodo Payments) takes the payment on its own pages. We store back into our
database:

- the Dodo payment identifier, webhook event identifier, product identifier,
  the amount and currency, the payment status and role, and the webhook
  payload (which may include the customer email address the payment provider
  gives us) so the engagement can be matched to the payment;
- the raw webhook event type, status and payload for failed and succeeded
  payment events, used to debug failed checkouts.

### 2.4 The analysis pipeline (self-serve agent desk)

If you use the self-serve agent desk, the business snapshot, offer, audience,
proof, and current weekly numbers you type (spend, leads, booked calls, closed
deals, cash collected, bottleneck) are processed by Cloudflare Workers AI to
draft your brief. Only your email address is stored with the run; the business
details themselves are not written to our database. The worker records that a
run happened, with the hashed IP and user agent as above.

### 2.5 The Appraisal Record (object storage)

Your appraisal is published as a PDF-like web page in an unguessable Cloudflare
R2 bucket — `records/<random-id>.html` — because it must survive every state
change without being emailed as an attachment. It is stored as HTML and
contains what you see on `/records/<id>`:

- the site URL we appraised and the name you gave;
- the faults found on your site and the evidence for each;
- your average deal value and monthly leads, and the monthly cost estimated
  from them;
- after payment: the correction record (before/after text per fault), the
  kickoff note, the reviewer's approved lines;
- the proof receipt comparing rerun to first run; the close-out with the
  day-7 and day-14 tracking notes and your personal referral code;
- the record carries a `noindex` header so search engines are told not to
  list it.

The record stays linked, unguessable, and reachable only by the link we send
you. `NISH:` Confirm how long customers get their record link (is it
indefinite?).

### 2.6 The specimen gallery (only with your say-so)

Only if the desk records that you consented (the `specimen_consent` flag), your
site URL and record link appear publicly on `/specimen` as a proof pair.
Records without the consent flag stay off that page. `NISH:` Confirm the
consent copy matches the flag exactly.

## 3. Why we keep it and the legal basis

| Data | Purpose | Legal basis |
| --- | --- | --- |
| Name, email, website, business type, deal value, monthly leads, referral code | To send the appraisal you asked for; to hold your slot on this month or the waitlist; to send the record and the confirmation | Performance of a contract (steps taken at your request before payment: GDPR Art. 6(1)(b)) |
| Deal value, monthly leads, website, faults and evidence, correction lines, tracking notes, kickoff note | To do the work you paid for and to prove the result | Performance of the consented contract for the paid correction (Art. 6(1)(b)) |
| Email, hashed IP, user agent, page path, referrer, timestamps, rate-limit counters | To stop flood and repeat abuse of the free forms and daily limits | Legitimate interests in operating a working service (Art. 6(1)(f)); IP is hashed and day-scoped for exactly this reason |
| Payment identifiers, amount, webhook payload | To match the payment to the engagement and honour anti-fraud checks | Performance of the contract (Art. 6(1)(b)), plus legal obligation to keep n.finance accounts (Art. 6(1)(c)) |
| Specimen consent and record link | To show off the work honestly | Consent (Art. 6(1)(a)) — you can withdraw; the record then leaves the gallery |
| Confirmation, record-ready, drift emails | To let you know where things stand | Legitimate interest / Art. 6(1)(b) |

`NISH:` Confirm the exact named legal basis for each row when the business
identity (Section 1) is settled. The table above is our best-call draft, not
settled advice.

## 4. Who we share it with (the processors)

We work with these processors, and nothing else:

- **Cloudflare** — hosts and serves the website; operates the D1 database and
  R2 storage where everything in this notice lives; sends transactional
  emails via Email Workers; runs Workers AI for the agent desk; provides the
  rate-limiter binding used to protect the appraisal form.
- **Google Ads** — a conversion tag is injected into the "request received"
  confirmation page (`/brief-requested`) only, when Google Ads is configured.
  It lets us count that an ad click turned into an appraisal request; it does
  not read anything you typed. No other pages carry it.
  `NISH:` Confirm whether the EEA consent / consent-mode handling for this
  single tag applies, and whether the tag stays at all.
- **Dodo Payments** — takes the $10,000 payment on its own checkout for paid
  corrections and sends us webhooks about it.

`NISH:` Confirm each processor is under the matching Data Processing
Agreement, and list any additional sub-processors the DPAs name that carry
your data.

## 5. International transfers

The processors above are global services. Cloudflare operates points of
presence worldwide, including inside the EEA, and its DPA covers transfers out
of the EEA using the European Commission's Standard Contractual Clauses.
Google Ads and Dodo Payments may transfer data outside the EEA under their own
terms. `NISH:` Confirm the DPAs include SCCs or equivalent, and fill in the
processing locations for Dodo Payments.

## 6. How long we keep it

What the code does today: every row in every table in the appendix, and every
object in the R2 records bucket, is kept until someone deletes it by hand.
Nothing is deleted on a timer, and no retention period runs in the code
today.

What follows is only what we propose; every period is open for Nish to set,
and none of it is in force yet:

| Store | Data | Proposed period (open for Nish, not settled) |
| --- | --- | --- |
| `email_signups` | email, referrer, user agent, page path, website | until you ask or the address bounces |
| `appraisal_requests`, `appraisal_waitlist` | your request fields | the appraisal year, then we delete names and emails from records still on file |
| `agent_runs`, `agent_usage_limits` | hashed IP, email-address counter keys, user agent, page path, counters | 90 days |
| `appraisal_records` (R2) and records HTML | name, website, faults, correction lines, tracking notes, referral code, specimen consent | the life of the customer's record, plus `NISH:` |
| `engagements`, `engagement_payments`, `dodo_webhook_events` | payment identifiers and payload | the statutory account / invoicing period, typically 6–10 years by jurisdiction |
| `correction_lines`, `correction_reviews`, `tracking_notes` | our working file with you and the reviewer's notes | 5 years after the close-out (defect-claim period) |
| Emails | what we sent you | the life of the engagement, plus `NISH:` |

`NISH:` Confirm which store is subject to which retention law (tax, consumer
protection, etc.) and lock the table.

## 7. Your rights

Depending on where you live and what we hold, you may be able to ask us to:

- **Access** — send you the personal data we hold about you.
- **Correct** — fix any data that is wrong.
- **Delete** — erase data we no longer need.
- **Restrict or object** — pause or stop processing that is not contract
  fulfilment, including the specimen-gallery listing at any time.
- **Portability** — give you a copy of your request in a machine-readable
  file.
- **Withdraw consent** — for anything you consented to (specimen gallery,
  marketing email if one ever exists).

`NISH:` Add any rights specific to your market (UK GDPR, PDPA, DPDP if India
owned, etc.).

How to use a right: email the address in Section 8. We answer within 30
calendar days. If you are in the EEA or UK, you may complain to your local
data authority `NISH:` name the authority and the country.

## 8. How to contact us

For any privacy question, correction, or deletion: `NISH:` contact email /
form / postal address. Confirm the published contact page agrees.

## 9. Cookies and tracking

What the code shows: the Worker sets no cookie of its own (there is no
Set-Cookie in it). The only third-party tracking we know of is the Google Ads
conversion tag on `/brief-requested` (see Section 4), which counts a page
load without reading your form data; ad tags of this kind typically set
cookies of their own. `NISH:` Confirm what the tag sets in your market,
whether it needs a consent banner, and that no other script on the site sets
a cookie.

---

## Appendix: field inventory (draft source of truth, not for publication)

Everything the code writes, per database table (`migrations/0001`–`0009`) and
R2, so Nish can check the draft against the schema:

- **`email_signups`** — `id`, `email`, `source`, `page_path`, `referer`,
  `user_agent`, `created_at`, `updated_at`, `website` (added in 0004).
- **`agent_runs`** — `id`, `email`, `source`, `page_path`, `ip_hash`,
  `user_agent`, `created_at`.
- **`agent_usage_limits`** — `bucket_key` (day-scoped counter key: either
  `ip:<date>:<SHA-256 of date and IP>`, `email:<date>:<your email address>`
  in plain text, a `checkout` or `checkout-attempt` key holding a hashed IP
  or a record id, or the global `agent-global:<date>`), `count`,
  `first_seen_at`, `updated_at`.
- **`appraisal_requests`** — `id`, `site_url`, `business_type`,
  `avg_deal_value`, `monthly_leads`, `name`, `email`, `month`,
  `referral_code`, `confirmation_sent_at`, `created_at`.
- **`appraisal_waitlist`** — `id`, `site_url`, `business_type`,
  `avg_deal_value`, `monthly_leads`, `name`, `email`, `month`, `slot_date`,
  `confirmation_sent_at`, `created_at`.
- **`appraisal_referrals`** — `code`, `referrer`, `created_at`,
  `used_request_id`, `used_at`.
- **`appraisal_audit_jobs`** — `id`, `request_id`, `status`, `created_at`.
- **`appraisal_events`** — `id`, `request_id`, `type`, `detail`, `created_at`.
- **`appraisal_records`** — `id`, `request_id`, `version`, `rendered_at`,
  `faults_json` (added in 0008), `review_json` (added in 0008).
- **`engagements`** — `id`, `request_id`, `record_id`, `status`,
  `checkout_session_id`, `kickoff_note`, `created_at`, `changed_at`,
  `specimen_consent` (added in 0009).
- **`engagement_events`** — `id`, `engagement_id`, `request_id`, `type`,
  `from_status`, `to_status`, `detail`, `created_at`.
- **`engagement_payments`** — `payment_id`, `engagement_id`, `webhook_id`,
  `product_id`, `amount_cents`, `currency`, `status`, `role`, `payload`,
  `created_at`.
- **`dodo_webhook_events`** — `webhook_id`, `event_type`, `status`, `reason`,
  `payload`, `created_at`.
- **`correction_lines`** — `id`, `engagement_id`, `request_id`, `fault_id`,
  `fault_title`, `before_text`, `after_text`, `legal_copy`, `status`,
  `reviewer`, `review_note`, `reviewed_at`, `recorded_version`, `created_at`,
  `changed_at`.
- **`correction_reviews`** — `id`, `line_id`, `engagement_id`, `reviewer`,
  `action`, `note`, `created_at`.
- **`proof_receipts`** — `id`, `request_id`, `record_id`, `before_version`,
  `after_version`, `created_at`.
- **`appraisal_rerun_jobs`** — `id`, `request_id`, `kind`, `status`,
  `created_at`.
- **`tracking_checks`** — `id`, `engagement_id`, `request_id`, `day`,
  `status`, `created_at`.
- **`tracking_notes`** — `id`, `engagement_id`, `request_id`, `day`, `note`,
  `reviewer`, `created_at`.
- **`close_outs`** — `id`, `engagement_id`, `request_id`, `record_id`,
  `receipt_id`, `referral_code`, `created_at`.
- **R2 bucket `RECORDS`** — `records/<id>.html` (Appraisal Record), the proof
  receipt object under the same key pattern, and the close-out HTML object.
