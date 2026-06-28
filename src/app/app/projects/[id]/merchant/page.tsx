import { notFound } from "next/navigation";
import { MerchantPanel } from "@/components/merchant-panel";
import { getProject } from "@/lib/projects";

export default async function MerchantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Merchant / Shopping</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Audit and optimize your Google Merchant / Shopping product feed for {project.domain} —
          feed-quality scoring, LLM title/description optimization, and Product schema.
        </p>
      </div>
      <MerchantPanel projectId={id} />
    </div>
  );
}
