import { OpenAICompatibleProvider } from "./openai-compatible.js";

export class HuggingFaceProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string | undefined) {
    super(
      "huggingface",
      apiKey,
      "meta-llama/Llama-3.3-70B-Instruct",
      "https://router.huggingface.co/v1",
    );
  }
}
