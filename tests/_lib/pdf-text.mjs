/**
 * Real PDF text extraction for tests — used to prove the BYTES of a
 * generated PDF (not just the parallel HTML artifact) actually contain the
 * claimed report content. Uses pdfjs-dist's legacy Node build, which has
 * zero runtime dependencies (no native canvas binding required for text
 * extraction).
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const standardFontDataUrl =
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") +
  path.sep;

/**
 * @param {Buffer | Uint8Array} pdfBytes
 * @returns {Promise<string>} all text content across all pages, joined with newlines
 */
export async function extractPdfText(pdfBytes) {
  // pdfjs-dist explicitly rejects Node's `Buffer` (a Uint8Array subclass) —
  // it must be a plain Uint8Array, so always copy into one rather than
  // relying on the `instanceof Uint8Array` check (Buffer passes that check
  // too, but pdfjs's own runtime guard rejects it anyway).
  const data = new Uint8Array(pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength));
  const loadingTask = getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl,
  });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  if (typeof doc.cleanup === "function") await doc.cleanup();
  return pages.join("\n");
}
