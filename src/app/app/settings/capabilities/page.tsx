"use client";

import { useEffect, useState } from "react";

interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  required: boolean;
  category: string;
}

export default function CapabilitiesSettingsPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [liveData, setLiveData] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then((d) => {
        setProviders(d.providers || []);
        setLiveData(d.liveData);
        setVersion(d.version);
      });
  }, []);

  const configured = providers.filter((p) => p.configured).length;

  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Live Provider Status</h2>
      <p className="text-sm text-muted-foreground mb-6">
        OmniPresence Engine v{version} — {configured}/{providers.length} providers configured.
        Live data mode: <strong className={liveData ? "text-green-400" : "text-yellow-400"}>{liveData ? "ON" : "Demo fallback"}</strong>
      </p>

      <div className="grid md:grid-cols-2 gap-3">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between p-3 rounded-lg border ${
              p.configured ? "border-green-500/30 bg-green-500/5" : "border-border bg-card"
            }`}
          >
            <div>
              <div className="font-medium text-sm">{p.name}</div>
              <div className="text-xs text-muted-foreground capitalize">{p.category}</div>
            </div>
            <span className={`text-xs font-medium ${p.configured ? "text-green-400" : "text-muted-foreground"}`}>
              {p.configured ? "Connected" : p.required ? "Required" : "Optional"}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        Set API keys in Vercel env or <code>.env.local</code>. Demo mode only activates when no live providers are configured.
      </p>
    </div>
  );
}
