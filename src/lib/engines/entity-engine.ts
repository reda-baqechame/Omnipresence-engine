import type { BrandProfile, Project } from "@/types/database";
import type { EntityProfile } from "@/types/database";

export interface EntityBuildResult {
  profile: Omit<EntityProfile, "id" | "created_at" | "updated_at">;
  wikidataDraft: string;
  napIssues: Array<{ platform: string; issue: string }>;
}

export function buildEntityProfile(
  project: Project,
  brand: Partial<BrandProfile>
): EntityBuildResult {
  const social = brand.social_profiles || {};
  const sameAsMap: Record<string, string> = {};

  if (social.linkedin) sameAsMap.linkedin = social.linkedin;
  if (social.twitter || social.x) sameAsMap.x = social.twitter || social.x || "";
  if (social.facebook) sameAsMap.facebook = social.facebook;
  if (social.youtube) sameAsMap.youtube = social.youtube;
  if (social.instagram) sameAsMap.instagram = social.instagram;

  sameAsMap.website = `https://${project.domain}`;

  const napRecords = [
    {
      platform: "website",
      name: brand.brand_name || project.name,
      address: project.location,
    },
    {
      platform: "google_business",
      name: brand.brand_name || project.name,
      address: project.location,
    },
  ];

  const napIssues: Array<{ platform: string; issue: string }> = [];
  if (!project.location) {
    napIssues.push({ platform: "google_business", issue: "Missing location for NAP consistency" });
  }
  if (!social.linkedin) {
    napIssues.push({ platform: "linkedin", issue: "No LinkedIn profile in sameAs map" });
  }

  const entityScore = calculateEntityScore(sameAsMap, napIssues, brand);

  const wikidataDraft = generateWikidataDraft(project, brand);

  return {
    profile: {
      project_id: project.id,
      wikidata_qid: undefined,
      same_as_map: sameAsMap,
      nap_records: napRecords,
      knowledge_panel_ready: entityScore >= 70,
      entity_score: entityScore,
      reconciliation_notes: napIssues.map((i) => `${i.platform}: ${i.issue}`).join("; ") || undefined,
    },
    wikidataDraft,
    napIssues,
  };
}

function calculateEntityScore(
  sameAs: Record<string, string>,
  napIssues: Array<{ platform: string; issue: string }>,
  brand: Partial<BrandProfile>
): number {
  let score = 20;
  score += Math.min(Object.keys(sameAs).length * 8, 40);
  if (brand.author_persona) score += 10;
  if ((brand.proof_points || []).length > 0) score += 10;
  if ((brand.case_studies || []).length > 0) score += 10;
  score -= napIssues.length * 5;
  return Math.max(0, Math.min(100, score));
}

function generateWikidataDraft(project: Project, brand: Partial<BrandProfile>): string {
  return JSON.stringify(
    {
      labels: { en: { language: "en", value: brand.brand_name || project.name } },
      descriptions: {
        en: {
          language: "en",
          value: `${project.industry || "business"} company based in ${project.location || "multiple locations"}`,
        },
      },
      claims: {
        P856: [{ value: `https://${project.domain}` }],
        P452: [{ value: project.industry }],
      },
      note: "Submit to Wikidata with verifiable third-party references per notability guidelines.",
    },
    null,
    2
  );
}

export function checkNAPConsistency(
  records: Array<{ platform: string; name: string; address?: string; phone?: string }>
): Array<{ platforms: string[]; field: string; values: string[] }> {
  const names = new Set(records.map((r) => r.name.toLowerCase().trim()));
  const issues: Array<{ platforms: string[]; field: string; values: string[] }> = [];

  if (names.size > 1) {
    issues.push({
      platforms: records.map((r) => r.platform),
      field: "name",
      values: [...names],
    });
  }

  const addresses = records.filter((r) => r.address).map((r) => r.address!.toLowerCase().trim());
  if (new Set(addresses).size > 1) {
    issues.push({
      platforms: records.filter((r) => r.address).map((r) => r.platform),
      field: "address",
      values: [...new Set(addresses)],
    });
  }

  return issues;
}

export function generateSameAsJsonLd(sameAsMap: Record<string, string>): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      sameAs: Object.values(sameAsMap).filter(Boolean),
    },
    null,
    2
  );
}
