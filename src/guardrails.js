import offer from "../config/offer.json" with { type: "json" };

export const ENGAGEMENT_STATUSES = [
  "requested",
  "appraised",
  "proposed",
  "paid",
  "in_correction",
  "proved",
  "tracking",
  "closed"
];

/** @type {Record<string, string[]>} */
const ENGAGEMENT_FLOW = {
  requested: ["appraised"],
  appraised: ["proposed"],
  proposed: ["paid"],
  paid: ["in_correction"],
  in_correction: ["proved"],
  proved: ["tracking"],
  tracking: ["closed"]
};

export const ENGAGEMENT_SETTLED_STATUSES = ENGAGEMENT_STATUSES.slice(ENGAGEMENT_STATUSES.indexOf("paid"));

export const CORRECTION_LINE_STATUSES = ["draft", "proposed", "approved", "recorded", "rejected", "skipped"];

export const APPLIED_LINE_STATES = ["approved", "recorded"];
export const CUSTOMER_PENDING_STATES = ["proposed"];
export const CUSTOMER_DECIDED_STATES = ["approved", "skipped"];
export const REVIEWED_LINE_STATES = [...APPLIED_LINE_STATES, "rejected"];
export const RECORD_LINE_STATES = [...REVIEWED_LINE_STATES, ...CUSTOMER_PENDING_STATES, ...CUSTOMER_DECIDED_STATES];

/** @type {Record<string, string[]>} */
const CORRECTION_FLOW = {
  draft: ["proposed", "rejected"],
  proposed: ["approved", "draft", "skipped"],
  approved: ["recorded"],
  recorded: [],
  rejected: [],
  skipped: []
};

export const DENIED_ACTIONS = new Map([
  [
    "send_email_as_customer",
    "no agent sends email as the customer or on the customer's behalf"
  ],
  [
    "publish_customer_site",
    "nothing reaches the customer's live site without the customer's written approval"
  ],
  [
    "spend_customer_money",
    "no agent spends the customer's money; the customer pays through the checkout themselves"
  ],
  [
    "change_legal_copy",
    "legal copy changes only with the customer's written consent on file"
  ]
]);

/** @param {string} action */
export function assertAllowedAction(action) {
  const denied = DENIED_ACTIONS.get(action);
  if (denied) throw new Error(`guardrail blocks ${action}: ${denied}`);
}

/** @param {string} action */
export function isAllowedAction(action) {
  return !DENIED_ACTIONS.has(action);
}

/** @param {string} from @param {string} to */
export function assertEngagementStatus(from, to) {
  if (!ENGAGEMENT_STATUSES.includes(from) || !ENGAGEMENT_FLOW[from]?.includes(to)) {
    throw new Error(`illegal engagement transition: ${from} -> ${to}`);
  }
}

const ENGAGEMENT_ACTIONS = new Map([
  ["proposed", ["send_checkout"]],
  ["paid", ["add_correction_line"]],
  ["in_correction", ["add_correction_line", "review_correction_line", "decide_correction_line"]],
  ["proved", ["add_kickoff_note"]],
  ["tracking", ["add_tracking_note", "close_out", "set_specimen_consent"]],
  ["closed", ["set_specimen_consent"]]
]);

/** @param {Pick<EngagementRow, "status"> | null | undefined} engagement @param {string} action */
export function engagementAllows(engagement, action) {
  const denied = DENIED_ACTIONS.get(action);
  if (denied) throw new Error(`guardrail blocks ${action}: ${denied}`);
  return ENGAGEMENT_ACTIONS.get(engagement?.status ?? "")?.includes(action) ?? false;
}

/** @param {string} from @param {string} to */
export function assertCorrectionLineStatus(from, to) {
  if (!CORRECTION_LINE_STATUSES.includes(from) || !CORRECTION_FLOW[from]?.includes(to)) {
    throw new Error(`illegal correction line transition: ${from} -> ${to}`);
  }
}

/** @param {Pick<CorrectionLineRow, "id" | "status">[]} lines */
export function assertPublishableLines(lines) {
  for (const line of lines) {
    if (line.status !== "approved" && line.status !== "recorded") {
      throw new Error(`correction line ${line.id} is ${line.status}; only approved lines publish`);
    }
  }
}

/** @param {{ legalCopy?: unknown, consentReceived?: unknown } | null | undefined} line */
export function assertLegalCopyConsent(line) {
  if (Number(line?.legalCopy) === 1 && !line?.consentReceived) {
    throw new Error("legal copy change needs the customer's written consent on file");
  }
}

export function offerPriceCents() {
  return offer.priceCents;
}

export function offerCurrency() {
  return offer.currency;
}
