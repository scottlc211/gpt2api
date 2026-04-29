import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      ok: true,
      runtime: "nodejs",
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
