import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Crocode", template: "%s · Crocode" },
  description: "Self-hosted AI code review for GitHub. Open source under Apache 2.0.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
