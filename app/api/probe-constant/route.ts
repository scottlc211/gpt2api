import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      route: "probe-constant",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
