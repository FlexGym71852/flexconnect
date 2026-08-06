import { ensureDatabase, getD1 } from "../../../db";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

type PlanPayload = { id?: string; name?: string; description?: string; priceCents?: number; interval?: string; stripePriceId?: string; active?: boolean };

export async function POST(request: Request) {
  const denied = await requireAdminApi(request); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<PlanPayload>(request);
  if (!body.name?.trim() || Number(body.priceCents) < 0) return jsonError("Plan name and price are required.");
  const id = crypto.randomUUID();
  await getD1().prepare("INSERT INTO plans (id,name,description,price_cents,interval,stripe_price_id,active) VALUES (?,?,?,?,?,?,?)")
    .bind(id, body.name.trim(), body.description?.trim() || "", Math.round(Number(body.priceCents)), body.interval || "month", body.stripePriceId?.trim() || null, body.active === false ? 0 : 1).run();
  return Response.json({ id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireAdminApi(request); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<PlanPayload>(request);
  if (!body.id) return jsonError("Plan id is required.");
  const current = await getD1().prepare("SELECT * FROM plans WHERE id=?").bind(body.id).first<Record<string, unknown>>();
  if (!current) return jsonError("Plan not found.", 404);
  await getD1().prepare("UPDATE plans SET name=?,description=?,price_cents=?,interval=?,stripe_price_id=?,active=? WHERE id=?")
    .bind(body.name?.trim() || current.name, body.description?.trim() ?? current.description, body.priceCents ?? current.price_cents, body.interval ?? current.interval, body.stripePriceId?.trim() || current.stripe_price_id, body.active === undefined ? current.active : body.active ? 1 : 0, body.id).run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const denied = await requireAdminApi(request); if (denied) return denied;
  await ensureDatabase();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("Plan id is required.");
  await getD1().prepare("UPDATE plans SET active=0 WHERE id=?").bind(id).run();
  return Response.json({ ok: true });
}
