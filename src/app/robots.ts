import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // App, API, and auth surfaces are not for crawlers. /verify stays
        // crawlable-by-link but receipt ids are unguessable capabilities.
        disallow: ["/app/", "/api/", "/auth/", "/portal/", "/report/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
