import { Queue, QueueEvents, Worker, type ConnectionOptions } from "bullmq";
import { capture, isBlocked, type CaptureOptions, type CaptureOutcome, type Surface } from "./capture.js";
import { withCaptureSlot } from "./concurrency.js";
import { retryWithExponentialBackoff } from "./retry-policy.js";

const QUEUE_NAME = "ai-ui-capture-jobs";

export interface CaptureJobData {
  surface: Surface;
  prompt: string;
  options: CaptureOptions;
  retryAttempts: number;
}

export interface CaptureJobResult {
  raw: CaptureOutcome;
}

let queue: Queue<CaptureJobData, CaptureJobResult> | null = null;
let queueEvents: QueueEvents | null = null;
let worker: Worker<CaptureJobData, CaptureJobResult> | null = null;

function getRedisUrl(): string | undefined {
  const url = process.env.REDIS_URL?.trim();
  return url || undefined;
}

export function isQueueEnabled(): boolean {
  return Boolean(getRedisUrl());
}

function getConnection(): ConnectionOptions {
  return { url: getRedisUrl()!, maxRetriesPerRequest: null };
}

function getQueue(): Queue<CaptureJobData, CaptureJobResult> {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

function getQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, { connection: getConnection() });
  }
  return queueEvents;
}

function shouldRetryCapture(result: CaptureOutcome): boolean {
  if (!result) return true;
  if (!isBlocked(result)) return false;
  const reason = (result.reason || "").toLowerCase();
  return reason.includes("rate") || reason.includes("traffic") || reason.includes("timeout");
}

async function runCaptureWithRetry(data: CaptureJobData): Promise<CaptureOutcome> {
  return withCaptureSlot(() =>
    retryWithExponentialBackoff(() => capture(data.surface, data.prompt, data.options), {
      attempts: data.retryAttempts,
      shouldRetry: (_error, _attempt, result) => shouldRetryCapture(result ?? null),
    })
  );
}

export async function enqueueCaptureJob(data: CaptureJobData) {
  return getQueue().add("capture", data, {
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export async function executeCaptureViaQueue(data: CaptureJobData): Promise<CaptureOutcome> {
  const job = await enqueueCaptureJob(data);
  const timeoutMs = Number(process.env.AI_UI_CAPTURE_JOB_TIMEOUT_MS || 120_000);
  const result = (await job.waitUntilFinished(getQueueEvents(), timeoutMs)) as CaptureJobResult;
  return result.raw;
}

export function startCaptureWorker(): Worker<CaptureJobData, CaptureJobResult> {
  if (worker) return worker;

  worker = new Worker<CaptureJobData, CaptureJobResult>(
    QUEUE_NAME,
    async (job) => {
      const raw = await runCaptureWithRetry(job.data);
      return { raw };
    },
    {
      connection: getConnection(),
      concurrency: Math.max(1, Number(process.env.AI_UI_CAPTURE_MAX_CONCURRENCY || 3)),
    }
  );

  worker.on("failed", (job, err) => {
    console.error("capture job failed", job?.id, err.message);
  });

  return worker;
}
