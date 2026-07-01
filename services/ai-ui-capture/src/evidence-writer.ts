import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Surface } from "./capture.js";

export interface CaptureEvidencePayload {
  surface: Surface;
  responseHash: string;
  answer: string;
  citedUrls: string[];
  screenshotBase64?: string;
  domHtml?: string;
}

export interface CaptureEvidencePaths {
  rootPath: string;
  answerPath: string;
  screenshotPath?: string;
  domPath?: string;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Persist capture artifacts to disk and return the saved paths.
 * The service can later be wired to object storage without changing callers.
 */
export async function writeCaptureEvidence(payload: CaptureEvidencePayload): Promise<CaptureEvidencePaths> {
  const baseDir = process.env.AI_UI_CAPTURE_EVIDENCE_DIR || "/tmp/ai-ui-capture-evidence";
  const stamp = Date.now();
  const rootPath = join(baseDir, safeSegment(payload.surface), `${stamp}-${safeSegment(payload.responseHash)}`);
  await mkdir(rootPath, { recursive: true });

  const answerPath = join(rootPath, "answer.json");
  await writeFile(
    answerPath,
    JSON.stringify(
      {
        surface: payload.surface,
        responseHash: payload.responseHash,
        answer: payload.answer,
        citedUrls: payload.citedUrls,
        capturedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  let screenshotPath: string | undefined;
  if (payload.screenshotBase64) {
    screenshotPath = join(rootPath, "screenshot.png");
    await writeFile(screenshotPath, Buffer.from(payload.screenshotBase64, "base64"));
  }

  let domPath: string | undefined;
  if (payload.domHtml) {
    domPath = join(rootPath, "dom.html");
    await writeFile(domPath, payload.domHtml, "utf8");
  }

  return { rootPath, answerPath, screenshotPath, domPath };
}
