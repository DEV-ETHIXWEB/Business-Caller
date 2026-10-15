import type { MetadataRoute } from "next";

// This is a private dialer for one company's staff, not a public site:
// every page behind the sign-in screen is somebody's phone number, call
// history and client messages. There is no reason for it to be crawled or
// indexed, and until now there was nothing telling crawlers so. The
// X-Robots-Tag header in next.config.ts says the same thing to crawlers
// that never fetch robots.txt.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
