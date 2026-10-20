import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactMatches, numberMatches, byName, allNumbers, type Contact } from "@/lib/contacts";

const kevin: Contact = { id: "1", name: "Kevin Roy", number: "+12064523433", company: "All Phase Plumbing" };

describe("contact search", () => {
  it("finds a number typed the way people write it", () => {
    for (const q of ["206 452", "(206) 452-3433", "206-452-3433", "2064523433", "+1 206 452 3433"]) {
      assert.equal(contactMatches(kevin, q), true, `should match ${q}`);
    }
  });
  it("still finds by name and company", () => {
    assert.equal(contactMatches(kevin, "kev"), true);
    assert.equal(contactMatches(kevin, "all phase"), true);
  });
  it("does not match an unrelated number", () => {
    assert.equal(contactMatches(kevin, "555 0199"), false);
  });
  it("searches extra numbers too", () => {
    const withWork = { ...kevin, extraNumbers: [{ label: "Work", number: "+12065550199" }] };
    assert.equal(contactMatches(withWork, "555 0199"), true);
  });
  it("an empty query matches everything", () => {
    assert.equal(contactMatches(kevin, "   "), true);
  });
});

describe("numberMatches", () => {
  it("matches a call-log number typed loosely", () => {
    assert.equal(numberMatches("+12064523433", "206 452"), true);
    assert.equal(numberMatches("+12064523433", "999"), false);
    assert.equal(numberMatches("+12064523433", "abc"), false);
  });
});

describe("ordering and numbers", () => {
  it("sorts by name, ignoring case", () => {
    const list = [{ ...kevin, name: "zoe" }, { ...kevin, name: "Adam" }];
    assert.deepEqual(list.sort(byName).map((c) => c.name), ["Adam", "zoe"]);
  });
  it("always lists the primary number first", () => {
    const withWork = { ...kevin, extraNumbers: [{ label: "Work", number: "+12065550199" }] };
    assert.deepEqual(allNumbers(withWork).map((n) => n.number), ["+12064523433", "+12065550199"]);
  });
});
