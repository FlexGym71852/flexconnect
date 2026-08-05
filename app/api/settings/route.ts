import { ensureDatabase, getD1 } from "../../../db";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

const allowed = new Set(["tax_rate", "door_unlock_seconds", "deny_past_due"]);

export async function PATCH(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<Record<string, string | number | boolean>>(request);
  const entries = Object.entries(body).filter(([key]) => allowed.has(key));
  if (!entries.length) return jsonError("No supported settings were supplied.");
  await getD1().batch(entries.map(([key, value]) => getD1().prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, String(value))));
  return Response.json({ ok: true });
}
