import "dotenv/config";
// @ts-ignore - types are provided at runtime via node_modules
import express from "express";
// @ts-ignore - types are provided at runtime via node_modules
import cors from "cors";
// @ts-ignore - types are provided at runtime via node_modules
import type { Request, Response } from "express";
// @ts-ignore - types are provided at runtime via node_modules
import multer from "multer";
import fsPromises from "node:fs/promises";

// Extend Express Request so multer's req.file is typed (multer adds it at runtime)
declare global {
  namespace Express {
    interface Request {
      file?: multer.Multer.File;
    }
  }
}
import { parseTextToTransaction } from "./services/gemini.js";
import { generateCaptionFromImage } from "./services/imageCaption.js";
import { scanBillAndParse } from "./services/scanBill.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: "*", // TODO: restrict to your mobile app / web origin in production
  }),
);
app.use(express.json());

// Configure Multer for temporary storage of uploaded images
const upload = multer({
  dest: "tmp/",
});

// Simple root route so hitting http://localhost:PORT/ doesn't show "Cannot GET /"
app.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, message: "Spendeka API running" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post("/text-to-transaction", async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as { text?: string; language?: string };
    const { text } = body;
    const language = body.language === "vie" ? "vie" : "eng";

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing or invalid 'text'" });
    }

    const parsed = await parseTextToTransaction(text, language);

    // Return only the structured JSON; the client will map it to DatabaseTransaction.
    return res.json(parsed);
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: error?.message || "Internal server error" });
  }
});

// Scan bill endpoint: OCR + Gemini parsing
// Accepts optional form field "language": "vie" | "eng" so caption matches user's app language
app.post(
  "/scan-bill",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No bill image uploaded" });
      }

      const { originalname, size, path } = file;
      const language = req.body?.language === "vie" ? "vie" : "eng";

      const { rawText, parsed } = await scanBillAndParse(
        path,
        originalname,
        size,
        language,
      );

      return res.json({ rawText, parsed });
    } catch (error: any) {
      if (error?.code === "FILE_TOO_LARGE") {
        return res.status(413).json({
          error: error.message,
        });
      }

      return res
        .status(500)
        .json({ error: error?.message || "Failed to scan bill" });
    }
  },
);

// Image caption endpoint: Gemini vision -> caption + items
// Accepts optional form field "language": "vie" | "eng" to match user's app language
app.post(
  "/image-caption",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const { path, mimetype } = file;
    const language = req.body?.language === "vie" ? "vie" : "eng";

    try {
      const result = await generateCaptionFromImage(
        path,
        mimetype || "image/jpeg",
        language,
      );
      return res.json(result);
    } catch (error: any) {
      return res
        .status(500)
        .json({ error: error?.message || "Failed to generate image caption" });
    } finally {
      try {
        await fsPromises.unlink(path);
      } catch {
        // ignore
      }
    }
  },
);

app.listen(PORT, () => {
  console.log(`Spendeka API listening on http://localhost:${PORT}`);
});
