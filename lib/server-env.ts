import { getCloudflareContext } from "@opennextjs/cloudflare";

type RequiredEnvKey = "API_URL" | "AUTH_KEY";

function readProcessEnv(name: RequiredEnvKey) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

async function readCloudflareEnv(name: RequiredEnvKey) {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const value = (env as Record<string, string | undefined>)[name]?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

async function readEnv(name: RequiredEnvKey) {
  const value = readProcessEnv(name) ?? (await readCloudflareEnv(name));
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function getServerEnv() {
  return {
    apiUrl: (await readEnv("API_URL")).replace(/\/$/, ""),
    authKey: await readEnv("AUTH_KEY"),
  };
}
