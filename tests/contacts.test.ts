import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contactMatches,
  numberMatches,
  byName,
  allNumbers,
  findContactByNumber,
  nameForNumber,
  type Contact,
} from "@/lib/contacts";

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

describe("looking a number up", () => {
  const withWork: Contact = { ...kevin, extraNumbers: [{ label: "Work", number: "+12065550199" }] };
  const other: Contact = { id: "2", name: "Dana Hill", number: "+13105550123" };

  it("finds a contact by the primary number", () => {
    assert.equal(nameForNumber([withWork, other], "+12064523433"), "Kevin Roy");
  });

  // The whole point of a second number. Before this, saving someone's work
  // line did nothing: the call still showed a bare number, and the Calls tab
  // still offered to save a number that was already saved.
  it("finds a contact by a second number too", () => {
    assert.equal(nameForNumber([withWork, other], "+12065550199"), "Kevin Roy");
    assert.equal(findContactByNumber([withWork, other], "+12065550199")?.id, "1");
  });

  it("returns nothing for a stranger, and never guesses on an empty number", () => {
    assert.equal(nameForNumber([withWork, other], "+19995550000"), undefined);
    assert.equal(nameForNumber([withWork, other], ""), undefined);
    assert.equal(findContactByNumber([], "+12064523433"), undefined);
  });

  it("does not trip over a contact with no extras", () => {
    assert.equal(nameForNumber([other], "+13105550123"), "Dana Hill");
  });
});
