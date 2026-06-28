/**
 * Deep schema.org / Google Rich Results validator.
 *
 * Replaces the shallow `@context`/`@type`-only check with a real per-type
 * validator that mirrors what `@adobe/structured-data-validator` and Google's
 * Rich Results Test enforce: the REQUIRED and RECOMMENDED properties per type,
 * plus rich-result eligibility. Dependency-free and deterministic so it runs
 * everywhere (CI, OmniData, the app) with no native build risk.
 *
 * Sources: Google Search Central structured-data feature guides (Product, FAQ,
 * Article, HowTo, LocalBusiness, Review, VideoObject, Event, Recipe,
 * Organization, BreadcrumbList).
 */

export interface SchemaTypeRule {
  required: string[];
  recommended: string[];
  /** Properties that are objects/arrays whose presence is checked but not shape. */
  notes?: string;
}

const TYPE_RULES: Record<string, SchemaTypeRule> = {
  Product: {
    required: ["name"],
    recommended: ["image", "description", "brand", "offers", "review", "aggregateRating", "sku", "gtin"],
    notes: "Needs offers OR review OR aggregateRating for the product rich result.",
  },
  Offer: {
    required: ["price", "priceCurrency"],
    recommended: ["availability", "url", "priceValidUntil"],
  },
  FAQPage: {
    required: ["mainEntity"],
    recommended: [],
    notes: "mainEntity must be an array of Question, each with acceptedAnswer.",
  },
  Question: {
    required: ["name", "acceptedAnswer"],
    recommended: [],
  },
  Article: {
    required: ["headline"],
    recommended: ["image", "datePublished", "dateModified", "author", "publisher"],
  },
  NewsArticle: {
    required: ["headline"],
    recommended: ["image", "datePublished", "dateModified", "author", "publisher"],
  },
  BlogPosting: {
    required: ["headline"],
    recommended: ["image", "datePublished", "dateModified", "author", "publisher"],
  },
  HowTo: {
    required: ["name", "step"],
    recommended: ["image", "totalTime", "supply", "tool"],
  },
  LocalBusiness: {
    required: ["name", "address"],
    recommended: ["telephone", "openingHours", "geo", "priceRange", "image", "url"],
  },
  Organization: {
    required: ["name"],
    recommended: ["url", "logo", "sameAs", "contactPoint"],
  },
  Review: {
    required: ["reviewRating", "author"],
    recommended: ["itemReviewed", "datePublished"],
  },
  AggregateRating: {
    required: ["ratingValue"],
    recommended: ["reviewCount", "ratingCount", "bestRating"],
  },
  VideoObject: {
    required: ["name", "thumbnailUrl", "uploadDate"],
    recommended: ["description", "contentUrl", "embedUrl", "duration"],
  },
  Event: {
    required: ["name", "startDate", "location"],
    recommended: ["endDate", "offers", "performer", "image", "description"],
  },
  Recipe: {
    required: ["name", "image"],
    recommended: ["recipeIngredient", "recipeInstructions", "author", "nutrition", "aggregateRating"],
  },
  BreadcrumbList: {
    required: ["itemListElement"],
    recommended: [],
  },
  WebSite: {
    required: ["name", "url"],
    recommended: ["potentialAction"],
  },
};

export type SchemaIssueSeverity = "error" | "warning";

export interface SchemaIssue {
  type: string;
  property: string;
  severity: SchemaIssueSeverity;
  message: string;
}

export interface SchemaTypeResult {
  type: string;
  recognized: boolean;
  richResultEligible: boolean;
  issues: SchemaIssue[];
}

export interface DeepSchemaValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  perType: SchemaTypeResult[];
}

function typeOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === "string") return [t];
  return [];
}

function hasProp(node: Record<string, unknown>, prop: string): boolean {
  const v = node[prop];
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Recursively collect every node that declares an @type (handles @graph + nesting). */
function collectNodes(input: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    for (const el of input) collectNodes(el, out);
    return out;
  }
  if (input && typeof input === "object") {
    const node = input as Record<string, unknown>;
    if (node["@type"]) out.push(node);
    for (const key of Object.keys(node)) {
      if (key === "@type" || key === "@context") continue;
      collectNodes(node[key], out);
    }
  }
  return out;
}

/** Product rich-result eligibility requires one of offers/review/aggregateRating. */
function productEligible(node: Record<string, unknown>): boolean {
  return hasProp(node, "offers") || hasProp(node, "review") || hasProp(node, "aggregateRating");
}

export function validateSchemaDeep(jsonLd: unknown): DeepSchemaValidation {
  const nodes = collectNodes(jsonLd);
  const errors: string[] = [];
  const warnings: string[] = [];
  const perType: SchemaTypeResult[] = [];

  // Top-level @context check (only required on root-level nodes).
  const roots = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  for (const r of roots) {
    if (r && typeof r === "object" && !("@context" in (r as object)) && !("@graph" in (r as object))) {
      errors.push("Missing @context on a root node");
    }
  }

  if (nodes.length === 0) {
    errors.push("No nodes with @type found");
    return { valid: false, errors, warnings, perType };
  }

  for (const node of nodes) {
    const types = typeOf(node);
    if (types.length === 0) {
      errors.push("Node missing @type");
      continue;
    }
    for (const type of types) {
      const rule = TYPE_RULES[type];
      const issues: SchemaIssue[] = [];
      if (!rule) {
        // Unknown/unsupported type — recognized by schema.org but no rich-result rule.
        perType.push({ type, recognized: false, richResultEligible: false, issues });
        continue;
      }

      for (const prop of rule.required) {
        if (!hasProp(node, prop)) {
          const issue: SchemaIssue = {
            type,
            property: prop,
            severity: "error",
            message: `${type} is missing required property "${prop}"`,
          };
          issues.push(issue);
          errors.push(issue.message);
        }
      }
      for (const prop of rule.recommended) {
        if (!hasProp(node, prop)) {
          const issue: SchemaIssue = {
            type,
            property: prop,
            severity: "warning",
            message: `${type} is missing recommended property "${prop}"`,
          };
          issues.push(issue);
          warnings.push(issue.message);
        }
      }

      let eligible = !issues.some((i) => i.severity === "error");
      if (type === "Product" && !productEligible(node)) {
        const issue: SchemaIssue = {
          type,
          property: "offers",
          severity: "error",
          message: "Product needs offers, review, or aggregateRating to be rich-result eligible",
        };
        issues.push(issue);
        errors.push(issue.message);
        eligible = false;
      }

      perType.push({ type, recognized: true, richResultEligible: eligible, issues });
    }
  }

  return { valid: errors.length === 0, errors, warnings, perType };
}
