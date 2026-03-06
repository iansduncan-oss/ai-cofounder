import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";

const ReadFileBody = Type.Object({
  path: Type.String({ minLength: 1 }),
});

const WriteFileBody = Type.Object({
  path: Type.String({ minLength: 1 }),
  content: Type.String(),
});

const TreeQuery = Type.Object({
  path: Type.Optional(Type.String()),
});

const GitOperationBody = Type.Object({
  operation: Type.Union([
    Type.Literal("clone"),
    Type.Literal("status"),
    Type.Literal("diff"),
    Type.Literal("add"),
    Type.Literal("commit"),
    Type.Literal("log"),
  ]),
  repoUrl: Type.Optional(Type.String()),
  repoDir: Type.Optional(Type.String()),
  directoryName: Type.Optional(Type.String()),
  paths: Type.Optional(Type.Array(Type.String())),
  message: Type.Optional(Type.String()),
  staged: Type.Optional(Type.Boolean()),
  maxCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  /* POST /files/read — read a file */
  app.post<{ Body: typeof ReadFileBody.static }>(
    "/files/read",
    { schema: { body: ReadFileBody } },
    async (request, reply) => {
      try {
        const content = await app.workspaceService.readFile(request.body.path);
        return { path: request.body.path, content };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("traversal") ? 403 : 404;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  /* POST /files/write — write a file */
  app.post<{ Body: typeof WriteFileBody.static }>(
    "/files/write",
    { schema: { body: WriteFileBody } },
    async (request, reply) => {
      try {
        await app.workspaceService.writeFile(request.body.path, request.body.content);
        return { written: true, path: request.body.path };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("traversal") ? 403 : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  /* GET /tree — list directory */
  app.get<{ Querystring: typeof TreeQuery.static }>(
    "/tree",
    { schema: { querystring: TreeQuery } },
    async (request, reply) => {
      try {
        const entries = await app.workspaceService.listDirectory(request.query.path);
        return { path: request.query.path ?? ".", entries };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("traversal") ? 403 : 404;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  /* POST /git — git operations */
  app.post<{ Body: typeof GitOperationBody.static }>(
    "/git",
    { schema: { body: GitOperationBody } },
    async (request, reply) => {
      const { operation, repoUrl, repoDir, directoryName, paths, message, staged, maxCount } = request.body;

      try {
        switch (operation) {
          case "clone": {
            if (!repoUrl) return reply.status(400).send({ error: "repoUrl is required for clone" });
            return app.workspaceService.gitClone(repoUrl, directoryName);
          }
          case "add": {
            if (!repoDir || !paths?.length) {
              return reply.status(400).send({ error: "repoDir and paths are required for add" });
            }
            return app.workspaceService.gitAdd(repoDir, paths);
          }
          case "status": {
            if (!repoDir) return reply.status(400).send({ error: "repoDir is required for status" });
            return app.workspaceService.gitStatus(repoDir);
          }
          case "diff": {
            if (!repoDir) return reply.status(400).send({ error: "repoDir is required for diff" });
            return app.workspaceService.gitDiff(repoDir, staged);
          }
          case "commit": {
            if (!repoDir || !message) {
              return reply.status(400).send({ error: "repoDir and message are required for commit" });
            }
            return app.workspaceService.gitCommit(repoDir, message);
          }
          case "log": {
            if (!repoDir) return reply.status(400).send({ error: "repoDir is required for log" });
            return app.workspaceService.gitLog(repoDir, maxCount);
          }
          default:
            return reply.status(400).send({ error: `Unknown operation: ${operation}` });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("traversal") ? 403 : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );
};
