import { createClient } from "@/lib/supabase/server";
import type { AuditLead } from "@/types/database";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConvertLeadButton } from "@/components/convert-lead-button";

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminMemberships } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"]);

  const orgIds = (adminMemberships || []).map((m) => m.organization_id);
  if (orgIds.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
        <p className="mb-2">Leads are only visible to organization owners and admins.</p>
        <Link href="/app" className="text-primary hover:underline text-sm">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { data: leads } = await supabase
    .from("audit_leads")
    .select("*")
    .in("organization_id", orgIds)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (leads || []) as AuditLead[];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Audit Leads</h1>
          <p className="text-muted-foreground mt-1">
            Prospects from your embeddable audit widget and referral links — scoped to your organization only.
          </p>
        </div>
        <Link
          href="/app/settings/whitelabel"
          className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-secondary transition"
        >
          Get Embed Code
        </Link>
      </div>

      {rows.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Issues</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <tr key={lead.id} className="border-b border-border/50 hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <a href={`mailto:${lead.email}`} className="text-primary hover:underline">
                      {lead.email}
                    </a>
                  </td>
                  <td className="px-4 py-3">{lead.domain}</td>
                  <td className="px-4 py-3">
                    {lead.score_snapshot?.omnipresence !== undefined
                      ? `${Math.round(lead.score_snapshot.omnipresence)}/100`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {lead.score_snapshot?.critical_issues ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <ConvertLeadButton leadId={lead.id} domain={lead.domain} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <p className="mb-2">No leads captured yet.</p>
          <p className="text-sm">
            Add the embeddable audit widget from Settings → White-Label to start collecting prospects.
          </p>
        </div>
      )}
    </div>
  );
}
