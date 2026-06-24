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
