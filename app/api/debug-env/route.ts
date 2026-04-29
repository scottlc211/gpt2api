import { NextResponse } from "next/server";
import { readRuntimeEnv } from "@/lib/server-env";

export async function GET() {
  try {
    return NextResponse.json(
      {
        ok: true,
        runtime: "nodejs",
        hasApiUrl: Boolean(await readRuntimeEnv("API_URL")),
        hasAuthKey: Boolean(await readRuntimeEnv("AUTH_KEY")),
        nodeEnv:
          typeof process !== "undefined" && typeof process.env?.NODE_ENV === "string"
            ? process.env.NODE_ENV
            : null,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        runtime: "nodejs",
        error: error instanceof Error ? error.message : "debug-env failed",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}
