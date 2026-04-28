type RequiredEnvKey = "API_URL" | "API_KEY" | "AUTH_KEY";

function readEnv(name: RequiredEnvKey) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getServerEnv() {
  return {
    apiUrl: readEnv("API_URL").replace(/\/$/, ""),
    apiKey: readEnv("API_KEY"),
    authKey: readEnv("AUTH_KEY"),
  };
}
