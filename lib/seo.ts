import { business, externalLinks, faqItems, pricePlans, siteUrl } from "@/lib/site";

export function localBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "SportsActivityLocation", "EntertainmentBusiness"],
    "@id": `${siteUrl}/#business`,
    name: business.name,
    alternateName: "Автосимуляторы АвтоСим",
    legalName: business.legalName,
    description:
      "Клуб автосимуляторов в Оренбурге: профессиональные автосимуляторы, VR, гонки с друзьями, дни рождения и корпоративы.",
    url: siteUrl,
    image: `${siteUrl}/assets/og/autosim-og.jpg`,
    logo: `${siteUrl}/favicon.png`,
    telephone: business.phone,
    priceRange: "350-5800 RUB",
    currenciesAccepted: "RUB",
    paymentAccepted: "Cash, Credit Card, SBP",
    address: {
      "@type": "PostalAddress",
      addressLocality: business.city,
      streetAddress: business.streetAddress,
      addressCountry: "RU"
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: business.latitude,
      longitude: business.longitude
    },
    hasMap: business.mapUrl,
    areaServed: {
      "@type": "City",
      name: business.city
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: business.phone,
      contactType: "reservations",
      areaServed: "RU",
      availableLanguage: ["ru"]
    },
    openingHours: "Mo-Su 14:00-02:00",
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday"
        ],
        opens: "14:00",
        closes: "02:00"
      }
    ],
    sameAs: [
      business.mapUrl,
      business.twoGisUrl,
      externalLinks.vk,
      externalLinks.telegram,
      externalLinks.instagram
    ]
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: business.name,
    url: siteUrl,
    inLanguage: "ru-RU"
  };
}

export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer
      }
    }))
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

export function offerCatalogJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "OfferCatalog",
    name: "Цены АвтоСим",
    itemListElement: pricePlans.flatMap((plan) =>
      plan.items.map((item) => ({
        "@type": "Offer",
        name: `${plan.title}: ${item.label}`,
        category: plan.subtitle,
        priceCurrency: "RUB",
        price: item.value.replace(/\D/g, ""),
        availability: "https://schema.org/InStock"
      }))
    )
  };
}
