import * as cheerio from "cheerio";

/**
 * Lightweight technology-stack detector for competitor intelligence.
 *
 * Fingerprints are derived from the community-maintained, MIT-licensed
 * webappanalyzer ruleset (https://github.com/enthec/webappanalyzer) — a curated
 * subset covering the high-signal CMS / framework / analytics / commerce / CDN
 * categories. No third-party API, no key, no license strings: detection runs
 * against the page's own HTML and response headers.
 *
 * Results are measured signals (a regex matched real markup/headers), but
 * fingerprinting is inherently best-effort — absence of a match is not proof of
 * absence. The UI should present this as "detected", not "guaranteed".
 */

export type TechCategory =
  | "cms"
  | "framework"
  | "analytics"
  | "ecommerce"
  | "cdn"
  | "tag_manager"
  | "marketing";

export interface DetectedTech {
  name: string;
  category: TechCategory;
  evidence: string;
}

interface Fingerprint {
  name: string;
  category: TechCategory;
  html?: RegExp[];
  scriptSrc?: RegExp[];
  meta?: { name: string; pattern: RegExp };
  header?: { name: string; pattern?: RegExp };
}

// Curated subset of the MIT webappanalyzer ruleset.
const FINGERPRINTS: Fingerprint[] = [
  { name: "WordPress", category: "cms", html: [/wp-content\//i, /wp-includes\//i], meta: { name: "generator", pattern: /wordpress/i } },
  { name: "Webflow", category: "cms", html: [/\.webflow\./i], meta: { name: "generator", pattern: /webflow/i } },
  { name: "Shopify", category: "ecommerce", html: [/cdn\.shopify\.com/i, /shopify\.com\/s\//i], header: { name: "x-shopify-stage" } },
  { name: "Squarespace", category: "cms", html: [/squarespace\.com/i, /static1\.squarespace/i], meta: { name: "generator", pattern: /squarespace/i } },
  { name: "Wix", category: "cms", html: [/wix\.com/i, /static\.wixstatic\.com/i], meta: { name: "generator", pattern: /wix\.com/i } },
  { name: "Ghost", category: "cms", meta: { name: "generator", pattern: /ghost/i } },
  { name: "Drupal", category: "cms", html: [/sites\/default\/files/i], meta: { name: "generator", pattern: /drupal/i }, header: { name: "x-generator", pattern: /drupal/i } },
  { name: "HubSpot", category: "marketing", scriptSrc: [/js\.hs-scripts\.com/i, /js\.hsforms\.net/i, /hs-analytics\.net/i] },
  { name: "Next.js", category: "framework", html: [/\/_next\/static\//i, /id="__next"/i] },
  { name: "Nuxt", category: "framework", html: [/id="__nuxt"/i, /_nuxt\//i] },
  { name: "Gatsby", category: "framework", html: [/id="___gatsby"/i] },
  { name: "React", category: "framework", html: [/data-reactroot/i, /react(?:-dom)?(?:\.production)?\.min\.js/i] },
  { name: "Vue.js", category: "framework", scriptSrc: [/vue(?:\.runtime)?(?:\.global)?(?:\.min)?\.js/i] },
  { name: "WooCommerce", category: "ecommerce", html: [/woocommerce/i] },
  { name: "BigCommerce", category: "ecommerce", html: [/bigcommerce\.com/i] },
  { name: "Google Analytics", category: "analytics", scriptSrc: [/google-analytics\.com\/(?:analytics|ga)\.js/i, /googletagmanager\.com\/gtag\/js/i] },
  { name: "Google Tag Manager", category: "tag_manager", scriptSrc: [/googletagmanager\.com\/gtm\.js/i], html: [/googletagmanager\.com\/ns\.html/i] },
  { name: "Plausible", category: "analytics", scriptSrc: [/plausible\.io\/js/i] },
  { name: "Segment", category: "analytics", scriptSrc: [/cdn\.segment\.com\/analytics\.js/i] },
  { name: "Hotjar", category: "analytics", scriptSrc: [/static\.hotjar\.com/i] },
  { name: "Cloudflare", category: "cdn", header: { name: "server", pattern: /cloudflare/i } },
  { name: "Fastly", category: "cdn", header: { name: "x-served-by", pattern: /cache.*fastly|fastly/i } },
  { name: "Vercel", category: "cdn", header: { name: "server", pattern: /vercel/i } },
  { name: "Netlify", category: "cdn", header: { name: "server", pattern: /netlify/i } },
];

export function detectFromHtml(
  html: string,
  headers: Record<string, string> = {}
): DetectedTech[] {
  const found = new Map<string, DetectedTech>();
  const $ = cheerio.load(html);

  const scriptSrcs = $("script[src]")
    .map((_, el) => $(el).attr("src") || "")
    .get();

  const metaTags = new Map<string, string>();
  $("meta[name]").each((_, el) => {
    const name = ($(el).attr("name") || "").toLowerCase();
    const content = $(el).attr("content") || "";
    if (name) metaTags.set(name, content);
  });

  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;

  for (const fp of FINGERPRINTS) {
    if (found.has(fp.name)) continue;

    if (fp.meta) {
      const content = metaTags.get(fp.meta.name.toLowerCase());
      if (content && fp.meta.pattern.test(content)) {
        found.set(fp.name, { name: fp.name, category: fp.category, evidence: `meta[${fp.meta.name}]` });
        continue;
      }
    }

    if (fp.header) {
      const value = lowerHeaders[fp.header.name.toLowerCase()];
      if (value !== undefined && (!fp.header.pattern || fp.header.pattern.test(value))) {
        found.set(fp.name, { name: fp.name, category: fp.category, evidence: `header:${fp.header.name}` });
        continue;
      }
    }

    if (fp.scriptSrc && scriptSrcs.some((src) => fp.scriptSrc!.some((re) => re.test(src)))) {
      found.set(fp.name, { name: fp.name, category: fp.category, evidence: "script-src" });
      continue;
    }

    if (fp.html && fp.html.some((re) => re.test(html))) {
      found.set(fp.name, { name: fp.name, category: fp.category, evidence: "html" });
    }
  }

  return [...found.values()];
}

export interface TechStackResult {
  domain: string;
  technologies: DetectedTech[];
  data_source: "measured";
}

/** Fetch a domain and detect its stack. The caller is responsible for SSRF validation. */
export async function detectTechStack(domain: string): Promise<TechStackResult> {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "PresenceOS-Audit/1.0" },
    redirect: "follow",
  });

  const html = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    domain: domain.replace(/^https?:\/\//, "").replace(/^www\./, ""),
    technologies: detectFromHtml(html, headers),
    data_source: "measured",
  };
}
