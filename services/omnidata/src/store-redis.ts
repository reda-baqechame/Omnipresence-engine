import { Redis } from "ioredis";
import type { TaskRecord } from "./types.js";

const REDIS_URL = process.env.REDIS_URL;
const TASK_PREFIX = "omnidata:task:";
const RANK_PREFIX = "omnidata:rank:";
const TTL_SECONDS = 60 * 60 * 24 * 30;

let client: Redis | null = null;
let initFailed = false;

function getRedis(): Redis | null {
  if (!REDIS_URL || initFailed) return null;
  if (client) return client;
  try {
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
    return client;
  } catch {
    initFailed = true;
    return null;
  }
}

async function ensureConnected(redis: Redis): Promise<boolean> {
  try {
    if (redis.status !== "ready") await redis.connect();
    return true;
  } catch {
    return false;
  }
}

export async function redisCreateTask(
  tag: string,
  endpoint: string,
  payload: unknown
): Promise<TaskRecord | null> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return null;

  const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const record: TaskRecord = {
    id,
    tag,
    status: "pending",
    endpoint,
    payload,
    created_at: new Date().toISOString(),
  };
  await redis.set(`${TASK_PREFIX}${id}`, JSON.stringify(record), "EX", TTL_SECONDS);
  return record;
}

export async function redisGetTask(id: string): Promise<TaskRecord | undefined> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return undefined;
  const raw = await redis.get(`${TASK_PREFIX}${id}`);
  return raw ? (JSON.parse(raw) as TaskRecord) : undefined;
}

export async function redisListReadyTasks(): Promise<TaskRecord[]> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return [];
  const keys = await redis.keys(`${TASK_PREFIX}*`);
  const tasks: TaskRecord[] = [];
  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const t = JSON.parse(raw) as TaskRecord;
    if (t.status === "pending") tasks.push(t);
  }
  return tasks;
}

export async function redisSaveTask(record: TaskRecord): Promise<void> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return;
  await redis.set(`${TASK_PREFIX}${record.id}`, JSON.stringify(record), "EX", TTL_SECONDS);
}

export async function redisAppendRankHistory(
  key: string,
  row: { checked_at: string; position: number | null; features: string[] }
): Promise<void> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return;
  const rk = `${RANK_PREFIX}${key}`;
  const raw = await redis.get(rk);
  const existing = raw ? (JSON.parse(raw) as typeof row[]) : [];
  existing.push(row);
  await redis.set(rk, JSON.stringify(existing.slice(-365)), "EX", TTL_SECONDS);
}

export async function redisGetRankHistory(
  key: string
): Promise<Array<{ checked_at: string; position: number | null; features: string[] }>> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return [];
  const raw = await redis.get(`${RANK_PREFIX}${key}`);
  return raw ? JSON.parse(raw) : [];
}

export function isRedisStoreEnabled(): boolean {
  return Boolean(REDIS_URL) && !initFailed;
}
