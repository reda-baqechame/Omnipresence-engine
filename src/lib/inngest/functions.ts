import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { runProjectScan, getOwnerEmail } from "@/lib/engines/scan-runner";
import { gatherReportData, saveReportArtifacts } from "@/lib/engines/report-builder";
import { syncProjectAttribution } from "@/lib/engines/attribution-sync";
import { sendWeeklyReport } from "@/lib/email/reports";
import { sendSlackWebhook, buildWeeklyReportSlackMessage } from "@/lib/notifications/slack";

export const runFullScan = inngest.createFunction(
  { id: "run-full-scan", retries: 2, triggers: [{ event: "project/scan.requested" }] },
  async ({ event, step }) => {
    const { projectId, organizationId } = event.data as { projectId: string; organizationId: string };

    const result = await step.run("full-scan", async () => {
      const supabase = await createServiceClient();
      const email = await getOwnerEmail(supabase, organizationId);
      return runProjectScan(supabase, projectId, { notifyEmail: email });
    });

    return result;
  }
);

export const monthlyRescan = inngest.createFunction(
  { id: "monthly-rescan", retries: 1, triggers: [{ cron: "0 0 1 * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projects = await step.run("fetch-active-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, organization_id")
        .eq("status", "active");
      return data || [];
    });

    for (const project of projects) {
      await step.sendEvent(`rescan-${project.id}`, {
        name: "project/scan.requested",
        data: { projectId: project.id, organizationId: project.organization_id },
      });
    }

    return { rescanned: projects.length };
  }
);


export const weeklyRescan = inngest.createFunction(
  { id: "weekly-rescan", retries: 1, triggers: [{ cron: "0 6 * * 1" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projects = await step.run("fetch-active-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, organization_id")
        .eq("status", "active");
      return data || [];
    });

    for (const project of projects) {
      await step.sendEvent(`weekly-rescan-${project.id}`, {
        name: "project/scan.requested",
        data: { projectId: project.id, organizationId: project.organization_id },
      });
    }

    return { rescanned: projects.length };
  }
);

export const monthlyAttributionSync = inngest.createFunction(
  { id: "monthly-attribution-sync", retries: 1, triggers: [{ cron: "0 7 2 * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projectIds = await step.run("fetch-connected-projects", async () => {
      const { data } = await supabase
        .from("oauth_connections")
        .select("project_id")
        .in("provider", ["google_search_console", "bing_webmaster", "google_analytics", "plausible"]);

      const unique = [...new Set((data || []).map((c) => c.project_id))];
      return unique;
    });

    let synced = 0;
    for (const projectId of projectIds) {
      const result = await step.run(`sync-attribution-${projectId}`, async () => {
        return syncProjectAttribution(supabase, projectId);
      });
      if (result.success) synced++;
    }

    return { synced, total: projectIds.length };
  }
);

export const generateReport = inngest.createFunction(
  { id: "generate-report", retries: 2, triggers: [{ event: "project/report.generate" }] },
  async ({ event, step }) => {
    const { projectId, reportId } = event.data as { projectId: string; reportId: string };
    const supabase = await createServiceClient();

    const gathered = await step.run("gather-report-data", async () => {
      return gatherReportData(supabase, projectId);
    });

    if (!gathered) return { success: false, error: "No report data" };

    await step.run("save-report", async () => {
      await saveReportArtifacts(
        supabase,
        projectId,
        reportId,
        gathered.reportData,
        gathered.whiteLabel
      );
    });

    return { success: true, reportId };
  }
);

export const syncAttribution = inngest.createFunction(
  { id: "sync-attribution", retries: 1, triggers: [{ event: "project/attribution.sync" }] },
  async ({ event }) => {
    const { projectId } = event.data as { projectId: string };
    const supabase = await createServiceClient();
    return syncProjectAttribution(supabase, projectId);
  }
);

export const weeklyReportEmail = inngest.createFunction(
  { id: "weekly-report-email", retries: 1, triggers: [{ cron: "0 9 * * 5" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, domain, organization_id")
        .eq("status", "active");
      return data || [];
    });

    let sent = 0;
    for (const project of projects) {
      const reportData = await step.run(`report-${project.id}`, async () => {
        const { data: scores } = await supabase
          .from("scores")
          .select("*")
          .eq("project_id", project.id)
          .order("created_at", { ascending: false })
          .limit(1);
        if (!scores?.[0]) return null;

        const { data: findings } = await supabase.from("technical_findings").select("*").eq("project_id", project.id);
        const { data: coverage } = await supabase.from("coverage_items").select("*").eq("project_id", project.id);
        const { data: authority } = await supabase.from("authority_opportunities").select("*").eq("project_id", project.id).limit(10);
        const { data: roadmap } = await supabase.from("roadmaps").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1).single();
        const { data: visibility } = await supabase.from("visibility_results").select("*").eq("project_id", project.id);

        const { data: org } = await supabase
          .from("organizations")
          .select("white_label_name, white_label_primary_color, slack_webhook_url, notifications_enabled, memberships(profiles(email))")
          .eq("id", project.organization_id)
          .single();

        const memberships = (org as unknown as { memberships?: Array<{ profiles?: { email: string } }> })?.memberships;
        const email = memberships?.[0]?.profiles?.email;

        const { data: previousScores } = await supabase
          .from("scores")
          .select("omnipresence_score")
          .eq("project_id", project.id)
          .order("created_at", { ascending: false })
          .limit(2);

        const reportPayload = {
          project: project as import("@/types/database").Project,
          score: scores[0],
          technicalFindings: findings || [],
          coverageItems: coverage || [],
          authorityOpportunities: authority || [],
          roadmapItems: roadmap?.items || [],
          visibilityResults: visibility || [],
          generatedAt: new Date().toISOString(),
        };

        let emailSent = false;
        if (email) {
          emailSent = await sendWeeklyReport(
            email,
            reportPayload,
            org?.white_label_name
              ? { name: org.white_label_name, color: org.white_label_primary_color || "#6366f1" }
              : undefined
          );
        }

        if (org?.notifications_enabled && org?.slack_webhook_url) {
          await sendSlackWebhook(
            org.slack_webhook_url,
            buildWeeklyReportSlackMessage(
              project.name,
              project.domain,
              scores[0].omnipresence_score,
              previousScores?.[1]?.omnipresence_score,
              `${process.env.NEXT_PUBLIC_APP_URL}/app/projects/${project.id}`,
              org.white_label_name || undefined
            )
          );
        }

        return emailSent ? email : null;
      });

      if (reportData) sent++;
    }

    return { sent, total: projects.length };
  }
);

export const functions = [runFullScan, monthlyRescan, weeklyRescan, generateReport, syncAttribution, monthlyAttributionSync, weeklyReportEmail];
