import { ensureDatabase, getD1 } from "../../../../db";
import { jsonError, requestJson } from "../../../../lib/runtime";
import { stripePost } from "../../../../lib/stripe";

type CheckoutPayload = {
  kind?: "membership" | "pos";
  planId?: string;
  name?: string;
  email?: string;
  phone?: string;
  saleId?: string;
};

export async function POST(request: Request) {
  await ensureDatabase();
  try {
    const body = await requestJson<CheckoutPayload>(request);
    const origin = new URL(request.url).origin;
    if (body.kind === "membership") {
      if (!body.planId || !body.name?.trim() || !body.email?.trim()) return jsonError("Name, email, and membership are required.");
      const plan = await getD1().prepare("SELECT * FROM plans WHERE id=? AND active=1").bind(body.planId).first<Record<string, unknown>>();
      if (!plan) return jsonError("Membership plan not found.", 404);
      const memberId = crypto.randomUUID();
      await getD1().prepare("INSERT INTO members (id,name,email,phone,plan_id,status) VALUES (?,?,?,?,?,?)")
        .bind(memberId, body.name.trim(), body.email.trim(), body.phone?.trim() || "", body.planId, "pending").run();
      const values: Record<string, string | number> = {
        mode: "subscription",
        success_url: `${origin}/join/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/join?canceled=1`,
        customer_email: body.email.trim(),
        "metadata[kind]": "membership",
        "metadata[member_id]": memberId,
        "metadata[plan_id]": String(plan.id),
        "subscription_data[metadata][member_id]": memberId,
        "subscription_data[metadata][plan_id]": String(plan.id),
      };
      if (plan.stripe_price_id) values["line_items[0][price]"] = String(plan.stripe_price_id);
      else {
        values["line_items[0][price_data][currency]"] = "usd";
        values["line_items[0][price_data][unit_amount]"] = Number(plan.price_cents);
        values["line_items[0][price_data][recurring][interval]"] = String(plan.interval);
        values["line_items[0][price_data][product_data][name]"] = `Flex Connect · ${plan.name}`;
        values["line_items[0][price_data][product_data][description]"] = String(plan.description);
      }
      values["line_items[0][quantity]"] = 1;
      const session = await stripePost("checkout/sessions", values);
      return Response.json({ url: session.url, sessionId: session.id });
    }

    if (body.kind === "pos" && body.saleId) {
      const sale = await getD1().prepare("SELECT * FROM sales WHERE id=? AND status='pending'").bind(body.saleId).first<Record<string, unknown>>();
      if (!sale) return jsonError("Pending sale not found.", 404);
      const items = await getD1().prepare("SELECT si.*, p.name FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=?").bind(body.saleId).all<Record<string, unknown>>();
      const values: Record<string, string | number> = {
        mode: "payment", success_url: `${origin}/?sale=success`, cancel_url: `${origin}/?sale=canceled`,
        "metadata[kind]": "pos", "metadata[sale_id]": body.saleId,
      };
      const itemRows = items.results as Array<Record<string, unknown>>;
      itemRows.forEach((item, index) => {
        values[`line_items[${index}][price_data][currency]`] = "usd";
        values[`line_items[${index}][price_data][unit_amount]`] = Number(item.unit_price_cents);
        values[`line_items[${index}][price_data][product_data][name]`] = String(item.name);
        values[`line_items[${index}][quantity]`] = Number(item.quantity);
      });
      if (Number(sale.tax_cents) > 0) {
        const index = itemRows.length;
        values[`line_items[${index}][price_data][currency]`] = "usd";
        values[`line_items[${index}][price_data][unit_amount]`] = Number(sale.tax_cents);
        values[`line_items[${index}][price_data][product_data][name]`] = "Sales tax";
        values[`line_items[${index}][quantity]`] = 1;
      }
      const session = await stripePost("checkout/sessions", values);
      await getD1().prepare("UPDATE sales SET stripe_session_id=? WHERE id=?").bind(session.id, body.saleId).run();
      return Response.json({ url: session.url, sessionId: session.id });
    }
    return jsonError("Unsupported checkout type.");
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Checkout failed.", 500);
  }
}
