import { ensureDatabase, getD1 } from "../../../../db";
import { verifyStripeEvent } from "../../../../lib/stripe";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const event = await verifyStripeEvent(raw, request.headers.get("stripe-signature"));
    await ensureDatabase();
    const object = event.data.object;
    const metadata = object.metadata || {};
    if (event.type === "checkout.session.completed") {
      const handled = await getD1().prepare("SELECT id FROM payments WHERE id=?").bind(event.id).first();
      if (handled) return Response.json({ received: true, duplicate: true });
    }
    if (event.type === "checkout.session.completed" && metadata.kind === "membership" && metadata.member_id) {
      await getD1().batch([
        getD1().prepare("UPDATE members SET status='active',balance_cents=0,stripe_customer_id=?,stripe_subscription_id=? WHERE id=?").bind(object.customer || null, object.subscription || null, metadata.member_id),
        getD1().prepare("INSERT INTO payments (id,member_id,source,amount_cents,tax_cents,status,description,stripe_reference) VALUES (?,?,?,?,?,?,?,?)").bind(event.id, metadata.member_id, "membership", Number(object.amount_total) || 0, 0, "paid", "Stripe membership signup", object.id),
      ]);
    }
    if (event.type === "checkout.session.completed" && metadata.kind === "pos" && metadata.sale_id) {
      const sale = await getD1().prepare("SELECT * FROM sales WHERE id=? AND status='pending'").bind(metadata.sale_id).first<Record<string, unknown>>();
      if (sale) {
        const items = await getD1().prepare("SELECT product_id,quantity FROM sale_items WHERE sale_id=?").bind(metadata.sale_id).all<{ product_id: string; quantity: number }>();
        await getD1().batch([
          getD1().prepare("UPDATE sales SET status='paid' WHERE id=?").bind(metadata.sale_id),
          ...((items.results as Array<{ product_id: string; quantity: number }>).map((item) => getD1().prepare("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?").bind(item.quantity, item.product_id, item.quantity))),
          getD1().prepare("INSERT INTO payments (id,source,amount_cents,tax_cents,status,description,stripe_reference) VALUES (?,?,?,?,?,?,?)").bind(event.id, "pos", Number(sale.total_cents), Number(sale.tax_cents), "paid", "Stripe clothing sale", object.id),
        ]);
      }
    }
    if (event.type === "invoice.payment_failed") {
      const memberId = String((object.parent as { subscription_details?: { metadata?: { member_id?: string } } } | undefined)?.subscription_details?.metadata?.member_id || "");
      if (memberId) await getD1().prepare("UPDATE members SET status='past_due', balance_cents=? WHERE id=?").bind(Number(object.amount_due) || 0, memberId).run();
    }
    if (event.type === "customer.subscription.deleted") {
      await getD1().prepare("UPDATE members SET status='canceled',nfc_token=NULL WHERE stripe_subscription_id=?").bind(object.id).run();
    }
    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid webhook." }, { status: 400 });
  }
}
