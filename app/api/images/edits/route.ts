import { NextRequest } from "next/server";
import { proxyFormRequest } from "@/lib/proxy";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  return proxyFormRequest(request, "/v1/images/edits");
}