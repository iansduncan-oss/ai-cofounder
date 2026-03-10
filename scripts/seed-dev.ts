#!/usr/bin/env npx tsx
/**
 * Seed script for local development / demo.
 *
 * Usage:
 *   DATABASE_URL=postgresql://ai_cofounder:localdev@localhost:5432/ai_cofounder npx tsx scripts/seed-dev.ts
 *
 * Creates: 1 user, 1 conversation, 5 goals, ~15 tasks, ~10 memories, 2 milestones.
 */

import {
  createDb,
  findOrCreateUser,
  createConversation,
  createGoal,
  createTask,
  saveMemory,
  createMilestone,
  assignGoalToMilestone,
  updateGoalStatus,
} from "@ai-cofounder/db";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(DATABASE_URL);

async function seed() {
  console.log("Seeding development database...\n");

  // ── User & Conversation ──
  const user = await findOrCreateUser(db, "dashboard-user", "dashboard", "Dev User");
  console.log(`  User: ${user.id} (${user.displayName})`);

  const conversation = await createConversation(db, {
    userId: user.id,
    title: "Dev Workspace",
  });
  console.log(`  Conversation: ${conversation.id}`);

  // ── Milestones ──
  const m1 = await createMilestone(db, {
    conversationId: conversation.id,
    title: "MVP Launch",
    description: "Core features for initial release",
    orderIndex: 0,
    createdBy: user.id,
  });

  const m2 = await createMilestone(db, {
    conversationId: conversation.id,
    title: "Growth & Polish",
    description: "Post-MVP improvements and scaling",
    orderIndex: 1,
    createdBy: user.id,
  });
  console.log(`  Milestones: ${m1.id}, ${m2.id}`);

  // ── Goals ──
  const goals = await Promise.all([
    createGoal(db, {
      conversationId: conversation.id,
      title: "Set up CI/CD pipeline",
      description: "Configure GitHub Actions for automated testing and deployment to Hetzner VPS",
      priority: "high",
      createdBy: user.id,
      milestoneId: m1.id,
    }),
    createGoal(db, {
      conversationId: conversation.id,
      title: "Implement user authentication",
      description: "Add JWT-based auth with login, signup, and session management",
      priority: "critical",
      createdBy: user.id,
      milestoneId: m1.id,
    }),
    createGoal(db, {
      conversationId: conversation.id,
      title: "Build dashboard analytics page",
      description: "Create a dashboard page showing goal progress, task metrics, and LLM usage charts",
      priority: "medium",
      createdBy: user.id,
      milestoneId: m1.id,
    }),
    createGoal(db, {
      conversationId: conversation.id,
      title: "Add email notification system",
      description: "Send email notifications for goal completions, approval requests, and daily briefings",
      priority: "low",
      createdBy: user.id,
      milestoneId: m2.id,
    }),
    createGoal(db, {
      conversationId: conversation.id,
      title: "Performance optimization sprint",
      description: "Profile and optimize database queries, reduce API response times, add caching",
      priority: "medium",
      createdBy: user.id,
      milestoneId: m2.id,
    }),
  ]);

  // Mark first goal as completed, second as active
  await updateGoalStatus(db, goals[0].id, "completed");
  await updateGoalStatus(db, goals[1].id, "active");

  console.log(`  Goals: ${goals.map((g) => g.id).join(", ")}`);

  // ── Tasks ──
  const taskDefs: Array<{
    goalIndex: number;
    title: string;
    description: string;
    agent: "planner" | "coder" | "reviewer" | "researcher" | "debugger";
    orderIndex: number;
  }> = [
    // Goal 0: CI/CD
    { goalIndex: 0, title: "Research GitHub Actions best practices", description: "Survey CI/CD patterns for Node.js monorepos", agent: "researcher", orderIndex: 0 },
    { goalIndex: 0, title: "Create CI workflow file", description: "Write .github/workflows/ci.yml with build, lint, and test steps", agent: "coder", orderIndex: 1 },
    { goalIndex: 0, title: "Create deploy workflow", description: "Write deploy.yml that SSHs to VPS and runs docker compose", agent: "coder", orderIndex: 2 },
    // Goal 1: Auth
    { goalIndex: 1, title: "Design auth schema and API", description: "Plan the authentication endpoints and data model", agent: "planner", orderIndex: 0 },
    { goalIndex: 1, title: "Implement JWT middleware", description: "Create Fastify plugin for JWT verification", agent: "coder", orderIndex: 1 },
    { goalIndex: 1, title: "Build login/signup endpoints", description: "POST /api/auth/login and /api/auth/signup routes", agent: "coder", orderIndex: 2 },
    { goalIndex: 1, title: "Review auth implementation", description: "Security review of authentication code", agent: "reviewer", orderIndex: 3 },
    // Goal 2: Dashboard
    { goalIndex: 2, title: "Design analytics page wireframe", description: "Create component layout for the analytics page", agent: "planner", orderIndex: 0 },
    { goalIndex: 2, title: "Build chart components", description: "Create reusable chart components with recharts", agent: "coder", orderIndex: 1 },
    { goalIndex: 2, title: "Connect to API endpoints", description: "Wire up TanStack Query hooks for analytics data", agent: "coder", orderIndex: 2 },
    // Goal 3: Email
    { goalIndex: 3, title: "Research email providers", description: "Compare SendGrid, Resend, and SES for transactional email", agent: "researcher", orderIndex: 0 },
    { goalIndex: 3, title: "Implement email service", description: "Create EmailService with templates for each notification type", agent: "coder", orderIndex: 1 },
    // Goal 4: Performance
    { goalIndex: 4, title: "Profile slow database queries", description: "Use EXPLAIN ANALYZE to identify and fix slow queries", agent: "debugger", orderIndex: 0 },
    { goalIndex: 4, title: "Add Redis caching layer", description: "Cache frequently accessed data like provider health and dashboard summaries", agent: "coder", orderIndex: 1 },
    { goalIndex: 4, title: "Review performance changes", description: "Validate optimization results with before/after benchmarks", agent: "reviewer", orderIndex: 2 },
  ];

  const createdTasks = [];
  for (const td of taskDefs) {
    const task = await createTask(db, {
      goalId: goals[td.goalIndex].id,
      title: td.title,
      description: td.description,
      assignedAgent: td.agent,
      orderIndex: td.orderIndex,
    });
    createdTasks.push(task);
  }
  console.log(`  Tasks: ${createdTasks.length} created`);

  // ── Memories ──
  const memoryDefs: Array<{ category: "technical" | "preferences" | "decisions" | "business" | "projects" | "other"; key: string; content: string }> = [
    { category: "technical", key: "monorepo-structure", content: "The project uses Turborepo with apps/ and packages/ directories. Build order: shared → db → llm → queue → api-client → bot-handlers → agent-server." },
    { category: "preferences", key: "code-style", content: "User prefers functional patterns over classes where possible. Uses async/await consistently, avoids callbacks." },
    { category: "decisions", key: "llm-provider-strategy", content: "Primary: Anthropic Claude for planning and conversation. Fallback: Groq for simple tasks, Gemini for research, OpenRouter as last resort." },
    { category: "technical", key: "testing-strategy", content: "All tests use vitest. Mock @ai-cofounder/db, @ai-cofounder/llm, and @ai-cofounder/shared. Import modules dynamically after mocks." },
    { category: "business", key: "target-users", content: "Solo founders and small teams who want an AI assistant that can plan, code, and coordinate multi-step projects." },
    { category: "preferences", key: "deployment-method", content: "Deploy via Docker Compose on Hetzner VPS. CI pushes to main trigger auto-deploy. Nginx Proxy Manager handles TLS." },
    { category: "decisions", key: "database-choice", content: "PostgreSQL 16 with pgvector extension for semantic memory. Drizzle ORM for type-safe queries and migrations." },
    { category: "technical", key: "queue-system", content: "BullMQ with Redis for background jobs: agent-tasks, monitoring, briefings, notifications, and pipeline execution." },
    { category: "business", key: "pricing-model", content: "Planning freemium model: free tier with limited daily tokens, paid tier with higher limits and priority queue." },
    { category: "preferences", key: "communication-style", content: "User prefers concise updates. Skip preamble, lead with results. Use markdown formatting for code references." },
  ];

  for (const mem of memoryDefs) {
    await saveMemory(db, {
      userId: user.id,
      category: mem.category,
      key: mem.key,
      content: mem.content,
    });
  }
  console.log(`  Memories: ${memoryDefs.length} created`);

  // Link goals to milestones (already done via createGoal milestoneId param)
  // But let's also link via the explicit function for the remaining ones
  await assignGoalToMilestone(db, goals[0].id, m1.id);
  await assignGoalToMilestone(db, goals[1].id, m1.id);
  await assignGoalToMilestone(db, goals[2].id, m1.id);
  await assignGoalToMilestone(db, goals[3].id, m2.id);
  await assignGoalToMilestone(db, goals[4].id, m2.id);

  console.log("\nSeed complete!");
  console.log(`  Summary: 1 user, 1 conversation, 2 milestones, 5 goals, ${createdTasks.length} tasks, ${memoryDefs.length} memories`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
