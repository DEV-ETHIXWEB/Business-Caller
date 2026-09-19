import twilio from "twilio";

// Server-only (uses the twilio SDK) - never imported from a client component.
//
// Backs the lazy "convert a plain 2-party call into a Twilio Conference"
// flow that Hold/Add Call/Merge all depend on. The very first call a
// browser places stays a plain <Dial><Number> (see app/api/voice/route.ts)
// - identical to how this app has always worked - right up until the
// moment someone actually presses Hold or Add Call for that specific call.
// Only then is it converted into a Conference behind the scenes, so the
// common case (a normal call, never held or added to) is completely
// unaffected: same caller ID, same ring/answer/hangup behavior as before.
//
// HOW THE UPGRADE WORKS (and why it's built this way):
// Redirecting the far-end leg out of the original <Dial> makes that <Dial>
// finish, and when a call's <Dial> finishes Twilio asks the <Dial>'s
// `action` URL what to do next (app/api/voice/after-dial). If there were
// no `action`, the browser leg would simply hang up at that instant - that
// was the original bug: the call dropped ~8 seconds in while the far leg
// was left stranded alone in the conference, on hold music, billing. So the
// upgrade is: (1) record that this call is being upgraded, (2) redirect
// ONLY the far leg into the conference, (3) let the browser leg follow via
// its own <Dial action>, which finds the record and joins the same room.

export interface ConferenceParticipantInfo {
  number: string;
  addedAt: number;
}

export interface ConferenceRecord {
  conferenceName: string;
  participants: Record<string, ConferenceParticipantInfo>;
}

// Thrown for failures that are the user's to know about (e.g. "the other
// party hasn't answered yet") rather than server faults, so routes can show
// the real reason instead of a generic error.
export class ConferenceUserError extends Error {}

function documentNameFor(browserCallSid: string): string {
  return `activecall_${browserCallSid}`;
}

// Calls never run this long (MAX_CALL_SECONDS in app/api/voice/route.ts is
// 4 hours), so anything older is certainly stale - given a TTL rather than
// left to accumulate in Sync forever. Also caps a conference's lifetime.
const RECORD_TTL_SECONDS = 4 * 60 * 60;

export function getConferenceClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

export async function readConferenceRecord(
  client: ReturnType<typeof twilio>,
  browserCallSid: string,
): Promise<ConferenceRecord | null> {
  try {
    const doc = await client.sync.v1
      .services(process.env.TWILIO_SYNC_SERVICE_SID!)
      .documents(documentNameFor(browserCallSid))
      .fetch();
    return (doc.data as ConferenceRecord | undefined) ?? null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function writeConferenceRecord(
  client: ReturnType<typeof twilio>,
  browserCallSid: string,
  record: ConferenceRecord,
): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  const documentName = documentNameFor(browserCallSid);
  try {
    await client.sync.v1
      .services(serviceSid)
      .documents(documentName)
      .update({ data: record, ttl: RECORD_TTL_SECONDS });
  } catch (err) {
    if (isNotFound(err)) {
      await client.sync.v1.services(serviceSid).documents.create({
        uniqueName: documentName,
        data: record,
        ttl: RECORD_TTL_SECONDS,
      });
      return;
    }
    throw err;
  }
}

async function deleteConferenceRecord(client: ReturnType<typeof twilio>, browserCallSid: string): Promise<void> {
  try {
    await client.sync.v1
      .services(process.env.TWILIO_SYNC_SERVICE_SID!)
      .documents(documentNameFor(browserCallSid))
      .remove();
  } catch {
    // Already gone, or expiring on its own via the TTL - nothing to do.
  }
}

// The authorization check every conference action relies on - a browser
// call's own CallSid is otherwise just an opaque string a client hands us,
// so this confirms Twilio's own record of that call really was placed by
// this identity before anything is done with it.
export async function callBelongsToIdentity(
  client: ReturnType<typeof twilio>,
  callSid: string,
  identity: string,
): Promise<boolean> {
  try {
    const call = await client.calls(callSid).fetch();
    return call.from === `client:${identity}`;
  } catch {
    return false;
  }
}

// Silent while waiting (waitUrl="") rather than Twilio's default hold
// music, and time-limited like the original <Dial>, so that if a leg is ever
// left alone in a conference it neither plays music nor runs unbounded.
export function conferenceJoinTwiml(conferenceName: string): string {
  const vr = new twilio.twiml.VoiceResponse();
  const dial = vr.dial({ timeLimit: RECORD_TTL_SECONDS });
  dial.conference(
    { startConferenceOnEnter: true, endConferenceOnExit: true, beep: "false", waitUrl: "" },
    conferenceName,
  );
  return vr.toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Participant sub-resources are addressed by Conference SID, not name, and
// the conference has no SID until Twilio actually executes the join TwiML
// just sent - which happens moments after the redirect returns, hence the
// short retry rather than a single lookup.
export async function resolveConferenceSid(
  client: ReturnType<typeof twilio>,
  conferenceName: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const conferences = await client.conferences.list({
      friendlyName: conferenceName,
      status: "in-progress",
      limit: 1,
    });
    if (conferences[0]) return conferences[0].sid;
    await sleep(400);
  }
  return null;
}

// Waits until both original legs have actually landed in the conference.
// Returns false if the browser leg never shows up - the caller must then
// clean up, because the far leg is by then alone in the conference.
async function waitForBothLegs(
  client: ReturnType<typeof twilio>,
  conferenceName: string,
  destinationCallSid: string,
  browserCallSid: string,
): Promise<boolean> {
  let redirectedBrowserLeg = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const conferences = await client.conferences.list({
      friendlyName: conferenceName,
      status: "in-progress",
      limit: 1,
    });
    if (conferences[0]) {
      const ids = (await client.conferences(conferences[0].sid).participants.list()).map((p) => p.callSid);
      if (ids.includes(destinationCallSid) && ids.includes(browserCallSid)) return true;
    }

    // Fallback if the browser leg hasn't followed on its own after ~2s
    // but is still alive: push it in explicitly, once.
    if (attempt === 4 && !redirectedBrowserLeg) {
      try {
        const parent = await client.calls(browserCallSid).fetch();
        if (parent.status === "in-progress") {
          redirectedBrowserLeg = true;
          await client.calls(browserCallSid).update({ twiml: conferenceJoinTwiml(conferenceName) });
        }
      } catch {
        // Fall through - the loop's timeout handles the failure.
      }
    }
    await sleep(500);
  }
  return false;
}

// Moves a plain, already-answered 2-party call into a brand new Conference.
// Idempotent: if this call was already converted by an earlier Hold or Add
// Call, just returns that. Throws ConferenceUserError for conditions the
// user should be told about; on any failure it leaves nothing behind (no
// stranded leg, no stale record).
export async function ensureConference(
  client: ReturnType<typeof twilio>,
  browserCallSid: string,
): Promise<ConferenceRecord> {
  const existing = await readConferenceRecord(client, browserCallSid);
  if (existing) return existing;

  const parent = await client.calls(browserCallSid).fetch();
  if (parent.status !== "in-progress") {
    throw new ConferenceUserError("This call isn't connected anymore.");
  }

  const children = await client.calls.list({ parentCallSid: browserCallSid, status: "in-progress", limit: 5 });
  const destinationCall = children[0];
  if (!destinationCall) {
    throw new ConferenceUserError("The other party hasn't answered yet.");
  }

  const conferenceName = `conf-${browserCallSid}`;
  const record: ConferenceRecord = {
    conferenceName,
    participants: {
      [destinationCall.sid]: { number: destinationCall.to || "", addedAt: Date.now() },
    },
  };

  // The record has to exist BEFORE the redirect: the instant the far leg is
  // redirected, the browser leg's <Dial> ends and Twilio immediately asks
  // /api/voice/after-dial what to do next - which reads this record.
  await writeConferenceRecord(client, browserCallSid, record);

  try {
    await client.calls(destinationCall.sid).update({ twiml: conferenceJoinTwiml(conferenceName) });

    const ok = await waitForBothLegs(client, conferenceName, destinationCall.sid, browserCallSid);
    if (!ok) throw new Error("The browser leg never joined the conference.");
  } catch (err) {
    // Don't leave the far leg alone in a conference (billing, and its phone
    // stuck on the line) - end it, and drop the record so a later
    // <Dial action> can't wrongly try to join a conference that's gone.
    await client
      .calls(destinationCall.sid)
      .update({ status: "completed" })
      .catch(() => {});
    await deleteConferenceRecord(client, browserCallSid);
    console.error("[lib/conference] Upgrade failed, far leg ended to avoid a stranded call:", err);
    throw new ConferenceUserError("Couldn't put the call on hold - the call was ended. Please call again.");
  }

  return record;
}

export async function addParticipantRecord(
  client: ReturnType<typeof twilio>,
  browserCallSid: string,
  callSid: string,
  number: string,
): Promise<void> {
  const record = await readConferenceRecord(client, browserCallSid);
  if (!record) return;
  record.participants[callSid] = { number, addedAt: Date.now() };
  await writeConferenceRecord(client, browserCallSid, record);
}
