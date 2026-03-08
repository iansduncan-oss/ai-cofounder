/**
 * Code-aware and prose-aware text chunker for RAG ingestion.
 * Splits text into chunks targeting ~512 tokens with 64-token overlap.
 * Uses structural boundaries (functions, classes, paragraphs) when possible.
 */

export interface Chunk {
  content: string;
  index: number;
  tokenCount: number;
  metadata: {
    language?: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    type: "code" | "prose";
  };
}

export interface ChunkerOptions {
  maxTokens?: number;
  overlapTokens?: number;
  filePath?: string;
  language?: string;
}

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 64;

// Rough token estimation: ~4 chars per token for English, ~3 for code
function estimateTokens(text: string, isCode: boolean): number {
  const charsPerToken = isCode ? 3 : 4;
  return Math.ceil(text.length / charsPerToken);
}

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
  "rb", "php", "swift", "kt", "scala", "sh", "bash", "zsh",
  "css", "scss", "less", "sql", "graphql", "yaml", "yml", "toml",
]);

const PROSE_EXTENSIONS = new Set([
  "md", "mdx", "txt", "rst", "adoc", "tex",
]);

function detectContentType(filePath?: string, content?: string): "code" | "prose" {
  if (filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (CODE_EXTENSIONS.has(ext)) return "code";
    if (PROSE_EXTENSIONS.has(ext)) return "prose";
  }
  // Heuristic: if >30% of lines start with common code patterns
  if (content) {
    const lines = content.split("\n").slice(0, 50);
    const codePatterns = /^\s*(import |export |const |let |var |function |class |def |fn |pub |if |for |while |return |async |await |type |interface )/;
    const codeLines = lines.filter((l) => codePatterns.test(l)).length;
    if (codeLines / Math.max(lines.length, 1) > 0.3) return "code";
  }
  return "prose";
}

// Code boundary patterns — split at top-level declarations
const CODE_BOUNDARIES = [
  /^(?:export\s+)?(?:async\s+)?function\s+/m,        // function declarations
  /^(?:export\s+)?class\s+/m,                         // class declarations
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=/m,      // top-level variable declarations
  /^(?:export\s+)?interface\s+/m,                      // interface declarations
  /^(?:export\s+)?type\s+/m,                           // type declarations
  /^(?:export\s+)?enum\s+/m,                           // enum declarations
  /^def\s+/m,                                          // Python functions
  /^class\s+/m,                                        // Python/Ruby classes
  /^fn\s+/m,                                           // Rust functions
  /^pub\s+/m,                                          // Rust pub items
  /^func\s+/m,                                         // Go functions
];

function splitCodeAtBoundaries(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    const isBoundary = CODE_BOUNDARIES.some((pattern) => pattern.test(line));
    if (isBoundary && currentSection.length > 0) {
      sections.push(currentSection.join("\n"));
      currentSection = [];
    }
    currentSection.push(line);
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join("\n"));
  }

  return sections;
}

function splitProseAtBoundaries(text: string): string[] {
  // Split on double newlines (paragraphs), headers, and horizontal rules
  const sections = text.split(/\n\s*\n/).filter((s) => s.trim().length > 0);
  return sections;
}

function mergeSmallSections(
  sections: string[],
  maxTokens: number,
  isCode: boolean,
): string[] {
  const merged: string[] = [];
  let current = "";

  for (const section of sections) {
    const separator = isCode ? "\n\n" : "\n\n";
    const combined = current ? `${current}${separator}${section}` : section;
    if (estimateTokens(combined, isCode) <= maxTokens) {
      current = combined;
    } else {
      if (current) merged.push(current);
      current = section;
    }
  }

  if (current) merged.push(current);
  return merged;
}

function splitOversizedChunk(
  text: string,
  maxTokens: number,
  isCode: boolean,
): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line, isCode);
    if (currentTokens + lineTokens > maxTokens && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(line);
    currentTokens += lineTokens;
  }

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}

function addOverlap(chunks: string[], overlapTokens: number, isCode: boolean): string[] {
  if (chunks.length <= 1 || overlapTokens <= 0) return chunks;

  const result: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      result.push(chunks[i]);
      continue;
    }

    // Get overlap from end of previous chunk
    const prevLines = chunks[i - 1].split("\n");
    const overlapLines: string[] = [];
    let tokens = 0;

    for (let j = prevLines.length - 1; j >= 0; j--) {
      const lineTokens = estimateTokens(prevLines[j], isCode);
      if (tokens + lineTokens > overlapTokens) break;
      overlapLines.unshift(prevLines[j]);
      tokens += lineTokens;
    }

    if (overlapLines.length > 0) {
      result.push(`${overlapLines.join("\n")}\n${chunks[i]}`);
    } else {
      result.push(chunks[i]);
    }
  }

  return result;
}

export function chunkText(text: string, options?: ChunkerOptions): Chunk[] {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const contentType = detectContentType(options?.filePath, text);
  const isCode = contentType === "code";

  // Skip empty or trivially small content
  if (estimateTokens(text, isCode) <= maxTokens) {
    return [
      {
        content: text,
        index: 0,
        tokenCount: estimateTokens(text, isCode),
        metadata: {
          language: options?.language,
          filePath: options?.filePath,
          startLine: 1,
          endLine: text.split("\n").length,
          type: contentType,
        },
      },
    ];
  }

  // Step 1: Split at structural boundaries
  const sections = isCode
    ? splitCodeAtBoundaries(text)
    : splitProseAtBoundaries(text);

  // Step 2: Merge small adjacent sections
  const merged = mergeSmallSections(sections, maxTokens, isCode);

  // Step 3: Split any oversized chunks by lines
  const sized: string[] = [];
  for (const section of merged) {
    if (estimateTokens(section, isCode) > maxTokens) {
      sized.push(...splitOversizedChunk(section, maxTokens, isCode));
    } else {
      sized.push(section);
    }
  }

  // Step 4: Add overlap between consecutive chunks
  const withOverlap = addOverlap(sized, overlapTokens, isCode);

  // Step 5: Calculate line ranges and build Chunk objects
  const lines = text.split("\n");
  let lineOffset = 0;

  return withOverlap.map((content, index) => {
    const chunkLines = content.split("\n").length;
    const startLine = lineOffset + 1;
    // Find actual position in original text (approximate due to overlap)
    const endLine = startLine + chunkLines - 1;

    // Advance offset by the non-overlapping portion
    if (index < sized.length) {
      lineOffset += sized[index].split("\n").length;
    }

    return {
      content,
      index,
      tokenCount: estimateTokens(content, isCode),
      metadata: {
        language: options?.language,
        filePath: options?.filePath,
        startLine,
        endLine: Math.min(endLine, lines.length),
        type: contentType,
      },
    };
  });
}

export { estimateTokens, detectContentType };
