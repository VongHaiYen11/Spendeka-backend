export type TransactionType = "income" | "spent";

/**
 * Parsed transaction shape returned from Gemini.
 * This is designed to map cleanly onto the frontend DatabaseTransaction type.
 */
export interface ParsedTransactionFromText {
  caption: string;
  amount: number;
  category: string;
  type: TransactionType;
  createdAt: string; // ISO datetime string
}

