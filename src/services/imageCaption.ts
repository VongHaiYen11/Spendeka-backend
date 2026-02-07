import "dotenv/config";
import fetch from "node-fetch";
import fsPromises from "node:fs/promises";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set in environment variables");
}

export interface ImageCaptionResult {
  items: string[];
  caption: string;
}

export type ImageCaptionLanguage = "vie" | "eng";

function buildCaptionPrompt(language: ImageCaptionLanguage): string {
  const isVietnamese = language === "vie";
  const captionLang = isVietnamese ? "Vietnamese" : "English";
  const itemsExample = isVietnamese
    ? '"trà sữa", "hamburger", "giày thể thao"'
    : '"milk tea", "hamburger", "sneakers"';

  return `
You are helping a user log a personal expense.

Look carefully at the provided image (a photo of items, food, bill, or scene related to spending).

Your task:
- Identify the main items in the image (max 5 short names).
- Write ONE very short ${captionLang} caption (<= 50 characters) that could be used as a note for this expense.

Return ONLY a JSON object with this exact shape:
{
  "items": string[],
  "caption": string
}

Rules:
- "items" should be short phrases in ${captionLang}, e.g. ${itemsExample}.
- "caption" must be in ${captionLang}, friendly, and concise.
- Do NOT include currency or amount in the caption.
- Output must be valid JSON, no comments, no extra text.
`;
}

export async function generateCaptionFromImage(
  filePath: string,
  mimeType: string,
  language: ImageCaptionLanguage = "eng",
): Promise<ImageCaptionResult> {
  const buffer = await fsPromises.readFile(filePath);
  const base64 = buffer.toString("base64");

  const prompt = buildCaptionPrompt(language);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: base64,
                  mimeType,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Gemini image caption API error: ${response.status} ${response.statusText} ${errorText}`,
    );
  }

  const data = (await response.json()) as any;
  const candidateText: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!candidateText) {
    throw new Error("Gemini image caption API did not return any content");
  }

  let parsed: ImageCaptionResult;
  try {
    parsed = JSON.parse(candidateText) as ImageCaptionResult;
  } catch {
    throw new Error("Failed to parse Gemini image caption response as JSON");
  }

  if (
    !parsed ||
    typeof parsed.caption !== "string" ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error("Gemini image caption JSON is missing required fields");
  }

  return parsed;
}
