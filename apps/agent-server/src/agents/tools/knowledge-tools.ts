import type { LlmTool } from "@ai-cofounder/llm";

export const SEARCH_KNOWLEDGE_TOOL: LlmTool = {
  name: "search_knowledge",
  description:
    "Search the knowledge base for relevant documents, notes, and ingested content. " +
    "Use when the user asks about something that might be in the knowledge base, " +
    "e.g. 'what do we know about X', 'find that doc about Y', 'search for Z in our docs'.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language search query",
      },
      limit: {
        type: "integer",
        description: "Maximum number of results to return (default 5)",
      },
      source_type: {
        type: "string",
        enum: ["repository", "conversation", "document", "note"],
        description: "Optional: filter by source type",
      },
    },
    required: ["query"],
  },
};

export const INGEST_DOCUMENT_TOOL: LlmTool = {
  name: "ingest_document",
  description:
    "Save content to the knowledge base for future retrieval. " +
    "Use when the user says 'save this to the knowledge base', 'remember this document', " +
    "'index this for later'. Content is chunked, embedded, and made searchable.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The text content to ingest into the knowledge base",
      },
      source_id: {
        type: "string",
        description: "A descriptive identifier for this content (e.g. 'competitor-analysis-q1-2026')",
      },
      source_type: {
        type: "string",
        enum: ["document", "note"],
        description: "Type of content being ingested (default: document)",
      },
    },
    required: ["content", "source_id"],
  },
};

export const KNOWLEDGE_STATUS_TOOL: LlmTool = {
  name: "knowledge_status",
  description:
    "Check what's in the knowledge base — how many documents, total chunks, ingestion status. " +
    "Use when the user asks 'what's in the knowledge base', 'how much do you know', " +
    "'what documents have been indexed'.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};
