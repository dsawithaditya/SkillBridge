/**
 * Resume text normalization and PDF text extraction using unpdf (maintained PDF.js).
 */

import { extractText } from "unpdf";
import { BadRequestError } from "./errors.js";

const MIN_EXTRACTED_CHARS = 30;
const FRIENDLY_PDF_ERROR =
  "We could not read this PDF. Paste your resume text instead";

export function cleanResumeText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  return rawText
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractTextFromPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    console.error("[resumeParser] Empty PDF buffer provided.");
    throw new BadRequestError(FRIENDLY_PDF_ERROR, {
      code: "PDF_PARSE_FAILED",
      details: { switchToPaste: true },
    });
  }

  let extractedText = "";
  try {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    if (typeof result?.text === "string") {
      extractedText = result.text;
    } else if (Array.isArray(result?.text)) {
      extractedText = result.text.join("\n");
    }
  } catch (err) {
    console.error("[resumeParser] PDF parse error:", err);
    throw new BadRequestError(FRIENDLY_PDF_ERROR, {
      code: "PDF_PARSE_FAILED",
      details: { switchToPaste: true },
    });
  }

  const cleaned = cleanResumeText(extractedText);
  if (cleaned.length < MIN_EXTRACTED_CHARS) {
    console.error(
      `[resumeParser] PDF yielded insufficient text (${cleaned.length} chars).`
    );
    throw new BadRequestError(FRIENDLY_PDF_ERROR, {
      code: "PDF_PARSE_FAILED",
      details: { switchToPaste: true },
    });
  }

  return cleaned;
}
