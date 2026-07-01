import { Search, BarChart3, Zap, Globe, Shield } from "lucide-react";
import { canRenderClaim } from "@/lib/config/claims";

const FEATURES = [
  { claimId: "technical_audit", icon: Search, title: "OmniPresence Audit", desc: "Scan your brand across 15+ platforms. See exactly where you're invisible and why." },
  { claimId: "ai_visibility_tracking", icon: BarChart3, title: "AI Visibility Tracking", desc: "Track brand mentions and citations across ChatGPT, Perplexity, Gemini, Google AI, and more." },
  { claimId: "content_optimization", icon: Zap, title: "90-Day Execution Plan", desc: "Get a prioritized roadmap ranked by revenue impact. Not just data — actionable steps." },
  { claimId: "source_citation_graph", icon: Globe, title: "Multi-Platform Coverage", desc: "Directories, social, review sites, communities, podcasts, and authority sources." },
  { claimId: "guarantee_deterministic", icon: Shield, title: "White-Label for Agencies", desc: "Sell branded OmniPresence reports to every client worried about AI search visibility." },
  { claimId: "attribution_proof", icon: BarChart3, title: "Traffic Attribution", desc: "Prove ROI with organic traffic, AI referrals, leads, and paid-ads-equivalent value." },
] as const;

export function getBackedMarketingFeatures() {
  return FEATURES.filter((f) => canRenderClaim(f.claimId));
}

export { FEATURES };
