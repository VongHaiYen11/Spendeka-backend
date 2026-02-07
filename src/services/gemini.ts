import "dotenv/config";
import fetch from "node-fetch";
import { ParsedTransactionFromText } from "../types/transaction.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set in environment variables");
}

/**
 * Extract the first JSON object from Gemini output safely.
 */
function extractJsonObject(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in Gemini response");
  return match[0];
}

export type ParseTransactionLanguage = "vie" | "eng";

export async function parseTextToTransaction(
  text: string,
  language: ParseTransactionLanguage = "eng",
): Promise<ParsedTransactionFromText> {
  // Server reference time (used for today/yesterday fallback)
  const now = new Date();
  const nowIso = now.toISOString();

  const captionRule =
    language === "vie"
      ? '- "caption" must be a short note in Vietnamese (e.g. "Cà phê sáng", "Ăn trưa").'
      : '- "caption" must be a short note in English (e.g. "Morning coffee", "Lunch").';

  const prompt = `
You are a transaction parser.

Your job: convert the user text into exactly ONE valid JSON object.

------------------------------------------------------------
Current datetime reference (ISO 8601):
${nowIso}
------------------------------------------------------------

User text:
"""
${text}
"""

Return exactly ONE JSON object (no markdown, no extra text) in this shape:

{
  "caption": string,
  "amount": number,
  "category": string,
  "type": "income" | "spent",
  "createdAt": string
}

Rules:

CAPTION (IMPORTANT):
- ${captionRule}
- Keep it concise; it will be used as a transaction note.

AMOUNT:
- "amount" must be a positive number.
- If multiple items exist, sum them.

TYPE:
- "income" if money received, otherwise "spent".

CATEGORY:
- MUST be one of these exact values:

Expenses:
"food", "transport", "shopping", "entertainment",
"bills", "health", "education", "other"

Income:
"salary", "freelance", "investment", "gift",
"refund", "other_income"

- Never invent new categories.

CREATEDAT (IMPORTANT):
- "createdAt" must be ISO 8601 datetime.
- If the user text contains a specific date, use that date.
- If the user says "today" or "yesterday", resolve it relative to the current datetime reference above.
- If the user provides a date but NO time, set the time to exactly 00:00:00.
- If the user provides NO date at all, use the current datetime reference above.

OUTPUT FORMAT:
- Return ONLY the JSON object.
- No backticks.
- No explanations.
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    },
  );

  if (!response.ok) {
    await response.text();
    throw new Error(
      `Gemini API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as any;

  const candidateText: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!candidateText) {
    throw new Error("Gemini API did not return any content");
  }

  let parsed: ParsedTransactionFromText;

  try {
    // Safer JSON extraction
    const jsonOnly = extractJsonObject(candidateText);
    parsed = JSON.parse(jsonOnly);
  } catch (err) {
    throw new Error("Failed to parse Gemini response as JSON");
  }

  // Validation
  if (
    typeof parsed.caption !== "string" ||
    typeof parsed.amount !== "number" ||
    typeof parsed.category !== "string" ||
    (parsed.type !== "income" && parsed.type !== "spent") ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new Error("Gemini response JSON is missing required fields");
  }

  return parsed;
}
