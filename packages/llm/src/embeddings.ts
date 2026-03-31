import { GoogleGenerativeAI } from "@google/generative-ai";

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
}

export function createEmbeddingService(apiKey: string): EmbeddingService {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: "text-embedding-005" });

  return {
    async embed(text: string): Promise<number[]> {
      const result = await model.embedContent(text);
      return result.embedding.values;
    },
  };
}
