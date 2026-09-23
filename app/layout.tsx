import type { Metadata, Viewport } from "next";
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
  // Stops the browser zooming the page when a field is focused, so typing a
  // message doesn't shove the whole layout around (the 16px rule in
  // globals.css is what actually prevents iOS Safari's focus zoom; this
  // covers the browsers that honour the viewport instead).
  maximumScale: 1,
  // Draw under the notch/home-indicator; the UI pads for the safe areas.
  viewportFit: "cover",
  // Android Chrome: shrink the layout when the keyboard opens instead of
  // covering the bottom of the page.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
