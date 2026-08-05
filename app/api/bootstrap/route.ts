import { ensureDatabase, getD1 } from "../../../db";
import { stripeConfigured } from "../../../lib/stripe";
import { runtimeValue } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

export async function GET() {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const d1 = getD1();
  const [members, plans, products, recentVisits, payments, settings, door] = await Promise.all([
    d1.prepare(`SELECT m.*, p.name AS plan_name, COUNT(v.id) AS visit_count FROM members m LEFT JOIN plans p ON p.id = m.plan_id LEFT JOIN visits v ON v.member_id = m.id AND v.result = 'approved' GROUP BY m.id ORDER BY m.joined_at DESC`).all(),
    d1.prepare(`SELECT p.*, COUNT(m.id) AS member_count FROM plans p LEFT JOIN members m ON m.plan_id = p.id GROUP BY p.id ORDER BY p.price_cents DESC`).all(),
    d1.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC`).all(),
    d1.prepare(`SELECT v.*, m.name AS member_name, m.phone, p.name AS plan_name, m.status FROM visits v LEFT JOIN members m ON m.id = v.member_id LEFT JOIN plans p ON p.id = m.plan_id ORDER BY v.created_at DESC LIMIT 40`).all(),
    d1.prepare(`SELECT * FROM payments WHERE status = 'paid' ORDER BY created_at DESC LIMIT 100`).all(),
    d1.prepare(`SELECT key, value FROM settings`).all(),
    d1.prepare(`SELECT * FROM door_events ORDER BY created_at DESC LIMIT 1`).first(),
  ]);
  const memberRows = members.results as Array<Record<string, unknown>>;
  const visitRows = recentVisits.results as Array<Record<string, unknown>>;
  const paymentRows = payments.results as Array<Record<string, unknown>>;
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const thisMonth = paymentRows.filter((row) => new Date(String(row.created_at)) >= startOfMonth);
  const settingsMap = Object.fromEntries((settings.results as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
  return Response.json({
    members: memberRows,
    plans: plans.results,
    products: products.results,
    visits: visitRows,
    payments: paymentRows,
    settings: settingsMap,
    door,
    integrations: { stripe: await stripeConfigured(), door: Boolean(await runtimeValue("DOOR_CONTROLLER_URL")) },
    metrics: {
      activeMembers: memberRows.filter((row) => row.status === "active").length,
      visitsToday: visitRows.filter((row) => new Date(String(row.created_at)) >= today && row.result === "approved").length,
      totalVisits: memberRows.reduce((sum, row) => sum + Number(row.visit_count), 0),
      monthlyRevenueCents: thisMonth.reduce((sum, row) => sum + Number(row.amount_cents), 0),
      taxCents: thisMonth.reduce((sum, row) => sum + Number(row.tax_cents), 0),
      debtCents: memberRows.reduce((sum, row) => sum + Number(row.balance_cents), 0),
    },
  });
}
