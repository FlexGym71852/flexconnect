import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  interval: text("interval").notNull().default("month"),
  stripePriceId: text("stripe_price_id"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  planId: text("plan_id").references(() => plans.id),
  status: text("status").notNull().default("active"),
  balanceCents: integer("balance_cents").notNull().default(0),
  nfcToken: text("nfc_token").unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastVisitAt: text("last_visit_at"),
});

export const visits = sqliteTable("visits", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  method: text("method").notNull().default("manual"),
  result: text("result").notNull().default("approved"),
  denialReason: text("denial_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  details: text("details").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  stock: integer("stock").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(),
  subtotalCents: integer("subtotal_cents").notNull(),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  paymentMethod: text("payment_method").notNull(),
  status: text("status").notNull().default("paid"),
  stripeSessionId: text("stripe_session_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const saleItems = sqliteTable("sale_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  saleId: text("sale_id").notNull().references(() => sales.id),
  productId: text("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  memberId: text("member_id").references(() => members.id),
  source: text("source").notNull(),
  amountCents: integer("amount_cents").notNull(),
  taxCents: integer("tax_cents").notNull().default(0),
  status: text("status").notNull().default("paid"),
  description: text("description").notNull().default(""),
  stripeReference: text("stripe_reference"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const doorEvents = sqliteTable("door_events", {
  id: text("id").primaryKey(),
  memberId: text("member_id").references(() => members.id),
  action: text("action").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const dailyRevenue = sqliteTable("daily_revenue", {
  day: text("day").primaryKey(),
  revenue: real("revenue").notNull(),
});
