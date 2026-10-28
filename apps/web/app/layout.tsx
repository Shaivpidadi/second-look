import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second Look: the co-signer that reads the paperwork",
  description:
    "Glasses watch the paper, a screen reader watches the typed values, and Second Look blocks the mistake before submit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-void font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
