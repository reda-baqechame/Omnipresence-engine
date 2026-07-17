import { z } from "zod";
import { generateStructured } from "@/lib/providers/ai-gateway";

/**
 * Merchant / Shopping feed engine.
 *
 * Ports the FeedGen (Apache-2.0) optimization *approach* — LLM-improved titles,
 * descriptions, and attribute fill — into a first-class engine (we do NOT adopt
 * FeedGen's Apps Script / Sheets harness). Powers Google Merchant Center /
 * Shopping + AI-shopping visibility: better titles and complete attributes are
 * the single biggest lever on Shopping impressions and Product rich results.
 *
 * Everything is grounded in the merchant's own feed data — we never invent
 * prices, GTINs, or specs. Optimization only restructures/clarifies existing
 * fields and flags missing attributes for the merchant to supply.
 */

export type FeedFormat = "xml" | "tsv";

export interface Product {
  id: string;
  title: string;
  description: string;
  link?: string;
  imageLink?: string;
  price?: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  condition?: string;
  availability?: string;
  productType?: string;
  googleProductCategory?: string;
  color?: string;
  size?: string;
  material?: string;
}

export interface ProductIssue {
  field: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
}

export interface ProductAudit {
  product: Product;
  issues: ProductIssue[];
  /** 0-100 feed-completeness/quality score. */
  score: number;
}

const G = (xml: string, tag: string): string | undefined => {
  // Matches <g:tag>value</g:tag> with optional CDATA.
  const re = new RegExp(`<g:${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/g:${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
};

const T = (xml: string, tag: string): string | undefined => {
  const re = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
};

/** Parse a Google Merchant feed (RSS 2.0 + g: namespace) or a TSV export. */
export function parseProductFeed(content: string, format: FeedFormat): Product[] {
  if (format === "xml") return parseXmlFeed(content);
  return parseTsvFeed(content);
}

function parseXmlFeed(xml: string): Product[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const products: Product[] = [];
  for (const item of items) {
    const id = G(item, "id") || T(item, "id") || "";
    const title = G(item, "title") || T(item, "title") || "";
    if (!id && !title) continue;
    products.push({
      id,
      title,
      description: G(item, "description") || T(item, "description") || "",
      link: G(item, "link") || T(item, "link"),
      imageLink: G(item, "image_link"),
      price: G(item, "price"),
      brand: G(item, "brand"),
      gtin: G(item, "gtin"),
      mpn: G(item, "mpn"),
      condition: G(item, "condition"),
      availability: G(item, "availability"),
      productType: G(item, "product_type"),
      googleProductCategory: G(item, "google_product_category"),
      color: G(item, "color"),
      size: G(item, "size"),
      material: G(item, "material"),
    });
  }
  return products;
}

function parseTsvFeed(tsv: string): Product[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const products: Product[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const get = (name: string) => {
      const j = idx(name);
      return j >= 0 ? (cols[j] || "").trim() : undefined;
    };
    const id = get("id") || "";
    const title = get("title") || "";
    if (!id && !title) continue;
    products.push({
      id,
      title,
      description: get("description") || "",
      link: get("link"),
      imageLink: get("image_link") || get("image link"),
      price: get("price"),
      brand: get("brand"),
      gtin: get("gtin"),
      mpn: get("mpn"),
      condition: get("condition"),
      availability: get("availability"),
      productType: get("product_type") || get("product type"),
      googleProductCategory: get("google_product_category") || get("google product category"),
      color: get("color"),
      size: get("size"),
      material: get("material"),
    });
  }
  return products;
}

/** Deterministic feed-quality audit aligned to Merchant Center requirements. */
export function auditProduct(p: Product): ProductAudit {
  const issues: ProductIssue[] = [];

  if (!p.title) issues.push({ field: "title", severity: "critical", message: "Missing title" });
  else if (p.title.length > 150)
    issues.push({ field: "title", severity: "medium", message: `Title exceeds 150 chars (${p.title.length})` });
  else if (p.title.length < 20)
    issues.push({ field: "title", severity: "medium", message: "Title is very short — add brand + key attributes" });

  if (p.brand && p.title && !p.title.toLowerCase().includes(p.brand.toLowerCase()))
    issues.push({ field: "title", severity: "low", message: "Title does not include the brand" });

  if (!p.description) issues.push({ field: "description", severity: "high", message: "Missing description" });
  else if (p.description.length < 160)
    issues.push({ field: "description", severity: "low", message: "Description is thin (<160 chars)" });

  if (!p.imageLink) issues.push({ field: "image_link", severity: "critical", message: "Missing image_link" });
  if (!p.price) issues.push({ field: "price", severity: "critical", message: "Missing price" });
  if (!p.availability) issues.push({ field: "availability", severity: "high", message: "Missing availability" });
  if (!p.condition) issues.push({ field: "condition", severity: "medium", message: "Missing condition" });
  if (!p.brand) issues.push({ field: "brand", severity: "high", message: "Missing brand" });
  if (!p.gtin && !p.mpn)
    issues.push({ field: "gtin", severity: "high", message: "Missing both GTIN and MPN (unique product identifier)" });
  if (!p.googleProductCategory)
    issues.push({ field: "google_product_category", severity: "medium", message: "Missing google_product_category" });
  if (!p.productType)
    issues.push({ field: "product_type", severity: "low", message: "Missing product_type" });

  // Score: start at 100, subtract weighted penalties.
  const weight = { critical: 22, high: 12, medium: 6, low: 3 } as const;
  const penalty = issues.reduce((s, i) => s + weight[i.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return { product: p, issues, score };
}

const OptimizeSchema = z.object({
  optimizedTitle: z.string(),
  optimizedDescription: z.string(),
  // .nullable(), NOT .optional() — OpenAI strict structured outputs reject
  // schemas with properties missing from `required`.
  suggestedAttributes: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .nullable(),
});

export interface ProductOptimization {
  optimizedTitle: string;
  optimizedDescription: string;
  suggestedAttributes: Array<{ name: string; value: string }>;
  source: "ai" | "unavailable";
  error?: string;
}

/**
 * LLM-optimize a product's title/description following the FeedGen approach:
 * front-load brand + product type + the most search-relevant attributes, keep
 * the title <=150 chars, and write a specific, grounded description. Never
 * invents specs — only reorganizes/clarifies fields present in the feed.
 */
export async function optimizeProduct(p: Product): Promise<ProductOptimization> {
  const context = `Product feed fields (only use what's given — never invent specs/prices):
- Current title: ${p.title || "(none)"}
- Current description: ${p.description?.slice(0, 600) || "(none)"}
- Brand: ${p.brand || "(unknown)"}
- Product type: ${p.productType || "(unknown)"}
- Google category: ${p.googleProductCategory || "(unknown)"}
- Color: ${p.color || "(n/a)"} | Size: ${p.size || "(n/a)"} | Material: ${p.material || "(n/a)"}
- Condition: ${p.condition || "(n/a)"} | Availability: ${p.availability || "(n/a)"}`;

  const result = await generateStructured(
    `You are a Google Merchant Center / Shopping feed optimizer (FeedGen approach). Optimize a product title and description to maximize Shopping impressions and AI-shopping recommendations. Rules: (1) title <=150 chars, structure "Brand + Product Type + Key Attributes (color/size/material/model)"; (2) description: specific, scannable, attribute-rich, no fluff; (3) NEVER invent attributes, specs, prices, or claims not present in the input — only reorganize and clarify; (4) suggest additional structured attributes ONLY if clearly implied by the given fields.`,
    `Optimize this product for Shopping and AI shopping engines.\n\n${context}`,
    OptimizeSchema
  );

  if (result.success && result.data) {
    return {
      optimizedTitle: result.data.optimizedTitle.slice(0, 150),
      optimizedDescription: result.data.optimizedDescription,
      suggestedAttributes: result.data.suggestedAttributes || [],
      source: "ai",
    };
  }
  return {
    optimizedTitle: p.title,
    optimizedDescription: p.description,
    suggestedAttributes: [],
    source: "unavailable",
    error: result.error || "AI optimization unavailable (configure an LLM key or Ollama)",
  };
}

/** Build Product JSON-LD (schema.org) for rich results from feed fields. */
export function buildProductJsonLd(p: Product): Record<string, unknown> {
  const offer: Record<string, unknown> = {
    "@type": "Offer",
    priceCurrency: (p.price?.match(/[A-Z]{3}/) || [])[0] || "USD",
    price: (p.price?.match(/[\d.]+/) || [])[0] || undefined,
    availability:
      p.availability && /in.?stock/i.test(p.availability)
        ? "https://schema.org/InStock"
        : p.availability
          ? "https://schema.org/OutOfStock"
          : undefined,
    url: p.link,
  };
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.description,
    image: p.imageLink,
    sku: p.id,
    gtin: p.gtin,
    mpn: p.mpn,
    category: p.googleProductCategory || p.productType,
    offers: offer,
  };
  if (p.brand) node.brand = { "@type": "Brand", name: p.brand };
  if (p.color) node.color = p.color;
  if (p.size) node.size = p.size;
  if (p.material) node.material = p.material;
  return node;
}

export interface MerchantFeedResult {
  totalProducts: number;
  averageScore: number;
  audits: ProductAudit[];
  topIssues: Array<{ field: string; count: number }>;
}

/** Parse + audit a whole feed and summarize the most common issues. */
export function runMerchantFeedAudit(content: string, format: FeedFormat): MerchantFeedResult {
  const products = parseProductFeed(content, format);
  const audits = products.map(auditProduct);
  const averageScore = audits.length
    ? Math.round(audits.reduce((s, a) => s + a.score, 0) / audits.length)
    : 0;

  const issueCounts = new Map<string, number>();
  for (const a of audits) {
    for (const i of a.issues) issueCounts.set(i.field, (issueCounts.get(i.field) || 0) + 1);
  }
  const topIssues = [...issueCounts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count);

  return { totalProducts: products.length, averageScore, audits, topIssues };
}
