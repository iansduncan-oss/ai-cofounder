import { OpenAICompatibleProvider } from "./openai-compatible.js";

export class TogetherProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string | undefined) {
    super(
      "together",
      apiKey,
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "https://api.together.xyz/v1",
    );
  }
}
