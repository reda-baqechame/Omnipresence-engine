import { lookup } from "dns/promises";
import { isProductionDeploy } from "@/lib/config/production";
import { normalizeDomain } from "@/lib/utils";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata.google",
  "169.254.169.254",
]);

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export function assertPublicDomain(domain: string): string {
  const normalized = normalizeDomain(domain);

  if (!normalized || normalized.length > 253) {
    throw new DomainValidationError("Invalid domain");
  }

  if (BLOCKED_HOSTS.has(normalized)) {
    throw new DomainValidationError("Domain not allowed");
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
    throw new DomainValidationError("IP addresses are not allowed");
  }

  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(normalized)) {
    throw new DomainValidationError("Private network addresses are not allowed");
  }

  if (!DOMAIN_REGEX.test(normalized)) {
    throw new DomainValidationError("Invalid domain format");
  }

  return normalized;
}

/** True if an IPv4/IPv6 literal is private, loopback, link-local, or otherwise non-public. */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.toLowerCase();
  // IPv6 loopback / link-local / unique-local / IPv4-mapped
  if (addr === "::1" || addr === "::") return true;
  if (addr.startsWith("fe80") || addr.startsWith("fc") || addr.startsWith("fd")) return true;
  if (addr.startsWith("::ffff:")) return isPrivateIp(addr.replace("::ffff:", ""));
  const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * Resolve a (already string-validated) domain and reject it if DNS points at a
 * private/internal IP. This closes the SSRF gap where a public hostname is
 * pointed at 169.254.169.254 / 10.x / localhost. Best-effort: on resolution
 * failure we allow the caller to proceed (the fetch itself will then fail).
 */
export async function assertDomainResolvesPublic(domain: string): Promise<void> {
  const host = normalizeDomain(domain);
  let addrs: Array<{ address: string }> = [];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    if (isProductionDeploy()) {
      throw new DomainValidationError("Domain could not be resolved");
    }
    return; // dev: let the downstream fetch fail naturally
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new DomainValidationError("Domain resolves to a private network address");
    }
  }
}

export function assertUrlBelongsToDomain(url: string, domain: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    throw new DomainValidationError("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new DomainValidationError("Only HTTP(S) URLs are allowed");
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const allowed = normalizeDomain(domain);

  if (host !== allowed && !host.endsWith(`.${allowed}`)) {
    throw new DomainValidationError("URL does not belong to project domain");
  }

  return parsed.toString();
}
