import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server-env";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serverError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function validateAuth(request: NextRequest, authKey: string) {
  const authorization = request.headers.get("authorization") || "";
  return authorization === `Bearer ${authKey}`;
}

async function forwardResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "application/json";
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  });
}

export async function proxyJsonRequest(request: NextRequest, targetPath: string) {
  try {
    const { apiUrl, apiKey, authKey } = getServerEnv();
    if (!validateAuth(request, authKey)) {
      return unauthorized();
    }

    const body = await request.text();
    const upstream = await fetch(`${apiUrl}${targetPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    return forwardResponse(upstream);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    return serverError(message);
  }
}

export async function proxyFormRequest(request: NextRequest, targetPath: string) {
  try {
    const { apiUrl, apiKey, authKey } = getServerEnv();
    if (!validateAuth(request, authKey)) {
      return unauthorized();
    }

    const formData = await request.formData();
    const upstream = await fetch(`${apiUrl}${targetPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    return forwardResponse(upstream);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    return serverError(message);
  }
}
