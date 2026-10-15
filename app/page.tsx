import { connection } from "next/server";
import Dialer from "@/app/components/Dialer";

// Rendered per request rather than at build time. The Content-Security-
// Policy in proxy.ts carries a fresh nonce for every visit, and Next.js
// can only stamp that nonce onto its script tags while rendering a real
// request - a page baked at build time would have to ship one fixed nonce
// to everybody, which defeats the point of having one.
export default async function Home() {
  await connection();
  return <Dialer />;
}
