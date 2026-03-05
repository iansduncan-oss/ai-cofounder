import { OpenAICompatibleProvider } from "./openai-compatible.js";

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string | undefined) {
    super(
      "openrouter",
      apiKey,
      "meta-llama/llama-3.3-70b-instruct:free",
      "https://openrouter.ai/api/v1",
    );
  }
}
