import { runtimeValue } from "./runtime";

export async function stripeConfigured() {
  return Boolean(await runtimeValue("STRIPE_SECRET_KEY"));
}

export async function stripePost(path: string, values: Record<string, string | number | undefined>) {
  const secret = await runtimeValue("STRIPE_SECRET_KEY");
  if (!secret) throw new Error("Stripe is not configured yet. Add STRIPE_SECRET_KEY in site settings.");
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) form.set(key, String(value));
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = await response.json() as { error?: { message?: string }; [key: string]: unknown };
  if (!response.ok) throw new Error(data.error?.message || "Stripe rejected the request.");
  return data;
}

export async function verifyStripeEvent(payload: string, signature: string | null) {
  const secret = await runtimeValue("STRIPE_WEBHOOK_SECRET");
  if (!secret || !signature) throw new Error("Stripe webhook signature is unavailable.");
  const parts = signature.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const candidates = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !candidates.length) throw new Error("Invalid Stripe signature header.");
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error("Expired Stripe webhook.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const valid = candidates.some((candidate) => constantTimeEqual(candidate, expected));
  if (!valid) throw new Error("Invalid Stripe webhook signature.");
  return JSON.parse(payload) as StripeEvent;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: { id: string; customer?: string; subscription?: string; amount_total?: number; metadata?: Record<string, string>; status?: string; [key: string]: unknown } };
};
