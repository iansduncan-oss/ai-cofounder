import { REST, Routes } from "discord.js";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { askCommand } from "./ask.js";
import { statusCommand } from "./status.js";
import { goalsCommand } from "./goals.js";
import { tasksCommand } from "./tasks.js";
import { memoryCommand } from "./memory.js";
import { clearCommand } from "./clear.js";
import { executeCommand } from "./execute.js";
import { approveCommand } from "./approve.js";
import { helpCommand } from "./help.js";
import { scheduleCommand } from "./schedule.js";
import { gmailCommand } from "./gmail.js";
import { registerUserCommand } from "./register-user.js";
import { approvalsCommand } from "./approvals.js";
import { rejectCommand } from "./reject.js";
import { budgetCommand } from "./budget.js";
import { errorsCommand } from "./errors.js";
import { standupCommand } from "./standup.js";
import { followupsCommand } from "./followups.js";
import { searchCommand } from "./search.js";
import { analyticsCommand } from "./analytics.js";
import { planCommand } from "./plan.js";
import { autoplanCommand } from "./autoplan.js";
import { reflectCommand } from "./reflect.js";
import { streakCommand } from "./streak.js";

const logger = createLogger("discord-commands");

const commands = [
  askCommand.toJSON(),
  statusCommand.toJSON(),
  goalsCommand.toJSON(),
  tasksCommand.toJSON(),
  memoryCommand.toJSON(),
  clearCommand.toJSON(),
  executeCommand.toJSON(),
  approveCommand.toJSON(),
  rejectCommand.toJSON(),
  approvalsCommand.toJSON(),
  budgetCommand.toJSON(),
  errorsCommand.toJSON(),
  standupCommand.toJSON(),
  followupsCommand.toJSON(),
  searchCommand.toJSON(),
  analyticsCommand.toJSON(),
  planCommand.toJSON(),
  autoplanCommand.toJSON(),
  reflectCommand.toJSON(),
  streakCommand.toJSON(),
  helpCommand.toJSON(),
  scheduleCommand.toJSON(),
  gmailCommand.toJSON(),
  registerUserCommand.toJSON(),
];

export async function registerCommands(token: string, clientId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const guildId = optionalEnv("DISCORD_GUILD_ID", "");

  const route =
    guildId.length > 0
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);

  logger.info(
    { count: commands.length, scope: guildId.length > 0 ? "guild" : "global" },
    `registering ${guildId.length > 0 ? "guild" : "global"} slash commands`,
  );

  await rest.put(route, { body: commands });

  logger.info("slash commands registered");
}
