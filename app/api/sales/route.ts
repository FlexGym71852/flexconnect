import { ensureDatabase, getD1 } from "../../../db";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

type SalePayload = { paymentMethod?: "cash" | "card"; items?: Array<{ productId: string; quantity: number }> };

export async function POST(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<SalePayload>(request);
  if (!body.items?.length) return jsonError("Add at least one item to the sale.");
  const prepared: Array<{ id: string; quantity: number; priceCents: number; stock: number; name: string }> = [];
  for (const item of body.items) {
    const product = await getD1().prepare("SELECT * FROM products WHERE id=? AND active=1").bind(item.productId).first<Record<string, unknown>>();
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    if (!product) return jsonError("A product in the cart is no longer available.", 409);
    if (Number(product.stock) < quantity) return jsonError(`${product.name} does not have enough stock.`, 409);
    prepared.push({ id: String(product.id), quantity, priceCents: Number(product.price_cents), stock: Number(product.stock), name: String(product.name) });
  }
  const subtotalCents = prepared.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const taxRate = Number((await getD1().prepare("SELECT value FROM settings WHERE key='tax_rate'").first<{ value: string }>())?.value || 0);
  const taxCents = Math.round(subtotalCents * taxRate / 100);
  const totalCents = subtotalCents + taxCents;
  const id = crypto.randomUUID();
  const method = body.paymentMethod || "cash";
  await getD1().batch([
    getD1().prepare("INSERT INTO sales (id,subtotal_cents,tax_cents,total_cents,payment_method,status) VALUES (?,?,?,?,?,?)").bind(id, subtotalCents, taxCents, totalCents, method, method === "cash" ? "paid" : "pending"),
    ...prepared.map((item) => getD1().prepare("INSERT INTO sale_items (sale_id,product_id,quantity,unit_price_cents) VALUES (?,?,?,?)").bind(id, item.id, item.quantity, item.priceCents)),
  ]);
  if (method === "cash") {
    await getD1().batch([
      ...prepared.map((item) => getD1().prepare("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?").bind(item.quantity, item.id, item.quantity)),
      getD1().prepare("INSERT INTO payments (id,source,amount_cents,tax_cents,status,description) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), "pos", totalCents, taxCents, "paid", "Clothing sale"),
    ]);
  }
  return Response.json({ saleId: id, subtotalCents, taxCents, totalCents, items: prepared }, { status: 201 });
}
