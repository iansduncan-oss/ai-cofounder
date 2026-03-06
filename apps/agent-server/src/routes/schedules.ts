import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  createSchedule,
  listSchedules,
  getSchedule,
  deleteSchedule,
  toggleSchedule,
} from "@ai-cofounder/db";
import { CronExpressionParser } from "cron-parser";
import { IdParams } from "../schemas.js";

const CreateScheduleBody = Type.Object({
  cronExpression: Type.String({ minLength: 1 }),
  actionPrompt: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String({ format: "uuid" })),
});

const ToggleScheduleBody = Type.Object({
  enabled: Type.Boolean(),
});

export const scheduleRoutes: FastifyPluginAsync = async (app) => {
  /* POST / — create a schedule */
  app.post<{ Body: typeof CreateScheduleBody.static }>(
    "/",
    { schema: { body: CreateScheduleBody } },
    async (request, reply) => {
      const { cronExpression, actionPrompt, description, userId } = request.body;

      // Validate cron expression
      try {
        const interval = CronExpressionParser.parse(cronExpression);
        const nextRunAt = interval.next().toDate();

        const schedule = await createSchedule(app.db, {
          cronExpression,
          actionPrompt,
          description,
          userId,
          enabled: true,
          nextRunAt,
        });
        return reply.status(201).send(schedule);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: `Invalid cron expression: ${msg}` });
      }
    },
  );

  /* GET / — list schedules */
  app.get<{ Querystring: { userId?: string } }>(
    "/",
    async (request) => {
      return listSchedules(app.db, request.query.userId);
    },
  );

  /* GET /:id — get a single schedule */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { params: IdParams } },
    async (request, reply) => {
      const schedule = await getSchedule(app.db, request.params.id);
      if (!schedule) return reply.status(404).send({ error: "Schedule not found" });
      return schedule;
    },
  );

  /* PATCH /:id/toggle — enable/disable a schedule */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof ToggleScheduleBody.static;
  }>(
    "/:id/toggle",
    { schema: { params: IdParams, body: ToggleScheduleBody } },
    async (request, reply) => {
      const schedule = await toggleSchedule(app.db, request.params.id, request.body.enabled);
      if (!schedule) return reply.status(404).send({ error: "Schedule not found" });
      return schedule;
    },
  );

  /* DELETE /:id — delete a schedule */
  app.delete<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { params: IdParams } },
    async (request, reply) => {
      const deleted = await deleteSchedule(app.db, request.params.id);
      if (!deleted) return reply.status(404).send({ error: "Schedule not found" });
      return { deleted: true };
    },
  );
};
