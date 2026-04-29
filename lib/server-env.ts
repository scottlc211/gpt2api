type RequiredEnvKey = "API_URL" | "AUTH_KEY";

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
    authKey: readEnv("AUTH_KEY"),
  };
}
