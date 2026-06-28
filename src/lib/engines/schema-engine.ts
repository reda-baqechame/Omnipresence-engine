import type { BrandProfile, Project } from "@/types/database";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { validateSchemaDeep } from "@/lib/engines/schema-validation";
import { z } from "zod";

export interface SchemaGenerationInput {
  project: Project;
  brand: Partial<BrandProfile>;
  pageUrl: string;
  pageTitle: string;
  pageContent?: string;
  types?: string[];
  /** Reconciled sameAs URLs from the entity profile (Wikidata/Wikipedia/G2/Crunchbase/etc). */
  entitySameAs?: string[];
  /** Wikidata QID (e.g. Q12345) for entity disambiguation via @id + identifier. */
  wikidataQid?: string;
  /** sameAs URLs for the founder/author Person entity. */
  personSameAs?: string[];
}

export interface GeneratedSchema {
  schemaTypes: string[];
  jsonLd: Record<string, unknown>[];
  gtmSnippet: string;
  htmlSnippet: string;
}

export async function generatePageSchema(
  input: SchemaGenerationInput
): Promise<GeneratedSchema> {
  // Merge social profiles with the reconciled entity sameAs (Wikidata/Wikipedia/
  // G2/Crunchbase/etc) so the Organization carries its full verified identity —
  // the single most-cited 2026 GEO lever — not just social links.
  const sameAs = Array.from(
    new Set(
      [
        ...Object.values(input.brand.social_profiles || {}),
        ...(input.entitySameAs || []),
      ].filter((v): v is string => Boolean(v))
    )
  );
  const types = input.types || ["Organization", "WebSite", "FAQPage", "Article"];

  const wikidataQid = input.wikidataQid?.trim();
  const wikidataUrl = wikidataQid ? `https://www.wikidata.org/wiki/${wikidataQid}` : undefined;

  const orgBlock = {
    "@context": "https://schema.org",
    "@type": "Organization",
    ...(wikidataUrl ? { "@id": wikidataUrl } : {}),
    name: input.brand.brand_name || input.project.name,
    url: `https://${input.project.domain}`,
    description: input.brand.brand_voice,
    sameAs,
    ...(wikidataQid
      ? {
          identifier: {
            "@type": "PropertyValue",
            propertyID: "Wikidata",
            value: wikidataQid,
          },
        }
      : {}),
    ...(input.project.location
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: input.project.location,
          },
        }
      : {}),
  };

  // Standalone Person entity for the founder/author — Person<->Organization
  // links materially strengthen entity understanding and E-E-A-T.
  const personName = input.brand.author_persona;
  const personBlock = personName
    ? {
        "@context": "https://schema.org",
        "@type": "Person",
        name: personName,
        ...(input.personSameAs && input.personSameAs.length
          ? { sameAs: Array.from(new Set(input.personSameAs.filter(Boolean))) }
          : {}),
        worksFor: {
          "@type": "Organization",
          name: input.brand.brand_name || input.project.name,
          ...(wikidataUrl ? { "@id": wikidataUrl } : {}),
        },
      }
    : null;

  const websiteBlock = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: input.brand.brand_name || input.project.name,
    url: `https://${input.project.domain}`,
  };

  const faqs = input.brand.faq_database || [];
  const faqBlock =
    faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.slice(0, 10).map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  const articleBlock = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.pageTitle,
    url: input.pageUrl,
    datePublished: new Date().toISOString().split("T")[0],
    dateModified: new Date().toISOString().split("T")[0],
    author: {
      "@type": "Person",
      name: input.brand.author_persona || input.brand.brand_name || input.project.name,
    },
    publisher: {
      "@type": "Organization",
      name: input.brand.brand_name || input.project.name,
    },
  };

  const jsonLd: Record<string, unknown>[] = [orgBlock, websiteBlock, articleBlock];
  if (personBlock) jsonLd.push(personBlock);
  if (faqBlock) jsonLd.push(faqBlock);

  const htmlSnippet = jsonLd
    .map((block) => `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>`)
    .join("\n");

  const gtmSnippet = `<!-- Paste in GTM Custom HTML tag -->\n${htmlSnippet}`;

  const schemaTypes = personBlock && !types.includes("Person") ? [...types, "Person"] : types;

  return {
    schemaTypes,
    jsonLd,
    gtmSnippet,
    htmlSnippet,
  };
}

export async function validateSchemaLocally(jsonLd: Record<string, unknown>[]): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
  perType: import("@/lib/engines/schema-validation").SchemaTypeResult[];
}> {
  // Deep per-type Google Rich Results validation (required + recommended props,
  // eligibility) instead of the old @context/@type-only check.
  const deep = validateSchemaDeep(jsonLd);
  return {
    valid: deep.valid,
    errors: deep.errors,
    warnings: deep.warnings,
    perType: deep.perType,
  };
}

export async function deploySchemaToWordPress(
  wpUrl: string,
  apiKey: string,
  postId: number,
  htmlSnippet: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${wpUrl}/wp-json/wp/v2/posts/${postId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meta: { _schema_json_ld: htmlSnippet },
        content: { raw: `<!-- schema injected -->\n${htmlSnippet}` },
      }),
    });
    return { success: response.ok, error: response.ok ? undefined : `WP ${response.status}` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Deploy failed" };
  }
}

export async function deploySchemaToWebflow(
  siteId: string,
  apiKey: string,
  collectionId: string,
  itemId: string,
  htmlSnippet: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fieldData: { "schema-markup": htmlSnippet },
        }),
      }
    );
    return { success: response.ok };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Webflow deploy failed" };
  }
}

export async function suggestSchemaFixes(
  existingTypes: string[],
  industry: string
): Promise<string[]> {
  const recommended = ["Organization", "WebSite", "Article", "FAQPage", "BreadcrumbList"];
  if (/local|plumb|dental|law|clinic|restaurant/i.test(industry)) {
    recommended.push("LocalBusiness");
  }
  return recommended.filter((t) => !existingTypes.includes(t));
}

const ContentQCSchema = z.object({
  passed: z.boolean(),
  score: z.number(),
  issues: z.array(z.string()),
});

export async function runSchemaContentQC(
  content: string,
  schemaTypes: string[]
): Promise<{ passed: boolean; score: number; issues: string[] }> {
  const result = await generateStructured(
    "You are a schema and content quality reviewer for AI citation eligibility.",
    `Review this content for citation readiness. Check: direct answers, proprietary facts, schema alignment.
Schema types: ${schemaTypes.join(", ")}
Content (first 3000 chars): ${content.slice(0, 3000)}`,
    ContentQCSchema
  );

  if (result.success && result.data) return result.data;
  return {
    passed: content.length >= 500,
    score: content.length >= 500 ? 70 : 40,
    issues: content.length < 500 ? ["Content too short"] : [],
  };
}
