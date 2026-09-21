import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rival Room — Your private chess club",
  description: "Timed chess with your friends. Personal PINs, rematches, and a lasting record against each rival.",
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
