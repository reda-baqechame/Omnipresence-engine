/**
 * Supabase Storage upload for AI UI capture artifacts.
 */
export interface SupabaseUploadResult {
  evidencePublicUrl: string | null;
  screenshotPath?: string;
  domPath?: string;
}

export async function uploadCaptureToSupabase(
  surface: string,
  responseHash: string,
  files: { answerJson: string; screenshotBase64?: string; domHtml?: string }
): Promise<SupabaseUploadResult | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.AI_CAPTURE_EVIDENCE_BUCKET || "ai-capture-evidence";
  if (!url || !key) return null;

  const base = `captures/${surface}/${responseHash.slice(0, 16)}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    apikey: key,
  };

  async function put(path: string, body: Buffer | string, contentType: string) {
    const payload: BodyInit = typeof body === "string" ? body : new Uint8Array(body);
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
      body: payload,
    });
    return res.ok;
  }

  const okJson = await put(`${base}/answer.json`, files.answerJson, "application/json");
  if (!okJson) return null;

  let screenshotPath: string | undefined;
  if (files.screenshotBase64) {
    screenshotPath = `${base}/screenshot.png`;
    await put(screenshotPath, Buffer.from(files.screenshotBase64, "base64"), "image/png");
  }
  let domPath: string | undefined;
  if (files.domHtml) {
    domPath = `${base}/dom.html`;
    await put(domPath, files.domHtml, "text/html");
  }

  return {
    evidencePublicUrl: `${url}/storage/v1/object/public/${bucket}/${base}/answer.json`,
    screenshotPath,
    domPath,
  };
}
