import { getCloudflareContext } from "@opennextjs/cloudflare";

type RequiredEnvKey = "API_URL" | "AUTH_KEY";

function readCloudflareEnv(name: RequiredEnvKey) {
  try {
    const env = getCloudflareContext().env as Record<string, string | undefined>;
    const value = env[name]?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function readNodeEnv(name: RequiredEnvKey) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readEnv(name: RequiredEnvKey) {
  const value = readCloudflareEnv(name) ?? readNodeEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getServerEnv() {
  return {
    apiUrl: readEnv("API_URL").replace(/\/$/, ""),
    authKey: readEnv("AUTH_KEY"),
  };
}
