/**
 * Backfill embeddings for existing memories that lack them.
 *
 * Usage:
 *   npx tsx packages/db/src/backfill-embeddings.ts
 *
 * Requires GEMINI_API_KEY and DATABASE_URL env vars.
 */

import { createDb } from "./client.js";
import { memories } from "./schema.js";
import { eq, isNull } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";

const DATABASE_URL = process.env.DATABASE_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is required");
  process.exit(1);
}

const db = createDb(DATABASE_URL);
const genai = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: "text-embedding-004" });

async function main() {
  const rows = await db.select().from(memories).where(isNull(memories.embedding));

  console.log(`Found ${rows.length} memories without embeddings`);

  let processed = 0;
  for (const row of rows) {
    const text = `${row.key}: ${row.content}`;
    try {
      const result = await model.embedContent(text);
      const embedding = result.embedding.values;

      await db.update(memories).set({ embedding }).where(eq(memories.id, row.id));

      processed++;
      if (processed % 10 === 0) {
        console.log(`Processed ${processed}/${rows.length}`);
      }
    } catch (err) {
      console.error(`Failed to embed memory ${row.id} (${row.key}):`, err);
    }
  }

  console.log(`Done. Backfilled ${processed}/${rows.length} memories.`);
  process.exit(0);
}

main();
