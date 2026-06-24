"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function NotificationsSettingsPage() {
  const [form, setForm] = useState({
    slack_webhook_url: "",
    notifications_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from("memberships")
        .select("organization_id, organizations(slack_webhook_url, notifications_enabled)")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      const org = membership?.organizations as {
        slack_webhook_url?: string;
        notifications_enabled?: boolean;
      } | null;

      if (org) {
        setForm({
          slack_webhook_url: org.slack_webhook_url || "",
          notifications_enabled: org.notifications_enabled !== false,
        });
      }
      setLoading(false);
    }
    load();
  }, []);

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
        .update({
          slack_webhook_url: form.slack_webhook_url || null,
          notifications_enabled: form.notifications_enabled,
        })
        .eq("id", membership.organization_id);
      setSaved(true);
    }
    setSaving(false);
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold mb-2">Notifications</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Receive weekly OmniPresence score summaries in Slack. Email reports are sent automatically every Friday.
      </p>

      <form onSubmit={handleSave} className="bg-card border border-border rounded-xl p-6 space-y-4">
        {saved && (
          <div className="bg-green-500/10 text-green-400 text-sm p-3 rounded-lg">Settings saved.</div>
        )}

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.notifications_enabled}
            onChange={(e) => setForm({ ...form, notifications_enabled: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Enable weekly report notifications</span>
        </label>

        <div>
          <label className="block text-sm font-medium mb-1.5">Slack Incoming Webhook URL</label>
          <input
            value={form.slack_webhook_url}
            onChange={(e) => setForm({ ...form, slack_webhook_url: e.target.value })}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Create a webhook in Slack → Apps → Incoming Webhooks. Weekly summaries post every Friday at 9 AM.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Notifications"}
        </button>
      </form>
    </div>
  );
}
