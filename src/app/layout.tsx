import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  metadataBase: new URL("https://kyowave.wazfahmi.site"),
  title: "Kyowave",
  description: "Everyone has their own wavelength. This one is yours.",
  applicationName: "Kyowave",
  manifest: "/manifest.webmanifest",
  // Home-screen launch on iOS: no Safari chrome, and a translucent status bar
  // so the app's own background runs under it. `title` is what appears under
  // the icon on the home screen — without it iOS uses the <title>, which is
  // the same here but would drift the moment the tab title changes.
  appleWebApp: {
    capable: true,
    title: "Kyowave",
    statusBarStyle: "black-translucent",
  },
  icons: {
    // Two SVG variants, picked by the browser's colour scheme. Each is drawn
    // to read against that scheme's chrome: icon.svg is bright blue on near
    // black, icon-light.svg is deeper blue on near white, so in both cases the
    // tile recedes and the rings carry the mark. favicon.ico last, for
    // anything that ignores media queries or SVG favicons.
    icon: [
      {
        url: "/icon.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon-light.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Kyowave",
    title: "Kyowave.",
    description: "Everyone has their own wavelength. This one is yours.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kyowave.",
    description: "Everyone has their own wavelength. This one is yours.",
    images: ["/og.png"],
  },
};

// viewportFit:"cover" lets the app paint under the notch and the home
// indicator; everything that would otherwise sit beneath them pads with
// env(safe-area-inset-*) instead. Zoom is deliberately NOT disabled —
// maximum-scale=1 is an accessibility regression. iOS's auto-zoom-on-focus is
// prevented the correct way, by keeping every text input at 16px or larger.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
