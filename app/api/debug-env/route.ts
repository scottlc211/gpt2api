import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json(
    {
      hasApiUrl: Boolean(process.env.API_URL?.trim()),
      hasAuthKey: Boolean(process.env.AUTH_KEY?.trim()),
      nodeEnv: process.env.NODE_ENV || null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
