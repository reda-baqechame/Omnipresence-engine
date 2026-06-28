/**
 * Link building campaigns — anchor mix 55% branded / 25% partial / 20% exact (AEO Engine pattern).
 * Uses backlink gaps + authority opportunities; vendor-ready order export.
 */

export interface LinkBuildingOrder {
  target_url: string;
  anchor_text: string;
  anchor_type: "branded" | "partial" | "exact";
  vendor_tier: string;
  estimated_dr: number;
  status: "draft" | "ordered" | "live";
}

const ANCHOR_MIX = { branded: 0.55, partial: 0.25, exact: 0.2 };

export function classifyAnchor(anchor: string, brand: string, keyword: string): LinkBuildingOrder["anchor_type"] {
  const a = anchor.toLowerCase();
  const b = brand.toLowerCase();
  if (a === b || a.includes(b)) return "branded";
  if (keyword && a.includes(keyword.toLowerCase())) return "exact";
  return "partial";
}

export function buildMonthlyCampaign(
  brand: string,
  domain: string,
  keywords: string[],
  gapDomains: Array<{ domain: string; dr_estimate?: number }>,
  tier: "growth" | "scale" = "growth"
): LinkBuildingOrder[] {
  const count = tier === "scale" ? 8 : 4;
  const primaryKw = keywords[0] || domain.split(".")[0];
  const orders: LinkBuildingOrder[] = [];

  const brandedCount = Math.round(count * ANCHOR_MIX.branded);
  const partialCount = Math.round(count * ANCHOR_MIX.partial);
  const exactCount = count - brandedCount - partialCount;

  // Only ever target REAL gap domains — never fabricate a placeholder outreach
  // URL. If there are no real targets, no orders are produced (honest empty).
  const targets = gapDomains.filter((g) => g.domain && g.domain.trim()).slice(0, count);
  let i = 0;

  for (let n = 0; n < brandedCount && i < targets.length; n++, i++) {
    orders.push({
      target_url: `https://${targets[i].domain}/outreach`,
      anchor_text: brand,
      anchor_type: "branded",
      vendor_tier: tier,
      estimated_dr: targets[i]?.dr_estimate ?? 35,
      status: "draft",
    });
  }
  for (let n = 0; n < partialCount && i < targets.length; n++, i++) {
    orders.push({
      target_url: `https://${targets[i].domain}/outreach`,
      anchor_text: `${primaryKw} experts`,
      anchor_type: "partial",
      vendor_tier: tier,
      estimated_dr: targets[i]?.dr_estimate ?? 35,
      status: "draft",
    });
  }
  for (let n = 0; n < exactCount && i < targets.length; n++, i++) {
    orders.push({
      target_url: `https://${domain}`,
      anchor_text: primaryKw,
      anchor_type: "exact",
      vendor_tier: tier,
      estimated_dr: targets[i]?.dr_estimate ?? 35,
      status: "draft",
    });
  }

  return orders;
}
