// The formatting buttons and shortcuts: they add (or remove) the same markers
// a person could type by hand, around the selected text or on the selected
// lines.

export type FormatKind = "bold" | "italic" | "strike" | "mono" | "quote" | "bullet" | "numbered" | "code";

export interface Edit {
  text: string;
  start: number;
  end: number;
}

const WRAP: Record<"bold" | "italic" | "strike" | "mono", string> = { bold: "*", italic: "_", strike: "~", mono: "`" };

function wrap(text: string, start: number, end: number, marker: string): Edit {
  const before = text.slice(0, start);
  const sel = text.slice(start, end);
  const after = text.slice(end);

  // Already wrapped, with the markers just outside the selection: take them off.
  if (before.endsWith(marker) && after.startsWith(marker) && sel.length > 0) {
    return { text: before.slice(0, -marker.length) + sel + after.slice(marker.length), start: start - marker.length, end: end - marker.length };
  }
  // The selection itself includes the markers: take them off.
  if (sel.length > 2 * marker.length && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(marker.length, -marker.length);
    return { text: before + inner + after, start, end: start + inner.length };
  }
  // Nothing selected: put a pair down with the caret between them.
  if (start === end) {
    return { text: before + marker + marker + after, start: start + marker.length, end: start + marker.length };
  }
  // Markers hug the words, never spaces, or they would not count.
  const lead = sel.length - sel.trimStart().length;
  const trail = sel.length - sel.trimEnd().length;
  const core = sel.slice(lead, sel.length - trail);
  if (!core) return { text, start, end };
  const wrapped = marker + core + marker;
  return {
    text: before + sel.slice(0, lead) + wrapped + sel.slice(sel.length - trail) + after,
    start: start + lead + marker.length,
    end: start + lead + marker.length + core.length,
  };
}

function lineRange(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  return [from, nl === -1 ? text.length : nl];
}

function prefixLines(text: string, start: number, end: number, prefixFor: (i: number) => string, has: (line: string) => RegExp): Edit {
  const [from, to] = lineRange(text, start, end);
  const lines = text.slice(from, to).split("\n");
  const allHave = lines.every((l) => has(l).test(l));
  const next = lines.map((l, i) => (allHave ? l.replace(has(l), "") : prefixFor(i) + l.replace(/^(?:[-*]\s+|\d+\.\s+|>\s)/, "")));
  const body = next.join("\n");
  return { text: text.slice(0, from) + body + text.slice(to), start: from, end: from + body.length };
}

export function applyFormat(text: string, start: number, end: number, kind: FormatKind): Edit {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));
  if (kind === "bold" || kind === "italic" || kind === "strike" || kind === "mono") return wrap(text, a, b, WRAP[kind]);
  if (kind === "quote") return prefixLines(text, a, b, () => "> ", () => /^>\s/);
  if (kind === "bullet") return prefixLines(text, a, b, () => "- ", () => /^[-*]\s+/);
  if (kind === "numbered") return prefixLines(text, a, b, (i) => `${i + 1}. `, () => /^\d+\.\s+/);

  // code block
  const sel = text.slice(a, b);
  if (sel.startsWith("```") && sel.endsWith("```") && sel.length >= 6) {
    const inner = sel.slice(3, -3).replace(/^\n/, "").replace(/\n$/, "");
    return { text: text.slice(0, a) + inner + text.slice(b), start: a, end: a + inner.length };
  }
  const block = "```\n" + sel + "\n```";
  return { text: text.slice(0, a) + block + text.slice(b), start: a + 4, end: a + 4 + sel.length };
}
