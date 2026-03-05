import { OpenAICompatibleProvider } from "./openai-compatible.js";

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string | undefined) {
    super("groq", apiKey, "llama-3.3-70b-versatile", "https://api.groq.com/openai/v1");
  }
}
