import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
const PREFIX = "rl:";

let client: Redis | null = null;
let initFailed = false;

function getRedis(): Redis | null {
  if (!REDIS_URL || initFailed) return null;
  if (!client) {
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
    client.on("error", () => {
      initFailed = true;
    });
  }
  return client;
}

export function isRateLimitRedisEnabled(): boolean {
  return Boolean(REDIS_URL) && !initFailed;
}

export async function checkRateLimitRedis(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec?: number; count: number } | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status !== "ready") await redis.connect();
    const redisKey = `${PREFIX}${key}`;
    const count = await redis.incr(redisKey);
    let ttl = await redis.pttl(redisKey);
    if (count === 1 || ttl < 0) {
      await redis.pexpire(redisKey, windowMs);
      ttl = windowMs;
    }
    if (count > limit) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(ttl / 1000)),
        count,
      };
    }
    return { allowed: true, count };
  } catch {
    initFailed = true;
    return null;
  }
}
