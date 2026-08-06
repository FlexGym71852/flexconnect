export async function runtimeValue(key: string) {
  try {
    const { env } = await import("cloudflare:workers");
    const values = env as unknown as Record<string, string | undefined>;
    return values[key]?.trim() || "";
  } catch {
    return process.env[key]?.trim() || "";
  }
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function requestJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("Invalid JSON request.");
  }
}
