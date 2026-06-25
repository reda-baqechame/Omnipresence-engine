import express from "express";
import routes from "./api/routes.js";
import { verifySignedRequest } from "./middleware/auth.js";
import { startWorker } from "./queue.js";

const PORT = Number(process.env.PORT || 8787);
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(verifySignedRequest);
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
