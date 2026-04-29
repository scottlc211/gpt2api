import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      ok: true,
      runtime: "edge",
      url: request.url,
      hasProcessGlobal: typeof process !== "undefined",
      hasProcessEnv: typeof process !== "undefined" && typeof process.env !== "undefined",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}