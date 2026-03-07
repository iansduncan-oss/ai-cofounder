import type { LlmRegistry, LlmTool, LlmToolUseContent, EmbeddingService } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { recallMemories, searchMemoriesByVector } from "@ai-cofounder/db";
import { SpecialistAgent, type SpecialistContext } from "./base.js";
import { READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL } from "../tools/filesystem-tools.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "../tools/web-search.js";
import { RECALL_MEMORIES_TOOL } from "../tools/memory-tools.js";
import type { WorkspaceService } from "../../services/workspace.js";

export class DocWriterAgent extends SpecialistAgent {
  readonly role: AgentRole = "doc_writer";
  readonly taskCategory = "code" as const;

  private workspaceService?: WorkspaceService;

  constructor(registry: LlmRegistry, db?: Db, embeddingService?: EmbeddingService, workspaceService?: WorkspaceService) {
    super("doc-writer", registry, db, embeddingService);
    this.workspaceService = workspaceService;
  }

  getSystemPrompt(context: SpecialistContext): string {
    const hasWorkspace = !!this.workspaceService;
    return `You are a documentation specialist agent working on a larger goal: "${context.goalTitle}".

Your job is to analyze code and produce high-quality documentation: READMEs, API docs, inline JSDoc/TSDoc comments, architecture overviews, and usage guides.

Approach:
1. Read the relevant source files to understand the code structure${hasWorkspace ? " using read_file and list_directory" : ""}
2. Search for existing docs and conventions — don't duplicate
3. Search the web for framework-specific documentation standards when relevant
4. Recall any project memories for context on architecture decisions
5. Write clear, accurate documentation that stays current with the code

Guidelines:
- Write for the target audience: developers who need to understand and use the code
- Include practical examples over abstract descriptions
- For README files: purpose, setup instructions, usage examples, API reference
- For API docs: endpoint, method, parameters, response format, error cases
- For JSDoc/TSDoc: describe the "why", not the "what" — the code shows the "what"
- Keep docs concise — every sentence should add value
- Use consistent formatting: headings, code blocks, bullet points
- Flag any code that lacks clear intent — suggest both docs and code improvements
- When writing inline docs, match the existing style in the codebase`;
  }

  getTools(): LlmTool[] {
    const tools: LlmTool[] = [SEARCH_WEB_TOOL, RECALL_MEMORIES_TOOL];

    if (this.workspaceService) {
      tools.push(READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL);
    }

    return tools;
  }

  protected override async executeTool(
    block: LlmToolUseContent,
    context: SpecialistContext,
  ): Promise<unknown> {
    switch (block.name) {
      case "search_web": {
        const input = block.input as { query: string; max_results?: number };
        return executeWebSearch(input.query, input.max_results);
      }

      case "recall_memories": {
        if (!context.userId || !this.db) return { error: "No user context available" };
        const input = block.input as { category?: string; query?: string };

        if (input.query && this.embeddingService) {
          try {
            const queryEmbedding = await this.embeddingService.embed(input.query);
            const results = await searchMemoriesByVector(this.db, queryEmbedding, context.userId, 10);
            if (results.length > 0) {
              return results.map((m) => ({
                key: m.key,
                category: m.category,
                content: m.content,
                distance: m.distance,
              }));
            }
          } catch (err) {
            this.logger.warn({ err }, "vector search failed, falling back to text search");
          }
        }

        const memories = await recallMemories(this.db, context.userId, input);
        return memories.map((m) => ({
          key: m.key,
          category: m.category,
          content: m.content,
        }));
      }

      case "read_file": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { path } = block.input as { path: string };
        try {
          const content = await this.workspaceService.readFile(path);
          return { path, content };
        } catch (err) {
          return { error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "write_file": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { path, content } = block.input as { path: string; content: string };
        try {
          await this.workspaceService.writeFile(path, content);
          return { success: true, path };
        } catch (err) {
          return { error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "list_directory": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { path } = block.input as { path?: string };
        try {
          const entries = await this.workspaceService.listDirectory(path ?? ".");
          return { entries };
        } catch (err) {
          return { error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      default:
        return { error: `Unknown tool: ${block.name}` };
    }
  }
}
