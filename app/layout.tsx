import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Business Caller",
  description: "Browser-based outbound dialer for the business Twilio line.",
  // Lets "Add to Home Screen" on iOS launch full-screen with our icon and
  // no Safari chrome, instead of opening as a plain bookmark.
  appleWebApp: {
    capable: true,
    title: "Business Caller",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0d10",
  width: "device-width",
  initialScale: 1,
  // Deliberately no `maximumScale`. Pinning it to 1 blocks pinch-zoom
  // entirely, which fails WCAG 2.1 AA (1.4.4 Resize Text) and makes the
  // app unusable for anyone who needs to magnify it. The reason it was
  // here - iOS Safari zooming into a focused field - is already handled by
  // the 16px minimum font size for inputs in globals.css, which is what
  // actually suppresses that behaviour.
  // Draw under the notch/home-indicator; the UI pads for the safe areas.
  viewportFit: "cover",
  // Android Chrome: shrink the layout when the keyboard opens instead of
  // covering the bottom of the page.
  interactiveWidget: "resizes-content",
};

// Runs before first paint so the saved theme, text size and wallpaper are
// already on <html> when the page appears (no light flash in dark mode).
// Mirrors applySettings() in lib/settings.ts.
const SETTINGS_BOOT_SCRIPT = `(function(){try{var s={};try{s=JSON.parse(localStorage.getItem("dialer_settings")||"{}")||{};}catch(x){}var r=document.documentElement;var d=s.theme==="dark"||((s.theme===undefined||s.theme==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)r.classList.add("dark");r.dataset.textSize=s.textSize||"medium";r.dataset.wallpaper=s.wallpaper||"dots";r.dataset.bubble=s.bubbleTheme||"crimson";}catch(e){}})();`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set per request by proxy.ts. The settings script below runs before
  // first paint and is inline by necessity, so it carries the nonce the
  // Content-Security-Policy names; without it the browser refuses to run
  // it and the app flashes light before switching to the saved theme.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SETTINGS_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
