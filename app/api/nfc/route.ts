import { ensureDatabase, getD1 } from "../../../db";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

export async function POST(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<{ memberId?: string }>(request);
  if (!body.memberId) return jsonError("Member id is required.");
  const member = await getD1().prepare("SELECT id FROM members WHERE id=?").bind(body.memberId).first();
  if (!member) return jsonError("Member not found.", 404);
  const token = `fc_${crypto.randomUUID().replaceAll("-", "")}`;
  await getD1().prepare("UPDATE members SET nfc_token=? WHERE id=?").bind(token, body.memberId).run();
  return Response.json({ token, record: `flexconnect:${token}` });
}

export async function DELETE(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const id = new URL(request.url).searchParams.get("memberId");
  if (!id) return jsonError("Member id is required.");
  await getD1().prepare("UPDATE members SET nfc_token=NULL WHERE id=?").bind(id).run();
  return Response.json({ ok: true });
}
