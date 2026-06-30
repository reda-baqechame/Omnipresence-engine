import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractLinksToTarget,
  spamRiskScore,
  linkValueScore,
} from "../engines/backlink-graph.js";

describe("backlink graph — link extraction (URL-level + anchor + rel)", () => {
  const html = `
    <html><body>
      <a href="https://target.com/page" rel="nofollow sponsored">Buy now</a>
      <a href="/relative" >Relative same-source (ignored)</a>
      <a href="https://www.target.com/other">Plain dofollow</a>
      <a href="https://blog.target.com/post" rel="ugc">Subdomain UGC</a>
      <a href="https://other.com/x">Unrelated</a>
    </body></html>`;

  it("extracts only links pointing at the target domain (incl. subdomains)", () => {
    const links = extractLinksToTarget(html, "https://source.com/", "target.com");
    const urls = links.map((l) => l.target_url);
    assert.ok(urls.some((u) => u.includes("target.com/page")));
    assert.ok(urls.some((u) => u.includes("target.com/other")));
    assert.ok(urls.some((u) => u.includes("blog.target.com/post")));
    assert.ok(!urls.some((u) => u.includes("other.com")));
    assert.equal(links.length, 3);
  });

  it("captures anchor text and rel tokens", () => {
    const links = extractLinksToTarget(html, "https://source.com/", "target.com");
    const buy = links.find((l) => l.target_url.includes("/page"));
    assert.equal(buy?.anchor, "Buy now");
    assert.deepEqual(buy?.rel.sort(), ["nofollow", "sponsored"]);
  });
});

describe("backlink graph — spam/toxic + link-value scoring", () => {
  it("flags low-authority spammy-TLD hyphenated domains as high risk", () => {
    const risk = spamRiskScore({ sourceDomain: "cheap-best-loans-online.xyz", authority: 0, nofollow: true });
    assert.ok(risk >= 60, `expected high risk, got ${risk}`);
  });

  it("treats high-authority clean domains as low risk", () => {
    const risk = spamRiskScore({ sourceDomain: "nytimes.com", authority: 90 });
    assert.ok(risk < 20, `expected low risk, got ${risk}`);
  });

  it("dofollow high-authority links carry far more value than nofollow", () => {
    const dofollow = linkValueScore({ authority: 80, nofollow: false, spamRisk: 0 });
    const nofollow = linkValueScore({ authority: 80, nofollow: true, spamRisk: 0 });
    assert.ok(dofollow > nofollow);
    assert.ok(dofollow >= 70);
  });

  it("spam risk drags link value down", () => {
    const clean = linkValueScore({ authority: 50, nofollow: false, spamRisk: 0 });
    const toxic = linkValueScore({ authority: 50, nofollow: false, spamRisk: 90 });
    assert.ok(clean > toxic);
  });
});
