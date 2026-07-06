import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { EmbedAuditSnippetSchema } from "@/lib/validation/schemas";

/** Public embed snippet for agency white-label audit widgets (v2 — brand/color params). */
export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app";
  // Constrain inputs: brand is plain text (no markup), color is a hex value.
  const brand = (request.nextUrl.searchParams.get("brand") || "").replace(/[<>"'`]/g, "").slice(0, 60);
  const rawColor = request.nextUrl.searchParams.get("color") || "6366f1";
  const color = /^#?[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : "6366f1";
  const logo = request.nextUrl.searchParams.get("logo") || "";
  const rawRef = (request.nextUrl.searchParams.get("ref") || "").trim().toLowerCase();
  const ref = /^[a-f0-9]{16,64}$/.test(rawRef) ? rawRef : "";

  const params = new URLSearchParams();
  if (brand) params.set("brand", brand);
  if (color) params.set("color", color.startsWith("#") ? color : `#${color}`);
  if (logo) params.set("logo", logo);
  if (ref) params.set("ref", ref);
  const qs = params.toString();
  const embedUrl = `${base}/embed/audit${qs ? `?${qs}` : ""}`;

  // JSON-encode the interpolated values so they cannot break out of the JS
  // string context when this snippet is pasted into a customer page.
  const snippet = `<!-- OmniPresence Embed Audit v2 -->
<div id="omnipresence-audit"></div>
<script>
(function(){
  var f=document.createElement("iframe");
  f.src=${JSON.stringify(embedUrl)};
  f.style.cssText="width:100%;min-height:520px;border:0;border-radius:12px";
  f.title=${JSON.stringify(`${brand || "OmniPresence"} Audit`)};
  document.getElementById("omnipresence-audit").appendChild(f);
})();
</script>`;

  return new NextResponse(snippet, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** POST /api/embed/audit-snippet — validated embed config for a project domain. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, EmbedAuditSnippetSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const { projectId, domain } = body;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const base = process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app";
  const embedUrl = `${base}/embed/audit?domain=${encodeURIComponent(domain)}`;

  return NextResponse.json({ projectId, domain, embedUrl });
}
