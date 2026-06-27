"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function WhiteLabelSettingsPage() {
  const [form, setForm] = useState({
    white_label_name: "",
    white_label_primary_color: "#6366f1",
    logo_url: "",
    white_label_domain: "",
    client_portal_enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [embedSnippet, setEmbedSnippet] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from("memberships")
        .select("organization_id, organizations(white_label_name, white_label_primary_color, logo_url, white_label_domain, client_portal_enabled)")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      const org = membership?.organizations as {
        white_label_name?: string;
        white_label_primary_color?: string;
        logo_url?: string;
        white_label_domain?: string;
        client_portal_enabled?: boolean;
      } | null;

      if (org) {
        setForm({
          white_label_name: org.white_label_name || "",
          white_label_primary_color: org.white_label_primary_color || "#6366f1",
          logo_url: org.logo_url || "",
          white_label_domain: org.white_label_domain || "",
          client_portal_enabled: Boolean(org.client_portal_enabled),
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (form.white_label_name) params.set("brand", form.white_label_name);
    if (form.white_label_primary_color) {
      params.set("color", form.white_label_primary_color.replace("#", ""));
    }
    if (form.logo_url) params.set("logo", form.logo_url);
    const qs = params.toString();
    fetch(`/api/embed/audit-snippet${qs ? `?${qs}` : ""}`)
      .then((r) => r.text())
      .then(setEmbedSnippet)
      .catch(() => setEmbedSnippet(""));
  }, [form.white_label_name, form.white_label_primary_color, form.logo_url]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (membership) {
      await supabase
        .from("organizations")
        .update(form)
        .eq("id", membership.organization_id);
      setSaved(true);
    }
    setSaving(false);
  }

  async function copyEmbed() {
    await navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-2">White-Label Branding</h2>
        <p className="text-sm text-muted-foreground">
          Customize reports and client-facing materials with your agency branding.
        </p>
      </div>

      <form onSubmit={handleSave} className="bg-card border border-border rounded-xl p-6 space-y-4">
        {saved && (
          <div className="bg-green-500/10 text-green-400 text-sm p-3 rounded-lg">Settings saved.</div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5">Agency Name (shown on reports)</label>
          <input
            value={form.white_label_name}
            onChange={(e) => setForm({ ...form, white_label_name: e.target.value })}
            placeholder="Your Agency Name"
            className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Logo URL</label>
          <input
            value={form.logo_url}
            onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
            placeholder="https://youragency.com/logo.png"
            className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Primary Color</label>
          <div className="flex gap-3 items-center">
            <input
              type="color"
              aria-label="Primary color picker"
              value={form.white_label_primary_color}
              onChange={(e) => setForm({ ...form, white_label_primary_color: e.target.value })}
              className="h-10 w-16 rounded cursor-pointer"
            />
            <input
              aria-label="Primary color hex value"
              placeholder="#6366f1"
              value={form.white_label_primary_color}
              onChange={(e) => setForm({ ...form, white_label_primary_color: e.target.value })}
              className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Client Portal Custom Domain</label>
          <input
            value={form.white_label_domain}
            onChange={(e) => setForm({ ...form, white_label_domain: e.target.value })}
            placeholder="reports.youragency.com"
            className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Point a CNAME at this app, then add the domain here. Client portals render at
            <code className="mx-1">/portal/&lt;share-token&gt;</code> with your branding.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.client_portal_enabled}
            onChange={(e) => setForm({ ...form, client_portal_enabled: e.target.checked })}
            className="h-4 w-4 rounded border-input"
          />
          Enable white-label client portal
        </label>

        <button
          type="submit"
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Branding"}
        </button>
      </form>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-2">Embeddable Audit Widget (v2)</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Paste this on client sites. Brand, color, and logo params are applied from your settings above.
        </p>
        <pre className="text-xs bg-secondary p-4 rounded-lg overflow-x-auto max-h-48 mb-3">
          {embedSnippet || "Loading embed snippet..."}
        </pre>
        <button
          type="button"
          onClick={copyEmbed}
          disabled={!embedSnippet}
          className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {copied ? "Copied!" : "Copy embed code"}
        </button>
      </div>
    </div>
  );
}
