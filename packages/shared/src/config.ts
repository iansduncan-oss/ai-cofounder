/** Load a required environment variable or throw */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Load an optional environment variable with a default */
export function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}
