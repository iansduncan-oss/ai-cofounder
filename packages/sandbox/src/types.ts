/** Supported languages for sandboxed execution */
export type SandboxLanguage = "typescript" | "javascript" | "python" | "bash";

/** Request to execute code in a sandbox */
export interface ExecutionRequest {
  /** Code to execute */
  code: string;
  /** Language of the code */
  language: SandboxLanguage;
  /** Execution timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Optional task ID for tracking */
  taskId?: string;
  /** Optional dependencies to install before execution */
  dependencies?: string[];
}

/** Result of a sandboxed code execution */
export interface ExecutionResult {
  /** Standard output from the execution */
  stdout: string;
  /** Standard error output */
  stderr: string;
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Language used */
  language: SandboxLanguage;
  /** Whether the execution was killed due to timeout */
  timedOut: boolean;
  /** Whether the container was killed due to OOM (exit code 137) */
  oomKilled: boolean;
  /** Whether result was served from cache */
  cached?: boolean;
}

/** Configuration for the sandbox service */
export interface SandboxConfig {
  /** Memory limit for containers (default: "256m") */
  memoryLimit?: string;
  /** CPU limit for containers (default: "0.5") */
  cpuLimit?: string;
  /** Process ID limit for containers (default: "64") */
  pidsLimit?: string;
  /** Default execution timeout in ms (default: 30000) */
  defaultTimeoutMs?: number;
  /** Whether Docker is available (set at init) */
  dockerAvailable?: boolean;
}
