import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_RULES, isBlocked, shouldSilence, type CallRules } from "@/lib/callRules";

const TZ = "America/Los_Angeles";

// A Date at a given wall-clock time in Los Angeles, so the tests read the
// way the setting does rather than in UTC.
function laTime(hour: number, minute = 0): Date {
  // PDT in July is UTC-7.
  return new Date(Date.UTC(2026, 6, 15, hour + 7, minute));
}

describe("blocking", () => {
  const rules: CallRules = { blocked: ["+12065550199"], dnd: false };

  it("blocks exactly the number stored", () => {
    assert.equal(isBlocked(rules, "+12065550199"), true);
    assert.equal(isBlocked(rules, "+12065550100"), false);
  });

  it("does not block an empty or unknown caller", () => {
    assert.equal(isBlocked(rules, ""), false);
    assert.equal(isBlocked(EMPTY_RULES, "+12065550199"), false);
  });
});

describe("do not disturb", () => {
  it("is off by default", () => {
    assert.equal(shouldSilence(EMPTY_RULES), false);
  });

  it("silences everything when on with no hours set", () => {
    assert.equal(shouldSilence({ blocked: [], dnd: true }), true);
  });

  it("lets calls through inside working hours and silences outside", () => {
    // Allowed 09:00-17:00.
    const rules: CallRules = { blocked: [], dnd: true, hours: { startMinute: 9 * 60, endMinute: 17 * 60, timeZone: TZ } };
    assert.equal(shouldSilence(rules, laTime(12)), false, "midday is inside the window");
    assert.equal(shouldSilence(rules, laTime(8, 59)), true, "just before opening");
    assert.equal(shouldSilence(rules, laTime(17)), true, "the end is exclusive");
    assert.equal(shouldSilence(rules, laTime(23)), true, "late evening");
  });

  it("handles a window that runs past midnight", () => {
    // The obvious implementation (start <= now < end) silently never
    // matches for an overnight window, which would look like the setting
    // being ignored. Allowed 22:00-07:00.
    const rules: CallRules = { blocked: [], dnd: true, hours: { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: TZ } };
    assert.equal(shouldSilence(rules, laTime(23)), false, "before midnight is inside");
    assert.equal(shouldSilence(rules, laTime(2)), false, "after midnight is still inside");
    assert.equal(shouldSilence(rules, laTime(12)), true, "midday is outside");
  });

  it("falls back to always-on rather than anything unpredictable when the zone is junk", () => {
    const rules: CallRules = { blocked: [], dnd: true, hours: { startMinute: 0, endMinute: 60, timeZone: "Not/AZone" } };
    assert.equal(shouldSilence(rules, laTime(12)), true);
  });

  it("never treats a broken window as 'silence everything' by accident", () => {
    // The API refuses invalid hours rather than dropping them, because
    // dropping them while the switch stays on silently turns "quiet
    // 9pm-7am" into "turn every call away, forever". This pins the other
    // half: hours that DO parse must actually narrow the silence.
    const rules: CallRules = { blocked: [], dnd: true, hours: { startMinute: 0, endMinute: 24 * 60 - 1, timeZone: TZ } };
    assert.equal(shouldSilence(rules, laTime(12)), false, "an all-day allow window must let calls through");
  });

  it("stays off regardless of hours when the switch is off", () => {
    const rules: CallRules = { blocked: [], dnd: false, hours: { startMinute: 9 * 60, endMinute: 17 * 60, timeZone: TZ } };
    assert.equal(shouldSilence(rules, laTime(23)), false);
  });
});
