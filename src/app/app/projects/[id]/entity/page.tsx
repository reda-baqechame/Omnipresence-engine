import { EntityPanel } from "@/components/entity-panel";

export default async function EntityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntityPanel projectId={id} />;
}
