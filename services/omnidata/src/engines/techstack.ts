/**
 * Best-effort tech-stack detection (BuiltWith/SimilarWeb tech-tracker lite).
 * Rule-based open fingerprints over HTML, headers, cookies and meta. Keyless.
 */

export interface DetectedTech {
  name: string;
  category: string;
  confidence: number;
  evidence: string;
}

export interface TechStackResult {
  url: string;
  technologies: DetectedTech[];
  categories: Record<string, string[]>;
  data_source: "fingerprint";
  available: boolean;
}

interface Fingerprint {
  name: string;
  category: string;
  html?: RegExp[];
  scriptSrc?: RegExp[];
  headers?: Array<{ name: string; pattern: RegExp }>;
  meta?: Array<{ name: string; pattern: RegExp }>;
  cookies?: RegExp[];
}

const FINGERPRINTS: Fingerprint[] = [
  { name: "Next.js", category: "Framework", html: [/id="__next"/, /\/_next\//], headers: [{ name: "x-powered-by", pattern: /next\.js/i }] },
  { name: "Nuxt.js", category: "Framework", html: [/id="__nuxt"/, /window\.__NUXT__/] },
  { name: "React", category: "Framework", html: [/data-reactroot/, /react(?:-dom)?(?:\.min)?\.js/] },
  { name: "Vue.js", category: "Framework", html: [/data-v-[0-9a-f]{8}/, /vue(?:\.min)?\.js/] },
  { name: "Angular", category: "Framework", html: [/ng-version="/, /ng-app/] },
  { name: "Svelte", category: "Framework", html: [/svelte-[0-9a-z]+/] },
  { name: "Gatsby", category: "Framework", html: [/id="___gatsby"/] },
  { name: "Astro", category: "Framework", html: [/astro-island/, /<!--\s*astro/i] },
  { name: "Remix", category: "Framework", html: [/window\.__remixContext/] },
  { name: "WordPress", category: "CMS", html: [/wp-content/, /wp-includes/], meta: [{ name: "generator", pattern: /WordPress/i }] },
  { name: "Shopify", category: "Ecommerce", html: [/cdn\.shopify\.com/, /Shopify\.theme/], headers: [{ name: "x-shopify-stage", pattern: /.+/ }] },
  { name: "WooCommerce", category: "Ecommerce", html: [/woocommerce/i] },
  { name: "Magento", category: "Ecommerce", html: [/Mage\.Cookies/, /\/static\/version\d+\/frontend\//] },
  { name: "BigCommerce", category: "Ecommerce", html: [/cdn\d*\.bigcommerce\.com/] },
  { name: "Wix", category: "CMS", html: [/static\.wixstatic\.com/, /wix\.com/], headers: [{ name: "x-wix-request-id", pattern: /.+/ }] },
  { name: "Squarespace", category: "CMS", html: [/static\.squarespace\.com/, /squarespace\.com/] },
  { name: "Webflow", category: "CMS", html: [/data-wf-page/, /assets\.website-files\.com/], meta: [{ name: "generator", pattern: /Webflow/i }] },
  { name: "Drupal", category: "CMS", html: [/Drupal\.settings/, /sites\/all\/(?:modules|themes)/], meta: [{ name: "generator", pattern: /Drupal/i }] },
  { name: "Joomla", category: "CMS", meta: [{ name: "generator", pattern: /Joomla/i }] },
  { name: "Ghost", category: "CMS", meta: [{ name: "generator", pattern: /Ghost/i }] },
  { name: "HubSpot", category: "Marketing", html: [/js\.hs-scripts\.com/, /hsforms\.net/], scriptSrc: [/hs-scripts\.com/] },
  { name: "Contentful", category: "CMS", html: [/images\.ctfassets\.net/] },
  { name: "Google Analytics", category: "Analytics", html: [/google-analytics\.com\/analytics\.js/, /gtag\/js\?id=UA-/] },
  { name: "Google Analytics 4", category: "Analytics", html: [/gtag\/js\?id=G-/, /googletagmanager\.com\/gtag/] },
  { name: "Google Tag Manager", category: "Analytics", html: [/googletagmanager\.com\/gtm\.js/, /GTM-[A-Z0-9]+/] },
  { name: "Segment", category: "Analytics", html: [/cdn\.segment\.com\/analytics\.js/] },
  { name: "Plausible", category: "Analytics", scriptSrc: [/plausible\.io\/js/] },
  { name: "PostHog", category: "Analytics", html: [/posthog\.com/, /posthog\.init/] },
  { name: "Mixpanel", category: "Analytics", html: [/cdn\.mxpnl\.com/] },
  { name: "Hotjar", category: "Analytics", html: [/static\.hotjar\.com/, /hotjar\.com/] },
  { name: "Amplitude", category: "Analytics", html: [/cdn\.amplitude\.com/] },
  { name: "Facebook Pixel", category: "Marketing", html: [/connect\.facebook\.net\/.*\/fbevents\.js/, /fbq\(/] },
  { name: "Stripe", category: "Payments", html: [/js\.stripe\.com/], scriptSrc: [/js\.stripe\.com/] },
  { name: "Intercom", category: "Support", html: [/widget\.intercom\.io/, /intercomSettings/] },
  { name: "Zendesk", category: "Support", html: [/static\.zdassets\.com/, /zendesk\.com/] },
  { name: "Drift", category: "Support", html: [/js\.driftt\.com/] },
  { name: "jQuery", category: "JS Library", html: [/jquery(?:-\d|\.min)?\.js/] },
  { name: "Bootstrap", category: "UI Framework", html: [/bootstrap(?:\.min)?\.(?:css|js)/] },
  { name: "Tailwind CSS", category: "UI Framework", html: [/tailwindcss/, /(?:bg|text|flex|grid)-\[/] },
  { name: "Cloudflare", category: "CDN", headers: [{ name: "server", pattern: /cloudflare/i }, { name: "cf-ray", pattern: /.+/ }] },
  { name: "Vercel", category: "Hosting", headers: [{ name: "server", pattern: /vercel/i }, { name: "x-vercel-id", pattern: /.+/ }] },
  { name: "Netlify", category: "Hosting", headers: [{ name: "server", pattern: /netlify/i }, { name: "x-nf-request-id", pattern: /.+/ }] },
  { name: "Amazon CloudFront", category: "CDN", headers: [{ name: "x-amz-cf-id", pattern: /.+/ }, { name: "via", pattern: /cloudfront/i }] },
  { name: "Fastly", category: "CDN", headers: [{ name: "x-served-by", pattern: /fastly|cache-/i }, { name: "x-fastly-request-id", pattern: /.+/ }] },
  { name: "Akamai", category: "CDN", headers: [{ name: "x-akamai-transformed", pattern: /.+/ }] },
  { name: "Nginx", category: "Web Server", headers: [{ name: "server", pattern: /nginx/i }] },
  { name: "Apache", category: "Web Server", headers: [{ name: "server", pattern: /apache/i }] },
  { name: "Microsoft IIS", category: "Web Server", headers: [{ name: "server", pattern: /iis|microsoft-httpapi/i }] },
];

function extractMetas(html: string): Record<string, string> {
  const metas: Record<string, string> = {};
  const re = /<meta\b[^>]*\bname=["']([^"']+)["'][^>]*\bcontent=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) metas[m[1].toLowerCase()] = m[2];
  return metas;
}

function matchFingerprint(
  fp: Fingerprint,
  html: string,
  headers: Record<string, string>,
  cookies: string,
  metas: Record<string, string>
): DetectedTech | null {
  for (const re of fp.html || []) {
    if (re.test(html)) return { name: fp.name, category: fp.category, confidence: 80, evidence: `html:${re.source.slice(0, 40)}` };
  }
  for (const re of fp.scriptSrc || []) {
    if (re.test(html)) return { name: fp.name, category: fp.category, confidence: 85, evidence: `script:${re.source.slice(0, 40)}` };
  }
  for (const h of fp.headers || []) {
    const v = headers[h.name.toLowerCase()];
    if (v && h.pattern.test(v)) return { name: fp.name, category: fp.category, confidence: 95, evidence: `header:${h.name}` };
  }
  for (const m of fp.meta || []) {
    const v = metas[m.name.toLowerCase()];
    if (v && m.pattern.test(v)) return { name: fp.name, category: fp.category, confidence: 95, evidence: `meta:${m.name}` };
  }
  for (const re of fp.cookies || []) {
    if (re.test(cookies)) return { name: fp.name, category: fp.category, confidence: 90, evidence: "cookie" };
  }
  return null;
}

/** Pure detection over an already-fetched response (testable, no network). */
export function detectFromResponse(
  url: string,
  html: string,
  headers: Record<string, string>,
  cookies = ""
): TechStackResult {
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  const metas = extractMetas(html);

  const found = new Map<string, DetectedTech>();
  for (const fp of FINGERPRINTS) {
    const hit = matchFingerprint(fp, html, lowerHeaders, cookies, metas);
    if (hit && (!found.has(hit.name) || found.get(hit.name)!.confidence < hit.confidence)) {
      found.set(hit.name, hit);
    }
  }
  const technologies = [...found.values()].sort((a, b) => b.confidence - a.confidence);
  const categories: Record<string, string[]> = {};
  for (const t of technologies) (categories[t.category] ||= []).push(t.name);
  return { url, technologies, categories, data_source: "fingerprint", available: technologies.length > 0 };
}

export async function detectTechStack(url: string): Promise<TechStackResult> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OmniDataTech/1.0)" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const cookies = res.headers.get("set-cookie") || "";
    return detectFromResponse(res.url || target, html, headers, cookies);
  } catch {
    return { url: target, technologies: [], categories: {}, data_source: "fingerprint", available: false };
  }
}
