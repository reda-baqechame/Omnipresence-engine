import express from "express";
import routes from "./api/routes.js";
import presence from "./api/presence.js";
import { verifySignedRequest, assertProductionAuth } from "./middleware/auth.js";
import { startWorker } from "./queue.js";
import { wipeWebgraphStorage, isWebgraphReady, triggerIngestAsync } from "./engines/webgraph.js";
import { isRateLimitRedisEnabled } from "./rate-limit-redis.js";

// Fail fast on insecure production config before binding the port.
assertProductionAuth();

async function bootstrapWebgraph(): Promise<void> {
  if (process.env.WEBGRAPH_WIPE_ON_START === "true") {
    console.log("[webgraph] wiping persisted index (WEBGRAPH_WIPE_ON_START)");
    await wipeWebgraphStorage();
  }
  const release = process.env.COMMONCRAWL_WEBGRAPH_RELEASE?.trim();
  if (!release) return;
  if (process.env.WEBGRAPH_AUTO_INGEST === "false") {
    console.log("[webgraph] auto-ingest disabled (WEBGRAPH_AUTO_INGEST=false)");
    return;
  }
  const ready = await isWebgraphReady();
  if (ready) {
    console.log(`[webgraph] index ready for release ${release}`);
    return;
  }
  const { accepted, reason } = triggerIngestAsync(release);
  console.log(`[webgraph] auto-ingest ${accepted ? "started" : "skipped"}: ${reason || release}`);
}

void bootstrapWebgraph().catch((e) =>
  console.warn("[webgraph] bootstrap failed:", e instanceof Error ? e.message : e)
);

const PORT = Number(process.env.PORT || 8787);
const app = express();

app.use(express.json({ limit: "2mb" }));

// Public health endpoint — must be reachable WITHOUT auth so Railway/Docker/Fly
// healthchecks (which send no API key) don't fail the deploy.
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "omnidata",
    version: "0.5.0",
    redis_rate_limit: isRateLimitRedisEnabled(),
  });
});

app.use(verifySignedRequest);
// Proprietary PresenceOS namespace + DataForSEO-compatible /v3 routes.
app.use(presence);
app.use(routes);

if (process.env.OMNIDATA_ENABLE_WORKER !== "false") {
  try {
    startWorker();
    console.log("OmniData worker started");
  } catch (err) {
    console.warn("Worker not started (Redis may be unavailable):", err);
  }
}

app.listen(PORT, () => {
  console.log(`OmniData listening on :${PORT}`);
});
