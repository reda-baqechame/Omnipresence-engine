import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatScore(score: number): string {
  return Math.round(score).toString();
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

/**
 * Per-job USD spend, e.g. for a report/scan's `actual_cost`. Individual
 * provider calls are often fractions of a cent — rounding to 2dp like
 * account-level `formatCurrency`/settings-usage totals would silently show
 * "$0.00" for real, attributed spend. Below a cent, show 4dp instead of
 * lying that a job cost nothing.
 */
export function formatJobCost(costUsd: number): string {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return "$0.00";
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

/** Compact token count, e.g. 4200 -> "4.2k tokens", 850 -> "850 tokens". */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0 tokens";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k tokens`;
  return `${Math.round(tokens)} tokens`;
}

/**
 * Human freshness label for an evidence row's `captured_at` — how long ago the
 * measurement was actually taken (not when the DB row was inserted). Used by
 * the Evidence Drawer so "confidence" isn't the only signal of how much to
 * trust a number; a 3-month-old "measured" value is very different from one
 * captured seconds ago.
 */
export function freshnessLabel(capturedAt: string, now: number = Date.now()): string {
  const ageMs = now - new Date(capturedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return normalizeDomain(url);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
