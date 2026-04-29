import { getCloudflareContext } from "@opennextjs/cloudflare";

type RequiredEnvKey = "API_URL" | "AUTH_KEY";
type RuntimeEnvShape = Partial<Record<RequiredEnvKey, string>>;

function readNodeProcessEnv(name: RequiredEnvKey) {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }

  const value = process.env[name];
  return typeof value === "string" ? value.trim() : undefined;
}

async function readCloudflareEnv(name: RequiredEnvKey) {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const value = (env as RuntimeEnvShape | undefined)?.[name];
    return typeof value === "string" ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function readRuntimeEnv(name: RequiredEnvKey) {
  const cloudflareValue = await readCloudflareEnv(name);
  if (cloudflareValue) {
    return cloudflareValue;
  }

  return readNodeProcessEnv(name);
}

async function readRequiredEnv(name: RequiredEnvKey) {
  const value = await readRuntimeEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function getServerEnv() {
  return {
    apiUrl: (await readRequiredEnv("API_URL")).replace(/\/$/, ""),
    authKey: await readRequiredEnv("AUTH_KEY"),
  };
}
