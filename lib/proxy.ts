import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server-env";

function serverError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
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
    const { apiUrl, authKey } = await getServerEnv();
    const body = await request.text();
    const upstream = await fetch(`${apiUrl}${targetPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authKey}`,
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
    const { apiUrl, authKey } = await getServerEnv();
    const formData = await request.formData();
    const upstream = await fetch(`${apiUrl}${targetPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authKey}`,
      },
      body: formData,
    });

    return forwardResponse(upstream);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    return serverError(message);
  }
}
