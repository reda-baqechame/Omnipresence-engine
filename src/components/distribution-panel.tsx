"use client";

import { useState } from "react";
import type { ContentAsset } from "@/types/database";

interface DistributionPanelProps {
  projectId: string;
  domain: string;
  assets: Array<Pick<ContentAsset, "id" | "title" | "type" | "status" | "published_url">>;
}

export function DistributionPanel({ projectId, domain, assets }: DistributionPanelProps) {
  const [urls, setUrls] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<Record<string, boolean> | null>(null);
  const [publishPlatform, setPublishPlatform] = useState("wordpress");
  const [credentials, setCredentials] = useState({ url: "", apiKey: "", collectionId: "" });
  const [socialApiKey, setSocialApiKey] = useState("");
  const [socialBufferToken, setSocialBufferToken] = useState("");
  const [socialBufferProfileIds, setSocialBufferProfileIds] = useState("");
  const [gbpToken, setGbpToken] = useState("");
  const [gbpAccountId, setGbpAccountId] = useState("");
  const [gbpLocationId, setGbpLocationId] = useState("");
  const [gbpPostText, setGbpPostText] = useState("");
  const [gbpPublishing, setGbpPublishing] = useState(false);
  const [gbpResult, setGbpResult] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [socialText, setSocialText] = useState("");
  const [socialPlatform, setSocialPlatform] = useState<"ayrshare" | "buffer">("ayrshare");
  const [socialPlatforms, setSocialPlatforms] = useState("linkedin,x");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);

  const publishedAssets = assets.filter((a) => a.status === "published" || a.status === "indexed");
  const draftAssets = assets.filter((a) => a.status === "drafted" || a.status === "approved");

  async function submitIndexing() {
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urlList.length === 0) return;
    setIndexing(true);
    const res = await fetch("/api/distribution", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urlList, engines: ["indexnow", "bing"], projectId }),
    });
    const data = await res.json();
    setIndexResult(data.results);
    setIndexing(false);
  }

  async function publishAsset(assetId: string) {
    setPublishing(assetId);
    await fetch("/api/distribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId,
        platform: publishPlatform,
        credentials,
      }),
    });
    setPublishing(null);
    window.location.reload();
  }

  async function scheduleSocial() {
    if (!socialText.trim()) return;
    setScheduling(true);
    setScheduleResult(null);
    const res = await fetch("/api/distribution", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: socialPlatform,
        text: socialText,
        projectId,
        platforms: socialPlatforms.split(",").map((p) => p.trim()).filter(Boolean),
        credentials: socialPlatform === "ayrshare"
          ? { apiKey: socialApiKey }
          : {
              accessToken: socialBufferToken,
              profileIds: socialBufferProfileIds.split(",").map((p) => p.trim()).filter(Boolean),
            },
      }),
    });
    const data = await res.json();
    setScheduleResult(data.success ? "Post scheduled successfully" : data.error || "Scheduling failed");
    setScheduling(false);
  }

  return (
    <div className="space-y-8">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold">{draftAssets.length}</div>
          <div className="text-sm text-muted-foreground">Ready to Publish</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{publishedAssets.length}</div>
          <div className="text-sm text-muted-foreground">Published</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-primary">{domain}</div>
          <div className="text-sm text-muted-foreground">Target Domain</div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">CMS Publishing</h3>
        <div className="flex gap-3 mb-4">
          <select
            value={publishPlatform}
            onChange={(e) => setPublishPlatform(e.target.value)}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          >
            <option value="wordpress">WordPress</option>
            <option value="webflow">Webflow</option>
            <option value="shopify">Shopify</option>
          </select>
          <input
            value={credentials.url}
            onChange={(e) => setCredentials({ ...credentials, url: e.target.value })}
            placeholder="CMS URL or Site ID"
            className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={credentials.apiKey}
            onChange={(e) => setCredentials({ ...credentials, apiKey: e.target.value })}
            placeholder="API Key"
            type="password"
            className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={credentials.collectionId}
            onChange={(e) => setCredentials({ ...credentials, collectionId: e.target.value })}
            placeholder="Collection/Blog ID (Webflow/Shopify)"
            className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          {draftAssets.map((asset) => (
            <div key={asset.id} className="flex items-center justify-between bg-secondary rounded-lg p-3">
              <div>
                <div className="font-medium text-sm">{asset.title}</div>
                <div className="text-xs text-muted-foreground">{asset.type}</div>
              </div>
              <button
                onClick={() => publishAsset(asset.id)}
                disabled={publishing === asset.id || !credentials.apiKey}
                className="bg-primary text-primary-foreground px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                {publishing === asset.id ? "Publishing..." : "Publish"}
              </button>
            </div>
          ))}
          {draftAssets.length === 0 && (
            <p className="text-sm text-muted-foreground">No draft content. Generate content in the Content tab first.</p>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">Social Scheduling</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Schedule approved content to LinkedIn, X, and more via Ayrshare or Buffer.
        </p>
        <div className="flex gap-3 mb-3">
          <select
            value={socialPlatform}
            onChange={(e) => setSocialPlatform(e.target.value as "ayrshare" | "buffer")}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          >
            <option value="ayrshare">Ayrshare</option>
            <option value="buffer">Buffer</option>
          </select>
          {socialPlatform === "ayrshare" && (
            <>
              <input
                value={socialApiKey}
                onChange={(e) => setSocialApiKey(e.target.value)}
                placeholder="Ayrshare API Key (or set AYRSHARE_API_KEY env)"
                type="password"
                className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={socialPlatforms}
                onChange={(e) => setSocialPlatforms(e.target.value)}
                placeholder="Platforms: linkedin,x,facebook"
                className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
              />
            </>
          )}
          {socialPlatform === "buffer" && (
            <>
              <input
                value={socialBufferToken}
                onChange={(e) => setSocialBufferToken(e.target.value)}
                placeholder="Buffer Access Token"
                type="password"
                className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={socialBufferProfileIds}
                onChange={(e) => setSocialBufferProfileIds(e.target.value)}
                placeholder="Buffer profile IDs (comma-separated)"
                className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
              />
            </>
          )}
        </div>
        <textarea
          value={socialText}
          onChange={(e) => setSocialText(e.target.value)}
          placeholder="Write your social post..."
          rows={3}
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm mb-3"
        />
        <button
          onClick={scheduleSocial}
          disabled={scheduling || !socialText.trim()}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {scheduling ? "Scheduling..." : "Schedule Post"}
        </button>
        {scheduleResult && (
          <p className={`text-sm mt-2 ${scheduleResult.includes("success") ? "text-green-400" : "text-red-400"}`}>
            {scheduleResult}
          </p>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">Google Business Profile</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Publish local posts directly to GBP (requires OAuth token, account ID, location ID).
        </p>
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          <input
            value={gbpToken}
            onChange={(e) => setGbpToken(e.target.value)}
            placeholder="GBP OAuth token"
            type="password"
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={gbpAccountId}
            onChange={(e) => setGbpAccountId(e.target.value)}
            placeholder="Account ID"
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={gbpLocationId}
            onChange={(e) => setGbpLocationId(e.target.value)}
            placeholder="Location ID"
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <textarea
          value={gbpPostText}
          onChange={(e) => setGbpPostText(e.target.value)}
          placeholder="GBP post summary..."
          rows={3}
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm mb-3"
        />
        <button
          onClick={async () => {
            if (!gbpPostText.trim()) return;
            setGbpPublishing(true);
            setGbpResult(null);
            const res = await fetch("/api/distribution", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                platform: "gbp",
                projectId,
                text: gbpPostText,
                credentials: {
                  gbpToken,
                  accountId: gbpAccountId,
                  locationId: gbpLocationId,
                },
              }),
            });
            const data = await res.json();
            setGbpResult(data.success ? "GBP post published" : data.error || "GBP publish failed");
            setGbpPublishing(false);
          }}
          disabled={gbpPublishing || !gbpPostText.trim()}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {gbpPublishing ? "Publishing..." : "Publish GBP Post"}
        </button>
        {gbpResult && (
          <p className={`text-sm mt-2 ${gbpResult.includes("published") ? "text-green-400" : "text-red-400"}`}>
            {gbpResult}
          </p>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">Bulk Indexing (IndexNow + Bing)</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Submit URLs to Bing and other IndexNow-compatible engines for faster discovery.
        </p>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={`https://${domain}/page-1\nhttps://${domain}/page-2`}
          rows={4}
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm mb-3"
        />
        <button
          onClick={submitIndexing}
          disabled={indexing}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {indexing ? "Submitting..." : "Submit to IndexNow"}
        </button>
        {indexResult && (
          <p className="text-sm mt-2 text-green-400">
            IndexNow: {indexResult.indexnow ? "Submitted successfully" : "Submission failed"}
          </p>
        )}
      </div>

      {publishedAssets.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Published Assets</h3>
          <div className="space-y-2">
            {publishedAssets.map((asset) => (
              <div key={asset.id} className="flex items-center justify-between bg-card border border-border rounded-lg p-3 text-sm">
                <span>{asset.title}</span>
                <span className="text-green-400">{asset.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
