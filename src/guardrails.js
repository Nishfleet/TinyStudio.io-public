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

export const CORRECTION_LINE_STATUSES = ["draft", "approved", "recorded", "rejected"];

const CORRECTION_FLOW = {
  draft: ["approved", "rejected"],
  approved: ["recorded"],
  recorded: [],
  rejected: []
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

export function assertAllowedAction(action) {
  const denied = DENIED_ACTIONS.get(action);
  if (denied) throw new Error(`guardrail blocks ${action}: ${denied}`);
}

export function isAllowedAction(action) {
  return !DENIED_ACTIONS.has(action);
}

export function assertEngagementStatus(from, to) {
  if (!ENGAGEMENT_STATUSES.includes(from) || !ENGAGEMENT_FLOW[from]?.includes(to)) {
    throw new Error(`illegal engagement transition: ${from} -> ${to}`);
  }
}

export function engagementAllows(engagement, action) {
  const from = engagement?.status;
  if (from === "proposed") return action === "send_checkout";
  if (from === "paid") return action === "add_correction_line";
  if (from === "in_correction") return action === "add_correction_line" || action === "review_correction_line";
  if (from === "proved") return action === "add_kickoff_note";
  return false;
}

export function assertCorrectionLineStatus(from, to) {
  if (!CORRECTION_LINE_STATUSES.includes(from) || !CORRECTION_FLOW[from]?.includes(to)) {
    throw new Error(`illegal correction line transition: ${from} -> ${to}`);
  }
}

export function assertPublishableLines(lines) {
  for (const line of lines) {
    if (line.status !== "approved" && line.status !== "recorded") {
      throw new Error(`correction line ${line.id} is ${line.status}; only approved lines publish`);
    }
  }
}

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
