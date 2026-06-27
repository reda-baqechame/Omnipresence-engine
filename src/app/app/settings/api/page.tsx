import { ApiKeysManager } from "@/components/api-keys-manager";

export default function ApiKeysPage() {
  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold mb-1">API Keys</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Programmatic access to your rank data and batch scans. Keys are scoped to your organization.
      </p>
      <ApiKeysManager />
    </div>
  );
}
