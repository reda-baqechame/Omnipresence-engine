import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { runProjectScan, getOwnerEmail } from "@/lib/engines/scan-runner";
import {
  stepTechnicalAudit,
  stepBrandExtract,
  stepVisibilityScan,
  stepScoreAndRoadmap,
} from "@/lib/engines/scan-steps";
import { analyzePassageReadiness } from "@/lib/engines/passage-readiness";
import { sendScoreDropAlert } from "@/lib/email/reports";
import { gatherReportData, saveReportArtifacts } from "@/lib/engines/report-builder";
import { syncProjectAttribution } from "@/lib/engines/attribution-sync";
import { sendWeeklyReport } from "@/lib/email/reports";
import { sendSlackWebhook, buildWeeklyReportSlackMessage } from "@/lib/notifications/slack";
import { verifyGuaranteeContract } from "@/lib/engines/guarantee";
import { runAllRankChecks } from "@/lib/engines/rank-tracker-service";
import type { Project } from "@/types/database";

export const runFullScan = inngest.createFunction(
  { id: "run-full-scan", retries: 2, triggers: [{ event: "project/scan.requested" }] },
  async ({ event, step }) => {
    const { projectId, organizationId } = event.data as { projectId: string; organizationId: string };
    const supabase = await createServiceClient();

    const project = await step.run("load-project", async () => {
      const { data } = await supabase.from("projects").select("*").eq("id", projectId).single();
      if (!data) throw new Error("Project not found");
      await supabase.from("projects").update({ status: "scanning" }).eq("id", projectId);
      return data as Project;
    });

    const technicalFindings = await step.run("technical-audit", () =>
      stepTechnicalAudit(supabase, projectId, project.domain)
    );

    await step.run("brand-extract", () => stepBrandExtract(supabase, project));

    await step.run("visibility-scan", () => stepVisibilityScan(supabase, project));

    const { score } = await step.run("score-roadmap", () =>
      stepScoreAndRoadmap(supabase, project, technicalFindings)
    );

    await step.run("finalize", async () => {
      await supabase.from("projects").update({
        status: "active",
        last_scan_at: new Date().toISOString(),
      }).eq("id", projectId);

      const email = await getOwnerEmail(supabase, organizationId);
      if (email) {
        const { sendScanCompleteEmail } = await import("@/lib/email/reports");
        await sendScanCompleteEmail(email, project.name, score.omnipresence_score, projectId);
      }
    });

    return { projectId, score: score.omnipresence_score, demo: false };
  }
);

/** Legacy monolithic scan fallback */
export const runFullScanLegacy = inngest.createFunction(
  { id: "run-full-scan-legacy", retries: 1, triggers: [{ event: "project/scan.legacy" }] },
  async ({ event, step }) => {
    const { projectId, organizationId } = event.data as { projectId: string; organizationId: string };
    return step.run("full-scan", async () => {
      const supabase = await createServiceClient();
      const email = await getOwnerEmail(supabase, organizationId);
      return runProjectScan(supabase, projectId, { notifyEmail: email });
    });
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

export const dailyFreshnessCheck = inngest.createFunction(
  { id: "daily-freshness-check", retries: 1, triggers: [{ cron: "0 3 * * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase.from("projects").select("id, domain").eq("status", "active");
      return data || [];
    });

    let checked = 0;
    for (const project of projects.slice(0, 20)) {
      await step.run(`freshness-${project.id}`, async () => {
        const findings = await analyzePassageReadiness(project.domain);
        const stale = findings.filter((f) => f.category === "freshness" && f.severity !== "low");
        if (stale.length > 0) {
          await supabase.from("ops_queue").insert({
            project_id: project.id,
            organization_id: (await supabase.from("projects").select("organization_id").eq("id", project.id).single()).data?.organization_id,
            action_type: "content_refresh",
            title: `Refresh stale content on ${project.domain}`,
            payload: { findings: stale.map((f) => f.title) },
            risk_level: "low",
            status: "approved",
          });
        }
      });
      checked++;
    }
    return { checked };
  }
);

export const citationDiffAlert = inngest.createFunction(
  { id: "citation-diff-alert", retries: 1, triggers: [{ cron: "0 8 * * 1" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase.from("projects").select("id, name, organization_id").eq("status", "active");
      return data || [];
    });

    let alerted = 0;
    for (const project of projects) {
      const delta = await step.run(`citation-delta-${project.id}`, async () => {
        const { data: runs } = await supabase
          .from("visibility_runs")
          .select("id")
          .eq("project_id", project.id)
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(2);

        if (!runs || runs.length < 2) return null;

        const [current, previous] = runs;
        const { count: currentCites } = await supabase
          .from("visibility_results")
          .select("*", { count: "exact", head: true })
          .eq("run_id", current.id)
          .eq("brand_cited", true);

        const { count: prevCites } = await supabase
          .from("visibility_results")
          .select("*", { count: "exact", head: true })
          .eq("run_id", previous.id)
          .eq("brand_cited", true);

        return { current: currentCites || 0, previous: prevCites || 0 };
      });

      if (delta && delta.current < delta.previous) {
        const email = await getOwnerEmail(supabase, project.organization_id);
        if (email) {
          await sendScoreDropAlert(
            email,
            project.name,
            delta.previous,
            delta.current,
            project.id
          );
          alerted++;
        }
      }
    }
    return { alerted };
  }
);

export const guaranteeVerificationCron = inngest.createFunction(
  { id: "guarantee-verification-cron", retries: 1, triggers: [{ cron: "0 4 * * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const contracts = await step.run("fetch-active-contracts", async () => {
      const { data } = await supabase
        .from("guarantee_contracts")
        .select("project_id, window_days, baseline_locked_at")
        .eq("status", "active")
        .not("baseline_locked_at", "is", null);
      return data || [];
    });

    let verified = 0;
    for (const contract of contracts) {
      const windowDays = Number(contract.window_days ?? 90);
      const end = new Date(contract.baseline_locked_at!).getTime() + windowDays * 86400000;
      if (Date.now() < end) continue;

      await step.run(`verify-${contract.project_id}`, async () => {
        const { data: score } = await supabase
          .from("scores")
          .select("omnipresence_score, ai_visibility, breakdown")
          .eq("project_id", contract.project_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        const { count: aiReferrals } = await supabase
          .from("ai_referrals")
          .select("*", { count: "exact", head: true })
          .eq("project_id", contract.project_id);

        const breakdown = (score?.breakdown || {}) as Record<string, number>;
        const metrics: Record<string, number> = {
          omnipresence_score: Number(score?.omnipresence_score ?? 0),
          citation_rate: Number(breakdown.citation_rate ?? 0),
          visibility_mention_rate: Number(breakdown.mention_rate ?? score?.ai_visibility ?? 0) / 100,
          ai_referral_traffic: aiReferrals ?? 0,
        };

        await verifyGuaranteeContract(supabase, contract.project_id, metrics);
      });
      verified++;
    }

    return { verified };
  }
);

export const weeklyRankCheck = inngest.createFunction(
  { id: "weekly-rank-check", retries: 1, triggers: [{ cron: "0 5 * * 2" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projects = await step.run("fetch-projects-with-keywords", async () => {
      const { data: keywords } = await supabase.from("rank_keywords").select("project_id");
      const ids = [...new Set((keywords || []).map((k) => k.project_id))];
      const { data: projects } = await supabase
        .from("projects")
        .select("id, domain")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      return projects || [];
    });

    let checked = 0;
    for (const project of projects) {
      await step.run(`ranks-${project.id}`, async () => {
        const results = await runAllRankChecks(supabase, project.id, project.domain);
        return results.length;
      });
      checked++;
    }

    return { checked };
  }
);

export const functions = [
  runFullScan,
  runFullScanLegacy,
  monthlyRescan,
  weeklyRescan,
  generateReport,
  syncAttribution,
  monthlyAttributionSync,
  weeklyReportEmail,
  dailyFreshnessCheck,
  citationDiffAlert,
  guaranteeVerificationCron,
  weeklyRankCheck,
];
