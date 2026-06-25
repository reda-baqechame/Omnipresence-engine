import type { TaskRecord } from "./types.js";
import {
  redisCreateTask,
  redisGetTask,
  redisListReadyTasks,
  redisSaveTask,
  redisAppendRankHistory,
  redisGetRankHistory,
} from "./store-redis.js";

const tasks = new Map<string, TaskRecord>();
const rankHistory = new Map<string, Array<{ checked_at: string; position: number | null; features: string[] }>>();

export function createTask(tag: string, endpoint: string, payload: unknown): TaskRecord {
  const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const record: TaskRecord = {
    id,
    tag,
    status: "pending",
    endpoint,
    payload,
    created_at: new Date().toISOString(),
  };
  tasks.set(id, record);
  void redisSaveTask(record).catch(() => {});
  return record;
}

export async function createTaskPersistent(
  tag: string,
  endpoint: string,
  payload: unknown
): Promise<TaskRecord> {
  const remote = await redisCreateTask(tag, endpoint, payload);
  if (remote) {
    tasks.set(remote.id, remote);
    return remote;
  }
  return createTask(tag, endpoint, payload);
}

export function getTask(id: string): TaskRecord | undefined {
  return tasks.get(id);
}

export async function getTaskHydrated(id: string): Promise<TaskRecord | undefined> {
  const local = tasks.get(id);
  if (local) return local;
  const remote = await redisGetTask(id);
  if (remote) {
    tasks.set(id, remote);
    return remote;
  }
  return undefined;
}

export function listReadyTasks(): TaskRecord[] {
  return [...tasks.values()].filter((t) => t.status === "pending");
}

export async function listReadyTasksHydrated(): Promise<TaskRecord[]> {
  const remote = await redisListReadyTasks();
  for (const t of remote) tasks.set(t.id, t);
  return listReadyTasks();
}

function persistTask(t: TaskRecord): void {
  tasks.set(t.id, t);
  void redisSaveTask(t).catch(() => {});
}

export function markProcessing(id: string): void {
  const t = tasks.get(id);
  if (t) {
    t.status = "processing";
    persistTask(t);
  }
}

export function completeTask(id: string, result: unknown): void {
  const t = tasks.get(id);
  if (t) {
    t.status = "completed";
    t.result = result;
    t.completed_at = new Date().toISOString();
    persistTask(t);
  }
}

export function failTask(id: string, error: string): void {
  const t = tasks.get(id);
  if (t) {
    t.status = "failed";
    t.error = error;
    t.completed_at = new Date().toISOString();
    persistTask(t);
  }
}

export function appendRankHistory(
  key: string,
  row: { checked_at: string; position: number | null; features: string[] }
): void {
  const existing = rankHistory.get(key) || [];
  existing.push(row);
  rankHistory.set(key, existing.slice(-365));
  void redisAppendRankHistory(key, row).catch(() => {});
}

export function getRankHistory(key: string) {
  const local = rankHistory.get(key);
  if (local?.length) return local;
  void redisGetRankHistory(key)
    .then((remote) => {
      if (remote.length) rankHistory.set(key, remote);
    })
    .catch(() => {});
  return local || [];
}

export async function getRankHistoryHydrated(key: string) {
  const remote = await redisGetRankHistory(key);
  if (remote.length) {
    rankHistory.set(key, remote);
    return remote;
  }
  return rankHistory.get(key) || [];
}

export function strikingDistance(history: Array<{ position: number | null }>, threshold = 20): boolean {
  const recent = history.slice(-5);
  if (recent.length === 0) return false;
  const avg =
    recent.reduce((s, r) => s + (r.position ?? 100), 0) / recent.length;
  return avg >= 4 && avg <= threshold;
}

export function detectCannibalization(
  snapshots: Array<{ url?: string; position: number | null }>
): string[] {
  const urls = snapshots.filter((s) => s.position && s.position <= 50 && s.url).map((s) => s.url!);
  const counts = new Map<string, number>();
  for (const u of urls) counts.set(u, (counts.get(u) || 0) + 1);
  return [...counts.entries()].filter(([, c]) => c > 1).map(([u]) => u);
}
