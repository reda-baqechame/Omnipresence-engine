import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { runProjectScan, getOwnerEmail } from "@/lib/engines/scan-runner";
import {
  stepTechnicalAudit,
  stepBrandExtract,
  stepVisibilityScan,
  stepScoreAndRoadmap,
} from "@/lib/engines/scan-steps";
import { resolveScanDemoMode } from "@/lib/demo/scan-data";
import { analyzePassageReadiness } from "@/lib/engines/passage-readiness";
import { sendScoreDropAlert, sendCitationDropAlert } from "@/lib/email/reports";
import { dispatchProjectAlerts } from "@/lib/engines/monitoring-alerts";
import { gatherReportData, saveReportArtifacts } from "@/lib/engines/report-builder";
import { syncProjectAttribution } from "@/lib/engines/attribution-sync";
import { sendWeeklyReport } from "@/lib/email/reports";
import { sendSlackWebhook, buildWeeklyReportSlackMessage } from "@/lib/notifications/slack";
import {
  verifyGuaranteeContract,
  gatherTier1Deliverables,
  gatherLedgerEvidence,
} from "@/lib/engines/guarantee";
import { runCadenceReview, gatherOperationalGuarantees } from "@/lib/engines/continuous-loop";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { runAllRankChecks } from "@/lib/engines/rank-tracker-service";
import { snapshotProjectBacklinks } from "@/lib/engines/backlink-monitor";
import { processScheduledContent } from "@/lib/engines/content-publish-scheduler";
import {
  runKeywordResearch,
  persistKeywordOpportunities,
  analyzeContentGaps,
} from "@/lib/engines/keyword-intelligence";
import { runDailyOnPageAutomation } from "@/lib/engines/on-page-queue";
import { analyzeInternalLinks } from "@/lib/engines/internal-linking";
import { buildMonthlyCampaign } from "@/lib/engines/link-building";
import { runBehaviorAnalytics } from "@/lib/engines/behavior-analytics";
import { monitorBrandNews } from "@/lib/engines/reputation";
import { getCruxHistory, hasCruxHistoryCapability } from "@/lib/providers/crux-history";
import { fetchFirehoseMentions } from "@/lib/engines/community-mentions";
import { logProviderError } from "@/lib/observability/log";
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

    // Refund-safety gate: paid orgs never receive demo data, even if no provider
    // is configured (real engines return Unavailable instead of fabricated data).
    const demo = await step.run("resolve-demo-mode", () =>
      resolveScanDemoMode(supabase, organizationId)
    );

    const technicalFindings = await step.run("technical-audit", () =>
      stepTechnicalAudit(supabase, projectId, project.domain)
    );

    await step.run("brand-extract", () => stepBrandExtract(supabase, project, demo));

    await step.run("visibility-scan", () => stepVisibilityScan(supabase, project, demo));

    const { score } = await step.run("score-roadmap", () =>
      stepScoreAndRoadmap(supabase, project, technicalFindings, demo)
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

export const weeklyAttributionSync = inngest.createFunction(
  { id: "weekly-attribution-sync", retries: 1, triggers: [{ cron: "0 7 * * 1" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projectIds = await step.run("fetch-connected-projects", async () => {
      const { data } = await supabase
        .from("oauth_connections")
        .select("project_id")
        .in("provider", ["google_search_console", "bing_webmaster", "google_analytics", "plausible"]);

      return [...new Set((data || []).map((c) => c.project_id))];
    });

    let synced = 0;
    for (const projectId of projectIds) {
      const result = await step.run(`weekly-sync-${projectId}`, async () => {
        return syncProjectAttribution(supabase, projectId);
      });
      if (result.success) synced++;
    }

    return { synced, total: projectIds.length };
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
        const gathered = await gatherReportData(supabase, project.id);
        if (!gathered) return null;

        const { reportData: payload, whiteLabel } = gathered;

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

        let emailSent = false;
        if (email) {
          emailSent = await sendWeeklyReport(
            email,
            payload,
            whiteLabel || (org?.white_label_name
              ? { name: org.white_label_name, color: org.white_label_primary_color || "#6366f1" }
              : undefined)
          );
        }

        if (org?.notifications_enabled && org?.slack_webhook_url) {
          await sendSlackWebhook(
            org.slack_webhook_url,
            buildWeeklyReportSlackMessage(
              project.name,
              project.domain,
              payload.score.omnipresence_score,
              previousScores?.[1]?.omnipresence_score,
              `${process.env.NEXT_PUBLIC_APP_URL}/app/projects/${project.id}`,
              org.white_label_name || undefined,
              payload.adsEquivalent
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
          // Use the citation-specific template (previously mislabeled as a score drop).
          await sendCitationDropAlert(
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

/**
 * Daily consolidated monitoring alerts: rank drops, finding regressions, and
 * SERP-feature losses pushed via email + Slack.
 */
export const monitoringAlerts = inngest.createFunction(
  { id: "monitoring-alerts", retries: 1, triggers: [{ cron: "0 9 * * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, organization_id")
        .eq("status", "active");
      return data || [];
    });

    let alerted = 0;
    for (const project of projects) {
      if (!project.organization_id) continue;
      const result = await step.run(`alerts-${project.id}`, async () => {
        const email = await getOwnerEmail(supabase, project.organization_id);
        return dispatchProjectAlerts(supabase, project, { ownerEmail: email });
      });
      if (result.sent) alerted++;
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

        // Tier 2 KPIs from REAL measured sources only. citation_rate /
        // mention_rate are computed from the latest visibility run's rows (not a
        // score-breakdown field that doesn't exist). If there's no measured
        // visibility run, we deliberately OMIT those keys so the guarantee marks
        // them "cannot verify" rather than auto-failing on a fabricated 0.
        const metrics: Record<string, number> = {
          omnipresence_score: Number(score?.omnipresence_score ?? 0),
          ai_referral_traffic: aiReferrals ?? 0,
        };

        const { data: latestRun } = await supabase
          .from("visibility_results")
          .select("run_id, created_at")
          .eq("project_id", contract.project_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestRun?.run_id) {
          const { data: runRows } = await supabase
            .from("visibility_results")
            .select("brand_mentioned, brand_cited, competitor_mentions, data_source, raw_response")
            .eq("project_id", contract.project_id)
            .eq("run_id", latestRun.run_id);
          if (runRows && runRows.length > 0) {
            const m = calculateVisibilityMetrics(runRows as never);
            if (m.measuredRate > 0) {
              metrics.citation_rate = m.citationRate;
              metrics.visibility_mention_rate = m.mentionRate;
            }
          }
        }

        // Tier 1 deterministic deliverables + operational guarantees + ledger.
        const [{ deliverables, tier1Met }, evidence, operationalGuarantees] = await Promise.all([
          gatherTier1Deliverables(supabase, contract.project_id),
          gatherLedgerEvidence(supabase, contract.project_id),
          gatherOperationalGuarantees(supabase, contract.project_id),
        ]);

        await verifyGuaranteeContract(supabase, contract.project_id, metrics, {
          tier1Deliverables: deliverables,
          tier1Met,
          evidence,
          operationalGuarantees,
        });
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
        try {
          const results = await runAllRankChecks(supabase, project.id, project.domain);
          return results.length;
        } catch (error) {
          logProviderError("cron:weekly-rank", error, { projectId: project.id });
          return 0;
        }
      });
      checked++;
    }

    return { checked };
  }
);

export const dailyRankCheck = inngest.createFunction(
  { id: "daily-rank-check", retries: 1, triggers: [{ cron: "0 4 * * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    // Only projects that explicitly opted into daily tracking AND have keywords.
    const projects = await step.run("fetch-daily-tracked-projects", async () => {
      const { data: keywords } = await supabase.from("rank_keywords").select("project_id");
      const ids = [...new Set((keywords || []).map((k) => k.project_id))];
      if (!ids.length) return [];
      const { data } = await supabase
        .from("projects")
        .select("id, domain")
        .eq("daily_rank_tracking", true)
        .in("id", ids);
      return data || [];
    });

    let checked = 0;
    for (const project of projects) {
      await step.run(`daily-ranks-${project.id}`, async () => {
        try {
          const results = await runAllRankChecks(supabase, project.id, project.domain);
          return results.length;
        } catch (error) {
          logProviderError("cron:daily-rank", error, { projectId: project.id });
          return 0;
        }
      });
      checked++;
    }

    return { checked };
  }
);

export const weeklyBacklinkMonitor = inngest.createFunction(
  { id: "weekly-backlink-monitor", retries: 1, triggers: [{ cron: "0 6 * * 3" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projects = await step.run("fetch-active-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, domain")
        .eq("status", "active");
      return data || [];
    });

    let snapshotted = 0;
    for (const project of projects) {
      await step.run(`backlinks-${project.id}`, async () => {
        try {
          await snapshotProjectBacklinks(supabase, project.id, project.domain);
        } catch (error) {
          logProviderError("cron:backlink-monitor", error, { projectId: project.id });
        }
      });
      snapshotted++;
    }

    return { snapshotted };
  }
);

export const weeklyBehaviorSync = inngest.createFunction(
  { id: "weekly-behavior-sync", retries: 1, triggers: [{ cron: "0 7 * * 4" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    // Only projects that connected Microsoft Clarity.
    const projects = await step.run("fetch-clarity-projects", async () => {
      const { data: integ } = await supabase
        .from("project_integrations")
        .select("project_id")
        .eq("provider", "clarity")
        .eq("is_active", true);
      const ids = [...new Set((integ || []).map((i) => i.project_id))];
      if (!ids.length) return [];
      const { data } = await supabase
        .from("projects")
        .select("id, organization_id")
        .in("id", ids);
      return data || [];
    });

    let synced = 0;
    for (const project of projects) {
      await step.run(`behavior-${project.id}`, async () => {
        try {
          const r = await runBehaviorAnalytics(supabase, {
            projectId: project.id,
            organizationId: project.organization_id,
          });
          return r.available ? r.issues.length : 0;
        } catch (error) {
          logProviderError("cron:behavior", error, { projectId: project.id });
          return 0;
        }
      });
      synced++;
    }

    return { synced, total: projects.length };
  }
);

export const dailyBrandNewsMonitor = inngest.createFunction(
  { id: "daily-brand-news-monitor", retries: 1, triggers: [{ cron: "0 8 * * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, domain, organization_id")
        .eq("status", "active");
      return data || [];
    });

    let monitored = 0;
    for (const project of projects) {
      await step.run(`news-${project.id}`, async () => {
        try {
          const r = await monitorBrandNews(supabase, {
            projectId: project.id,
            organizationId: project.organization_id,
            brand: project.name || project.domain,
            domain: project.domain,
          });
          return r.available ? r.summary.total : 0;
        } catch (error) {
          logProviderError("cron:brand-news", error, { projectId: project.id });
          return 0;
        }
      });
      monitored++;
    }
    return { monitored };
  }
);

export const weeklyCwvHistorySync = inngest.createFunction(
  { id: "weekly-cwv-history-sync", retries: 1, triggers: [{ cron: "0 6 * * 5" }] },
  async ({ step }) => {
    if (!hasCruxHistoryCapability()) return { synced: 0, skipped: "No CrUX/PageSpeed key" };
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase.from("projects").select("id, domain").eq("status", "active");
      return data || [];
    });

    let synced = 0;
    for (const project of projects) {
      await step.run(`cwv-${project.id}`, async () => {
        try {
          const res = await getCruxHistory(project.domain);
          if (!res.available || !res.points.length) return 0;
          await supabase.from("cwv_history").upsert(
            res.points.map((p) => ({
              project_id: project.id,
              collected_on: p.date,
              lcp_ms: p.lcpMs ?? null,
              inp_ms: p.inpMs ?? null,
              cls: p.cls ?? null,
              data_source: "measured",
            })),
            { onConflict: "project_id,collected_on" }
          );
          return res.points.length;
        } catch (error) {
          logProviderError("cron:cwv-history", error, { projectId: project.id });
          return 0;
        }
      });
      synced++;
    }
    return { synced, total: projects.length };
  }
);

export const weeklyMentionFirehose = inngest.createFunction(
  { id: "weekly-mention-firehose", retries: 1, triggers: [{ cron: "0 9 * * 6" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, competitors")
        .eq("status", "active");
      return data || [];
    });

    let inserted = 0;
    for (const project of projects) {
      await step.run(`firehose-${project.id}`, async () => {
        try {
          if (!project.name) return 0;
          const { rows } = await fetchFirehoseMentions(project.name, (project.competitors || []) as string[]);
          if (!rows.length) return 0;
          const { data: existing } = await supabase
            .from("community_mentions")
            .select("url")
            .eq("project_id", project.id);
          const seen = new Set((existing || []).map((e) => e.url));
          const newRows = rows.filter((r) => !seen.has(r.url));
          if (newRows.length) {
            await supabase.from("community_mentions").insert(
              newRows.map((r) => ({
                project_id: project.id,
                platform: r.platform,
                url: r.url,
                keyword: r.keyword,
                mention_type: r.mention_type || "brand",
              }))
            );
            inserted += newRows.length;
          }
          return newRows.length;
        } catch (error) {
          logProviderError("cron:mention-firehose", error, { projectId: project.id });
          return 0;
        }
      });
    }
    return { inserted, total: projects.length };
  }
);

export const scheduledContentPublish = inngest.createFunction(
  { id: "scheduled-content-publish", retries: 1, triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    return step.run("process-scheduled", () => processScheduledContent(supabase));
  }
);

export const weeklyIntelligenceSync = inngest.createFunction(
  { id: "weekly-intelligence-sync", retries: 1, triggers: [{ cron: "0 4 * * 1" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projects = await step.run("fetch-active-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, domain, industry, competitors")
        .eq("status", "active");
      return data || [];
    });

    let synced = 0;
    for (const project of projects) {
      await step.run(`intelligence-${project.id}`, async () => {
        const seed =
          project.industry || project.domain.replace(/^www\./, "").split(".")[0];
        const { opportunities, live } = await runKeywordResearch(seed, project.domain);
        if (live && opportunities.length) {
          await persistKeywordOpportunities(supabase, project.id, opportunities);
        }

        const competitors = (project.competitors || []) as string[];
        if (competitors.length) {
          const { gaps, live: gapsLive } = await analyzeContentGaps(
            project.domain,
            competitors,
            [seed]
          );
          if (gapsLive && gaps.length) {
            await supabase.from("content_gap_findings").upsert(
              (gaps as Array<{
                keyword: string;
                competitor_domain: string;
                competitor_position: number;
                our_position: number | null;
                opportunity_score: number;
              }>).map((g) => ({
                project_id: project.id,
                keyword: g.keyword,
                competitor_domain: g.competitor_domain,
                competitor_position: g.competitor_position,
                our_position: g.our_position,
                opportunity_score: g.opportunity_score,
              })),
              { onConflict: "project_id,keyword,competitor_domain" }
            );
          }
        }

        return { keywords: opportunities.length, live };
      });
      synced++;
    }

    return { synced };
  }
);

export const dailyOnPageAutomation = inngest.createFunction(
  { id: "daily-on-page-automation", retries: 1, triggers: [{ cron: "0 2 * * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, domain, name")
        .eq("status", "active");
      return data || [];
    });

    let total = 0;
    for (const project of projects) {
      const n = await step.run(`on-page-${project.id}`, () =>
        runDailyOnPageAutomation(supabase, project.id, project.domain, project.name)
      );
      total += n;
    }
    return { projects: projects.length, proposed: total };
  }
);

export const weeklyInternalLinkScan = inngest.createFunction(
  { id: "weekly-internal-link-scan", retries: 1, triggers: [{ cron: "0 5 * * 2" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase.from("projects").select("id, domain").eq("status", "active");
      return data || [];
    });

    let found = 0;
    for (const project of projects) {
      const result = await step.run(`internal-links-${project.id}`, async () => {
        const { opportunities } = await analyzeInternalLinks(project.domain, 30);
        const rows = opportunities.map((o) => ({
          project_id: project.id,
          source_url: o.sourceUrl,
          target_url: o.targetUrl,
          anchor_suggestion: o.anchorSuggestion,
          relevance_score: o.relevanceScore,
          context_snippet: o.contextSnippet,
          status: "identified",
        }));
        if (rows.length) {
          await supabase.from("internal_link_opportunities").upsert(rows, {
            onConflict: "project_id,source_url,target_url",
          });
        }
        return opportunities.length;
      });
      found += result;
    }
    return { projects: projects.length, opportunities: found };
  }
);

export const monthlyLinkBuilding = inngest.createFunction(
  { id: "monthly-link-building", retries: 1, triggers: [{ cron: "0 6 10 * *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();
    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, domain, industry")
        .eq("status", "active");
      return data || [];
    });

    let orders = 0;
    for (const project of projects) {
      const count = await step.run(`links-${project.id}`, async () => {
        const { data: kws } = await supabase
          .from("keyword_opportunities")
          .select("keyword")
          .eq("project_id", project.id)
          .order("opportunity_score", { ascending: false })
          .limit(5);
        const { data: snapshot } = await supabase
          .from("backlink_snapshots")
          .select("backlinks")
          .eq("project_id", project.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const backlinkList = (snapshot?.backlinks || []) as Array<{ domain?: string; rank?: number }>;
        const gapDomains = backlinkList.slice(0, 20).map((b) => ({
          domain: (b.domain || "").replace(/^www\./, ""),
          dr_estimate: b.rank ?? 35,
        }));
        const campaign = buildMonthlyCampaign(
          project.name,
          project.domain,
          (kws || []).map((k) => k.keyword),
          gapDomains
        );
        if (!campaign.length) return 0;
        await supabase.from("link_building_orders").insert(
          campaign.map((o) => ({
            project_id: project.id,
            target_url: o.target_url,
            anchor_text: o.anchor_text,
            anchor_type: o.anchor_type,
            vendor_tier: o.vendor_tier,
            estimated_dr: o.estimated_dr,
            status: o.status,
          }))
        );
        return campaign.length;
      });
      orders += count;
    }
    return { projects: projects.length, orders };
  }
);

// Quarterly operating review: surface gainers/losers, regressions, citation
// gaps and materialize them as tracked tasks for every active project.
export const quarterlyOperatingReview = inngest.createFunction(
  { id: "quarterly-operating-review", retries: 1, triggers: [{ cron: "0 6 1 */3 *" }] },
  async ({ step }) => {
    const supabase = await createServiceClient();

    const projects = await step.run("fetch-projects", async () => {
      const { data } = await supabase.from("projects").select("id, organization_id");
      return data || [];
    });

    let reviewed = 0;
    for (const project of projects) {
      await step.run(`review-${project.id}`, async () => {
        await runCadenceReview(supabase, project.id, project.organization_id, "quarterly");
      });
      reviewed++;
    }

    return { reviewed };
  }
);

export const functions = [
  runFullScan,
  runFullScanLegacy,
  monthlyRescan,
  weeklyRescan,
  generateReport,
  syncAttribution,
  weeklyAttributionSync,
  monthlyAttributionSync,
  weeklyReportEmail,
  dailyFreshnessCheck,
  citationDiffAlert,
  monitoringAlerts,
  guaranteeVerificationCron,
  weeklyRankCheck,
  dailyRankCheck,
  weeklyBacklinkMonitor,
  weeklyBehaviorSync,
  dailyBrandNewsMonitor,
  weeklyCwvHistorySync,
  weeklyMentionFirehose,
  scheduledContentPublish,
  weeklyIntelligenceSync,
  dailyOnPageAutomation,
  weeklyInternalLinkScan,
  monthlyLinkBuilding,
  quarterlyOperatingReview,
];
