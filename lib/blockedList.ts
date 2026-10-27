// Pure, and deliberately in its own file rather than beside the rest of the
// call rules: lib/callRules.ts talks to Twilio Sync, so importing it from a
// client component pulls the Twilio SDK - and `fs`, `net`, `tls` - into the
// browser bundle and the build fails.

/**
 * The numbers whose local blocked/unblocked state disagrees with the server's.
 *
 * The client keeps its own copy of the blocked list, because that is what
 * hides a chat in the list, but the server's copy is the one the webhooks
 * obey. On unlock the two are reconciled by toggling exactly the numbers
 * returned here.
 *
 * Both directions matter. Adopting only additions meant unblocking someone
 * on another device never arrived - and since every later write sends the
 * whole list up from the local copy, the next block of any number silently
 * re-blocked the one that had just been let through.
 *
 * Each number appears at most once: the caller toggles, so returning one
 * twice would undo itself.
 */
export function blockedToToggle(local: string[], remote: string[]): string[] {
  const l = new Set(local);
  const r = new Set(remote);
  const out: string[] = [];
  for (const n of r) if (!l.has(n)) out.push(n);
  for (const n of l) if (!r.has(n)) out.push(n);
  return out;
}
