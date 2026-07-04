import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/JsonLd";
import { LeadModal } from "@/components/LeadModal";
import { LeadProvider } from "@/components/LeadProvider";
import { ScrollMotion } from "@/components/ScrollMotion";
import { localBusinessJsonLd, websiteJsonLd } from "@/lib/seo";
import { absoluteUrl, business, siteUrl } from "@/lib/site";

const ogImageUrl = absoluteUrl("/assets/og/autosim-og.jpg?v=20260630-2");

const cinematografica = localFont({
  src: [
    {
      path: "../public/assets/fonts/Cinematografica/Cinematografica-Regular.otf",
      weight: "400"
    },
    {
      path: "../public/assets/fonts/Cinematografica/Cinematografica-Bold.otf",
      weight: "700"
    },
    {
      path: "../public/assets/fonts/Cinematografica/Cinematografica-Heavy.otf",
      weight: "900"
    }
  ],
  variable: "--font-racing",
  display: "swap"
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "АвтоСим - клуб автосимуляторов в Оренбурге",
    template: "%s | АвтоСим"
  },
  description:
    "АвтоСим в Оренбурге: профессиональные автосимуляторы, VR, гонки с друзьями, дни рождения, корпоративы и бронирование заездов.",
  icons: {
    icon: [
      {
        url: "/favicon.png",
        type: "image/png",
        sizes: "500x500"
      }
    ],
    shortcut: "/favicon.png",
    apple: "/favicon.png"
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: business.name,
    url: siteUrl,
    title: "АвтоСим - клуб автосимуляторов в Оренбурге",
    description:
      "Гонки, VR, автосимуляторы, дни рождения и корпоративы в Оренбурге.",
    images: [
      {
        url: ogImageUrl,
        width: 1200,
        height: 630,
        alt: "Клуб автосимуляторов АвтоСим в Оренбурге"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "АвтоСим - клуб автосимуляторов в Оренбурге",
    description:
      "Профессиональные автосимуляторы, VR и гоночные заезды в Оренбурге.",
    images: [ogImageUrl]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={cinematografica.variable} data-scroll-behavior="smooth">
      <body>
        <JsonLd data={localBusinessJsonLd()} />
        <JsonLd data={websiteJsonLd()} />
        <LeadProvider>
          <Header />
          {children}
          <Footer />
          <LeadModal />
          <ScrollMotion />
        </LeadProvider>
      </body>
    </html>
  );
}
