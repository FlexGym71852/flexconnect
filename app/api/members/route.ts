import { ensureDatabase, getD1 } from "../../../db";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

type MemberPayload = { id?: string; name?: string; email?: string; phone?: string; planId?: string; status?: string; balanceCents?: number };

export async function POST(request: Request) {
  const denied = await requireAdminApi(request); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<MemberPayload>(request);
  if (!body.name?.trim()) return jsonError("Member name is required.");
  const id = crypto.randomUUID();
  await getD1().prepare("INSERT INTO members (id,name,email,phone,plan_id,status,balance_cents) VALUES (?,?,?,?,?,?,?)")
    .bind(id, body.name.trim(), body.email?.trim() || "", body.phone?.trim() || "", body.planId || null, body.status || "active", Math.max(0, Number(body.balanceCents) || 0)).run();
  return Response.json({ id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireAdminApi(request); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<MemberPayload>(request);
  if (!body.id) return jsonError("Member id is required.");
  const existing = await getD1().prepare("SELECT * FROM members WHERE id = ?").bind(body.id).first<Record<string, unknown>>();
  if (!existing) return jsonError("Member not found.", 404);
  await getD1().prepare("UPDATE members SET name=?, email=?, phone=?, plan_id=?, status=?, balance_cents=? WHERE id=?")
    .bind(body.name?.trim() || existing.name, body.email?.trim() ?? existing.email, body.phone?.trim() ?? existing.phone, body.planId ?? existing.plan_id, body.status ?? existing.status, body.balanceCents ?? existing.balance_cents, body.id).run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const denied = await requireAdminApi(request); if (denied) return denied;
  await ensureDatabase();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("Member id is required.");
  await getD1().prepare("UPDATE members SET status='canceled', nfc_token=NULL WHERE id=?").bind(id).run();
  return Response.json({ ok: true });
}
