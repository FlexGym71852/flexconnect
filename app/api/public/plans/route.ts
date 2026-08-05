import { ensureDatabase, getD1 } from "../../../../db";
import { stripeConfigured } from "../../../../lib/stripe";

export async function GET() {
  await ensureDatabase();
  const plans = await getD1().prepare("SELECT id,name,description,price_cents,interval FROM plans WHERE active=1 ORDER BY price_cents ASC").all();
  return Response.json({ plans: plans.results, stripeConfigured: await stripeConfigured() });
}
