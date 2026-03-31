import { describe, it, expect, vi, beforeEach } from "vitest";

/* ────────────────────────────────────────────────────────────
 *  Mock Google Generative AI SDK
 * ────────────────────────────────────────────────────────── */

const mockEmbedContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  embedContent: mockEmbedContent,
});

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class MockGoogleAI {
      getGenerativeModel = mockGetGenerativeModel;
      constructor(_apiKey: string) {}
    },
  };
});

/* ────────────────────────────────────────────────────────────
 *  Import after mocks
 * ────────────────────────────────────────────────────────── */

import { createEmbeddingService, type EmbeddingService } from "../embeddings.js";

/* ════════════════════════════════════════════════════════════
 *  Tests
 * ════════════════════════════════════════════════════════════ */

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGenerativeModel.mockReturnValue({
      embedContent: mockEmbedContent,
    });
    service = createEmbeddingService("gm-test-key");
  });

  describe("createEmbeddingService()", () => {
    it("creates the model with text-embedding-005", () => {
      createEmbeddingService("my-api-key");
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: "text-embedding-005",
      });
    });
  });

  describe("embed()", () => {
    it("returns embedding values for a text input", async () => {
      const mockValues = [0.1, 0.2, 0.3, -0.4, 0.5];
      mockEmbedContent.mockResolvedValueOnce({
        embedding: { values: mockValues },
      });

      const result = await service.embed("Hello world");

      expect(mockEmbedContent).toHaveBeenCalledWith("Hello world");
      expect(result).toEqual(mockValues);
    });

    it("returns a 768-dimension vector", async () => {
      const mockValues = Array.from({ length: 768 }, (_, i) => i * 0.001);
      mockEmbedContent.mockResolvedValueOnce({
        embedding: { values: mockValues },
      });

      const result = await service.embed("Test sentence");

      expect(result).toHaveLength(768);
      expect(result[0]).toBe(0);
      expect(result[767]).toBeCloseTo(0.767);
    });

    it("handles empty string input", async () => {
      const mockValues = Array.from({ length: 768 }, () => 0);
      mockEmbedContent.mockResolvedValueOnce({
        embedding: { values: mockValues },
      });

      const result = await service.embed("");

      expect(mockEmbedContent).toHaveBeenCalledWith("");
      expect(result).toHaveLength(768);
    });

    it("handles long text input", async () => {
      const longText = "a".repeat(10000);
      const mockValues = [0.5, 0.6, 0.7];
      mockEmbedContent.mockResolvedValueOnce({
        embedding: { values: mockValues },
      });

      const result = await service.embed(longText);

      expect(mockEmbedContent).toHaveBeenCalledWith(longText);
      expect(result).toEqual(mockValues);
    });

    it("can be called multiple times sequentially", async () => {
      mockEmbedContent
        .mockResolvedValueOnce({
          embedding: { values: [0.1, 0.2] },
        })
        .mockResolvedValueOnce({
          embedding: { values: [0.3, 0.4] },
        })
        .mockResolvedValueOnce({
          embedding: { values: [0.5, 0.6] },
        });

      const result1 = await service.embed("first");
      const result2 = await service.embed("second");
      const result3 = await service.embed("third");

      expect(result1).toEqual([0.1, 0.2]);
      expect(result2).toEqual([0.3, 0.4]);
      expect(result3).toEqual([0.5, 0.6]);
      expect(mockEmbedContent).toHaveBeenCalledTimes(3);
    });

    it("can be called in parallel (batch-style)", async () => {
      mockEmbedContent
        .mockResolvedValueOnce({
          embedding: { values: [0.1] },
        })
        .mockResolvedValueOnce({
          embedding: { values: [0.2] },
        })
        .mockResolvedValueOnce({
          embedding: { values: [0.3] },
        });

      const texts = ["hello", "world", "test"];
      const results = await Promise.all(texts.map((t) => service.embed(t)));

      expect(results).toEqual([[0.1], [0.2], [0.3]]);
      expect(mockEmbedContent).toHaveBeenCalledTimes(3);
      expect(mockEmbedContent).toHaveBeenCalledWith("hello");
      expect(mockEmbedContent).toHaveBeenCalledWith("world");
      expect(mockEmbedContent).toHaveBeenCalledWith("test");
    });

    it("propagates API errors", async () => {
      mockEmbedContent.mockRejectedValueOnce(new Error("Quota exceeded"));

      await expect(service.embed("test")).rejects.toThrow("Quota exceeded");
    });

    it("propagates network errors", async () => {
      mockEmbedContent.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(service.embed("test")).rejects.toThrow("ECONNREFUSED");
    });

    it("handles API returning malformed response (no embedding)", async () => {
      mockEmbedContent.mockResolvedValueOnce({});

      await expect(service.embed("test")).rejects.toThrow();
    });

    it("handles API returning malformed response (no values)", async () => {
      mockEmbedContent.mockResolvedValueOnce({
        embedding: {},
      });

      // The result would be undefined since .values is undefined
      // This tests that the service doesn't crash but returns what the API gives
      const result = await service.embed("test");
      expect(result).toBeUndefined();
    });
  });
});
