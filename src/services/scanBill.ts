import "dotenv/config";
import fsPromises from "node:fs/promises";
import Tesseract from "tesseract.js";
import type { ParsedTransactionFromText } from "../types/transaction.js";
import { parseTextToTransaction } from "./gemini.js";

const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB hard limit for bill images

export type ScanBillLanguage = "vie" | "eng";

export async function scanBillAndParse(
  filePath: string,
  originalName: string,
  size: number,
  language: ScanBillLanguage = "eng",
): Promise<{ rawText: string; parsed: ParsedTransactionFromText }> {
  if (!size || size <= 0) {
    await safeUnlink(filePath);
    throw new Error("Uploaded bill image is empty");
  }

  if (size > MAX_IMAGE_FILE_SIZE_BYTES) {
    await safeUnlink(filePath);
    const err: any = new Error(
      "Bill image too large. Please upload an image under 5MB.",
    );
    err.code = "FILE_TOO_LARGE";
    throw err;
  }

  try {
    // Support Vietnamese + English OCR
    const result = await Tesseract.recognize(filePath, "vie+eng", {
      logger: () => {
        // Logger disabled - no console output
      },
    });

    const rawText = (result.data?.text || "").trim();

    if (!rawText) {
      throw new Error("OCR did not detect any text in the bill image.");
    }

    const parsed = await parseTextToTransaction(rawText, language);

    return { rawText, parsed };
  } finally {
    await safeUnlink(filePath);
  }
}

async function safeUnlink(path: string) {
  try {
    await fsPromises.unlink(path);
  } catch (err: any) {
    // Ignore errors (file may not exist)
    if (err?.code !== "ENOENT") {
      // Silent fail for temp file cleanup
    }
  }
}
