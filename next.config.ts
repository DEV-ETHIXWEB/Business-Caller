import type { NextConfig } from "next";

// Headers that do not depend on the request. The per-request
// Content-Security-Policy is set in proxy.ts instead, because its nonce
// has to be new every time.
const BASE_SECURITY_HEADERS = [
  // Belt and braces with the CSP's frame-ancestors, for anything that
  // predates CSP support.
  { key: "X-Frame-Options", value: "DENY" },
  // Stops a browser second-guessing a Content-Type and running, say, a
  // downloaded attachment as script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Phone numbers appear in this app's URLs only via POST bodies, but a
  // full referrer still leaks the host and path to anything linked out to.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The dialer needs the microphone; nothing here needs a camera, the
  // user's location, or any of the rest, so none of it is available even
  // if something injected asks.
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Keeps this origin in its own browsing-context group, so a window it
  // opens (or that opens it) cannot reach into it.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // The app is a private internal tool. It should never appear in a
  // search index, and robots.ts says the same thing to crawlers that read
  // robots.txt rather than headers.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

// Set on Vercel at build time; absent locally, where the default is fine.
const siteOrigin = (() => {
  try {
    return process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : "";
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  // Vercel reports the framework and version by default; neither helps a
  // visitor and both help someone looking for a known weakness.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: BASE_SECURITY_HEADERS,
      },
      {
        // Every API response is specific to one signed-in person. `public`
        // invites any proxy between here and them to keep a copy.
        //
        // /api/media is deliberately left out: it serves the same photo or
        // voice note on every poll of an open chat, and its own route
        // already sets `private, max-age=3600` so the browser stops
        // refetching it. `private` keeps it out of shared caches.
        source: "/api/:path((?!media).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" }],
      },
      // Vercel serves the app shell with `Access-Control-Allow-Origin: *`.
      // Nothing cross-origin has any business reading this app, so where
      // the deployment URL is known it is narrowed to just that origin.
      ...(siteOrigin
        ? [
            {
              source: "/:path*",
              headers: [
                { key: "Access-Control-Allow-Origin", value: siteOrigin },
                { key: "Vary", value: "Origin" },
              ],
            },
          ]
        : []),
    ];
  },
};

export default nextConfig;
