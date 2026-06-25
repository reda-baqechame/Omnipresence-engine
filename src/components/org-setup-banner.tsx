"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrgSetupBanner() {
  const router = useRouter();
  const [settingUp, setSettingUp] = useState(false);
  const [orgName, setOrgName] = useState(() => {
    if (typeof window === "undefined") return "";
    const pending = sessionStorage.getItem("pending_org_name");
    if (pending) sessionStorage.removeItem("pending_org_name");
    return pending || "";
  });
  const [error, setError] = useState("");

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim()) return;
    setSettingUp(true);
    setError("");

    const res = await fetch("/api/auth/setup-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: orgName.trim() }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to create organization");
      setSettingUp(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-8 max-w-lg mx-auto text-center">
      <h2 className="text-xl font-semibold mb-2">Set up your organization</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Create an organization to start auditing client projects.
      </p>
      <form onSubmit={createOrg} className="space-y-4 text-left">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Your agency or company name"
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
          required
        />
        <button
          type="submit"
          disabled={settingUp}
          className="w-full bg-primary text-primary-foreground py-2 rounded-lg font-medium disabled:opacity-50"
        >
          {settingUp ? "Creating..." : "Create Organization"}
        </button>
      </form>
    </div>
  );
}
