import type { MetadataRoute } from "next";
import { VS_PAGES } from "@/lib/marketing/vs-pages";
import { LEARN_PAGES } from "@/lib/marketing/learn-pages";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/audit`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/agencies`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/customers`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  const vsPages: MetadataRoute.Sitemap = VS_PAGES.map((p) => ({
    url: `${BASE}/vs/${p.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const learnPages: MetadataRoute.Sitemap = LEARN_PAGES.map((p) => ({
    url: `${BASE}/learn/${p.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticPages, ...vsPages, ...learnPages];
}
