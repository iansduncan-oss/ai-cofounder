import { createDb } from "./client.js";
import {
  users,
  conversations,
  messages,
  goals,
  tasks,
  memories,
  milestones,
  personas,
  events,
  schedules,
  n8nWorkflows,
} from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(DATABASE_URL);

async function seed() {
  console.log("Seeding database...");

  // Users
  const [dashboardUser] = await db
    .insert(users)
    .values([
      { externalId: "dashboard-user", platform: "dashboard", displayName: "Ian" },
      { externalId: "discord-user-1", platform: "discord", displayName: "TestUser" },
      { externalId: "slack-user-1", platform: "slack", displayName: "SlackDev" },
    ])
    .onConflictDoNothing()
    .returning();

  if (!dashboardUser) {
    console.log("Users already seeded, skipping...");
    process.exit(0);
  }

  console.log(`  Created ${3} users`);

  // Conversations
  const [conv1, conv2] = await db
    .insert(conversations)
    .values([
      { userId: dashboardUser.id, title: "Project Planning" },
      { userId: dashboardUser.id, title: "Bug Investigation" },
    ])
    .returning();

  console.log(`  Created ${2} conversations`);

  // Messages
  await db.insert(messages).values([
    { conversationId: conv1.id, role: "user", content: "Let's plan the next sprint" },
    { conversationId: conv1.id, role: "agent", agentRole: "orchestrator", content: "I'll help you plan the sprint. Let me break down the priorities." },
    { conversationId: conv1.id, role: "agent", agentRole: "planner", content: "Based on the backlog, I recommend focusing on: 1) RAG pipeline 2) Dashboard auth 3) Cost tracking" },
    { conversationId: conv2.id, role: "user", content: "The deploy failed last night" },
    { conversationId: conv2.id, role: "agent", agentRole: "debugger", content: "Let me check the deploy logs and CI status." },
  ]);
  console.log(`  Created ${5} messages`);

  // Milestones
  const [milestone1] = await db
    .insert(milestones)
    .values([
      {
        title: "v0.2.0 — JARVIS Intelligence",
        description: "Add RAG, cost-aware routing, circuit breakers, and enhanced monitoring",
        status: "in_progress",
      },
      {
        title: "v0.3.0 — Collaboration",
        description: "Multi-user, shared goals, OAuth, role-based access",
        status: "planned",
      },
    ])
    .returning();

  console.log(`  Created ${2} milestones`);

  // Goals
  const [goal1, goal2, goal3] = await db
    .insert(goals)
    .values([
      {
        conversationId: conv1.id,
        title: "Implement RAG pipeline",
        description: "Wire packages/rag into orchestrator for document retrieval",
        status: "active",
        priority: "high",
        createdBy: dashboardUser.id,
        milestoneId: milestone1.id,
      },
      {
        conversationId: conv1.id,
        title: "Add cost-aware LLM routing",
        description: "Factor $/token into provider resolution",
        status: "completed",
        priority: "high",
        createdBy: dashboardUser.id,
        milestoneId: milestone1.id,
      },
      {
        conversationId: conv2.id,
        title: "Fix deploy health check timeout",
        description: "Health check fails intermittently on slow starts",
        status: "active",
        priority: "critical",
        createdBy: dashboardUser.id,
      },
    ])
    .returning();

  console.log(`  Created ${3} goals`);

  // Tasks
  await db.insert(tasks).values([
    { goalId: goal1.id, title: "Review existing RAG package API", assignedAgent: "researcher", status: "completed", orderIndex: 0, output: "RAG package has chunker, ingester, and retriever modules" },
    { goalId: goal1.id, title: "Wire RAG into orchestrator recall_memories", assignedAgent: "coder", status: "pending", orderIndex: 1 },
    { goalId: goal1.id, title: "Add ingestion queue processor", assignedAgent: "coder", status: "pending", orderIndex: 2 },
    { goalId: goal2.id, title: "Add MODEL_COSTS data structure", assignedAgent: "coder", status: "completed", orderIndex: 0, output: "Added cost-per-token data for all providers" },
    { goalId: goal2.id, title: "Update resolveProvider with cost factor", assignedAgent: "coder", status: "completed", orderIndex: 1, output: "Cost tracking added to complete() method" },
    { goalId: goal3.id, title: "Investigate health check timing", assignedAgent: "debugger", status: "running", orderIndex: 0 },
  ]);
  console.log(`  Created ${6} tasks`);

  // Memories
  await db.insert(memories).values([
    { userId: dashboardUser.id, key: "project-stack", content: "AI Cofounder uses Turborepo with Fastify, React, Drizzle ORM, BullMQ, and multi-LLM routing", category: "technical", importance: 9 },
    { userId: dashboardUser.id, key: "deploy-process", content: "Push to main triggers CI, green CI triggers deploy to Hetzner VPS via Tailscale SSH", category: "process", importance: 8 },
    { userId: dashboardUser.id, key: "user-preference-testing", content: "User prefers comprehensive test coverage. Always write tests for new features.", category: "preference", importance: 7 },
  ]);
  console.log(`  Created ${3} memories`);

  // Personas
  await db.insert(personas).values([
    {
      name: "JARVIS",
      description: "Primary AI assistant with dry wit and proactive monitoring",
      systemPrompt: "You are JARVIS, an AI cofounder assistant. You are efficient, insightful, and occasionally witty. You proactively monitor systems and suggest improvements.",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      isDefault: true,
    },
  ]);
  console.log(`  Created ${1} persona`);

  // Schedules
  await db.insert(schedules).values([
    {
      userId: dashboardUser.id,
      name: "Morning briefing",
      description: "Daily summary of overnight activity, CI status, and priorities",
      cronExpression: "0 9 * * *",
      action: "briefing",
      enabled: true,
    },
    {
      userId: dashboardUser.id,
      name: "Weekly retrospective",
      description: "Analyze completed goals, extract patterns, suggest improvements",
      cronExpression: "0 15 * * 5",
      action: "reflection",
      enabled: true,
    },
  ]);
  console.log(`  Created ${2} schedules`);

  // Events
  await db.insert(events).values([
    { source: "github", type: "push", payload: { ref: "refs/heads/main", commits: 3 } },
    { source: "github", type: "ci_pass", payload: { workflow: "CI", conclusion: "success" } },
    { source: "cron", type: "monitoring", payload: { check: "vps_health", status: "ok" } },
  ]);
  console.log(`  Created ${3} events`);

  // n8n Workflows
  await db
    .insert(n8nWorkflows)
    .values([
      {
        name: "Enhanced GitHub Issue Pipeline",
        description: "Classifies GitHub issues (bug/feature/question), auto-labels, creates prioritized goals, and notifies Discord",
        webhookUrl: "http://localhost:5678/webhook/github-issue",
        direction: "inbound",
        eventType: "issue_opened",
        isActive: true,
      },
      {
        name: "Deploy Failure Alerts",
        description: "Sends Discord alert and triggers agent investigation when a deploy fails",
        webhookUrl: "http://localhost:5678/webhook/deploy-alert",
        direction: "inbound",
        eventType: "workflow_failure",
        isActive: true,
      },
      {
        name: "Weekly LLM Cost Digest",
        description: "Superseded by Weekly Digest — fetches weekly usage stats every Monday at 9 AM",
        webhookUrl: "http://localhost:5678/webhook/cost-digest",
        direction: "outbound",
        eventType: "scheduled",
        isActive: false,
      },
      {
        name: "Smart Error Triage",
        description: "Receives Alertmanager webhooks, deduplicates alerts (30min window), enriches with error context, and sends classified Discord embeds",
        webhookUrl: "http://localhost:5678/webhook/alertmanager-triage",
        direction: "inbound",
        eventType: "alert_fired",
        isActive: true,
      },
      {
        name: "Weekly Digest",
        description: "Comprehensive weekly report: commits by type, deploy stats, error summary, and LLM cost data — posted to Discord and Slack",
        webhookUrl: "http://localhost:5678/webhook/weekly-digest",
        direction: "outbound",
        eventType: "scheduled",
        isActive: true,
      },
      {
        name: "System Health Rollup",
        description: "Daily 7:30 AM health check: system status, VPS resources, SSL certs, backups, errors, and active alerts — single Discord embed",
        webhookUrl: "http://localhost:5678/webhook/health-rollup",
        direction: "outbound",
        eventType: "scheduled",
        isActive: true,
      },
    ])
    .onConflictDoNothing();
  console.log(`  Created ${6} n8n workflows`);

  console.log("\nSeed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
