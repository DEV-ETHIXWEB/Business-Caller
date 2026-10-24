/**
 * Reads the lead summaries the answering service texts in.
 *
 * When a call is answered by the AI receptionist rather than a person, it
 * texts over a summary of what the caller wanted - the customer's name,
 * their number, the address, the problem in their own words, how urgent it
 * is, and "Reply CLAIM to take this lead."
 *
 * Until now those landed in the Texts tab as ordinary messages, so the
 * day's new work arrived as a wall of plain text in a chat thread, mixed
 * in with everything else. Everything needed to act on a job was in there;
 * none of it was usable. Parsing them back out turns that thread into a
 * list of jobs you can call, navigate to, and claim.
 *
 * Deliberately forgiving: the wording of these messages is set by a
 * separate service that can change without warning, so a summary that has
 * lost a field, gained one, or dropped the emoji still parses. Only the
 * two things that make it a lead at all - the header and a customer name -
 * are required.
 */

export type LeadPriority = "urgent" | "estimate" | "routine";

export interface Lead {
  /** The SID of the text it came from, so it stays stable across polls. */
  sid: string;
  /** Epoch milliseconds - when the summary arrived. */
  at: number;
  /** Which of our numbers the summary was texted to. */
  toNumber: string;
  /** The number the summary came from (the answering service). */
  fromNumber: string;
  customerName: string;
  /** The customer's own number in E.164, when the summary gave one. */
  customerNumber?: string;
  address?: string;
  problem?: string;
  priority: LeadPriority;
  /** "residential", "commercial", and whatever else the service sends. */
  jobType?: string;
  /** The word to text back to take the job, when the summary names one. */
  claimWord?: string;
  /** The untouched text, so nothing is lost if the parse misses something. */
  raw: string;
}

// "New Lead", "NEW LEAD - URGENT", "🔧 New Lead — ESTIMATE". The dash may
// be a hyphen or an em dash, and the emoji may not be there at all.
const HEADER_RE = /new\s+lead\b\s*[—\-–:]?\s*([a-z]+)?/i;

function field(body: string, label: string): string | undefined {
  // Each field runs to the end of its own line. Spaces and tabs only around
  // the colon - never \s, which matches newlines: with \s an empty
  // "Address:" line swallowed the "Problem:" line underneath it and
  // reported the problem as the address.
  const re = new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.+)$`, "im");
  const value = re.exec(body)?.[1]?.trim();
  return value || undefined;
}

function readPriority(body: string, headerWord?: string): LeadPriority {
  const stated = field(body, "Priority")?.toLowerCase() ?? headerWord?.toLowerCase() ?? "";
  if (stated.includes("urgent") || stated.includes("emergency")) return "urgent";
  if (stated.includes("estimate") || stated.includes("quote")) return "estimate";
  return "routine";
}

/** Whether a message body looks like one of these summaries at all. */
export function looksLikeLead(body: string): boolean {
  if (!body) return false;
  return HEADER_RE.test(body) && /^\s*customer\s*:/im.test(body);
}

export interface ParseLeadInput {
  sid: string;
  at: number;
  body: string;
  toNumber: string;
  fromNumber: string;
}

export function parseLead(input: ParseLeadInput): Lead | null {
  const { body } = input;
  if (!looksLikeLead(body)) return null;

  const customerName = field(body, "Customer");
  if (!customerName) return null;

  const headerWord = HEADER_RE.exec(body)?.[1];

  // "address on file" is what the service sends when the caller did not
  // give one. Showing that as if it were an address, with a map button
  // that goes nowhere, is worse than showing nothing.
  const rawAddress = field(body, "Address");
  const address = rawAddress && !/^address on file$/i.test(rawAddress) ? rawAddress : undefined;

  const rawPhone = field(body, "Phone");
  const customerNumber = rawPhone && /^\+?[\d\s()-]{7,}$/.test(rawPhone) ? rawPhone.replace(/[^\d+]/g, "") : undefined;

  const claimWord = /reply\s+([A-Z]{3,})\s+to\s+take/i.exec(body)?.[1];

  return {
    sid: input.sid,
    at: input.at,
    toNumber: input.toNumber,
    fromNumber: input.fromNumber,
    customerName,
    ...(customerNumber ? { customerNumber } : {}),
    ...(address ? { address } : {}),
    ...(field(body, "Problem") ? { problem: field(body, "Problem") } : {}),
    priority: readPriority(body, headerWord),
    ...(field(body, "Type") ? { jobType: field(body, "Type") } : {}),
    ...(claimWord ? { claimWord } : {}),
    raw: body,
  };
}

const PRIORITY_RANK: Record<LeadPriority, number> = { urgent: 0, estimate: 1, routine: 2 };

/**
 * Urgent first, then newest. A leaking main from an hour ago matters more
 * than a quote request from a minute ago, which is the whole reason the
 * summaries carry a priority.
 */
export function byUrgencyThenRecency(a: Lead, b: Lead): number {
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  return rank !== 0 ? rank : b.at - a.at;
}

/** A map link for the address, for the button on a lead card. */
export function mapLink(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}
