import { OpenAICompatibleProvider } from "./openai-compatible.js";

export class CerebrasProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string | undefined) {
    super(
      "cerebras",
      apiKey,
      "llama-3.3-70b",
      "https://api.cerebras.ai/v1",
    );
  }
}
