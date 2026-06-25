import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { TaskRecord } from "./types.js";
import { completeTask, createTask, failTask, getTask, markProcessing } from "./store.js";
import { runSerpLive } from "./engines/serp.js";
import { runBacklinks } from "./engines/backlinks.js";
import { runKeywords } from "./engines/keywords.js";
import { runRankCheck } from "./engines/rank-tracker.js";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let queue: Queue | null = null;

function getConnection(): ConnectionOptions {
  return { url: REDIS_URL, maxRetriesPerRequest: null };
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue("omnidata-tasks", { connection: getConnection() });
  }
  return queue;
}

export async function enqueueTask(tag: string, endpoint: string, payload: unknown): Promise<TaskRecord> {
  const task = createTask(tag, endpoint, payload);
  try {
    await getQueue().add("process", { taskId: task.id }, { jobId: task.id });
  } catch {
    void processTask(task.id);
  }
  return task;
}

export async function processTask(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task || task.status !== "pending") return;
  markProcessing(taskId);
  try {
    const result = await executeEndpoint(task.endpoint, task.payload);
    completeTask(taskId, result);
  } catch (err) {
    failTask(taskId, err instanceof Error ? err.message : "Task failed");
  }
}

async function executeEndpoint(endpoint: string, payload: unknown): Promise<unknown> {
  const p = payload as Record<string, unknown>;
  switch (endpoint) {
    case "serp/google/organic":
      return runSerpLive(String(p.keyword || ""), String(p.location || "United States"));
    case "backlinks/summary":
      return runBacklinks(String(p.target || p.domain || ""));
    case "keywords/suggestions":
      return runKeywords(String(p.seed || p.keyword || ""));
    case "rank/check":
      return runRankCheck(String(p.keyword || ""), String(p.domain || ""), String(p.location || "United States"));
    default:
      throw new Error(`Unknown endpoint: ${endpoint}`);
  }
}

export function startWorker(): Worker {
  const worker = new Worker(
    "omnidata-tasks",
    async (job) => {
      await processTask(job.data.taskId as string);
    },
    { connection: getConnection() }
  );
  worker.on("failed", (job, err) => {
    if (job?.data?.taskId) failTask(job.data.taskId, err.message);
  });
  return worker;
}
