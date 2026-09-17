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

export interface ConferenceParticipantInfo {
  number: string;
  addedAt: number;
}

export interface ConferenceRecord {
  conferenceName: string;
  participants: Record<string, ConferenceParticipantInfo>;
}

function documentNameFor(browserCallSid: string): string {
  return `activecall_${browserCallSid}`;
}

// Calls never run this long (MAX_CALL_SECONDS in app/api/voice/route.ts is
// 4 hours), so anything older is certainly stale - given a TTL rather than
// left to accumulate in Sync forever.
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

function conferenceJoinTwiml(conferenceName: string): string {
  const vr = new twilio.twiml.VoiceResponse();
  const dial = vr.dial();
  dial.conference(
    { startConferenceOnEnter: true, endConferenceOnExit: true, beep: "false" },
    conferenceName,
  );
  return vr.toString();
}

// Moves a plain, already-answered 2-party call into a brand new Conference
// without any audible interruption to either side - the standard Twilio
// pattern for upgrading a call after the fact. Idempotent: if this call was
// already converted by an earlier Hold or Add Call, just returns that.
export async function ensureConference(
  client: ReturnType<typeof twilio>,
  browserCallSid: string,
): Promise<ConferenceRecord> {
  const existing = await readConferenceRecord(client, browserCallSid);
  if (existing) return existing;

  const children = await client.calls.list({ parentCallSid: browserCallSid, limit: 5 });
  const destinationCall = children[0];
  if (!destinationCall) {
    throw new Error("Could not find the other party on this call.");
  }

  const conferenceName = `conf-${browserCallSid}`;
  const twiml = conferenceJoinTwiml(conferenceName);

  // Order matters: redirect the far-end leg into the conference first, so
  // it's already running independently by the time the browser leg's own
  // <Dial> bridge is broken. Reversing this order would hang up the far end
  // the moment the browser side redirects, since it would have nowhere
  // else to go yet.
  await client.calls(destinationCall.sid).update({ twiml });
  await client.calls(browserCallSid).update({ twiml });

  const record: ConferenceRecord = {
    conferenceName,
    participants: {
      [destinationCall.sid]: { number: destinationCall.to || "", addedAt: Date.now() },
    },
  };
  await writeConferenceRecord(client, browserCallSid, record);
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

// Participant sub-resources are addressed by Conference SID, not name, and
// the conference has no SID until Twilio actually executes the join TwiML
// just sent to both legs - which happens moments after those redirect
// calls return, hence the short retry rather than a single lookup.
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
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}
