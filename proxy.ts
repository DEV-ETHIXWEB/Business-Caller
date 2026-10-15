import { NextResponse, type NextRequest } from "next/server";

// Per-request Content-Security-Policy with a fresh nonce.
//
// In Next.js 16 this file is `proxy.ts`; `middleware.ts` is the deprecated
// name for the same thing.
//
// Without a CSP, any script that ever got onto the page could do whatever
// it liked - and this page can place calls and read every message on the
// business line. `strict-dynamic` plus a per-request nonce means only the
// scripts this server actually emitted can run: Next.js reads the nonce
// out of this header during rendering and stamps it onto its own framework
// and bundle tags, and app/layout.tsx puts it on the one inline script of
// our own. An injected `<script>` carries no nonce, so it never executes.
//
// Using a nonce means the page must be rendered per request rather than
// served from the build - a nonce baked in at build time would be the same
// for everybody, which is no nonce at all. That is why app/page.tsx calls
// `connection()`.

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' only in development: React uses eval there to rebuild
    // server-side error stacks in the browser. Production never needs it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and next/font ship as ordinary stylesheets from this origin,
    // but React still sets a few inline styles while rendering, and a style
    // cannot run code the way a script can.
    "style-src 'self' 'unsafe-inline'",
    // blob: and data: cover photo previews and anything picked from the
    // device before it is uploaded; the Vercel Blob host is where profile
    // photos actually live (app/api/avatar/route.ts uploads them there and
    // stores the public URL), so without it every avatar is blocked.
    "img-src 'self' blob: data: https://*.public.blob.vercel-storage.com",
    "media-src 'self' blob: data:",
    "font-src 'self'",
    // The Twilio Voice SDK signals over a WebSocket and fetches ICE/region
    // details over HTTPS. Without these, calling stops working entirely.
    "connect-src 'self' https://*.twilio.com wss://*.twilio.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: this app has a Call button, so being framed by someone
    // else's page is a way to get a signed-in person to place a call they
    // never meant to.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // API routes set their own headers, and static assets and images are
      // served straight from the CDN - none of them render HTML, so none
      // of them needs a nonce. Prefetches are skipped for the same reason.
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
