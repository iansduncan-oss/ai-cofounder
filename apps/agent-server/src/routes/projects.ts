import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Type } from "@sinclair/typebox";
import {
  listRegisteredProjects,
  createRegisteredProject,
  getRegisteredProjectById,
  updateRegisteredProject,
  deleteRegisteredProject,
  createProjectDependency,
  listProjectDependencies,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("projects-routes");

const projectLanguageValues = ["typescript", "python", "javascript", "go", "other"] as const;

const CreateProjectBody = Type.Object({
  name: Type.String({ minLength: 1, description: "Project name" }),
  workspacePath: Type.String({ minLength: 1, description: "Absolute path to project root" }),
  repoUrl: Type.Optional(Type.String({ description: "Git remote URL" })),
  description: Type.Optional(Type.String({ description: "Project description" })),
  language: Type.Optional(Type.Union(projectLanguageValues.map((v) => Type.Literal(v)), { description: "Primary programming language" })),
  defaultBranch: Type.Optional(Type.String({ description: "Default git branch" })),
  testCommand: Type.Optional(Type.String({ description: "Test command" })),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Additional config" })),
});

const UpdateProjectBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  workspacePath: Type.Optional(Type.String({ minLength: 1 })),
  repoUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  language: Type.Optional(Type.Union(projectLanguageValues.map((v) => Type.Literal(v)))),
  defaultBranch: Type.Optional(Type.String()),
  testCommand: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  isActive: Type.Optional(Type.Boolean()),
  config: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
});

const CreateDependencyBody = Type.Object({
  targetProjectId: Type.String({ description: "Target project ID" }),
  dependencyType: Type.String({ minLength: 1, description: "Type of dependency (e.g. api_client, shared_library)" }),
  description: Type.Optional(Type.String({ description: "Description of the dependency relationship" })),
});

const IdParams = Type.Object({
  id: Type.String({ description: "Project ID" }),
});

export const projectRoutes = fp(async (app: FastifyInstance) => {
  // GET /api/projects — list all registered projects
  app.get("/api/projects", {
    schema: {
      tags: ["projects"],
      summary: "List registered projects",
    },
  }, async (_req, reply) => {
    try {
      const projects = await listRegisteredProjects(app.db);
      reply.send(projects);
    } catch (err) {
      logger.error({ err }, "failed to list projects");
      reply.status(500).send({ error: "Failed to list projects" });
    }
  });

  // POST /api/projects — create a new project
  app.post<{ Body: typeof CreateProjectBody.static }>("/api/projects", {
    schema: {
      tags: ["projects"],
      summary: "Create a registered project",
      body: CreateProjectBody,
      response: { 201: Type.Record(Type.String(), Type.Unknown()) },
    },
  }, async (req, reply) => {
    try {
      const body = req.body;
      const slug = body.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

      const project = await createRegisteredProject(app.db, {
        name: body.name,
        slug,
        workspacePath: body.workspacePath,
        repoUrl: body.repoUrl,
        description: body.description,
        language: body.language ?? "typescript",
        defaultBranch: body.defaultBranch ?? "main",
        testCommand: body.testCommand,
        config: body.config,
      });

      // Also register with in-memory projectRegistry if available
      if (app.projectRegistry) {
        try {
          await app.projectRegistry.registerProject({
            id: project.id,
            name: project.name,
            slug: project.slug,
            workspacePath: project.workspacePath,
            repoUrl: project.repoUrl,
            description: project.description,
            language: project.language ?? "typescript",
            defaultBranch: project.defaultBranch ?? "main",
            testCommand: project.testCommand,
            config: project.config as Record<string, unknown> | null,
          });
        } catch (regErr) {
          logger.warn({ regErr, projectId: project.id }, "failed to register project in-memory (non-fatal)");
        }
      }

      reply.status(201).send(project);
    } catch (err) {
      logger.error({ err }, "failed to create project");
      reply.status(500).send({ error: "Failed to create project" });
    }
  });

  // GET /api/projects/:id — get single project
  app.get<{ Params: typeof IdParams.static }>("/api/projects/:id", {
    schema: {
      tags: ["projects"],
      summary: "Get a project by ID",
      params: IdParams,
    },
  }, async (req, reply) => {
    try {
      const project = await getRegisteredProjectById(app.db, req.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }
      reply.send(project);
    } catch (err) {
      logger.error({ err }, "failed to get project");
      reply.status(500).send({ error: "Failed to get project" });
    }
  });

  // PUT /api/projects/:id — update project
  app.put<{ Params: typeof IdParams.static; Body: typeof UpdateProjectBody.static }>("/api/projects/:id", {
    schema: {
      tags: ["projects"],
      summary: "Update a project",
      params: IdParams,
      body: UpdateProjectBody,
    },
  }, async (req, reply) => {
    try {
      const updated = await updateRegisteredProject(app.db, req.params.id, req.body);
      if (!updated) {
        return reply.status(404).send({ error: "Project not found" });
      }
      reply.send(updated);
    } catch (err) {
      logger.error({ err }, "failed to update project");
      reply.status(500).send({ error: "Failed to update project" });
    }
  });

  // DELETE /api/projects/:id — soft-delete project
  app.delete<{ Params: typeof IdParams.static }>("/api/projects/:id", {
    schema: {
      tags: ["projects"],
      summary: "Delete a project (soft delete)",
      params: IdParams,
    },
  }, async (req, reply) => {
    try {
      const deleted = await deleteRegisteredProject(app.db, req.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "Project not found" });
      }
      reply.send({ deleted: true, id: req.params.id });
    } catch (err) {
      logger.error({ err }, "failed to delete project");
      reply.status(500).send({ error: "Failed to delete project" });
    }
  });

  // POST /api/projects/:id/dependencies — create dependency link
  app.post<{ Params: typeof IdParams.static; Body: typeof CreateDependencyBody.static }>("/api/projects/:id/dependencies", {
    schema: {
      tags: ["projects"],
      summary: "Create a dependency between projects",
      params: IdParams,
      body: CreateDependencyBody,
    },
  }, async (req, reply) => {
    try {
      const dep = await createProjectDependency(app.db, {
        sourceProjectId: req.params.id,
        targetProjectId: req.body.targetProjectId,
        dependencyType: req.body.dependencyType,
        description: req.body.description,
      });
      reply.status(201).send(dep);
    } catch (err) {
      logger.error({ err }, "failed to create project dependency");
      reply.status(500).send({ error: "Failed to create dependency" });
    }
  });

  // GET /api/projects/:id/dependencies — list dependencies
  app.get<{ Params: typeof IdParams.static }>("/api/projects/:id/dependencies", {
    schema: {
      tags: ["projects"],
      summary: "List project dependencies",
      params: IdParams,
    },
  }, async (req, reply) => {
    try {
      const deps = await listProjectDependencies(app.db, req.params.id);
      reply.send(deps);
    } catch (err) {
      logger.error({ err }, "failed to list project dependencies");
      reply.status(500).send({ error: "Failed to list dependencies" });
    }
  });
});
