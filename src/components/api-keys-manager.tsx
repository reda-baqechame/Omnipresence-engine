"use client";

import { useEffect, useState } from "react";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked: boolean;
  created_at: string;
}

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/keys");
    const data = await res.json();
    setKeys(data.keys || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setCreating(true);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "API key" }),
    });
    const data = await res.json();
    if (data.key) setNewKey(data.key);
    setName("");
    setCreating(false);
    load();
  }

  async function revoke(id: string) {
    await fetch(`/api/keys?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-1">Create API key</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Use keys with the public API: <code>GET /api/v1/ranks?projectId=…</code> and{" "}
          <code>POST /api/v1/scan</code>. Send the key as <code>x-api-key</code> or a Bearer token.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. CI pipeline)"
            className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={create}
            disabled={creating}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create key"}
          </button>
        </div>

        {newKey && (
          <div className="mt-4 rounded-lg bg-green-500/10 border border-green-500/30 p-3">
            <p className="text-sm text-green-400 mb-1">
              Copy this key now — it won&apos;t be shown again:
            </p>
            <code className="block break-all text-xs bg-background rounded px-2 py-1.5">{newKey}</code>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-3">Your keys</h3>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="space-y-2">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2 text-sm border-t border-border/50 pt-2 first:border-0 first:pt-0">
                <span>
                  <span className="font-medium">{k.name}</span>{" "}
                  <code className="text-xs text-muted-foreground">omp_{k.prefix}_…</code>
                  {k.revoked && <span className="ml-2 text-xs text-red-400">revoked</span>}
                  {k.last_used_at && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      last used {new Date(k.last_used_at).toLocaleDateString()}
                    </span>
                  )}
                </span>
                {!k.revoked && (
                  <button
                    type="button"
                    onClick={() => revoke(k.id)}
                    className="text-muted-foreground hover:text-red-400 text-xs"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
