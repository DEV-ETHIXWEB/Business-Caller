import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byUrgencyThenRecency, dropResends, looksLikeLead, parseLead, type Lead } from "@/lib/leads";

// Verbatim from the live account - the exact shape the answering service sends.
const URGENT = `🔧 New Lead — URGENT

Customer: Gary
Phone: +12065711349
Address: address on file
Problem: Leaky faucet, dripping steadily from the outlet at 911 West Elm Street
Priority: urgent
Type: residential

Reply CLAIM to take this lead.`;

const ESTIMATE = `🔧 New Lead — ESTIMATE

Customer: Lucy
Phone: +18722784999
Address: 1420 14th Street, Seattle, WA, 98052
Problem: Homeowner Lucy wants a quote for hydro jetting the main sewer line from the main cleanout. Not an emergency.
Priority: estimate
Type: residential

Reply CLAIM to take this lead.`;

const base = { sid: "SM1", at: 1_700_000_000_000, toNumber: "+12064523433", fromNumber: "+12068956963" };

describe("recognising a lead", () => {
  it("accepts the summaries the service actually sends", () => {
    assert.equal(looksLikeLead(URGENT), true);
    assert.equal(looksLikeLead(ESTIMATE), true);
  });

  it("ignores ordinary texts", () => {
    for (const body of ["Hi Kevin this is amar", "", "Customer: Gary", "New Lead"]) {
      assert.equal(looksLikeLead(body), false, `should ignore ${JSON.stringify(body)}`);
    }
  });
});

describe("parsing a lead", () => {
  it("pulls out every field", () => {
    const lead = parseLead({ ...base, body: ESTIMATE })!;
    assert.equal(lead.customerName, "Lucy");
    assert.equal(lead.customerNumber, "+18722784999");
    assert.equal(lead.address, "1420 14th Street, Seattle, WA, 98052");
    assert.equal(lead.priority, "estimate");
    assert.equal(lead.jobType, "residential");
    assert.equal(lead.claimWord, "CLAIM");
    assert.match(lead.problem!, /hydro jetting/);
  });

  it("treats 'address on file' as no address, not an address", () => {
    // Otherwise the card shows a map button that goes nowhere.
    const lead = parseLead({ ...base, body: URGENT })!;
    assert.equal(lead.address, undefined);
    assert.equal(lead.priority, "urgent");
  });

  it("survives the service changing its wording", () => {
    const plain = "NEW LEAD - URGENT\nCustomer: Dana\nProblem: No hot water\n";
    const lead = parseLead({ ...base, body: plain })!;
    assert.equal(lead.customerName, "Dana");
    assert.equal(lead.priority, "urgent", "falls back to the header when there is no Priority line");
    assert.equal(lead.address, undefined);
    assert.equal(lead.customerNumber, undefined);
  });

  it("keeps the original text, so nothing is lost if a field is missed", () => {
    assert.equal(parseLead({ ...base, body: URGENT })!.raw, URGENT);
  });

  it("returns null rather than a half-built lead", () => {
    assert.equal(parseLead({ ...base, body: "just a normal text" }), null);
    assert.equal(parseLead({ ...base, body: "New Lead — URGENT\nno customer here" }), null);
  });

  it("does not let a missing field swallow the next one", () => {
    const lead = parseLead({ ...base, body: "New Lead\nCustomer: Ray\nAddress:\nProblem: Burst pipe" })!;
    assert.equal(lead.customerName, "Ray");
    assert.equal(lead.address, undefined);
    assert.equal(lead.problem, "Burst pipe");
  });
});

describe("ordering", () => {
  it("puts urgent first, then newest", () => {
    const mk = (priority: Lead["priority"], at: number, name: string): Lead =>
      ({ ...base, sid: name, at, customerName: name, priority, raw: "" }) as Lead;
    const sorted = [
      mk("routine", 300, "new-routine"),
      mk("urgent", 100, "old-urgent"),
      mk("estimate", 200, "estimate"),
      mk("urgent", 200, "new-urgent"),
    ]
      .sort(byUrgencyThenRecency)
      .map((l) => l.customerName);
    assert.deepEqual(sorted, ["new-urgent", "old-urgent", "estimate", "new-routine"]);
  });
});

describe("repeat sends vs repeat calls", () => {
  const lead = (sid: string, at: number, raw: string): Lead =>
    ({ sid, at, toNumber: "+12064523433", fromNumber: "+12068956963", customerName: "Gary", priority: "urgent", raw }) as Lead;

  const SAME = "New Lead - URGENT\nCustomer: Gary\nProblem: Leaky faucet";

  it("drops the same summary texted twice in a row", () => {
    const kept = dropResends([lead("a", 1_000_000, SAME), lead("b", 1_000_000 + 30_000, SAME)]);
    assert.deepEqual(kept.map((l) => l.sid), ["a"]);
  });

  it("keeps the same customer ringing back days later", () => {
    // The real risk: identical text is not the same job. Losing this one
    // means a job that came in simply never appears.
    const kept = dropResends([lead("a", 1_000_000, SAME), lead("b", 1_000_000 + 3 * 24 * 3600_000, SAME)]);
    assert.deepEqual(kept.map((l) => l.sid), ["a", "b"]);
  });

  it("treats whitespace-only differences as the same text", () => {
    const kept = dropResends([lead("a", 1_000_000, SAME), lead("b", 1_000_000 + 1000, SAME.replace(/\n/g, "\n  "))]);
    assert.deepEqual(kept.map((l) => l.sid), ["a"]);
  });

  it("never merges two different jobs", () => {
    const other = SAME.replace("Gary", "Lucy");
    const kept = dropResends([lead("a", 1_000_000, SAME), lead("b", 1_000_000 + 1000, other)]);
    assert.equal(kept.length, 2);
  });

  it("handles an empty list", () => {
    assert.deepEqual(dropResends([]), []);
  });
});
