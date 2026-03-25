#!/usr/bin/env node
/**
 * One-shot script to create Uptime Kuma monitors via Socket.io API.
 * Idempotent — skips monitors that already exist by name.
 *
 * Usage:
 *   UPTIME_KUMA_USER=admin UPTIME_KUMA_PASSWORD=secret node infra/scripts/setup-uptime-kuma.mjs
 *
 * Options:
 *   UPTIME_KUMA_URL  — Socket.io URL (default: http://localhost:3001)
 */

import { io } from "socket.io-client";

const KUMA_URL = process.env.UPTIME_KUMA_URL || "http://localhost:3001";
const USERNAME = process.env.UPTIME_KUMA_USER;
const PASSWORD = process.env.UPTIME_KUMA_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error("Error: UPTIME_KUMA_USER and UPTIME_KUMA_PASSWORD are required");
  process.exit(1);
}

// --- Monitor definitions ---

const HTTP_MONITORS = [
  {
    name: "AI Cofounder API",
    url: "https://api.aviontechs.com/health",
    type: "keyword",
    keyword: '"status"',
    interval: 60,
  },
  {
    name: "AI Cofounder Deep Health",
    url: "https://api.aviontechs.com/health/deep",
    type: "keyword",
    keyword: '"ok"',
    interval: 60,
  },
  {
    name: "Dashboard",
    url: "https://app.aviontechs.com/dashboard/",
    type: "http",
    interval: 60,
  },
  {
    name: "n8n",
    url: "https://n8n.aviontechs.com",
    type: "http",
    interval: 60,
  },
  {
    name: "Grafana",
    url: "https://grafana.aviontechs.com",
    type: "http",
    interval: 60,
  },
  {
    name: "Status Page",
    url: "https://status.aviontechs.com",
    type: "http",
    interval: 60,
  },
];

const TCP_MONITORS = [
  { name: "Redis", hostname: "redis", port: 6379, interval: 60 },
  { name: "PostgreSQL", hostname: "avion-postgres-1", port: 5432, interval: 60 },
];

// --- Socket.io helpers ---

function emit(socket, event, data) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout on ${event}`)), 15_000);
    socket.emit(event, data, (res) => {
      clearTimeout(timeout);
      if (res.ok) {
        resolve(res);
      } else {
        reject(new Error(res.msg || `${event} failed`));
      }
    });
  });
}

async function run() {
  console.log(`Connecting to Uptime Kuma at ${KUMA_URL}...`);

  const socket = io(KUMA_URL, { reconnection: false, timeout: 10_000 });

  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", (err) => reject(new Error(`Connection failed: ${err.message}`)));
  });

  // Check if initial setup is needed (no admin account yet)
  const needSetup = await new Promise((resolve) => {
    socket.emit("needSetup", (needSetup) => resolve(needSetup));
  });

  if (needSetup) {
    console.log("First-time setup detected. Creating admin account...");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout on setup")), 15_000);
      socket.emit("setup", USERNAME, PASSWORD, (res) => {
        clearTimeout(timeout);
        if (res.ok) resolve(res);
        else reject(new Error(res.msg || "setup failed"));
      });
    });
    console.log("Admin account created.");
  }

  console.log("Logging in...");

  const loginRes = await emit(socket, "login", {
    username: USERNAME,
    password: PASSWORD,
    token: "",
  });

  if (!loginRes.ok) {
    throw new Error("Login failed");
  }
  console.log("Logged in.");

  // Get existing monitors to check for duplicates
  const existingMonitors = await new Promise((resolve) => {
    socket.emit("getMonitorList", (res) => resolve(res));
  });

  const existingNames = new Set(
    Object.values(existingMonitors).map((m) => m.name),
  );

  const createdIds = [];

  // Create HTTP monitors
  for (const mon of HTTP_MONITORS) {
    if (existingNames.has(mon.name)) {
      console.log(`  SKIP: "${mon.name}" already exists`);
      // Find existing ID for status page
      const existing = Object.values(existingMonitors).find((m) => m.name === mon.name);
      if (existing) createdIds.push(existing.id);
      continue;
    }

    const monitorData = {
      type: mon.type === "keyword" ? "keyword" : "http",
      name: mon.name,
      url: mon.url,
      interval: mon.interval,
      retryInterval: 60,
      maxretries: 3,
      accepted_statuscodes: ["200-299"],
      notificationIDList: {},
      ...(mon.type === "keyword" ? { keyword: mon.keyword } : {}),
    };

    const res = await emit(socket, "add", monitorData);
    console.log(`  CREATED: "${mon.name}" (id: ${res.monitorID})`);
    createdIds.push(res.monitorID);
  }

  // Create TCP monitors
  for (const mon of TCP_MONITORS) {
    if (existingNames.has(mon.name)) {
      console.log(`  SKIP: "${mon.name}" already exists`);
      const existing = Object.values(existingMonitors).find((m) => m.name === mon.name);
      if (existing) createdIds.push(existing.id);
      continue;
    }

    const monitorData = {
      type: "port",
      name: mon.name,
      hostname: mon.hostname,
      port: mon.port,
      interval: mon.interval,
      retryInterval: 60,
      maxretries: 3,
      accepted_statuscodes: ["200-299"],
      notificationIDList: {},
    };

    const res = await emit(socket, "add", monitorData);
    console.log(`  CREATED: "${mon.name}" (id: ${res.monitorID})`);
    createdIds.push(res.monitorID);
  }

  // Create status page if it doesn't exist
  console.log("\nSetting up status page...");
  try {
    // Try to save the status page config (creates or updates)
    const statusPageSlug = "avion";

    // First try to add the status page
    try {
      await emit(socket, "addStatusPage", { title: "Avion Technologies", slug: statusPageSlug });
      console.log("  CREATED: Status page 'Avion Technologies'");
    } catch {
      console.log("  Status page already exists, updating...");
    }

    // Build the monitor list for the status page
    const publicGroupList = [
      {
        name: "Services",
        weight: 1,
        monitorList: createdIds.map((id) => ({ id })),
      },
    ];

    await emit(socket, "saveStatusPage", {
      slug: statusPageSlug,
      title: "Avion Technologies",
      description: "Service status for Avion Technologies",
      publicGroupList,
      showPoweredBy: false,
    });
    console.log("  Status page updated with all monitors.");
  } catch (err) {
    console.warn(`  Warning: Status page setup failed — ${err.message}`);
    console.warn("  You may need to create it manually in the UI.");
  }

  console.log(`\nDone. ${createdIds.length} monitors configured.`);
  socket.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
