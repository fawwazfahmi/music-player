import type { Metadata } from "next";
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
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
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

export const viewport = { themeColor: "#09090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
