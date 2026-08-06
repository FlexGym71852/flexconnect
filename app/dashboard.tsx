"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { hardware, type DoorBluetoothConfig, type DoorWifiConfig, type HardwareState, type ReaderBluetoothConfig, type ReaderWifiConfig, type Transport } from "./hardware";
import { apiFetch, getApiConfig, hasExternalApi, isGitHubPagesBuild, publicAppUrl, saveApiConfig, type ApiConfig } from "./api-client";

type View = "overview" | "members" | "plans" | "access" | "pos" | "reports" | "settings";

const nav: { id: View; label: string; mark: string }[] = [
  { id: "overview", label: "Overview", mark: "OV" },
  { id: "members", label: "Members", mark: "MB" },
  { id: "plans", label: "Memberships", mark: "PL" },
  { id: "access", label: "Access & NFC", mark: "AC" },
  { id: "pos", label: "Clothing POS", mark: "PO" },
  { id: "reports", label: "Reports", mark: "RP" },
  { id: "settings", label: "Settings", mark: "ST" },
];

type Member = { id: string; name: string; initials: string; plan: string; status: string; balance: number; visits: number; lastVisit: string; phone: string; nfc: boolean; nfcToken?: string };
type Plan = { id: string; name: string; description: string; price: number; members: number; color: string; active: boolean; stripePriceId?: string };
type Product = { id: string; name: string; meta: string; price: number; stock: number; sku: string };
type Visit = { id: string; memberName: string; plan: string; status: string; result: string; method: string; when: string };
type Metrics = { activeMembers: number; visitsToday: number; totalVisits: number; monthlyRevenue: number; tax: number; debt: number };

const seedPlans: Plan[] = [
  { id: "unlimited", name: "Unlimited", description: "24/7 gym access and all group classes", price: 49, members: 0, color: "orange", active: true },
  { id: "open-gym", name: "Open Gym", description: "Gym floor access during staffed hours", price: 29, members: 0, color: "blue", active: true },
  { id: "student", name: "Student", description: "Unlimited access with valid student ID", price: 35, members: 0, color: "violet", active: true },
];

const seedProducts: Product[] = [
  { id: "shirt", name: "Flex heavyweight tee", meta: "Black · S–2XL", price: 28, stock: 34, sku: "FC-TEE-BLK" },
  { id: "hoodie", name: "Classic training hoodie", meta: "Charcoal · M–2XL", price: 52, stock: 16, sku: "FC-HOOD-CHR" },
  { id: "tank", name: "Performance tank", meta: "Orange · S–XL", price: 24, stock: 21, sku: "FC-TANK-ORG" },
  { id: "cap", name: "Embroidered cap", meta: "Black · One size", price: 22, stock: 12, sku: "FC-CAP-BLK" },
];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatWhen(value: unknown) {
  if (!value) return "Never";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Never";
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, today)) return `Today, ${time}`;
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${time}`;
}

function Brand() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark" aria-hidden="true"><span>F</span></div>
      <div><strong>FLEX</strong><strong>CONNECT</strong><small>GYM MANAGEMENT</small></div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status === "past_due" ? "Past due" : status[0].toUpperCase() + status.slice(1);
  return <span className={`status-pill ${status}`}><i />{label}</span>;
}

function Metric({ label, value, note, tone = "orange" }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <article className="metric-card">
      <div className={`metric-signal ${tone}`} aria-hidden="true" />
      <p>{label}</p><strong>{value}</strong><small>{note}</small>
    </article>
  );
}

export default function Dashboard() {
  const [view, setView] = useState<View>("overview");
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState(seedPlans);
  const [products, setProducts] = useState(seedProducts);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [modal, setModal] = useState<null | "member" | "plan" | "product" | "scan">(null);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [doorOpen, setDoorOpen] = useState(false);
  const [taxRate, setTaxRate] = useState(8.25);
  const [metrics, setMetrics] = useState<Metrics>({ activeMembers: 0, visitsToday: 0, totalVisits: 0, monthlyRevenue: 0, tax: 0, debt: 0 });
  const [integrations, setIntegrations] = useState({ stripe: false });
  const [hardwareState, setHardwareState] = useState<HardwareState>(() => hardware.getState());
  const [externalApiReady, setExternalApiReady] = useState(() => hasExternalApi());

  const refreshData = useCallback(async () => {
    try {
      const response = await apiFetch("/api/bootstrap", { cache: "no-store" });
      const data = await response.json() as {
        members?: Array<Record<string, unknown>>; plans?: Array<Record<string, unknown>>; products?: Array<Record<string, unknown>>; visits?: Array<Record<string, unknown>>;
        settings?: Record<string, string>; integrations?: { stripe?: boolean; door?: boolean };
        metrics?: { activeMembers?: number; visitsToday?: number; totalVisits?: number; monthlyRevenueCents?: number; taxCents?: number; debtCents?: number };
      };
      if (!response.ok) throw new Error("Database unavailable");
      if (data.members) setMembers(data.members.map((row) => {
        const name = String(row.name || "Member");
        return { id: String(row.id), name, initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), plan: String(row.plan_name || "No plan"), status: String(row.status || "active"), balance: Number(row.balance_cents || 0) / 100, visits: Number(row.visit_count || 0), lastVisit: formatWhen(row.last_visit_at), phone: String(row.phone || ""), nfc: Boolean(row.nfc_token), nfcToken: row.nfc_token ? String(row.nfc_token) : undefined };
      }));
      if (data.plans) setPlans(data.plans.map((row, index) => ({ id: String(row.id), name: String(row.name), description: String(row.description || ""), price: Number(row.price_cents || 0) / 100, members: Number(row.member_count || 0), color: ["orange", "blue", "violet"][index % 3], active: Boolean(row.active), stripePriceId: row.stripe_price_id ? String(row.stripe_price_id) : undefined })));
      if (data.products) setProducts(data.products.map((row) => ({ id: String(row.id), name: String(row.name), meta: String(row.details || ""), price: Number(row.price_cents || 0) / 100, stock: Number(row.stock || 0), sku: String(row.sku) })));
      if (data.visits) setVisits(data.visits.map((row) => ({ id: String(row.id), memberName: String(row.member_name || "Former member"), plan: String(row.plan_name || "—"), status: String(row.status || "inactive"), result: String(row.result || "approved"), method: String(row.method || "manual").toUpperCase(), when: formatWhen(row.created_at) })));
      if (data.settings?.tax_rate) setTaxRate(Number(data.settings.tax_rate));
      if (data.integrations) setIntegrations({ stripe: Boolean(data.integrations.stripe) });
      if (data.metrics) setMetrics({ activeMembers: Number(data.metrics.activeMembers || 0), visitsToday: Number(data.metrics.visitsToday || 0), totalVisits: Number(data.metrics.totalVisits || 0), monthlyRevenue: Number(data.metrics.monthlyRevenueCents || 0) / 100, tax: Number(data.metrics.taxCents || 0) / 100, debt: Number(data.metrics.debtCents || 0) / 100 });
    } catch { setMembers([]); setVisits([]); setMetrics({ activeMembers: 0, visitsToday: 0, totalVisits: 0, monthlyRevenue: 0, tax: 0, debt: 0 }); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void refreshData(), 0); return () => window.clearTimeout(timer); }, [refreshData]);
  useEffect(() => hardware.subscribe(setHardwareState), []);

  const title = nav.find((item) => item.id === view)?.label ?? "Overview";
  const visibleMembers = members.filter((m) => `${m.name} ${m.phone} ${m.plan}`.toLowerCase().includes(query.toLowerCase()));
  const cartItems = products.filter((p) => cart[p.id]).map((p) => ({ ...p, quantity: cart[p.id] }));
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * (taxRate / 100);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => hardware.subscribeTags(async (token) => {
    const response = await apiFetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, method: "reader" }) });
    const result = await response.json() as { approved?: boolean; reason?: string; member?: { name?: string }; error?: string };
    if (!response.ok || !result.approved) { notify(result.reason || result.error || "Access denied"); return; }
    const name = result.member?.name || "Member";
    let message = `${name} checked in · Door is not connected`;
    if (hardwareState.door.status === "connected") {
      try { await hardware.operateDoor("open"); setDoorOpen(true); message = `${name} checked in · Open command sent`; }
      catch (error) { message = `${name} checked in · ${error instanceof Error ? error.message : "Door command failed"}`; }
    }
    notify(message);
    setModal(null);
    await refreshData();
  }), [hardwareState.door.status, notify, refreshData]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "New member");
    const plan = plans.find((item) => item.name === String(data.get("plan")));
    const response = await apiFetch("/api/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, phone: data.get("phone"), email: data.get("email"), planId: plan?.id }) });
    if (!response.ok) { notify("Member could not be added"); return; }
    setModal(null); notify(`${name} was added`); await refreshData();
  }

  async function addPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name"));
    const response = await apiFetch("/api/plans", { method: editingPlan ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingPlan?.id, name, description: data.get("description"), priceCents: Math.round(Number(data.get("price")) * 100), stripePriceId: data.get("stripe") }) });
    if (!response.ok) { notify("Membership could not be created"); return; }
    setModal(null); setEditingPlan(null); notify(`${name} ${editingPlan ? "was updated" : "is ready for Stripe"}`); await refreshData();
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name"));
    const response = await apiFetch("/api/products", { method: editingProduct ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingProduct?.id, name, sku: data.get("sku"), details: data.get("meta"), priceCents: Math.round(Number(data.get("price")) * 100), stock: Number(data.get("stock")) }) });
    if (!response.ok) { const result = await response.json() as { error?: string }; notify(result.error || "Item could not be added"); return; }
    setModal(null); setEditingProduct(null); notify(`${name} ${editingProduct ? "was updated" : "was added to inventory"}`); await refreshData();
  }

  function addToCart(id: string) {
    setCart((current) => ({ ...current, [id]: (current[id] || 0) + 1 }));
  }

  async function checkout(paymentMethod: "cash" | "card") {
    if (!cartItems.length) return;
    const response = await apiFetch("/api/sales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentMethod, items: cartItems.map((item) => ({ productId: item.id, quantity: item.quantity })) }) });
    const sale = await response.json() as { saleId?: string; error?: string };
    if (!response.ok || !sale.saleId) { notify(sale.error || "Sale could not be completed"); return; }
    if (paymentMethod === "card") {
      const stripe = await apiFetch("/api/stripe/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "pos", saleId: sale.saleId }) });
      const result = await stripe.json() as { url?: string; error?: string };
      if (!stripe.ok || !result.url) { notify(result.error || "Stripe checkout is not configured"); return; }
      window.location.assign(result.url); return;
    }
    setCart({}); notify(`Cash sale recorded · ${money(subtotal + tax)}`); await refreshData();
  }

  async function operateDoor(action: "open" | "close") {
    try {
      await hardware.operateDoor(action);
      setDoorOpen(action === "open");
      notify(action === "open" ? "Open command sent to the front door" : "Close command sent to the front door");
    } catch (error) { notify(error instanceof Error ? error.message : "Door controller did not respond"); }
  }

  async function createNfc(member: Member) {
    const response = await apiFetch("/api/nfc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: member.id }) });
    const result = await response.json() as { record?: string; error?: string };
    if (!response.ok || !result.record) { notify(result.error || "NFC key could not be created"); return; }
    if (hardwareState.reader.status === "connected") {
      try { await hardware.writeNfcRecord(result.record); notify(`NFC key written for ${member.name}`); }
      catch (error) { notify(error instanceof Error ? `Key assigned. ${error.message}` : "Key assigned, but the NFC writer failed"); }
    } else {
      const NfcReader = (window as unknown as { NDEFReader?: new () => { write: (value: string) => Promise<void> } }).NDEFReader;
      if (NfcReader) {
      try { await new NfcReader().write(result.record); notify(`NFC key written for ${member.name}`); }
      catch { notify("Key assigned, but NFC writing was canceled"); }
      } else notify(`Key assigned to ${member.name}. Connect an NFC writer to program a tag.`);
    }
    await refreshData();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Main navigation">
          <p className="nav-label">MANAGE</p>
          {nav.slice(0, 5).map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.mark}</span>{item.label}{item.id === "members" && <em>{members.length}</em>}</button>)}
          <p className="nav-label secondary">BUSINESS</p>
          {nav.slice(5).map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.mark}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-foot"><div className="avatar">FC</div><div><strong>Flex Connect</strong><small>Owner account</small></div><button aria-label="Account menu">•••</button></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><p>FLEX CONNECT / {title.toUpperCase()}</p><h1>{title}</h1></div>
          <div className="top-actions"><span className={`sync-state ${hardwareState.door.status === "connected" && hardwareState.reader.status === "connected" ? "" : "offline"}`}><i />{hardwareState.door.status === "connected" && hardwareState.reader.status === "connected" ? "Devices connected" : "Hardware setup needed"}</span><a href={publicAppUrl("/join")} className="ghost-button">Public signup</a><button className="primary-button" onClick={() => setModal("scan")}>Scan member</button></div>
        </header>

        <div className="page-body">
          {isGitHubPagesBuild && !externalApiReady && <button className="pages-setup-banner" onClick={() => setView("settings")}><strong>GitHub Pages frontend is ready.</strong><span>Connect the secure Flex backend in Settings to enable members, Stripe, reports, and POS data.</span><b>Open Settings →</b></button>}
          {view === "overview" && <Overview members={members} metrics={metrics} hardwareState={hardwareState} setView={setView} setModal={setModal} operateDoor={operateDoor} />}
          {view === "members" && <Members members={visibleMembers} query={query} setQuery={setQuery} setModal={setModal} createNfc={createNfc} notify={notify} />}
          {view === "plans" && <Plans plans={plans} setPlans={setPlans} setModal={setModal} setEditingPlan={setEditingPlan} notify={notify} />}
          {view === "access" && <Access members={members} doorOpen={doorOpen} hardwareState={hardwareState} setModal={setModal} notify={notify} operateDoor={operateDoor} createNfc={createNfc} />}
          {view === "pos" && <POS products={products} setProducts={setProducts} setModal={setModal} setEditingProduct={setEditingProduct} cart={cart} addToCart={addToCart} cartItems={cartItems} subtotal={subtotal} tax={tax} checkout={checkout} />}
          {view === "reports" && <Reports members={members} metrics={metrics} visits={visits} />}
          {view === "settings" && <Settings taxRate={taxRate} setTaxRate={setTaxRate} integrations={integrations} hardwareState={hardwareState} onApiReady={() => setExternalApiReady(true)} notify={notify} />}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.slice(0, 5).map((item) => <button key={item.id} onClick={() => setView(item.id)} className={view === item.id ? "active" : ""}><span>{item.mark}</span>{item.label.split(" ")[0]}</button>)}
      </nav>

      {modal && <Modal title={modal === "member" ? "Add member" : modal === "plan" ? (editingPlan ? "Edit membership" : "Create membership") : modal === "product" ? (editingProduct ? "Edit clothing item" : "Add clothing item") : "NFC check-in"} onClose={() => { setModal(null); setEditingPlan(null); setEditingProduct(null); }}>
        {modal === "member" && <form onSubmit={addMember} className="form-grid"><label>Full name<input name="name" required placeholder="Member name" /></label><label>Phone<input name="phone" required placeholder="(870) 555-0000" /></label><label>Email<input name="email" type="email" placeholder="member@email.com" /></label><label>Membership<select name="plan">{plans.filter((p) => p.active).map((p) => <option key={p.id}>{p.name}</option>)}</select></label><div className="form-actions"><button type="button" className="ghost-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button">Add member</button></div></form>}
        {modal === "plan" && <form onSubmit={addPlan} className="form-grid"><label>Plan name<input name="name" required placeholder="Premium" defaultValue={editingPlan?.name} /></label><label>Monthly price<input name="price" required type="number" min="0" step="0.01" placeholder="59.00" defaultValue={editingPlan?.price} /></label><label className="wide">Description<input name="description" required placeholder="What members receive" defaultValue={editingPlan?.description} /></label><label>Stripe Price ID<input name="stripe" placeholder="price_... (optional)" defaultValue={editingPlan?.stripePriceId} /></label><div className="form-actions"><button type="button" className="ghost-button" onClick={() => {setModal(null);setEditingPlan(null)}}>Cancel</button><button className="primary-button">{editingPlan ? "Save changes" : "Create plan"}</button></div></form>}
        {modal === "product" && <form onSubmit={addProduct} className="form-grid"><label>Item name<input name="name" required placeholder="Training shorts" defaultValue={editingProduct?.name} /></label><label>SKU<input name="sku" required placeholder="FC-SHORT-BLK" defaultValue={editingProduct?.sku} /></label><label>Variant details<input name="meta" placeholder="Black · S–2XL" defaultValue={editingProduct?.meta} /></label><label>Price<input name="price" required type="number" min="0" step="0.01" defaultValue={editingProduct?.price} /></label><label>Current stock<input name="stock" required type="number" min="0" defaultValue={editingProduct?.stock} /></label><div className="form-actions"><button type="button" className="ghost-button" onClick={() => {setModal(null);setEditingProduct(null)}}>Cancel</button><button className="primary-button">{editingProduct ? "Save changes" : "Add item"}</button></div></form>}
        {modal === "scan" && <ScanPanel members={members} setMembers={setMembers} hardwareState={hardwareState} onClose={() => setModal(null)} notify={notify} refreshData={refreshData} />}
      </Modal>}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Overview({ members, metrics, hardwareState, setView, setModal, operateDoor }: { members: Member[]; metrics: Metrics; hardwareState: HardwareState; setView: (view: View) => void; setModal: (value: "scan") => void; operateDoor: (action: "open" | "close") => Promise<void> }) {
  const doorConnected = hardwareState.door.status === "connected";
  const week = [["Thu",0],["Fri",0],["Sat",0],["Sun",0],["Mon",0],["Tue",0],["Wed",metrics.visitsToday]] as const;
  return <div className="content-stack">
    <section className="welcome-row"><div><p className="eyebrow">WEDNESDAY, AUGUST 5</p><h2>Good evening, Flex Connect.</h2><p>Here&apos;s how the gym is moving today.</p></div><div><button className="ghost-button" onClick={() => setView("members")}>Add member</button><button className="primary-button" onClick={() => setModal("scan")}>Start NFC scan</button></div></section>
    <section className="metrics-grid"><Metric label="Active members" value={String(metrics.activeMembers)} note="Live member records" /><Metric label="Visits today" value={String(metrics.visitsToday)} note="Approved entries today" tone="blue" /><Metric label="Monthly revenue" value={money(metrics.monthlyRevenue)} note="Memberships and clothing" tone="green" /><Metric label="Outstanding debt" value={money(metrics.debt)} note={`${members.filter((m) => m.balance > 0).length} members need attention`} tone="red" /></section>
    <section className="overview-grid">
      <article className="panel visits-panel"><div className="panel-head"><div><p className="eyebrow">TRAFFIC</p><h3>Visits this week</h3></div><span>{metrics.totalVisits} total</span></div><div className="bar-chart" aria-label="Weekly visits bar chart">{week.map(([day,value]) => <div key={day}><span style={{height: `${Math.max(Number(value) * 1.35, 2)}px`}} className={day === "Wed" ? "today" : ""}><i>{value}</i></span><small>{day}</small></div>)}</div></article>
      <article className={`panel access-card ${doorConnected ? "" : "device-offline"}`}><div className="live-label"><i />{doorConnected ? "DOOR CONNECTED" : "DOOR DISCONNECTED"}</div><div className="door-visual"><div className="scan-wave" /><span>FC</span></div><h3>{doorConnected ? hardwareState.door.name : "No door controller"}</h3><p>{doorConnected ? hardwareState.door.message : "Connect a Wi-Fi or Bluetooth controller in Settings."}</p><button className="primary-button" disabled={!doorConnected} onClick={() => void operateDoor("open")}>Unlock door</button></article>
    </section>
    <section className="panel"><div className="panel-head"><div><p className="eyebrow">RECENT ACTIVITY</p><h3>Latest member visits</h3></div><button className="text-button" onClick={() => setView("reports")}>View all records →</button></div><div className="table-wrap"><table><thead><tr><th>Member</th><th>Membership</th><th>Check-in</th><th>Status</th></tr></thead><tbody>{members.length ? members.slice(0,4).map((member) => <tr key={member.id}><td><div className="member-cell"><span>{member.initials}</span><strong>{member.name}</strong></div></td><td>{member.plan}</td><td>{member.lastVisit}</td><td><StatusPill status={member.status} /></td></tr>) : <tr><td className="empty-table" colSpan={4}>No member activity yet. Add your first member to get started.</td></tr>}</tbody></table></div></section>
  </div>;
}

function Members({ members, query, setQuery, setModal, createNfc }: { members: Member[]; query: string; setQuery: (v: string) => void; setModal: (v: "member") => void; createNfc: (member: Member) => Promise<void>; notify: (v: string) => void }) {
  return <div className="content-stack"><section className="section-toolbar"><div><p className="eyebrow">DIRECTORY</p><h2>{members.length} gym members</h2></div><button className="primary-button" onClick={() => setModal("member")}>+ Add member</button></section><section className="panel"><div className="filter-row"><input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, or membership…" /><select><option>All statuses</option><option>Active</option><option>Past due</option><option>Paused</option></select></div><div className="table-wrap"><table><thead><tr><th>Member</th><th>Plan</th><th>Visits</th><th>Balance</th><th>NFC key</th><th>Status</th><th /></tr></thead><tbody>{members.length ? members.map((member) => <tr key={member.id}><td><div className="member-cell"><span>{member.initials}</span><div><strong>{member.name}</strong><small>{member.phone}</small></div></div></td><td>{member.plan}</td><td>{member.visits}</td><td className={member.balance ? "debt" : ""}>{money(member.balance)}</td><td>{member.nfc ? <button className="text-button" onClick={() => void createNfc(member)}>Rewrite key</button> : <button className="text-button" onClick={() => void createNfc(member)}>Create key</button>}</td><td><StatusPill status={member.status} /></td><td><button className="more-button" aria-label={`Actions for ${member.name}`}>•••</button></td></tr>) : <tr><td className="empty-table" colSpan={7}>No members yet. Add your first member above.</td></tr>}</tbody></table></div></section></div>;
}

function Plans({ plans, setPlans, setModal, setEditingPlan, notify }: { plans: Plan[]; setPlans: React.Dispatch<React.SetStateAction<Plan[]>>; setModal: (v: "plan") => void; setEditingPlan: (plan: Plan | null) => void; notify: (v: string) => void }) {
  async function toggle(plan: Plan) { setPlans((all) => all.map((item) => item.id === plan.id ? {...item,active:!item.active} : item)); const response = await apiFetch("/api/plans", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: plan.id, active: !plan.active }) }); if (!response.ok) setPlans((all) => all.map((item) => item.id === plan.id ? {...item,active:plan.active} : item)); else notify(`${plan.name} ${plan.active ? "hidden from" : "added to"} signup`); }
  return <div className="content-stack"><section className="section-toolbar"><div><p className="eyebrow">STRIPE SUBSCRIPTIONS</p><h2>Membership options</h2><p>Prices and availability update the public signup page.</p></div><button className="primary-button" onClick={() => {setEditingPlan(null);setModal("plan")}}>+ New membership</button></section><section className="plan-grid">{plans.map((plan) => <article className="plan-card" key={plan.id}><div className={`plan-accent ${plan.color}`} /><div className="plan-top"><span>{plan.active ? "LIVE" : "HIDDEN"}</span><button className="more-button" aria-label={`Edit ${plan.name}`} onClick={() => {setEditingPlan(plan);setModal("plan")}}>Edit</button></div><h3>{plan.name}</h3><p>{plan.description}</p><div className="plan-price"><strong>{money(plan.price)}</strong><span>/ month</span></div><dl><div><dt>Members</dt><dd>{plan.members}</dd></div><div><dt>Stripe billing</dt><dd className="connected">{plan.stripePriceId ? "Price linked" : "Dynamic price"}</dd></div></dl><button className="ghost-button full" onClick={() => void toggle(plan)}>{plan.active ? "Hide from signup" : "Publish plan"}</button></article>)}</section><section className="info-strip"><div><strong>Public membership page</strong><span>Members choose a plan and pay securely through Stripe Checkout.</span></div><a href={publicAppUrl("/join")} className="ghost-button">Open signup page ↗</a></section></div>;
}

function Access({ members, doorOpen, hardwareState, setModal, operateDoor, createNfc }: { members: Member[]; doorOpen: boolean; hardwareState: HardwareState; setModal: (v: "scan") => void; notify: (v: string) => void; operateDoor: (action: "open" | "close") => Promise<void>; createNfc: (member: Member) => Promise<void> }) {
  const connected = hardwareState.door.status === "connected";
  return <div className="content-stack"><section className="section-toolbar"><div><p className="eyebrow">NFC & DOOR CONTROL</p><h2>Front entrance</h2><p>Approve valid members, record visits, and operate connected hardware.</p></div><button className="primary-button" onClick={() => setModal("scan")}>Start scanner</button></section><section className="access-grid"><article className={`door-panel ${doorOpen ? "open" : ""} ${connected ? "" : "device-offline"}`}><div className="door-status"><span><i />{connected ? (doorOpen ? "OPEN COMMAND SENT" : "CONNECTED") : "DISCONNECTED"}</span><small>{connected ? `${hardwareState.door.transport?.toUpperCase()} · ${hardwareState.door.message}` : "Set up a real controller in Settings"}</small></div><div className="door"><div><span>FLEX</span></div></div><h3>{connected ? hardwareState.door.name : "Front door"}</h3><p>{connected ? (doorOpen ? "Door open command was sent." : "Ready for a 5 second unlock pulse.") : "No commands are sent until hardware is connected."}</p><div className="button-row"><button className="primary-button" disabled={!connected} onClick={() => void operateDoor("open")}>Open door</button><button className="ghost-button" disabled={!connected} onClick={() => void operateDoor("close")}>Close door</button></div></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">KEY STATUS</p><h3>NFC credentials</h3></div><strong>{members.filter((m) => m.nfc).length}/{members.length}</strong></div><div className="access-list">{members.length ? members.map((member) => <div key={member.id}><span className="mini-avatar">{member.initials}</span><div><strong>{member.name}</strong><small>{member.nfc ? "Key assigned" : "No NFC key"}</small></div><button className="text-button" onClick={() => void createNfc(member)}>{member.nfc ? "Rewrite" : "Create"}</button></div>) : <p className="empty-state">No members yet. Add a member before creating an NFC key.</p>}</div></article></section></div>;
}

function POS({ products, setProducts, setModal, setEditingProduct, cart, addToCart, cartItems, subtotal, tax, checkout }: { products: Product[]; setProducts: React.Dispatch<React.SetStateAction<Product[]>>; setModal: (v: "product") => void; setEditingProduct: (product: Product | null) => void; cart: Record<string, number>; addToCart: (id: string) => void; cartItems: (Product & {quantity:number})[]; subtotal: number; tax: number; checkout: (method: "cash" | "card") => Promise<void> }) {
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("card");
  async function removeProduct(product: Product) { const response = await apiFetch(`/api/products?id=${encodeURIComponent(product.id)}`, { method: "DELETE" }); if (response.ok) setProducts((all) => all.filter((item) => item.id !== product.id)); }
  return <div className="pos-layout"><section className="catalog"><div className="section-toolbar"><div><p className="eyebrow">RETAIL</p><h2>Clothing inventory</h2></div><button className="primary-button" onClick={() => {setEditingProduct(null);setModal("product")}}>+ Add item</button></div><div className="product-grid">{products.map((product, index) => <article className="product-card" key={product.id}><div className={`product-art art-${index % 4}`}><span>{product.name.split(" ").at(-1)?.slice(0,2).toUpperCase()}</span></div><div className="product-copy"><p>{product.sku}</p><h3>{product.name}</h3><span>{product.meta}</span><div><strong>{money(product.price)}</strong><small>{product.stock} in stock</small></div><div className="product-actions"><button className="primary-button" disabled={product.stock <= (cart[product.id] || 0)} onClick={() => addToCart(product.id)}>Add to cart {cart[product.id] ? `(${cart[product.id]})` : ""}</button><button className="more-button" aria-label={`Edit ${product.name}`} onClick={() => {setEditingProduct(product);setModal("product")}}>Edit</button><button className="more-button remove" aria-label={`Remove ${product.name}`} onClick={() => void removeProduct(product)}>Remove</button></div></div></article>)}</div></section><aside className="cart-panel"><div><p className="eyebrow">CURRENT SALE</p><h2>Cart <span>{cartItems.reduce((sum,item) => sum + item.quantity,0)} items</span></h2></div><div className="cart-items">{cartItems.length ? cartItems.map((item) => <div key={item.id}><div><strong>{item.name}</strong><small>{item.quantity} × {money(item.price)}</small></div><b>{money(item.quantity * item.price)}</b></div>) : <div className="empty-cart"><span>FC</span><strong>No items yet</strong><p>Select clothing to begin a sale.</p></div>}</div><div className="totals"><p><span>Subtotal</span><strong>{money(subtotal)}</strong></p><p><span>Tax</span><strong>{money(tax)}</strong></p><p className="grand"><span>Total</span><strong>{money(subtotal + tax)}</strong></p><label>Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "card")}><option value="card">Card — Stripe</option><option value="cash">Cash</option></select></label><button className="primary-button full" disabled={!cartItems.length} onClick={() => void checkout(paymentMethod)}>Complete sale</button></div></aside></div>;
}

function Reports({ members, metrics, visits }: { members: Member[]; metrics: Metrics; visits: Visit[] }) {
  const debtors = members.filter((member) => member.balance > 0);
  return <div className="content-stack"><section className="section-toolbar"><div><p className="eyebrow">FINANCIAL & VISIT HISTORY</p><h2>Business reports</h2><p>Revenue, taxes, debtors, and every member entry in one place.</p></div><button className="ghost-button" onClick={() => window.print()}>Print report</button></section><section className="metrics-grid"><Metric label="Gross revenue" value={money(metrics.monthlyRevenue)} note="Current month" /><Metric label="Sales tax collected" value={money(metrics.tax)} note="Retail tax liability" tone="blue" /><Metric label="Membership debt" value={money(metrics.debt)} note={`${debtors.length} accounts outstanding`} tone="red" /><Metric label="Total visits" value={String(metrics.totalVisits)} note={`${metrics.visitsToday} today`} tone="green" /></section><section className="report-grid"><article className="panel"><div className="panel-head"><div><p className="eyebrow">REVENUE</p><h3>Income overview</h3></div><select><option>This month</option></select></div><div className="breakdown"><div><span className="orange" /><p><strong>Gross collected</strong><small>Memberships and clothing</small></p><b>{money(metrics.monthlyRevenue)}</b></div><div><span className="blue" /><p><strong>Sales tax</strong><small>Tracked separately for filing</small></p><b>{money(metrics.tax)}</b></div><div><span className="green" /><p><strong>Revenue before tax</strong><small>Gross less collected tax</small></p><b>{money(metrics.monthlyRevenue - metrics.tax)}</b></div></div></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">DEBTORS</p><h3>Outstanding accounts</h3></div><span>{debtors.length}</span></div><div className="access-list">{debtors.length ? debtors.map((member) => <div key={member.id}><span className="mini-avatar">{member.initials}</span><div><strong>{member.name}</strong><small>{member.plan} · Payment attention</small></div><b className="debt">{money(member.balance)}</b></div>) : <p className="empty-state">No outstanding member balances.</p>}</div></article></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">VISIT HISTORY</p><h3>Member entries</h3></div><span>{metrics.totalVisits} total visits</span></div><div className="table-wrap"><table><thead><tr><th>Member</th><th>Membership</th><th>Check-in</th><th>Method</th><th>Decision</th></tr></thead><tbody>{visits.length ? visits.map((visit) => <tr key={visit.id}><td><strong>{visit.memberName}</strong></td><td>{visit.plan}</td><td>{visit.when}</td><td>{visit.method}</td><td><StatusPill status={visit.result === "approved" ? "active" : "past_due"} /></td></tr>) : <tr><td className="empty-table" colSpan={5}>No visits have been recorded.</td></tr>}</tbody></table></div></section></div>;
}

function DeviceBadge({ connection }: { connection: HardwareState["door"] }) {
  return <span className={`integration-state ${connection.status === "connected" ? "" : "offline"}`}><i />{connection.status === "connecting" ? "Connecting…" : connection.status === "connected" ? `Connected · ${connection.transport}` : connection.status === "error" ? "Connection error" : "Not connected"}</span>;
}

function Settings({ taxRate, setTaxRate, integrations, hardwareState, onApiReady, notify }: { taxRate: number; setTaxRate: (v: number) => void; integrations: { stripe: boolean }; hardwareState: HardwareState; onApiReady: () => void; notify: (v: string) => void }) {
  const stored = hardware.configs();
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => getApiConfig());
  const [doorTransport, setDoorTransport] = useState<Transport>("wifi");
  const [readerTransport, setReaderTransport] = useState<Transport>("wifi");
  const [doorWifi, setDoorWifi] = useState<DoorWifiConfig>(stored.doorWifi);
  const [doorBluetooth, setDoorBluetooth] = useState<DoorBluetoothConfig>(stored.doorBluetooth);
  const [readerWifi, setReaderWifi] = useState<ReaderWifiConfig>(stored.readerWifi);
  const [readerBluetooth, setReaderBluetooth] = useState<ReaderBluetoothConfig>(stored.readerBluetooth);

  async function save() { const response = await apiFetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ tax_rate: taxRate }) }); notify(response.ok ? "Settings saved" : "Settings could not be saved"); }
  async function saveBackend() {
    const normalized = saveApiConfig(apiConfig);
    setApiConfig(normalized);
    try {
      const response = await apiFetch("/api/bootstrap", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "The backend URL or admin token is not authorized." : `Backend returned HTTP ${response.status}.`);
      onApiReady();
      notify("Secure backend connected");
    } catch (error) { notify(error instanceof Error ? error.message : "Backend connection failed"); }
  }
  async function connectDoor() {
    try {
      if (doorTransport === "wifi") await hardware.connectDoorWifi(doorWifi);
      else await hardware.connectDoorBluetooth(doorBluetooth);
      notify("Door controller connected");
    } catch (error) { notify(error instanceof Error ? error.message : "Door connection failed"); }
  }
  async function connectReader() {
    try {
      if (readerTransport === "wifi") await hardware.connectReaderWifi(readerWifi);
      else await hardware.connectReaderBluetooth(readerBluetooth);
      notify("NFC reader connected");
    } catch (error) { notify(error instanceof Error ? error.message : "NFC reader connection failed"); }
  }

  return <div className="settings-wrap"><section className="section-toolbar"><div><p className="eyebrow">CONFIGURATION</p><h2>Business settings</h2><p>Connect real hardware and set the rules used across Flex Connect.</p></div></section>
    {isGitHubPagesBuild && <section className="panel backend-settings"><div className="panel-head"><div><p className="eyebrow">GITHUB PAGES</p><h3>Secure data and Stripe backend</h3></div><span>Required for live data</span></div><div className="backend-form"><label>Backend URL<input value={apiConfig.baseUrl} onChange={(event) => setApiConfig({ ...apiConfig, baseUrl: event.target.value })} placeholder="https://your-flex-backend.example.com" /></label><label>Admin API token<input type="password" autoComplete="off" value={apiConfig.adminToken} onChange={(event) => setApiConfig({ ...apiConfig, adminToken: event.target.value })} placeholder="Stored only on this device" /></label><button className="primary-button" onClick={() => void saveBackend()}>Save and test</button></div><p className="hardware-note">GitHub Pages serves this interface. The backend securely handles Stripe secrets, webhooks, membership records, reports, and POS data.</p></section>}
    <section className="panel device-settings"><div className="panel-head"><div><p className="eyebrow">LOCAL HARDWARE</p><h3>Door and NFC devices</h3></div></div><div className="device-grid">
      <article className="device-card"><div className="device-card-head"><div><strong>Door controller</strong><small>{hardwareState.door.name || "Open/close relay"}</small></div><DeviceBadge connection={hardwareState.door} /></div><p className="device-message">{hardwareState.door.message}</p><label>Connection<select value={doorTransport} onChange={(event) => setDoorTransport(event.target.value as Transport)}><option value="wifi">Wi-Fi / local API</option><option value="bluetooth">Bluetooth LE</option></select></label>
        {doorTransport === "wifi" ? <div className="device-fields"><label>Controller URL<input value={doorWifi.endpoint} onChange={(event) => setDoorWifi({ ...doorWifi, endpoint: event.target.value })} placeholder="https://door.local/api/door" /></label><label>Bearer token<input type="password" autoComplete="off" value={doorWifi.token} onChange={(event) => setDoorWifi({ ...doorWifi, token: event.target.value })} placeholder="Optional device token" /></label></div> : <div className="device-fields"><label>BLE service UUID<input value={doorBluetooth.serviceUuid} onChange={(event) => setDoorBluetooth({ ...doorBluetooth, serviceUuid: event.target.value })} placeholder="Service UUID" /></label><label>Write characteristic UUID<input value={doorBluetooth.writeCharacteristicUuid} onChange={(event) => setDoorBluetooth({ ...doorBluetooth, writeCharacteristicUuid: event.target.value })} placeholder="Characteristic UUID" /></label><div className="split-fields"><label>Open command<input value={doorBluetooth.openCommand} onChange={(event) => setDoorBluetooth({ ...doorBluetooth, openCommand: event.target.value })} /></label><label>Close command<input value={doorBluetooth.closeCommand} onChange={(event) => setDoorBluetooth({ ...doorBluetooth, closeCommand: event.target.value })} /></label></div></div>}
        <div className="button-row">{hardwareState.door.status === "connected" ? <button className="ghost-button" onClick={() => { hardware.disconnectDoor(); notify("Door controller disconnected"); }}>Disconnect</button> : <button className="primary-button" disabled={hardwareState.door.status === "connecting"} onClick={() => void connectDoor()}>{doorTransport === "bluetooth" ? "Pair door controller" : "Connect door controller"}</button>}</div>
      </article>
      <article className="device-card"><div className="device-card-head"><div><strong>NFC reader / writer</strong><small>{hardwareState.reader.name || "Credential reader"}</small></div><DeviceBadge connection={hardwareState.reader} /></div><p className="device-message">{hardwareState.reader.message}</p><label>Connection<select value={readerTransport} onChange={(event) => setReaderTransport(event.target.value as Transport)}><option value="wifi">Wi-Fi / WebSocket</option><option value="bluetooth">Bluetooth LE</option></select></label>
        {readerTransport === "wifi" ? <div className="device-fields"><label>Reader WebSocket URL<input value={readerWifi.socketUrl} onChange={(event) => setReaderWifi({ ...readerWifi, socketUrl: event.target.value })} placeholder="wss://reader.local/tags" /></label><label>Bearer token<input type="password" autoComplete="off" value={readerWifi.token} onChange={(event) => setReaderWifi({ ...readerWifi, token: event.target.value })} placeholder="Optional device token" /></label><label>Write URL<input value={readerWifi.writeUrl} onChange={(event) => setReaderWifi({ ...readerWifi, writeUrl: event.target.value })} placeholder="Optional: https://…/write" /></label></div> : <div className="device-fields"><label>BLE service UUID<input value={readerBluetooth.serviceUuid} onChange={(event) => setReaderBluetooth({ ...readerBluetooth, serviceUuid: event.target.value })} placeholder="Service UUID" /></label><label>Notify characteristic UUID<input value={readerBluetooth.notifyCharacteristicUuid} onChange={(event) => setReaderBluetooth({ ...readerBluetooth, notifyCharacteristicUuid: event.target.value })} placeholder="Tag notification UUID" /></label><label>Write characteristic UUID<input value={readerBluetooth.writeCharacteristicUuid} onChange={(event) => setReaderBluetooth({ ...readerBluetooth, writeCharacteristicUuid: event.target.value })} placeholder="Optional writer UUID" /></label></div>}
        <div className="button-row">{hardwareState.reader.status === "connected" ? <button className="ghost-button" onClick={() => { hardware.disconnectReader(); notify("NFC reader disconnected"); }}>Disconnect</button> : <button className="primary-button" disabled={hardwareState.reader.status === "connecting"} onClick={() => void connectReader()}>{readerTransport === "bluetooth" ? "Pair NFC reader" : "Connect NFC reader"}</button>}</div>
      </article>
    </div><p className="hardware-note">Wi-Fi hardware must expose the shown local JSON/WebSocket interface and allow this site origin. Bluetooth hardware must expose writable or notifying GATT characteristics.</p></section>
    <section className="panel settings-card"><div className="setting-row"><div><strong>Stripe payments</strong><p>Accept recurring memberships and clothing payments.</p></div><span className={`integration-state ${integrations.stripe ? "" : "offline"}`}><i />{integrations.stripe ? "Configured" : "Needs secret key"}</span></div><div className="setting-row"><div><strong>Retail sales tax</strong><p>Applied to clothing sold through the POS.</p></div><label className="compact-input"><input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} /><span>%</span></label></div><div className="setting-row"><div><strong>Door unlock time</strong><p>How long the relay stays open after an approved scan.</p></div><select><option>5 seconds</option><option>8 seconds</option><option>10 seconds</option></select></div><button className="primary-button" onClick={() => void save()}>Save changes</button></section></div>;
}

function ScanPanel({ members, setMembers, hardwareState, onClose, notify, refreshData }: { members: Member[]; setMembers: React.Dispatch<React.SetStateAction<Member[]>>; hardwareState: HardwareState; onClose: () => void; notify: (v: string) => void; refreshData: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const member = useMemo(() => members.find((m) => m.name.toLowerCase().includes(token.toLowerCase()) || m.id === token || m.nfcToken === token.replace(/^flexconnect:/, "")), [members, token]);
  const checkIn = useCallback(async (payload: { memberId?: string; token?: string; method: string }) => {
    const response = await apiFetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json() as { approved?: boolean; reason?: string; member?: { name?: string }; error?: string };
    if (!response.ok || !result.approved) { notify(result.reason || result.error || "Access denied"); setScanning(false); return; }
    const name = result.member?.name || member?.name || "Member";
    setMembers((all) => all.map((item) => item.name === name ? {...item,visits:item.visits+1,lastVisit:"Just now"} : item));
    let message = `${name} checked in · Door is not connected`;
    if (hardwareState.door.status === "connected") {
      try { await hardware.operateDoor("open"); message = `${name} checked in · Open command sent`; }
      catch (error) { message = `${name} checked in · ${error instanceof Error ? error.message : "Door command failed"}`; }
    }
    notify(message); await refreshData(); onClose();
  }, [hardwareState.door.status, member?.name, notify, onClose, refreshData, setMembers]);

  async function startNfc() {
    if (hardwareState.reader.status === "connected") { setScanning(true); notify(`${hardwareState.reader.name} is already listening for keys`); return; }
    const NfcReader = (window as unknown as { NDEFReader?: new () => { scan: () => Promise<void>; onreading: null | ((event: { message: { records: Array<{ data?: DataView; encoding?: string }> } }) => void) } }).NDEFReader;
    if (!NfcReader) { notify("Connect an NFC reader in Settings or use Web NFC on Android"); return; }
    try {
      const reader = new NfcReader(); await reader.scan(); setScanning(true);
      reader.onreading = (event) => {
        const record = event.message.records[0];
        const value = record?.data ? new TextDecoder(record.encoding || "utf-8").decode(record.data) : "";
        if (value) { setToken(value); void checkIn({ token: value, method: "nfc" }); }
      };
    } catch { setScanning(false); notify("NFC scanning was canceled or blocked"); }
  }
  return <div className="scanner"><div className={`scanner-visual ${scanning ? "scanning" : ""}`}><div className="scan-ring"><span>NFC</span></div></div><h3>{scanning ? "Ready for an NFC key" : "Scan or search"}</h3><p>{hardwareState.reader.status === "connected" ? `${hardwareState.reader.name} is connected over ${hardwareState.reader.transport}.` : "Connect a Wi-Fi/Bluetooth reader in Settings, use Web NFC on Android, or select a member manually."}</p><button className="primary-button" onClick={() => void startNfc()}>{scanning ? "Listening…" : hardwareState.reader.status === "connected" ? "Listen on connected reader" : "Start built-in NFC"}</button><div className="or"><span>OR</span></div><input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Type member name or NFC token" />{token && <div className={`scan-result ${member ? "approved" : "denied"}`}>{member ? <><span>{member.initials}</span><div><strong>{member.name}</strong><small>{member.plan} · {member.status}</small></div><button onClick={() => void checkIn({ memberId: member.id, method: "manual" })}>Check in</button></> : <p>No matching credential found.</p>}</div>}</div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><div><p className="eyebrow">FLEX CONNECT</p><h2>{title}</h2></div><button onClick={onClose} aria-label="Close">×</button></header>{children}</section></div>;
}
