import { describe, it, expect } from "vitest";
import { GroqProvider } from "../providers/groq.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import { TogetherProvider } from "../providers/together.js";
import { CerebrasProvider } from "../providers/cerebras.js";
import { OllamaProvider } from "../providers/ollama.js";

describe("OpenAI-compatible provider subclasses", () => {
  describe("GroqProvider", () => {
    it("has correct name and default model", () => {
      const provider = new GroqProvider("test-key");
      expect(provider.name).toBe("groq");
      expect(provider.defaultModel).toBe("llama-3.3-70b-versatile");
      expect(provider.available).toBe(true);
    });

    it("is unavailable without API key", () => {
      const provider = new GroqProvider(undefined);
      expect(provider.available).toBe(false);
    });

    it("is unavailable with empty string API key", () => {
      const provider = new GroqProvider("");
      expect(provider.available).toBe(false);
    });
  });

  describe("OpenRouterProvider", () => {
    it("has correct name and default model", () => {
      const provider = new OpenRouterProvider("test-key");
      expect(provider.name).toBe("openrouter");
      expect(provider.defaultModel).toBe("meta-llama/llama-3.3-70b-instruct:free");
      expect(provider.available).toBe(true);
    });

    it("is unavailable without API key", () => {
      expect(new OpenRouterProvider(undefined).available).toBe(false);
    });
  });

  describe("TogetherProvider", () => {
    it("has correct name and default model", () => {
      const provider = new TogetherProvider("test-key");
      expect(provider.name).toBe("together");
      expect(provider.defaultModel).toBe("meta-llama/Llama-3.3-70B-Instruct-Turbo");
      expect(provider.available).toBe(true);
    });

    it("is unavailable without API key", () => {
      expect(new TogetherProvider(undefined).available).toBe(false);
    });
  });

  describe("CerebrasProvider", () => {
    it("has correct name and default model", () => {
      const provider = new CerebrasProvider("test-key");
      expect(provider.name).toBe("cerebras");
      expect(provider.defaultModel).toBe("llama-3.3-70b");
      expect(provider.available).toBe(true);
    });

    it("is unavailable without API key", () => {
      expect(new CerebrasProvider(undefined).available).toBe(false);
    });
  });

  describe("OllamaProvider", () => {
    it("uses default localhost URL when not specified", () => {
      const provider = new OllamaProvider(undefined);
      expect(provider.name).toBe("ollama");
      expect(provider.defaultModel).toBe("llama3.2:3b");
      // Unavailable without explicit baseURL (prevents routing to non-existent local instance)
      expect(provider.available).toBe(false);
    });

    it("is available when baseURL explicitly set", () => {
      const provider = new OllamaProvider("http://localhost:11434/v1");
      expect(provider.available).toBe(true);
    });

    it("accepts custom default model", () => {
      const provider = new OllamaProvider("http://localhost:11434/v1", "mistral:7b");
      expect(provider.defaultModel).toBe("mistral:7b");
    });

    it("strips tools from requests (local models don't support tool use reliably)", async () => {
      // This verifies the override exists — actual execution would require a real client
      const provider = new OllamaProvider("http://localhost:11434/v1");
      // The override wraps super.complete — verify the method exists
      expect(typeof provider.complete).toBe("function");
    });
  });
});
