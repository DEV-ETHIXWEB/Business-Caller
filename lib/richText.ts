// WhatsApp-style text formatting, parsed into a small tree so it can be drawn
// without ever touching innerHTML:
//   *bold*  _italic_  ~strike~  `mono`
//   > quote        - or * bullet lists        1. numbered lists
//   ```code blocks```
// Texts travel as plain SMS, so the person on the other end sees the raw
// markers (exactly as WhatsApp does when a message is forwarded to SMS).

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold" | "italic" | "strike"; children: Inline[] }
  | { t: "mono"; v: string }
  | { t: "link"; url: string; trailing: string };

export type Block =
  | { t: "p"; inline: Inline[] }
  | { t: "quote"; inline: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][]; start: number }
  | { t: "code"; text: string };

const MARKERS: Record<string, "bold" | "italic" | "strike" | "mono"> = { "*": "bold", _: "italic", "~": "strike", "`": "mono" };
const WORDISH = /[\p{L}\p{N}]/u;
const URL_RE = /https?:\/\/[^\s]+/g;

// A marker opens only at the start of the text or after a non-word character,
// closes only before the end or a non-word character, and never hugs a space
// on the inside (so "2 * 3 * 4" and "snake_case_name" stay as they are).
function findClose(text: string, open: number, marker: string): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\n") return -1;
    if (text[i] !== marker) continue;
    const before = text[i - 1];
    const after = text[i + 1];
    if (/\s/.test(before)) continue;
    if (after !== undefined && WORDISH.test(after)) continue;
    if (i === open + 1) continue;
    return i;
  }
  return -1;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      out.push({ t: "text", v: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // Links first, so an underscore inside a URL is never read as italics.
    if (ch === "h" && (text.startsWith("http://", i) || text.startsWith("https://", i))) {
      URL_RE.lastIndex = i;
      const m = URL_RE.exec(text);
      if (m && m.index === i) {
        const trailing = m[0].match(/[.,!?;:)\]]+$/)?.[0] ?? "";
        const url = trailing ? m[0].slice(0, -trailing.length) : m[0];
        flush();
        out.push({ t: "link", url, trailing });
        i += m[0].length;
        continue;
      }
    }

    const kind = MARKERS[ch];
    if (kind) {
      const before = text[i - 1];
      const next = text[i + 1];
      const opensHere = (before === undefined || !WORDISH.test(before)) && next !== undefined && !/\s/.test(next) && next !== ch;
      if (opensHere) {
        const close = findClose(text, i, ch);
        if (close !== -1) {
          flush();
          const inner = text.slice(i + 1, close);
          out.push(kind === "mono" ? { t: "mono", v: inner } : { t: kind, children: parseInline(inner) });
          i = close + 1;
          continue;
        }
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET_RE = /^[-*]\s+(.*)$/;
const ORDERED_RE = /^(\d+)\.\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ t: "p", inline: parseInline(paragraph.join("\n")) });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const closeAt = lines.findIndex((l, j) => j > i && l.trim().endsWith("```"));
      if (closeAt !== -1) {
        flushParagraph();
        const first = line.trim().slice(3);
        const middle = lines.slice(i + 1, closeAt);
        const last = lines[closeAt].trim().slice(0, -3);
        blocks.push({ t: "code", text: [first, ...middle, last].filter((l, idx, all) => !(l === "" && (idx === 0 || idx === all.length - 1))).join("\n") });
        i = closeAt;
        continue;
      }
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      const quoted = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith("> ")) quoted.push(lines[++i].slice(2));
      blocks.push({ t: "quote", inline: parseInline(quoted.join("\n")) });
      continue;
    }

    if (BULLET_RE.test(line)) {
      flushParagraph();
      const items: Inline[][] = [parseInline(line.match(BULLET_RE)![1])];
      while (i + 1 < lines.length && BULLET_RE.test(lines[i + 1])) items.push(parseInline(lines[++i].match(BULLET_RE)![1]));
      blocks.push({ t: "ul", items });
      continue;
    }

    if (ORDERED_RE.test(line)) {
      flushParagraph();
      const first = line.match(ORDERED_RE)!;
      const items: Inline[][] = [parseInline(first[2])];
      while (i + 1 < lines.length && ORDERED_RE.test(lines[i + 1])) items.push(parseInline(lines[++i].match(ORDERED_RE)![2]));
      blocks.push({ t: "ol", items, start: Number(first[1]) });
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

// --- Structured messages ------------------------------------------------------
// Replies, polls, events, locations and contact cards are all ordinary texts
// with a recognisable shape, so they still read fine on any phone.

const QUOTE_OPEN = "↪ “"; // ↪ “
const QUOTE_CLOSE = "”";

export function makeReply(quoted: string, reply: string): string {
  const snippet = quoted.replace(/\s+/g, " ").trim().slice(0, 90);
  return `${QUOTE_OPEN}${snippet}${QUOTE_CLOSE}\n${reply}`;
}

export function parseReply(body: string): { quote: string | null; rest: string } {
  if (!body.startsWith(QUOTE_OPEN)) return { quote: null, rest: body };
  const nl = body.indexOf("\n");
  const first = nl === -1 ? body : body.slice(0, nl);
  if (!first.endsWith(QUOTE_CLOSE)) return { quote: null, rest: body };
  return { quote: first.slice(QUOTE_OPEN.length, -QUOTE_CLOSE.length), rest: nl === -1 ? "" : body.slice(nl + 1) };
}

export interface PollData {
  question: string;
  options: string[];
}

const POLL_HEAD = "📊 Poll: "; // 📊
const POLL_FOOT = "Reply with a number to vote.";

export function makePoll(question: string, options: string[]): string {
  return [`${POLL_HEAD}${question.trim()}`, ...options.map((o, i) => `${i + 1}. ${o.trim()}`), POLL_FOOT].join("\n");
}

export function parsePoll(body: string): PollData | null {
  const lines = body.split("\n");
  if (!lines[0]?.startsWith(POLL_HEAD) || lines[lines.length - 1] !== POLL_FOOT) return null;
  const options: string[] = [];
  for (const l of lines.slice(1, -1)) {
    const m = /^(\d+)\.\s+(.+)$/.exec(l);
    if (!m || Number(m[1]) !== options.length + 1) return null;
    options.push(m[2]);
  }
  if (options.length < 2) return null;
  return { question: lines[0].slice(POLL_HEAD.length), options };
}

export interface Vote {
  from: string;
  at: number;
  body: string;
}

// The last valid answer from each sender counts. An answer is the option's
// number ("2") or, for convenience, its text.
export function tallyPoll(poll: PollData, votes: Vote[]): { counts: number[]; total: number; byVoter: Record<string, number> } {
  const byVoter: Record<string, number> = {};
  for (const v of [...votes].sort((a, b) => a.at - b.at)) {
    const text = v.body.trim();
    let idx = -1;
    if (/^\d{1,2}$/.test(text)) idx = Number(text) - 1;
    else idx = poll.options.findIndex((o) => o.toLowerCase() === text.toLowerCase());
    if (idx >= 0 && idx < poll.options.length) byVoter[v.from] = idx;
  }
  const counts = poll.options.map(() => 0);
  for (const idx of Object.values(byVoter)) counts[idx]++;
  return { counts, total: Object.keys(byVoter).length, byVoter };
}

export interface EventData {
  title: string;
  when: string;
  place: string;
}

const EVENT_HEAD = "📅 Event: "; // 📅
const EVENT_WHEN = "🕐 "; // 🕐
const EVENT_PLACE = "📍 "; // 📍
const EVENT_FOOT = "Reply YES, NO or MAYBE.";

export function makeEvent(e: EventData): string {
  return [`${EVENT_HEAD}${e.title.trim()}`, `${EVENT_WHEN}${e.when.trim()}`, ...(e.place.trim() ? [`${EVENT_PLACE}${e.place.trim()}`] : []), EVENT_FOOT].join("\n");
}

export function parseEvent(body: string): EventData | null {
  const lines = body.split("\n");
  if (!lines[0]?.startsWith(EVENT_HEAD) || lines[lines.length - 1] !== EVENT_FOOT) return null;
  const when = lines.find((l) => l.startsWith(EVENT_WHEN));
  if (!when) return null;
  const place = lines.find((l) => l.startsWith(EVENT_PLACE));
  return { title: lines[0].slice(EVENT_HEAD.length), when: when.slice(EVENT_WHEN.length), place: place ? place.slice(EVENT_PLACE.length) : "" };
}

export type Rsvp = "yes" | "no" | "maybe";

export function tallyEvent(votes: Vote[]): { counts: Record<Rsvp, number>; byVoter: Record<string, Rsvp> } {
  const byVoter: Record<string, Rsvp> = {};
  for (const v of [...votes].sort((a, b) => a.at - b.at)) {
    const t = v.body.trim().toLowerCase().replace(/[.!]+$/, "");
    if (["yes", "y", "yep", "yeah", "going", "i'm in"].includes(t)) byVoter[v.from] = "yes";
    else if (["no", "n", "nope", "can't", "cant", "not going"].includes(t)) byVoter[v.from] = "no";
    else if (["maybe", "m", "not sure"].includes(t)) byVoter[v.from] = "maybe";
  }
  const counts: Record<Rsvp, number> = { yes: 0, no: 0, maybe: 0 };
  for (const r of Object.values(byVoter)) counts[r]++;
  return { counts, byVoter };
}

export interface LocationData {
  lat: number;
  lng: number;
  label: string;
}

const LOC_HEAD = "📍 Location: ";

export function makeLocation(lat: number, lng: number, label = ""): string {
  const url = `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `${LOC_HEAD}${label ? `${label} ` : ""}${url}`;
}

export function parseLocation(body: string): LocationData | null {
  const m = /^📍 Location: (?:(.*?) )?https?:\/\/(?:maps\.google\.com|www\.google\.com\/maps|maps\.apple\.com)[^\s]*?[?&](?:q|ll)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(body.trim());
  if (!m) return null;
  const lat = Number(m[2]);
  const lng = Number(m[3]);
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
  return { lat, lng, label: m[1] ?? "" };
}

export interface ContactCard {
  name: string;
  number: string;
}

const CONTACT_HEAD = "👤 Contact: "; // 👤

export function makeContactCard(c: ContactCard): string {
  return `${CONTACT_HEAD}${c.name.trim()} ${c.number}`;
}

export function parseContactCard(body: string): ContactCard | null {
  const m = /^👤 Contact: (.+?) (\+\d{8,15})\s*$/.exec(body.trim());
  return m ? { name: m[1], number: m[2] } : null;
}

// What to show in a chat-list preview for a structured message.
export function previewLabel(body: string): string {
  const { quote, rest } = parseReply(body);
  const text = quote !== null ? rest : body;
  if (parsePoll(text)) return "📊 Poll";
  if (parseEvent(text)) return "📅 Event";
  if (parseLocation(text)) return "📍 Location";
  if (parseContactCard(text)) return "👤 Contact";
  return text;
}
