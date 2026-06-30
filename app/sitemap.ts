import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

const routes = ["", "/prices", "/events", "/faq", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.75
  }));
}
