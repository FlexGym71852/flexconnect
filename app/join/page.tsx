"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type PublicPlan = { id: string; name: string; description: string; price_cents: number; interval: string };

export default function JoinPage() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [selected, setSelected] = useState("");
  const [stripeReady, setStripeReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/public/plans").then(async (response) => {
      const data = await response.json() as { plans?: PublicPlan[]; stripeConfigured?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load memberships.");
      setPlans(data.plans || []); setSelected(data.plans?.[0]?.id || ""); setStripeReady(Boolean(data.stripeConfigured));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load memberships.")).finally(() => setLoading(false));
  }, []);

  async function beginCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/stripe/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "membership", planId: selected, name: form.get("name"), email: form.get("email"), phone: form.get("phone") }) });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Checkout could not be started.");
      window.location.assign(data.url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Checkout could not be started."); setSubmitting(false); }
  }

  return <main className="join-page">
    <header className="join-header"><Link href="/join"><span>F</span><strong>FLEX <i>CONNECT</i></strong></Link><div><span className="secure-dot" />Secure Stripe checkout</div></header>
    <section className="join-hero"><p>MEMBERSHIP · ACCESS · COMMUNITY</p><h1>Build strength.<br/><span>Stay connected.</span></h1><p>Choose your membership, complete secure payment, and receive your Flex Connect access key at the gym.</p></section>
    <section className="join-content">
      <div className="join-plans"><div className="join-section-head"><p>01 / CHOOSE YOUR PLAN</p><h2>Memberships that move with you</h2></div>
        {loading ? <div className="join-loading">Loading memberships…</div> : <div className="public-plan-grid">{plans.map((plan, index) => <button key={plan.id} type="button" className={selected === plan.id ? "selected" : ""} onClick={() => setSelected(plan.id)}><span className="plan-number">0{index + 1}</span><div><h3>{plan.name}</h3><p>{plan.description}</p><ul><li>Digital member profile</li><li>NFC door access</li><li>Visit history</li></ul></div><div className="public-price"><strong>${(plan.price_cents / 100).toFixed(0)}</strong><span>/ {plan.interval}</span></div><i className="choice-dot" /></button>)}</div>}
      </div>
      <aside className="join-form-card"><div className="join-section-head"><p>02 / YOUR DETAILS</p><h2>Start your membership</h2></div><form onSubmit={beginCheckout}><label>Full name<input name="name" required autoComplete="name" placeholder="Your full name" /></label><label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></label><label>Phone number<input name="phone" type="tel" required autoComplete="tel" placeholder="(870) 555-0000" /></label><div className="selected-summary"><span>Selected membership</span><strong>{plans.find((plan) => plan.id === selected)?.name || "—"}</strong><b>{plans.find((plan) => plan.id === selected) ? `$${((plans.find((plan) => plan.id === selected)?.price_cents || 0) / 100).toFixed(2)}/month` : ""}</b></div>{error && <p className="join-error">{error}</p>}<button className="join-cta" disabled={!selected || submitting || !stripeReady}>{submitting ? "Opening Stripe…" : stripeReady ? "Continue to secure checkout →" : "Stripe setup required"}</button><small>Payments are processed by Stripe. Cancel anytime under your membership terms.</small></form></aside>
    </section>
    <footer className="join-footer"><span>FLEX CONNECT</span><p>Gym membership and access management.</p><Link href="/">Staff dashboard</Link></footer>
  </main>;
}
