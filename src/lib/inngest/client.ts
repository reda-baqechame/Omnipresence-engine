import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "presenceos",
  name: "PresenceOS",
});

export type Events = {
  "project/scan.requested": {
    data: { projectId: string; organizationId: string };
  };
  "project/visibility.scan": {
    data: { projectId: string; runId: string };
  };
  "project/technical.audit": {
    data: { projectId: string };
  };
  "project/brand.extract": {
    data: { projectId: string };
  };
  "project/prompts.generate": {
    data: { projectId: string };
  };
  "project/coverage.check": {
    data: { projectId: string };
  };
  "project/authority.find": {
    data: { projectId: string };
  };
  "project/score.calculate": {
    data: { projectId: string };
  };
  "project/roadmap.generate": {
    data: { projectId: string };
  };
  "project/report.generate": {
    data: { projectId: string; reportId: string };
  };
  "project/tracking.rescan": {
    data: { projectId: string };
  };
  "project/attribution.sync": {
    data: { projectId: string };
  };
  "project/ranks.check": {
    data: { projectId: string };
  };
  "panel/run.requested": {
    data: { panelId: string; projectId: string };
  };
  "ops/execute.requested": {
    data: { opsId: string; projectId: string };
  };
  "asset/deployed": {
    data: { projectId: string; organizationId: string; url: string; assetId?: string; keyword?: string; taskId?: string };
  };
};
