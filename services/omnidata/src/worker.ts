import { startWorker } from "./queue.js";

const worker = startWorker();
console.log("OmniData standalone worker running");

worker.on("completed", (job) => {
  console.log(`Task ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Task ${job?.id} failed:`, err.message);
});
