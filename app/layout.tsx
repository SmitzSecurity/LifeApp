import type { Metadata } from "next";
import "./globals.css";
import {appearanceBootstrap} from "@/lib/life/appearance";

export const metadata: Metadata = {
  title: "LifeApp — Your daily check-in",
  description: "Track the habits you chose, capture your day, and see your progress.",
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
    <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:appearanceBootstrap()}} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
