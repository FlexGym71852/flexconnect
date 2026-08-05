import { ensureDatabase } from "../../../db";
import { operateDoor } from "../../../lib/door";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

export async function POST(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<{ action?: "open" | "close" }>(request);
  if (body.action !== "open" && body.action !== "close") return jsonError("Door action must be open or close.");
  return Response.json(await operateDoor(body.action));
}
