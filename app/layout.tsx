import type { Metadata } from "next";
import "./globals.css";
import {appearanceBootstrap} from "@/lib/life/appearance";

export const metadata: Metadata = {
  title: "LifeApp — Your daily check-in",
  description: "Track the habits you chose, capture your day, and see your progress.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {capable:true,title:"LifeApp",statusBarStyle:"default"},
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/app-icon-192.png",
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
