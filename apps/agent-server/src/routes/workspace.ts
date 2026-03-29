import { execFile } from "node:child_process";
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
    Type.Literal("pull"),
    Type.Literal("branch"),
    Type.Literal("checkout"),
    Type.Literal("push"),
    Type.Literal("run_tests"),
  ]),
  repoUrl: Type.Optional(Type.String()),
  repoDir: Type.Optional(Type.String()),
  directoryName: Type.Optional(Type.String()),
  paths: Type.Optional(Type.Array(Type.String())),
  message: Type.Optional(Type.String()),
  staged: Type.Optional(Type.Boolean()),
  maxCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  remote: Type.Optional(Type.String()),
  branch: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  create: Type.Optional(Type.Boolean()),
  command: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 300000 })),
});

const DeleteFileBody = Type.Object({
  path: Type.String({ minLength: 1 }),
});

const DeleteDirectoryBody = Type.Object({
  path: Type.String({ minLength: 1 }),
  force: Type.Optional(Type.Boolean()),
});

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  /* GET /usage — workspace disk usage */
  app.get(
    "/usage",
    { schema: { tags: ["workspace"] } },
    async () => {
      const rootDir = app.workspaceService.rootDir;
      return new Promise<{ path: string; totalBytes: number; totalHuman: string }>((resolve, _reject) => {
        execFile("du", ["-sb", rootDir], { timeout: 10_000 }, (error, stdout) => {
          if (error) {
            // Fallback: return 0 if du fails (e.g. dir doesn't exist yet)
            return resolve({ path: rootDir, totalBytes: 0, totalHuman: "0B" });
          }
          const bytes = parseInt(stdout.split("\t")[0], 10) || 0;
          const units = ["B", "KB", "MB", "GB"];
          let size = bytes;
          let unitIdx = 0;
          while (size >= 1024 && unitIdx < units.length - 1) {
            size /= 1024;
            unitIdx++;
          }
          const totalHuman = `${size.toFixed(unitIdx === 0 ? 0 : 1)}${units[unitIdx]}`;
          resolve({ path: rootDir, totalBytes: bytes, totalHuman });
        });
      });
    },
  );

  /* POST /files/delete — delete a file */
  app.post<{ Body: typeof DeleteFileBody.static }>(
    "/files/delete",
    { schema: { tags: ["workspace"], body: DeleteFileBody } },
    async (request, reply) => {
      try {
        await app.workspaceService.deleteFile(request.body.path);
        return { deleted: true, path: request.body.path };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("traversal") ? 403 : 404;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  /* POST /directories/delete — delete a directory */
  app.post<{ Body: typeof DeleteDirectoryBody.static }>(
    "/directories/delete",
    { schema: { tags: ["workspace"], body: DeleteDirectoryBody } },
    async (request, reply) => {
      try {
        await app.workspaceService.deleteDirectory(request.body.path, request.body.force);
        return { deleted: true, path: request.body.path };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("traversal") ? 403 : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );
  /* POST /files/read — read a file */
  app.post<{ Body: typeof ReadFileBody.static }>(
    "/files/read",
    { schema: { tags: ["workspace"], body: ReadFileBody } },
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
    { schema: { tags: ["workspace"], body: WriteFileBody } },
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
    { schema: { tags: ["workspace"], querystring: TreeQuery } },
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
    { schema: { tags: ["workspace"], body: GitOperationBody } },
    async (request, reply) => {
      const { operation, repoUrl, repoDir, directoryName, paths, message, staged, maxCount, remote, branch, name, create, command, timeoutMs } = request.body;

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
          case "pull": {
            if (!repoDir) return reply.status(400).send({ error: "repoDir is required for pull" });
            return app.workspaceService.gitPull(repoDir, remote, branch);
          }
          case "branch": {
            if (!repoDir) return reply.status(400).send({ error: "repoDir is required for branch" });
            return app.workspaceService.gitBranch(repoDir, name);
          }
          case "checkout": {
            if (!repoDir || !branch) {
              return reply.status(400).send({ error: "repoDir and branch are required for checkout" });
            }
            return app.workspaceService.gitCheckout(repoDir, branch, create);
          }
          case "push": {
            if (!repoDir) return reply.status(400).send({ error: "repoDir is required for push" });
            return app.workspaceService.gitPush(repoDir, remote, branch);
          }
          case "run_tests": {
            if (!repoDir) return reply.status(400).send({ error: "repoDir is required for run_tests" });
            return app.workspaceService.runTests(repoDir, command, timeoutMs);
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
