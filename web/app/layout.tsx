import type { Metadata } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: { default: "Crocode", template: "%s · Crocode" },
  description:
    "Self-hosted AI code review for GitHub. Open source under Apache 2.0.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
        <footer className="mx-auto max-w-6xl px-6 py-8 text-xs text-muted-foreground">
          Crocode · Self-hosted GitHub code review · Apache 2.0
        </footer>
      </body>
    </html>
  );
}
