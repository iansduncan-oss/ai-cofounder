import { describe, it, expect } from "vitest";
import { chunkText, estimateTokens, detectContentType } from "../chunker.js";

describe("estimateTokens", () => {
  it("estimates code tokens at ~3 chars per token", () => {
    const code = "const x = 1;"; // 12 chars
    expect(estimateTokens(code, true)).toBe(4); // ceil(12/3)
  });

  it("estimates prose tokens at ~4 chars per token", () => {
    const prose = "Hello world test"; // 16 chars
    expect(estimateTokens(prose, false)).toBe(4); // ceil(16/4)
  });
});

describe("detectContentType", () => {
  it("detects TypeScript files as code", () => {
    expect(detectContentType("src/index.ts")).toBe("code");
  });

  it("detects JavaScript files as code", () => {
    expect(detectContentType("app.js")).toBe("code");
  });

  it("detects markdown files as prose", () => {
    expect(detectContentType("README.md")).toBe("prose");
  });

  it("detects content type from code patterns when no extension", () => {
    const code = `
import { foo } from "bar";
export function doStuff() {
  const x = 1;
  return x;
}
    `.trim();
    expect(detectContentType(undefined, code)).toBe("code");
  });

  it("defaults to prose for unknown content", () => {
    expect(detectContentType(undefined, "Just some text")).toBe("prose");
  });
});

describe("chunkText", () => {
  it("returns a single chunk for small content", () => {
    const text = "Hello world";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Hello world");
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it("splits large code at function boundaries", () => {
    const lines: string[] = [];
    // Create 3 functions, each large enough to be its own chunk
    for (let i = 0; i < 3; i++) {
      lines.push(`export function func${i}() {`);
      for (let j = 0; j < 100; j++) {
        lines.push(`  const var${j} = "value${j}"; // padding line for function ${i}`);
      }
      lines.push(`}`);
      lines.push("");
    }
    const text = lines.join("\n");

    const chunks = chunkText(text, { filePath: "test.ts", maxTokens: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should contain reasonable content
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(300); // tolerance for overlap
    }
  });

  it("splits large prose at paragraph boundaries", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push(
        `Paragraph ${i}: ${"This is a sentence that adds length to the paragraph. ".repeat(20)}`,
      );
    }
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text, { filePath: "doc.md", maxTokens: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.metadata.type).toBe("prose");
    }
  });

  it("preserves metadata through chunking", () => {
    const text = "A small piece of text for a single chunk output.";
    const chunks = chunkText(text, {
      filePath: "src/utils.ts",
      language: "typescript",
    });

    expect(chunks[0].metadata.filePath).toBe("src/utils.ts");
    expect(chunks[0].metadata.language).toBe("typescript");
    expect(chunks[0].metadata.startLine).toBe(1);
  });

  it("handles empty content", () => {
    const chunks = chunkText("");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("");
  });

  it("respects custom maxTokens", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: some content here`);
    const text = lines.join("\n");
    const chunks = chunkText(text, { maxTokens: 100 });

    for (const chunk of chunks) {
      // Allow tolerance for overlap (64 tokens default overlap)
      expect(chunk.tokenCount).toBeLessThanOrEqual(170);
    }
  });
});
