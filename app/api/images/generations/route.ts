import { NextRequest } from "next/server";
import { proxyJsonRequest } from "@/lib/proxy";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  return proxyJsonRequest(request, "/v1/images/generations");
}