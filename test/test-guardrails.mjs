import assert from "node:assert/strict";
import test from "node:test";
import {
  DENIED_ACTIONS,
  assertAllowedAction,
  assertCorrectionLineStatus,
  assertEngagementStatus,
  assertLegalCopyConsent,
  assertPublishableLines,
  engagementAllows,
  isAllowedAction
} from "../src/guardrails.js";

const LEGAL_FLOW = [
  ["requested", "appraised"],
  ["appraised", "proposed"],
  ["proposed", "paid"],
  ["paid", "in_correction"],
  ["in_correction", "proved"],
  ["proved", "tracking"],
  ["tracking", "closed"]
];

const ALL_STATUSES = ["requested", "appraised", "proposed", "paid", "in_correction", "proved", "tracking", "closed"];

test("guardrails: every denied action is refused by name", () => {
  for (const action of DENIED_ACTIONS.keys()) {
    assert.equal(isAllowedAction(action), false, `${action} must not read as allowed`);
    assert.throws(() => assertAllowedAction(action), new RegExp(`guardrail blocks ${action}`));
  }
  assert.equal(isAllowedAction("record_correction_line"), true);
  assert.equal(isAllowedAction("send_customer_their_own_record"), true);
  assert.doesNotThrow(() => assertAllowedAction("record_correction_line"));
});

test("guardrails: no email on the customer's behalf, no publishing without approval, no spending their money, no legal copy change without written consent", () => {
  const reasons = [...DENIED_ACTIONS.values()].join(" | ");
  assert.match(reasons, /email as the customer/);
  assert.match(reasons, /without the customer's written approval/);
  assert.match(reasons, /spends the customer's money/);
  assert.match(reasons, /written consent/);
});

test("guardrails: the legal engagement flow passes and every illegal transition throws", () => {
  for (const [from, to] of LEGAL_FLOW) {
    assert.doesNotThrow(() => assertEngagementStatus(from, to), `${from} -> ${to} is the legal step`);
  }
  for (const from of ALL_STATUSES) {
    const legal = LEGAL_FLOW.filter(([start]) => start === from).map(([, to]) => to);
    for (const to of ALL_STATUSES) {
      if (legal.includes(to)) continue;
      assert.throws(() => assertEngagementStatus(from, to), new RegExp(`illegal engagement transition: ${from} -> ${to}`), `${from} -> ${to} must be refused`);
    }
  }
});

test("guardrails: an unknown status has no legal step", () => {
  for (const status of ["", "unknown", "closed"]) {
    assert.throws(() => assertEngagementStatus(status, "closed"), /illegal engagement transition/);
  }
  assert.throws(() => assertEngagementStatus("requested", "unknown"), /illegal engagement transition/);
});

test("guardrails: a correction line moves draft to approved to recorded, and no other way", () => {
  assert.doesNotThrow(() => assertCorrectionLineStatus("draft", "approved"));
  assert.doesNotThrow(() => assertCorrectionLineStatus("draft", "rejected"));
  assert.doesNotThrow(() => assertCorrectionLineStatus("approved", "recorded"));
  for (const [from, to] of [["approved", "draft"], ["recorded", "approved"], ["rejected", "recorded"], ["draft", "recorded"]]) {
    assert.throws(() => assertCorrectionLineStatus(from, to), new RegExp(`illegal correction line transition: ${from} -> ${to}`));
  }
});

test("guardrails: only approved lines publish", () => {
  assert.doesNotThrow(() => assertPublishableLines([{ id: "l1", status: "approved" }, { id: "l2", status: "recorded" }]));
  assert.throws(() => assertPublishableLines([{ id: "l1", status: "draft" }]), /only approved lines publish/);
  assert.throws(() => assertPublishableLines([{ id: "l1", status: "rejected" }]), /only approved lines publish/);
});

test("guardrails: legal copy needs the customer's written consent on file", () => {
  assert.doesNotThrow(() => assertLegalCopyConsent({ legalCopy: 0 }));
  assert.doesNotThrow(() => assertLegalCopyConsent({ legalCopy: 1, consentReceived: true }));
  assert.throws(() => assertLegalCopyConsent({ legalCopy: 1, consentReceived: false }), /written consent/);
  assert.throws(() => assertLegalCopyConsent({ legalCopy: 1 }), /written consent/);
});

test("guardrails: each state allows only the action that state has", () => {
  assert.equal(engagementAllows({ status: "proposed" }, "send_checkout"), true);
  assert.equal(engagementAllows({ status: "paid" }, "add_correction_line"), true);
  assert.equal(engagementAllows({ status: "in_correction" }, "review_correction_line"), true);
  assert.equal(engagementAllows({ status: "proved" }, "add_kickoff_note"), true);
  assert.equal(engagementAllows({ status: "requested" }, "send_checkout"), false);
  assert.equal(engagementAllows({ status: "paid" }, "send_checkout"), false);
  assert.equal(engagementAllows({ status: "proved" }, "add_correction_line"), false);
  assert.equal(engagementAllows(null, "send_checkout"), false);
  for (const action of DENIED_ACTIONS.keys()) {
    for (const status of ALL_STATUSES) {
      assert.equal(engagementAllows({ status }, action), false, `${action} is denied in every state`);
    }
  }
});
