import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rival Room — Your private chess club",
  description: "Timed chess for two. Private access, rematches, and a lasting head-to-head record.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
