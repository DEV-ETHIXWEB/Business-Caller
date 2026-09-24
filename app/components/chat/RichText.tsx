"use client";

import { parseBlocks, type Block, type Inline } from "@/lib/richText";

function markText(plain: string, highlight: string | undefined, key: string): React.ReactNode {
  const q = highlight?.trim();
  if (!q) return plain;
  const lower = plain.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let at = 0;
  for (let idx = lower.indexOf(needle); idx !== -1; idx = lower.indexOf(needle, at)) {
    if (idx > at) out.push(plain.slice(at, idx));
    out.push(
      <mark key={`${key}-${idx}`} className="rounded bg-yellow-300/80 px-0.5 text-slate-900">
        {plain.slice(idx, idx + needle.length)}
      </mark>,
    );
    at = idx + needle.length;
  }
  if (at < plain.length) out.push(plain.slice(at));
  return out.length ? out : plain;
}

export function InlineNodes({ nodes, highlight, keyPrefix = "i" }: { nodes: Inline[]; highlight?: string; keyPrefix?: string }) {
  return (
    <>
      {nodes.map((n, i) => {
        const key = `${keyPrefix}-${i}`;
        switch (n.t) {
          case "text":
            return <span key={key}>{markText(n.v, highlight, key)}</span>;
          case "bold":
            return (
              <strong key={key} className="font-semibold">
                <InlineNodes nodes={n.children} highlight={highlight} keyPrefix={key} />
              </strong>
            );
          case "italic":
            return (
              <em key={key}>
                <InlineNodes nodes={n.children} highlight={highlight} keyPrefix={key} />
              </em>
            );
          case "strike":
            return (
              <s key={key}>
                <InlineNodes nodes={n.children} highlight={highlight} keyPrefix={key} />
              </s>
            );
          case "mono":
            return (
              <code key={key} className="rounded bg-black/10 px-1 py-px font-mono text-[0.9em] dark:bg-white/10">
                {markText(n.v, highlight, key)}
              </code>
            );
          case "link":
            return (
              <span key={key}>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="underline decoration-current/50 underline-offset-2"
                >
                  {markText(n.url, highlight, key)}
                </a>
                {n.trailing}
              </span>
            );
        }
      })}
    </>
  );
}

// One message's text, formatted. A plain one-paragraph message keeps the class
// the chat uses to float the time to the end of the last line.
export function RichBlocks({ blocks, highlight, floatTime }: { blocks: Block[]; highlight?: string; floatTime?: React.ReactNode }) {
  const single = blocks.length === 1 && blocks[0].t === "p";
  return (
    <>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.t) {
          case "p":
            return (
              <p key={key} className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${single && floatTime ? "flow-root" : ""}`}>
                <InlineNodes nodes={b.inline} highlight={highlight} keyPrefix={key} />
                {single && floatTime}
              </p>
            );
          case "quote":
            return (
              <blockquote key={key} className="my-0.5 whitespace-pre-wrap border-l-[3px] border-current/40 pl-2 opacity-90 [overflow-wrap:anywhere]">
                <InlineNodes nodes={b.inline} highlight={highlight} keyPrefix={key} />
              </blockquote>
            );
          case "ul":
            return (
              <ul key={key} className="my-0.5 list-disc space-y-0.5 pl-5 [overflow-wrap:anywhere]">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <InlineNodes nodes={it} highlight={highlight} keyPrefix={`${key}-${j}`} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} start={b.start} className="my-0.5 list-decimal space-y-0.5 pl-5 [overflow-wrap:anywhere]">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <InlineNodes nodes={it} highlight={highlight} keyPrefix={`${key}-${j}`} />
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={key} className="my-1 overflow-x-auto rounded-lg bg-black/15 p-2 font-mono text-[0.8125rem] leading-snug dark:bg-black/30">
                {b.text}
              </pre>
            );
        }
      })}
    </>
  );
}

export function RichText({ text, highlight, floatTime }: { text: string; highlight?: string; floatTime?: React.ReactNode }) {
  return <RichBlocks blocks={parseBlocks(text)} highlight={highlight} floatTime={floatTime} />;
}
