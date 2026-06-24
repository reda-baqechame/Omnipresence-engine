import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runProjectScan, getOwnerEmail } from "@/lib/engines/scan-runner";
import { inngest } from "@/lib/inngest/client";

export async function triggerProjectScan(
  projectId: string,
  organizationId: string
): Promise<{ mode: "inngest" | "sync" }> {
  if (process.env.INNGEST_EVENT_KEY) {
    try {
      await inngest.send({
        name: "project/scan.requested",
        data: { projectId, organizationId },
      });
      return { mode: "inngest" };
    } catch {
      // Fall through to sync
    }
  }

  after(async () => {
    const supabase = await createServiceClient();
    const email = await getOwnerEmail(supabase, organizationId);
    try {
      await runProjectScan(supabase, projectId, { notifyEmail: email });
    } catch (error) {
      console.error("Background scan failed:", error);
      await supabase.from("projects").update({ status: "draft" }).eq("id", projectId);
    }
  });

  return { mode: "sync" };
}
