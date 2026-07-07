/** Resolve Upstash Redis REST credentials (supports Vercel KV alias names). */
export function resolveUpstashRedisRest(): { url: string; token: string } | null {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.KV_URL ||
    ""
  ).replace(/\/$/, "");
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.KV_REST_API_READ_ONLY_TOKEN ||
    "";
  if (!url || !token) return null;
  return { url, token };
}

export function hasUpstashRedisRest(): boolean {
  return resolveUpstashRedisRest() !== null;
}
