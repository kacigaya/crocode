import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { asset } from "@/lib/docs-site";
import { themeScript } from "@/lib/theme";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "CroCode Docs", template: "%s · CroCode" },
  description: "Setup, configuration, security, and API guides for self-hosted GitHub code review with CroCode.",
  robots: { index: true, follow: true },
  icons: { icon: asset("/icon.svg") },
};

export default function DocsRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
