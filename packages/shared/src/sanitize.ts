/**
 * Sanitize untrusted text (tool results, memory content, external data)
 * before injecting into LLM prompts. Strips common prompt injection
 * patterns and enforces length limits.
 */

/** Patterns that mimic LLM prompt delimiters / instruction markers */
const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  // Common chat-template delimiters
  [/<\|(?:system|user|assistant|im_start|im_end|endoftext)\|>/gi, "[STRIPPED]"],
  [/\[INST\]|\[\/INST\]/gi, "[STRIPPED]"],
  [/<<SYS>>|<<\/SYS>>/gi, "[STRIPPED]"],
  [/<\/s>/gi, "[STRIPPED]"],

  // XML-like tags that could be interpreted as prompt structure
  [/<\/?(?:system|assistant|user|human|tool_use|tool_result|user-data|instructions|context|memory)(?=[\s>\/])(?:\s[^>]*)?\/?>/gi, "[STRIPPED]"],

  // Markdown headings that attempt prompt/instruction override
  [/^#{1,3}\s+(?:System|Instructions|Prompt|Override|Ignore\s+previous|New\s+instructions|IMPORTANT)/gim, "[STRIPPED]"],

  // Common prompt injection phrases
  [/(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|context|rules|prompts)/gi, "[STRIPPED]"],

  // Role-play injection ("Human:", "Assistant:" at line start)
  [/^(?:Human|Assistant|System|User)\s*:/gim, "[STRIPPED]:"],

  // HTML script/style/iframe tags
  [/<\/?(?:script|style|iframe|object|embed|form|input)(?:\s[^>]*)?\/?>/gi, "[STRIPPED]"],
];

/** Collapse runs of 4+ newlines down to 2 */
const EXCESSIVE_NEWLINES = /\n{4,}/g;

/** Collapse runs of 4+ spaces/tabs down to a single space */
const EXCESSIVE_WHITESPACE = /[ \t]{4,}/g;

/**
 * Sanitize a tool result or other untrusted text before it is injected
 * into an LLM prompt.
 *
 * @param text    - The raw text to sanitize
 * @param maxLen  - Maximum allowed length (default 10 000 chars). Text
 *                  beyond this limit is truncated with a marker.
 * @returns Sanitized text safe for prompt inclusion.
 */
export function sanitizeToolResult(text: string, maxLen = 10_000): string {
  if (!text) return text;

  let sanitized = text;

  for (const [pattern, replacement] of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  // Collapse excessive whitespace
  sanitized = sanitized.replace(EXCESSIVE_NEWLINES, "\n\n");
  sanitized = sanitized.replace(EXCESSIVE_WHITESPACE, " ");

  // Enforce length limit
  if (sanitized.length > maxLen) {
    sanitized = sanitized.slice(0, maxLen) + "\n[TRUNCATED — output exceeded maximum length]";
  }

  return sanitized;
}
