import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { defaultLanguage } from "@/components/language";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

const displayFont = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
});

const dataFont = Space_Grotesk({
  variable: "--font-data",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "NeoRate · Devizaárfolyam-összehasonlítás",
  description:
    "Átlátható devizaárfolyam- és díj-összehasonlítás fintech szolgáltatók és bankok között.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang={defaultLanguage}
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${displayFont.variable} ${dataFont.variable}`}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
