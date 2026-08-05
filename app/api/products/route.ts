import { ensureDatabase, getD1 } from "../../../db";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

type ProductPayload = { id?: string; name?: string; sku?: string; details?: string; priceCents?: number; stock?: number; active?: boolean };

export async function POST(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<ProductPayload>(request);
  if (!body.name?.trim() || !body.sku?.trim() || Number(body.priceCents) < 0) return jsonError("Name, SKU, and price are required.");
  const id = crypto.randomUUID();
  try {
    await getD1().prepare("INSERT INTO products (id,name,sku,details,price_cents,stock,active) VALUES (?,?,?,?,?,?,1)")
      .bind(id, body.name.trim(), body.sku.trim(), body.details?.trim() || "", Math.round(Number(body.priceCents)), Math.max(0, Number(body.stock) || 0)).run();
  } catch { return jsonError("That SKU is already in use.", 409); }
  return Response.json({ id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<ProductPayload>(request);
  if (!body.id) return jsonError("Product id is required.");
  const current = await getD1().prepare("SELECT * FROM products WHERE id=?").bind(body.id).first<Record<string, unknown>>();
  if (!current) return jsonError("Product not found.", 404);
  await getD1().prepare("UPDATE products SET name=?,sku=?,details=?,price_cents=?,stock=?,active=? WHERE id=?")
    .bind(body.name?.trim() || current.name, body.sku?.trim() || current.sku, body.details?.trim() ?? current.details, body.priceCents ?? current.price_cents, body.stock ?? current.stock, body.active === undefined ? current.active : body.active ? 1 : 0, body.id).run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("Product id is required.");
  await getD1().prepare("UPDATE products SET active=0 WHERE id=?").bind(id).run();
  return Response.json({ ok: true });
}
