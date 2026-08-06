(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const gate = $("#storageGate");
  const app = $("#app");
  const view = $("#view");
  const modal = $("#modal");
  const modalBody = $("#modalBody");
  const titles = { overview: "Overview", members: "Members", plans: "Memberships", reports: "Visits & Reports", access: "Access & NFC", pos: "Clothing POS", signup: "Public Signup", website: "Edit Website", settings: "Settings" };
  const freshData = () => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      businessName: "Flex Connect", taxRate: 0, currency: "USD", unlockSeconds: 5,
      door: { type: "none", wifiUrl: "", unlockPath: "/unlock", lockPath: "/lock", method: "POST", token: "", serviceUuid: "", characteristicUuid: "", unlockCommand: "unlock", lockCommand: "lock" },
      nfc: { wsUrl: "", serialBaud: 9600, tagPrefix: "flex:" }
    },
    plans: [], members: [], visits: [], products: [], sales: [],
    website: { repo: "", branch: "", path: "" }
  });

  let data = freshData();
  let fileHandle = null;
  let directoryHandle = null;
  let currentView = "overview";
  let saveChain = Promise.resolve();
  let cart = [];
  let selectedSignupPlan = "";
  let doorCharacteristic = null;
  let doorOpen = false;
  let nfcReader = null;
  let nfcSocket = null;
  let serialPort = null;
  let toastTimer = null;
  let githubToken = "";
  const web = { user: null, repos: [], branches: [], files: [], doc: null, parts: { text: [], image: [], button: [] }, images: [], tab: "text", busy: "", message: "", commitUrl: "", timer: null };

  const id = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = value => new Intl.NumberFormat(undefined, { style: "currency", currency: data.settings.currency || "USD" }).format(number(value));
  const when = value => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const initials = name => String(name || "Member").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const planName = planId => data.plans.find(plan => plan.id === planId)?.name || "No plan";
  const todayKey = value => new Date(value).toLocaleDateString("en-CA");

  function normalize(input) {
    const base = freshData();
    const incoming = input && typeof input === "object" ? input : {};
    const settings = incoming.settings && typeof incoming.settings === "object" ? incoming.settings : {};
    data = {
      ...base, ...incoming,
      settings: { ...base.settings, ...settings, door: { ...base.settings.door, ...(settings.door || {}) }, nfc: { ...base.settings.nfc, ...(settings.nfc || {}) } },
      plans: Array.isArray(incoming.plans) ? incoming.plans : [], members: Array.isArray(incoming.members) ? incoming.members : [],
      visits: Array.isArray(incoming.visits) ? incoming.visits : [], products: Array.isArray(incoming.products) ? incoming.products : [], sales: Array.isArray(incoming.sales) ? incoming.sales : [],
      website: { ...base.website, ...(incoming.website && typeof incoming.website === "object" ? incoming.website : {}) }
    };
  }

  function notify(message, error = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast${error ? " error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 3600);
  }

  function setSaveState(label, busy = false) {
    const state = $("#saveState");
    state.textContent = label;
    state.classList.toggle("busy", busy);
  }

  async function readHandle(handle) {
    const file = await handle.getFile();
    if (!file.size) return freshData();
    return JSON.parse(await file.text());
  }

  function saveData(showToast = false) {
    if (!fileHandle) return Promise.reject(new Error("No storage file is connected."));
    data.updatedAt = new Date().toISOString();
    setSaveState("Saving…", true);
    saveChain = saveChain.catch(() => {}).then(async () => {
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      setSaveState("Saved to file");
      if (showToast) notify("Saved directly to flex-connect-data.json");
    }).catch(error => {
      setSaveState("Save failed", true);
      notify(`Could not save: ${error.message}`, true);
      throw error;
    });
    return saveChain;
  }

  async function chooseFolder() {
    if (!("showDirectoryPicker" in window)) throw new Error("Folder access is unavailable. Use current Chrome or Edge on desktop.");
    directoryHandle = await window.showDirectoryPicker({ mode: "readwrite", id: "flex-connect-storage" });
    fileHandle = await directoryHandle.getFileHandle("flex-connect-data.json", { create: true });
    normalize(await readHandle(fileHandle));
    await saveData();
    startApp(directoryHandle.name);
  }

  async function openDataFile() {
    if (!("showOpenFilePicker" in window)) throw new Error("Direct file access is unavailable. Use current Chrome or Edge on desktop.");
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "Flex Connect data", accept: { "application/json": [".json"] } }]
    });
    fileHandle = handle;
    directoryHandle = null;
    normalize(await readHandle(handle));
    startApp(handle.name);
  }

  function startApp(name) {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    $("#storageName").textContent = name || "Data file connected";
    render();
    notify("Storage connected. Autosave is active.");
  }

  async function storageAction(action) {
    try { await action(); }
    catch (error) {
      if (error.name !== "AbortError") {
        $("#storageSupport").textContent = error.message;
        notify(error.message, true);
      }
    }
  }

  $("#chooseFolder").addEventListener("click", () => storageAction(chooseFolder));
  $("#openDataFile").addEventListener("click", () => storageAction(openDataFile));
  $("#changeFolder").addEventListener("click", () => storageAction(chooseFolder));
  $("#saveNow").addEventListener("click", () => saveData(true));
  $("#storageSupport").textContent = "Recommended: Chrome or Edge on desktop. GitHub Pages provides the secure HTTPS connection required for hardware permissions.";

  $("#nav").addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    currentView = button.dataset.view;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function render() {
    $$("#nav [data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === currentView));
    $("#pageTitle").textContent = titles[currentView];
    $("#breadcrumb").textContent = `FLEX CONNECT / ${titles[currentView].toUpperCase()}`;
    $("#memberCount").textContent = data.members.length;
    ({ overview: renderOverview, members: renderMembers, plans: renderPlans, reports: renderReports, access: renderAccess, pos: renderPos, signup: renderSignup, website: renderWebsite, settings: renderSettings })[currentView]();
  }

  function toolbar(title, text, actions = "") {
    return `<section class="toolbar"><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div><div class="toolbar-actions">${actions}</div></section>`;
  }

  function empty(message) { return `<div class="empty">${esc(message)}</div>`; }

  function metrics() {
    const active = data.members.filter(member => member.status === "active").length;
    const today = data.visits.filter(visit => todayKey(visit.time) === todayKey(new Date()) && visit.result === "allowed").length;
    const revenue = data.sales.reduce((sum, sale) => sum + number(sale.total), 0);
    const debt = data.members.reduce((sum, member) => sum + number(member.debt), 0);
    return `<section class="cards">
      <article class="card metric"><span>Active members</span><strong>${active}</strong><small>${data.members.length} total member records</small></article>
      <article class="card metric blue"><span>Visits today</span><strong>${today}</strong><small>Approved NFC entries today</small></article>
      <article class="card metric green"><span>Total revenue</span><strong>${money(revenue)}</strong><small>Membership and clothing records</small></article>
      <article class="card metric red"><span>Outstanding debt</span><strong>${money(debt)}</strong><small>${data.members.filter(member => number(member.debt) > 0).length} debtors</small></article>
    </section>`;
  }

  function renderOverview() {
    const visits = data.visits.slice().sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 6);
    view.innerHTML = `${toolbar(`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${data.settings.businessName}.`, "Everything here is running from your selected local data file.", '<button class="secondary" data-action="add-member">Add member</button><button class="primary" data-action="scan-nfc">Start NFC scan</button>')}${metrics()}
      <section class="split"><article class="panel"><div class="panel-head"><h3>Latest member visits</h3><span>${data.visits.length} total records</span></div>${visitTable(visits)}</article>
      <article class="panel device"><h3>${doorOpen ? "Door unlocked" : "Door controller"}</h3><p>${doorOpen ? "The configured door has been sent an unlock command." : "Connect a Wi-Fi or Bluetooth controller under Access & NFC."}</p><div class="device-status ${doorCharacteristic ? "connected" : ""}">${doorCharacteristic ? "Bluetooth controller connected" : data.settings.door.type === "wifi" ? "Wi-Fi controller configured" : "Hardware setup needed"}</div><div class="button-row"><button class="primary" data-action="door-unlock">Unlock</button><button class="secondary" data-action="door-lock">Lock</button></div></article></section>`;
  }

  function memberRows(list) {
    if (!list.length) return `<tr><td colspan="7">No members yet. Add your first member to begin.</td></tr>`;
    return list.map(member => `<tr><td><strong>${esc(member.name)}</strong><br><small>${esc(member.email || "No email")}</small></td><td>${esc(planName(member.planId))}</td><td><span class="pill ${esc(member.status)}">${esc(member.status)}</span></td><td class="${number(member.debt) ? "debt" : ""}">${money(member.debt)}</td><td>${esc(member.nfcTag || "Not assigned")}</td><td>${member.visits || data.visits.filter(v => v.memberId === member.id && v.result === "allowed").length}</td><td><div class="row-actions"><button class="text-btn" data-action="record-payment" data-id="${member.id}">Payment</button><button class="text-btn" data-action="edit-member" data-id="${member.id}">Edit</button><button class="text-btn" data-action="delete-member" data-id="${member.id}">Remove</button></div></td></tr>`).join("");
  }

  function renderMembers() {
    view.innerHTML = `${toolbar("Members", "Member records stay blank until you add someone.", '<button class="primary" data-action="add-member">Add member</button>')}<article class="panel"><div class="filters"><input id="memberSearch" placeholder="Search members" aria-label="Search members"><select id="memberStatus" aria-label="Filter by status"><option value="">All statuses</option><option>active</option><option>pending</option><option>past_due</option><option>paused</option></select></div><div class="table-wrap"><table><thead><tr><th>Member</th><th>Membership</th><th>Status</th><th>Debt</th><th>NFC tag</th><th>Visits</th><th>Actions</th></tr></thead><tbody id="memberRows">${memberRows(data.members)}</tbody></table></div></article>`;
    const filter = () => {
      const q = $("#memberSearch").value.toLowerCase();
      const status = $("#memberStatus").value;
      $("#memberRows").innerHTML = memberRows(data.members.filter(member => (!status || member.status === status) && `${member.name} ${member.email} ${member.nfcTag}`.toLowerCase().includes(q)));
    };
    $("#memberSearch").addEventListener("input", filter);
    $("#memberStatus").addEventListener("change", filter);
  }

  function renderPlans() {
    view.innerHTML = `${toolbar("Membership options", "Create plans and attach a Stripe Payment Link to each one.", '<button class="primary" data-action="add-plan">Create membership</button>')}<section class="plan-grid">${data.plans.length ? data.plans.map(plan => `<article class="plan"><h3>${esc(plan.name)}</h3><p>${esc(plan.description || "No description")}</p><div class="price">${money(plan.price)} <span>/ ${esc(plan.interval || "month")}</span></div><p><strong>${data.members.filter(member => member.planId === plan.id).length}</strong> linked members<br>${plan.stripeLink ? "Stripe Payment Link connected" : "Add a Stripe Payment Link"}</p><div class="plan-actions">${plan.stripeLink ? `<button class="primary" data-action="open-stripe" data-id="${plan.id}">Subscribe</button>` : ""}<button class="secondary" data-action="edit-plan" data-id="${plan.id}">Edit</button><button class="danger" data-action="delete-plan" data-id="${plan.id}">Remove</button></div></article>`).join("") : empty("No membership options yet. Create the first plan and paste its Stripe Payment Link.")}</section>`;
  }

  function visitTable(list = data.visits) {
    if (!list.length) return empty("No visit history yet. A record will appear when an NFC key is scanned or a manual scan is tested.");
    return `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Tag</th><th>Time</th><th>Result</th><th>Source</th></tr></thead><tbody>${list.map(visit => `<tr><td><strong>${esc(visit.memberName || "Unknown key")}</strong></td><td>${esc(visit.tag || "—")}</td><td>${esc(when(visit.time))}</td><td><span class="pill ${visit.result === "allowed" ? "" : "denied"}">${esc(visit.result)}</span></td><td>${esc(visit.source || "NFC")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderReports() {
    const gross = data.sales.reduce((sum, sale) => sum + number(sale.total), 0);
    const tax = data.sales.reduce((sum, sale) => sum + number(sale.tax), 0);
    const debtors = data.members.filter(member => number(member.debt) > 0);
    const days = Array.from({ length: 7 }, (_, offset) => { const date = new Date(); date.setDate(date.getDate() - (6 - offset)); const key = todayKey(date); return { label: date.toLocaleDateString([], { weekday: "short" }), count: data.visits.filter(v => todayKey(v.time) === key && v.result === "allowed").length }; });
    const max = Math.max(1, ...days.map(day => day.count));
    view.innerHTML = `${toolbar("Visits and financial reports", "Revenue, tax, debtors, and entry history are calculated from your local file.")}
      <section class="cards"><article class="card metric"><span>Total visits</span><strong>${data.visits.filter(v => v.result === "allowed").length}</strong><small>${data.visits.filter(v => v.result !== "allowed").length} denied scans</small></article><article class="card metric blue"><span>Gross revenue</span><strong>${money(gross)}</strong><small>${data.sales.length} completed sales</small></article><article class="card metric green"><span>Revenue tax</span><strong>${money(tax)}</strong><small>${number(data.settings.taxRate).toFixed(2)}% current tax rate</small></article><article class="card metric red"><span>Debtors</span><strong>${debtors.length}</strong><small>${money(debtors.reduce((sum, member) => sum + number(member.debt), 0))} outstanding</small></article></section>
      <article class="panel"><div class="panel-head"><h3>Visits this week</h3><span>${days.reduce((sum, day) => sum + day.count, 0)} approved</span></div><div class="bar-chart">${days.map(day => `<div class="bar"><b>${day.count}</b><i style="height:${Math.max(5, day.count / max * 100)}%"></i><small>${day.label}</small></div>`).join("")}</div></article>
      <section class="split"><article class="panel"><div class="panel-head"><h3>Visit history</h3><button class="danger compact" data-action="clear-visits" ${data.visits.length ? "" : "disabled"}>Clear history</button></div>${visitTable(data.visits.slice().reverse())}</article><article class="panel"><div class="panel-head"><h3>Debtors</h3><span>${debtors.length}</span></div>${debtors.length ? `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Debt</th></tr></thead><tbody>${debtors.map(member => `<tr><td>${esc(member.name)}</td><td class="debt">${money(member.debt)}</td></tr>`).join("")}</tbody></table></div>` : empty("No debtors.")}</article></section>`;
  }

  function renderAccess() {
    const door = data.settings.door;
    view.innerHTML = `${toolbar("Door access and NFC", "Hardware permissions are requested only when you press a connect or scan button.", '<button class="primary" data-action="scan-nfc">Scan NFC key</button>')}
      <section class="access-grid"><article class="panel device"><h3>Door controller</h3><p>Connect directly over Web Bluetooth or call an HTTPS controller on the device network.</p><div class="device-status ${doorCharacteristic || door.type === "wifi" ? "connected" : ""}">${doorCharacteristic ? "Bluetooth controller connected" : door.type === "wifi" && door.wifiUrl ? "Wi-Fi controller configured" : "No controller connected"}</div><div class="button-row"><button class="secondary" data-action="connect-door">Connect Bluetooth</button><button class="primary" data-action="door-unlock">Open door</button><button class="secondary" data-action="door-lock">Close door</button></div></article>
      <article class="panel device"><h3>NFC reader</h3><p>Use Android Web NFC, an external serial reader, or a network reader WebSocket.</p><div id="nfcStatus" class="device-status ${nfcReader || serialPort || nfcSocket?.readyState === 1 ? "connected" : ""}">${nfcReader ? "Web NFC scanning" : serialPort ? "Serial NFC reader connected" : nfcSocket?.readyState === 1 ? "Network NFC reader connected" : "Reader disconnected"}</div><div class="button-row"><button class="primary" data-action="scan-nfc">Start Web NFC</button><button class="secondary" data-action="connect-serial">Connect serial reader</button><button class="secondary" data-action="connect-reader">Connect network reader</button><button class="secondary" data-action="write-nfc">Write NFC tag</button></div></article></section>
      <article class="panel device"><h3>Test or keyboard reader scan</h3><p>Many USB NFC readers type the tag value like a keyboard. Enter or scan a value here and press Enter.</p><form id="manualScan" class="form-grid"><label class="wide">NFC tag value<input name="tag" required autocomplete="off" placeholder="Scan or enter a key"></label><div class="modal-actions"><button class="primary">Process scan</button></div></form></article>
      <article class="panel"><div class="panel-head"><h3>Recent access events</h3><span>${data.visits.length}</span></div>${visitTable(data.visits.slice(-8).reverse())}</article>`;
    $("#manualScan").addEventListener("submit", event => { event.preventDefault(); const input = event.currentTarget.elements.tag; handleTag(input.value, "Manual / keyboard reader"); input.value = ""; });
  }

  function cartTotals() {
    const subtotal = cart.reduce((sum, item) => { const product = data.products.find(p => p.id === item.productId); return sum + (product ? number(product.price) * item.quantity : 0); }, 0);
    const tax = subtotal * number(data.settings.taxRate) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }

  function renderPos() {
    const totals = cartTotals();
    view.innerHTML = `${toolbar("Clothing point of sale", "Create, edit, remove, stock, and sell clothing products.", '<button class="primary" data-action="add-product">Create product</button>')}<section class="pos"><div class="product-grid">${data.products.length ? data.products.map(product => `<article class="product ${number(product.stock) < 1 ? "soldout" : ""}"><h3>${esc(product.name)}</h3><p>${esc(product.description || product.sku || "Clothing item")}</p><div class="price">${money(product.price)}</div><p class="stock">${number(product.stock)} in stock</p><div class="product-actions"><button class="primary" data-action="cart-add" data-id="${product.id}" ${number(product.stock) < 1 ? "disabled" : ""}>Add to cart</button><button class="secondary" data-action="edit-product" data-id="${product.id}">Edit</button><button class="danger" data-action="delete-product" data-id="${product.id}">Remove</button></div></article>`).join("") : empty("No clothing products yet. Create your first item.")}</div>
      <aside class="panel cart"><h2>Current sale</h2><div class="cart-items">${cart.length ? cart.map(item => { const product = data.products.find(p => p.id === item.productId); return product ? `<div class="cart-line"><div><strong>${esc(product.name)}</strong><small>${money(product.price)} × ${item.quantity}</small></div><button class="text-btn" data-action="cart-minus" data-id="${product.id}">−</button><button class="text-btn" data-action="cart-add" data-id="${product.id}">+</button></div>` : ""; }).join("") : empty("Cart is empty.")}</div><div class="totals"><p><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></p><p><span>Tax</span><strong>${money(totals.tax)}</strong></p><p class="grand"><span>Total</span><strong>${money(totals.total)}</strong></p><button class="primary full" data-action="checkout" ${cart.length ? "" : "disabled"}>Complete sale</button></div></aside></section>`;
  }

  function renderSignup() {
    if (!data.plans.some(plan => plan.id === selectedSignupPlan)) selectedSignupPlan = data.plans[0]?.id || "";
    view.innerHTML = `${toolbar("Public membership signup", "Members can choose a plan, save their record locally, and continue through Stripe's hosted checkout.")}<section class="signup signup-grid"><div class="signup-plans">${data.plans.length ? data.plans.map(plan => `<button class="signup-plan ${selectedSignupPlan === plan.id ? "selected" : ""}" data-action="select-signup-plan" data-id="${plan.id}"><div><h3>${esc(plan.name)}</h3><p>${esc(plan.description || "Membership plan")}</p></div><strong>${money(plan.price)} / ${esc(plan.interval)}</strong></button>`).join("") : empty("Create a membership option before using signup.")}</div><article class="panel signup-form"><h3>Member details</h3><form id="signupForm"><label>Full name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Phone<input name="phone" type="tel"></label><button class="primary full" ${selectedSignupPlan ? "" : "disabled"}>Save member & open Stripe</button><small>Stripe handles payment on its secure Payment Link. This page never sees card details.</small></form></article></section>`;
    $("#signupForm").addEventListener("submit", async event => {
      event.preventDefault();
      const plan = data.plans.find(item => item.id === selectedSignupPlan);
      if (!plan) return notify("Choose a membership plan.", true);
      const form = new FormData(event.currentTarget);
      const member = { id: id(), name: form.get("name").trim(), email: form.get("email").trim(), phone: form.get("phone").trim(), planId: plan.id, status: plan.stripeLink ? "pending" : "active", debt: 0, nfcTag: "", createdAt: new Date().toISOString() };
      data.members.push(member);
      await saveData();
      if (plan.stripeLink) {
        try { const url = new URL(plan.stripeLink); if (member.email) url.searchParams.set("prefilled_email", member.email); window.open(url.toString(), "_blank", "noopener,noreferrer"); }
        catch { window.open(plan.stripeLink, "_blank", "noopener,noreferrer"); }
        notify("Member saved. Stripe checkout opened in a new tab.");
      } else notify("Member saved. Add a Stripe Payment Link to this plan for checkout.");
      event.currentTarget.reset();
      render();
    });
  }

  const repoPath = name => String(name || "").split("/").map(encodeURIComponent).join("/");

  async function gh(path, options = {}) {
    if (!githubToken) throw new Error("Connect GitHub first.");
    const response = await fetch(`https://api.github.com${path}`, { ...options, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json", ...(options.headers || {}) } });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error("The GitHub key was not accepted.");
      if (response.status === 403) throw new Error("GitHub refused this action. Check the key's repository and Contents permissions.");
      if (response.status === 409) throw new Error("The branch changed while publishing. Reload the page and try again.");
      if (response.status === 422) throw new Error("GitHub could not publish to this branch. It may be protected.");
      throw new Error(result.message || `GitHub returned ${response.status}.`);
    }
    return result;
  }

  async function ghPages(path) {
    const result = [];
    for (let page = 1; page <= 10; page++) {
      const rows = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(rows)) break;
      result.push(...rows);
      if (rows.length < 100) break;
    }
    return result;
  }

  function clearWebDoc() {
    web.images.forEach(item => URL.revokeObjectURL(item.url));
    web.doc = null; web.parts = { text: [], image: [], button: [] }; web.images = []; web.commitUrl = "";
  }

  function selectedRepo() { return web.repos.find(repo => repo.full_name === data.website.repo); }

  function renderWebsite() {
    const connected = Boolean(githubToken && web.user);
    const connect = connected ? `<article class="panel gh-connect connected"><div class="gh-user"><b>GH</b><div><small>CONNECTED FOR THIS SESSION</small><h3>${esc(web.user.name || web.user.login)}</h3><p>${esc(web.user.login)} · key is not saved</p></div></div><div class="button-row"><button class="secondary" data-action="gh-refresh">Refresh repositories</button><button class="danger" data-action="gh-disconnect">Disconnect & clear key</button></div></article>` : `<article class="panel gh-connect"><div><p class="step">STEP 1 OF 4</p><h3>Connect your GitHub website</h3><p>Use a fine-grained personal access token with access only to the websites you want to edit. It needs <strong>Metadata: read</strong> and <strong>Contents: read and write</strong>.</p></div><form id="ghForm" class="gh-form"><label>GitHub key<input name="token" type="password" required autocomplete="off" placeholder="github_pat_••••••••"></label><button class="primary" ${web.busy ? "disabled" : ""}>${esc(web.busy || "Connect GitHub")}</button></form><div class="safe-note"><b>✓</b><p><strong>Session-only security.</strong> The key stays in memory and is cleared when this page closes. It is never written to the Flex Connect data file. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create a fine-grained key</a>.</p></div></article>`;
    const choose = connected ? `<article class="panel web-source"><div class="web-head"><div><p class="step">STEP 2 OF 4</p><h3>Choose the website to edit</h3><p>Select the repository, publishing branch, and HTML page. Flex Connect finds its text, images, buttons, and links automatically.</p></div>${web.busy ? `<span class="chip">${esc(web.busy)}</span>` : ""}</div><div class="web-selects"><label>Website repository<select id="webRepo" ${web.busy ? "disabled" : ""}><option value="">Choose a repository</option>${web.repos.map(repo => `<option value="${esc(repo.full_name)}" ${data.website.repo === repo.full_name ? "selected" : ""}>${esc(repo.full_name)}${repo.private ? " · private" : ""}${repo.permissions?.push === false ? " · view only" : ""}</option>`).join("")}</select></label><label>Publishing branch<select id="webBranch" ${!data.website.repo || web.busy ? "disabled" : ""}><option value="">Choose a branch</option>${web.branches.map(branch => `<option value="${esc(branch.name)}" ${data.website.branch === branch.name ? "selected" : ""}>${esc(branch.name)}</option>`).join("")}</select></label><label>Website page<select id="webFile" ${!data.website.branch || web.busy ? "disabled" : ""}><option value="">Choose an HTML page</option>${web.files.map(file => `<option value="${esc(file.path)}" ${data.website.path === file.path ? "selected" : ""}>${esc(file.path)}</option>`).join("")}</select></label></div>${selectedRepo()?.permissions?.push === false ? '<div class="web-warning">This repository is view-only for the connected account.</div>' : ""}</article>` : "";
    const editor = connected && web.doc ? editorMarkup() : "";
    view.innerHTML = `${toolbar("Edit a public website", "Change words, pictures, and buttons visually. No Cloudflare tunnel, backend, or coding is required.")}<section class="web-work">${connect}${choose}${web.message ? `<div class="web-message ${web.commitUrl ? "success" : ""}"><span>${esc(web.message)}</span>${web.commitUrl ? `<a href="${esc(web.commitUrl)}" target="_blank" rel="noopener noreferrer">Open GitHub commit</a>` : ""}</div>` : ""}${editor}</section>`;
    $("#ghForm")?.addEventListener("submit", event => { event.preventDefault(); connectGitHub(new FormData(event.currentTarget).get("token")); });
    $("#webRepo")?.addEventListener("change", event => loadRepo(event.target.value));
    $("#webBranch")?.addEventListener("change", event => loadBranch(event.target.value));
    $("#webFile")?.addEventListener("change", event => loadHtml(event.target.value));
    $("#webSearch")?.addEventListener("input", event => drawCards(event.target.value));
    $("#webCards")?.addEventListener("input", editPart);
    $("#webCards")?.addEventListener("change", replaceImage);
    updatePreview();
  }

  function editorMarkup() {
    const blocked = web.busy || selectedRepo()?.permissions?.push === false;
    return `<section class="web-editor"><article class="panel edit-panel"><div class="web-head"><div><p class="step">STEP 3 OF 4</p><h3>Edit the page</h3><p>Type into a box or choose a replacement image. The preview updates as you work.</p></div><span class="chip">${esc(data.website.path)}</span></div><div class="part-tabs"><button data-action="web-tab" data-tab="text" class="${web.tab === "text" ? "active" : ""}"><b>T</b>Text <em>${web.parts.text.length}</em></button><button data-action="web-tab" data-tab="image" class="${web.tab === "image" ? "active" : ""}"><b>I</b>Images <em>${web.parts.image.length}</em></button><button data-action="web-tab" data-tab="button" class="${web.tab === "button" ? "active" : ""}"><b>B</b>Buttons & links <em>${web.parts.button.length}</em></button></div><div class="web-search"><input id="webSearch" type="search" placeholder="Find something on this page"></div><div id="webCards" class="web-cards">${cards(web.tab)}</div></article><aside class="panel web-preview"><div class="panel-head"><div><h3>Live preview</h3><span>Safe, isolated preview</span></div><button class="secondary compact" data-action="web-preview">Refresh</button></div><iframe id="webPreview" title="Website preview" sandbox="allow-scripts allow-forms allow-popups"></iframe></aside><article class="panel web-publish"><div><p class="step">STEP 4 OF 4</p><h3>Publish your changes</h3><p>Creates one GitHub commit with the edited HTML and replacement images. GitHub Pages, Cloudflare Pages, or another connected host can deploy it automatically.</p></div><div class="publish-row"><label>Change note<input id="commitMessage" value="Update website with Flex Connect" maxlength="120"></label><button class="primary" data-action="web-publish" ${blocked ? "disabled" : ""}>${esc(web.busy || "Publish to GitHub")}</button></div></article></section>`;
  }

  function targetValue(item, kind) { return kind === "image" ? `${item.el.getAttribute("src") || ""} ${item.el.getAttribute("alt") || ""}` : item.get(); }

  function cards(kind, query = "") {
    const q = query.trim().toLowerCase();
    const items = web.parts[kind].map((item, index) => ({ item, index })).filter(row => !q || `${row.item.context} ${targetValue(row.item, kind)}`.toLowerCase().includes(q));
    if (!items.length) return empty(q ? "No matching items." : "Nothing editable was found in this category.");
    return items.map(({ item, index }) => {
      if (kind === "text") return `<article class="edit-card"><div class="card-name"><b>T</b><div><strong>${esc(item.label)}</strong><small>${esc(item.context)}</small></div></div><label>Text${item.get().length > 90 ? `<textarea data-kind="text" data-index="${index}" data-field="value">${esc(item.get())}</textarea>` : `<input data-kind="text" data-index="${index}" data-field="value" value="${esc(item.get())}">`}</label></article>`;
      if (kind === "image") return `<article class="edit-card image-edit"><img src="${esc(imagePreview(item, index))}" alt=""><div><div class="card-name"><b>I</b><div><strong>${esc(item.label)}</strong><small>${esc(item.context)}</small></div></div><label>Image description<input data-kind="image" data-index="${index}" data-field="alt" value="${esc(item.el.getAttribute("alt") || "")}"></label><label class="image-pick">Replace this image<input type="file" accept="image/*" data-image data-index="${index}"></label></div></article>`;
      const href = item.el.tagName === "A" ? item.el.getAttribute("href") || "" : null;
      return `<article class="edit-card"><div class="card-name"><b>B</b><div><strong>${item.el.tagName === "A" ? "Link" : "Button"}</strong><small>${esc(item.context)}</small></div></div><label>Button text<input data-kind="button" data-index="${index}" data-field="value" value="${esc(item.get())}"></label>${href !== null ? `<label>Goes to<input data-kind="button" data-index="${index}" data-field="href" value="${esc(href)}" placeholder="https://example.com or /page.html"></label>` : ""}</article>`;
    }).join("");
  }

  function drawCards(query = "") { const area = $("#webCards"); if (area) area.innerHTML = cards(web.tab, query); }

  async function connectGitHub(token) {
    githubToken = String(token || "").trim(); if (!githubToken) return;
    web.busy = "Connecting…"; web.message = ""; renderWebsite();
    try {
      [web.user, web.repos] = await Promise.all([gh("/user"), ghPages("/user/repos?sort=updated&affiliation=owner%2Ccollaborator%2Corganization_member")]);
      web.repos.sort((a, b) => a.full_name.localeCompare(b.full_name)); web.busy = ""; web.message = `${web.repos.length} repositories available.`;
      if (data.website.repo && web.repos.some(repo => repo.full_name === data.website.repo)) await loadRepo(data.website.repo, true); else renderWebsite();
    } catch (error) { githubToken = ""; web.user = null; web.repos = []; web.busy = ""; web.message = error.message; renderWebsite(); notify(error.message, true); }
  }

  async function refreshRepos() {
    web.busy = "Refreshing…"; renderWebsite();
    try { web.repos = (await ghPages("/user/repos?sort=updated&affiliation=owner%2Ccollaborator%2Corganization_member")).sort((a, b) => a.full_name.localeCompare(b.full_name)); web.busy = ""; web.message = "Repository list refreshed."; renderWebsite(); }
    catch (error) { web.busy = ""; web.message = error.message; renderWebsite(); }
  }

  function disconnectGitHub() { githubToken = ""; web.user = null; web.repos = []; web.branches = []; web.files = []; clearWebDoc(); web.message = "GitHub disconnected. The key was cleared from memory."; renderWebsite(); }

  async function loadRepo(name, keep = false) {
    const oldBranch = keep ? data.website.branch : "", oldPath = keep ? data.website.path : ""; clearWebDoc(); web.branches = []; web.files = []; data.website = { repo: name, branch: "", path: "" };
    if (!name) { await saveData(); return renderWebsite(); }
    web.busy = "Finding branches…"; web.message = ""; renderWebsite();
    try { web.branches = await ghPages(`/repos/${repoPath(name)}/branches`); const repo = selectedRepo(); const branch = web.branches.some(item => item.name === oldBranch) ? oldBranch : repo.default_branch || web.branches[0]?.name; if (!branch) throw new Error("No branches were found."); data.website.branch = branch; await loadBranch(branch, oldPath); }
    catch (error) { web.busy = ""; web.message = error.message; renderWebsite(); notify(error.message, true); }
  }

  async function loadBranch(name, preferred = "") {
    clearWebDoc(); web.files = []; data.website.branch = name; data.website.path = "";
    if (!name) { await saveData(); return renderWebsite(); }
    const branch = web.branches.find(item => item.name === name); web.busy = "Finding website pages…"; renderWebsite();
    try { const tree = await gh(`/repos/${repoPath(data.website.repo)}/git/trees/${encodeURIComponent(branch.commit.sha)}?recursive=1`); web.files = (tree.tree || []).filter(item => item.type === "blob" && /\.html?$/i.test(item.path)).sort((a, b) => a.path.localeCompare(b.path)); if (!web.files.length) throw new Error("No HTML pages were found in this branch."); const path = web.files.some(file => file.path === preferred) ? preferred : web.files.find(file => file.path.toLowerCase() === "index.html")?.path || web.files.find(file => /(^|\/)index\.html$/i.test(file.path))?.path || web.files[0].path; await loadHtml(path); }
    catch (error) { web.busy = ""; web.message = error.message; await saveData(); renderWebsite(); notify(error.message, true); }
  }

  async function loadHtml(path) {
    clearWebDoc(); data.website.path = path;
    if (!path) { await saveData(); return renderWebsite(); }
    const file = web.files.find(item => item.path === path); web.busy = "Opening page…"; web.message = ""; renderWebsite();
    try { const blob = await gh(`/repos/${repoPath(data.website.repo)}/git/blobs/${encodeURIComponent(file.sha)}`); const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, "")), char => char.charCodeAt(0)); web.doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "text/html"); analyzeHtml(); web.busy = ""; web.message = `Ready to edit ${path}.`; await saveData(); renderWebsite(); }
    catch (error) { web.busy = ""; web.message = error.message; renderWebsite(); notify(error.message, true); }
  }

  function contextFor(el) { const area = el.closest("section,header,footer,nav,main,article") || el.parentElement; const heading = area?.querySelector("h1,h2,h3")?.textContent?.trim().replace(/\s+/g, " "); return heading && heading.length < 70 ? heading : area?.id ? `#${area.id}` : area?.tagName?.toLowerCase() || "page"; }
  function textPart(node, label, el = node.parentElement) { const match = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/); const before = match?.[1] || "", after = match?.[3] || ""; return { el, label, context: contextFor(el), get: () => node.nodeValue.trim(), set: value => { node.nodeValue = `${before}${value}${after}`; } }; }
  function buttonText(el) { const walker = web.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) if (node.nodeValue.trim() && !node.parentElement.closest("svg")) return node; return null; }

  function analyzeHtml() {
    const parts = { text: [], image: [], button: [] }, walker = web.doc.createTreeWalker(web.doc.body, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { const el = node.parentElement, value = node.nodeValue.trim(); if (!value || !el || el.closest("script,style,svg,noscript,template,a,button")) continue; const tag = el.tagName.toLowerCase(); parts.text.push(textPart(node, /^h[1-6]$/.test(tag) ? "Heading" : tag === "p" ? "Paragraph" : tag === "li" ? "List item" : "Text", el)); }
    [...web.doc.querySelectorAll("img")].forEach((el, i) => parts.image.push({ el, label: el.getAttribute("alt") || `Image ${i + 1}`, context: contextFor(el) }));
    [...web.doc.querySelectorAll("a,button")].forEach(el => { const node = buttonText(el); if (node) parts.button.push(textPart(node, el.tagName === "A" ? "Link" : "Button", el)); else if (el.getAttribute("aria-label")) parts.button.push({ el, label: "Button", context: contextFor(el), get: () => el.getAttribute("aria-label") || "", set: value => el.setAttribute("aria-label", value) }); });
    web.parts = parts;
  }

  function editPart(event) { const input = event.target.closest("[data-field]"); if (!input) return; const item = web.parts[input.dataset.kind]?.[number(input.dataset.index)]; if (!item) return; if (input.dataset.field === "value") item.set(input.value); else if (input.dataset.field === "href") input.value ? item.el.setAttribute("href", input.value) : item.el.removeAttribute("href"); else item.el.setAttribute("alt", input.value); clearTimeout(web.timer); web.timer = setTimeout(updatePreview, 250); }

  async function replaceImage(event) {
    const input = event.target.closest("[data-image]"), file = input?.files?.[0]; if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) return notify("Choose an image smaller than 20 MB.", true);
    const index = number(input.dataset.index), target = web.parts.image[index], old = web.images.find(item => item.index === index); if (old) { URL.revokeObjectURL(old.url); web.images = web.images.filter(item => item !== old); }
    const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "image"; const dir = data.website.path.includes("/") ? data.website.path.slice(0, data.website.path.lastIndexOf("/") + 1) : ""; const relative = `assets/flex-connect/${Date.now()}-${safe}`;
    web.images.push({ index, file, path: `${dir}${relative}`, url: URL.createObjectURL(file) }); target.el.setAttribute("src", relative); drawCards($("#webSearch")?.value || ""); updatePreview(); notify("Replacement image is ready to publish.");
  }

  function rawBase() { const [owner, repo] = data.website.repo.split("/"); const dir = data.website.path.includes("/") ? data.website.path.slice(0, data.website.path.lastIndexOf("/") + 1) : ""; const revision = web.branches.find(item => item.name === data.website.branch)?.commit?.sha || data.website.branch; return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(revision)}/${dir.split("/").filter(Boolean).map(encodeURIComponent).join("/")}${dir ? "/" : ""}`; }
  function imagePreview(item, index) { const staged = web.images.find(image => image.index === index); if (staged) return staged.url; try { return new URL(item.el.getAttribute("src") || "", rawBase()).href; } catch { return item.el.getAttribute("src") || ""; } }
  function serialize(doc = web.doc) { return `${doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!doctype html>"}\n${doc.documentElement.outerHTML}`; }
  function updatePreview() { clearTimeout(web.timer); const frame = $("#webPreview"); if (!frame || !web.doc) return; const clone = new DOMParser().parseFromString(serialize(), "text/html"); const base = clone.createElement("base"); base.href = rawBase(); base.target = "_blank"; clone.head.prepend(base); const images = [...clone.querySelectorAll("img")]; web.images.forEach(item => { if (images[item.index]) images[item.index].src = item.url; }); frame.srcdoc = serialize(clone); }
  function buffer64(buffer) { const bytes = new Uint8Array(buffer); let value = ""; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value); }

  async function publishHtml() {
    const repo = selectedRepo(); if (!repo || !web.doc) throw new Error("Choose a website page first."); if (repo.permissions?.push === false) throw new Error("This account cannot publish to this repository.");
    const message = $("#commitMessage")?.value.trim() || "Update website with Flex Connect"; web.busy = "Publishing…"; web.message = "Creating one GitHub commit…"; renderWebsite();
    try { const rp = repoPath(data.website.repo), branch = data.website.branch.split("/").map(encodeURIComponent).join("/"); const head = await gh(`/repos/${rp}/git/ref/heads/${branch}`); const parent = await gh(`/repos/${rp}/git/commits/${head.object.sha}`); const html = await gh(`/repos/${rp}/git/blobs`, { method: "POST", body: JSON.stringify({ content: serialize(), encoding: "utf-8" }) }); const entries = [{ path: data.website.path, mode: "100644", type: "blob", sha: html.sha }]; for (const image of web.images) { const blob = await gh(`/repos/${rp}/git/blobs`, { method: "POST", body: JSON.stringify({ content: buffer64(await image.file.arrayBuffer()), encoding: "base64" }) }); entries.push({ path: image.path, mode: "100644", type: "blob", sha: blob.sha }); } const tree = await gh(`/repos/${rp}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries }) }); const commit = await gh(`/repos/${rp}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [head.object.sha] }) }); await gh(`/repos/${rp}/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) }); const current = web.branches.find(item => item.name === data.website.branch); if (current?.commit) current.commit.sha = commit.sha; web.images.forEach(item => URL.revokeObjectURL(item.url)); web.images = []; web.busy = ""; web.message = "Published to GitHub. Your connected website host can now deploy this commit."; web.commitUrl = `https://github.com/${data.website.repo}/commit/${commit.sha}`; renderWebsite(); notify("Website published to GitHub."); }
    catch (error) { web.busy = ""; web.message = error.message; renderWebsite(); notify(error.message, true); }
  }

  function renderSettings() {
    const s = data.settings, d = s.door, n = s.nfc;
    view.innerHTML = `${toolbar("Settings", "All settings are written directly into the selected JSON file.")}
      <form id="settingsForm" class="settings-grid"><article class="panel settings-card"><h3>Business</h3><p>Reporting and receipt defaults.</p><div class="form-grid"><label class="wide">Business name<input name="businessName" value="${esc(s.businessName)}" required></label><label>Tax rate (%)<input name="taxRate" type="number" min="0" step="0.01" value="${number(s.taxRate)}"></label><label>Currency<select name="currency"><option ${s.currency === "USD" ? "selected" : ""}>USD</option><option ${s.currency === "CAD" ? "selected" : ""}>CAD</option><option ${s.currency === "GBP" ? "selected" : ""}>GBP</option><option ${s.currency === "EUR" ? "selected" : ""}>EUR</option></select></label><label>Auto-lock delay (seconds)<input name="unlockSeconds" type="number" min="0" value="${number(s.unlockSeconds)}"></label></div></article>
      <article class="panel settings-card"><h3>Door controller</h3><p>Use Wi-Fi HTTPS or Web Bluetooth.</p><div class="form-grid"><label>Connection<select name="doorType"><option value="none" ${d.type === "none" ? "selected" : ""}>Not configured</option><option value="wifi" ${d.type === "wifi" ? "selected" : ""}>Wi-Fi / HTTPS</option><option value="bluetooth" ${d.type === "bluetooth" ? "selected" : ""}>Bluetooth LE</option></select></label><label>HTTP method<select name="doorMethod"><option ${d.method === "POST" ? "selected" : ""}>POST</option><option ${d.method === "GET" ? "selected" : ""}>GET</option></select></label><label class="wide">Controller HTTPS URL<input name="wifiUrl" value="${esc(d.wifiUrl)}" placeholder="https://door-controller.local"></label><label>Unlock path<input name="unlockPath" value="${esc(d.unlockPath)}"></label><label>Lock path<input name="lockPath" value="${esc(d.lockPath)}"></label><label class="wide">Bearer token (optional)<input name="doorToken" type="password" value="${esc(d.token)}"></label><label>BLE service UUID<input name="serviceUuid" value="${esc(d.serviceUuid)}"></label><label>BLE characteristic UUID<input name="characteristicUuid" value="${esc(d.characteristicUuid)}"></label><label>Unlock command<input name="unlockCommand" value="${esc(d.unlockCommand)}"></label><label>Lock command<input name="lockCommand" value="${esc(d.lockCommand)}"></label></div></article>
      <article class="panel settings-card"><h3>NFC readers</h3><p>Web NFC needs Android Chrome. USB readers can connect through Web Serial.</p><div class="form-grid"><label class="wide">Network reader WebSocket<input name="wsUrl" value="${esc(n.wsUrl)}" placeholder="wss://reader.example"></label><label>Serial baud rate<input name="serialBaud" type="number" value="${number(n.serialBaud)}"></label><label>NFC tag prefix<input name="tagPrefix" value="${esc(n.tagPrefix)}"></label></div></article>
      <article class="panel settings-card"><h3>Browser capabilities</h3><p>No browser database is used.</p><div class="cap-list"><div class="cap"><span>Direct folder storage</span><b class="${"showDirectoryPicker" in window ? "yes" : "no"}">${"showDirectoryPicker" in window ? "Available" : "Unavailable"}</b></div><div class="cap"><span>Web Bluetooth</span><b class="${navigator.bluetooth ? "yes" : "no"}">${navigator.bluetooth ? "Available" : "Unavailable"}</b></div><div class="cap"><span>Web NFC</span><b class="${"NDEFReader" in window ? "yes" : "no"}">${"NDEFReader" in window ? "Available" : "Unavailable"}</b></div><div class="cap"><span>Web Serial</span><b class="${navigator.serial ? "yes" : "no"}">${navigator.serial ? "Available" : "Unavailable"}</b></div></div></article>
      <div class="modal-actions"><button class="primary" type="submit">Save settings</button></div></form>`;
    $("#settingsForm").addEventListener("submit", async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget);
      data.settings.businessName = f.get("businessName").trim(); data.settings.taxRate = number(f.get("taxRate")); data.settings.currency = f.get("currency"); data.settings.unlockSeconds = number(f.get("unlockSeconds"));
      Object.assign(data.settings.door, { type: f.get("doorType"), method: f.get("doorMethod"), wifiUrl: f.get("wifiUrl").trim().replace(/\/$/, ""), unlockPath: f.get("unlockPath").trim(), lockPath: f.get("lockPath").trim(), token: f.get("doorToken").trim(), serviceUuid: f.get("serviceUuid").trim(), characteristicUuid: f.get("characteristicUuid").trim(), unlockCommand: f.get("unlockCommand"), lockCommand: f.get("lockCommand") });
      Object.assign(data.settings.nfc, { wsUrl: f.get("wsUrl").trim(), serialBaud: number(f.get("serialBaud")), tagPrefix: f.get("tagPrefix") });
      await saveData(); notify("Settings saved to the data file."); render();
    });
  }

  function openModal(title, html, onSubmit) {
    $("#modalTitle").textContent = title;
    modalBody.innerHTML = `<div class="modal-content">${html}</div>`;
    modal.classList.remove("hidden");
    const form = $("form", modalBody);
    if (form && onSubmit) form.addEventListener("submit", onSubmit);
    setTimeout(() => $("input,select", modalBody)?.focus(), 50);
  }
  function closeModal() { modal.classList.add("hidden"); modalBody.innerHTML = ""; }
  $("#closeModal").addEventListener("click", closeModal);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });

  function memberModal(member) {
    const editing = Boolean(member); member ||= { name: "", email: "", phone: "", planId: "", status: "active", debt: 0, nfcTag: "" };
    openModal(editing ? "Edit member" : "Add member", `<form class="form-grid"><label>Full name<input name="name" value="${esc(member.name)}" required></label><label>Email<input name="email" type="email" value="${esc(member.email)}"></label><label>Phone<input name="phone" value="${esc(member.phone)}"></label><label>Membership<select name="planId"><option value="">No plan</option>${data.plans.map(plan => `<option value="${plan.id}" ${member.planId === plan.id ? "selected" : ""}>${esc(plan.name)}</option>`).join("")}</select></label><label>Status<select name="status">${["active", "pending", "past_due", "paused"].map(status => `<option ${member.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label>Outstanding debt<input name="debt" type="number" min="0" step="0.01" value="${number(member.debt)}"></label><label class="wide">NFC tag ID<input name="nfcTag" value="${esc(member.nfcTag)}" placeholder="Scan or type a unique key"></label><div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">${editing ? "Save member" : "Add member"}</button></div></form>`, async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget); const tag = f.get("nfcTag").trim();
      if (tag && data.members.some(item => item.id !== member.id && item.nfcTag === tag)) return notify("That NFC key is already assigned.", true);
      const record = { ...member, id: member.id || id(), name: f.get("name").trim(), email: f.get("email").trim(), phone: f.get("phone").trim(), planId: f.get("planId"), status: f.get("status"), debt: number(f.get("debt")), nfcTag: tag, createdAt: member.createdAt || new Date().toISOString() };
      if (editing) data.members[data.members.findIndex(item => item.id === member.id)] = record; else data.members.push(record);
      await saveData(); closeModal(); notify(editing ? "Member updated." : "Member added."); render();
    });
    $("[data-close]", modalBody).addEventListener("click", closeModal);
  }

  function planModal(plan) {
    const editing = Boolean(plan); plan ||= { name: "", description: "", price: 0, interval: "month", stripeLink: "" };
    openModal(editing ? "Edit membership" : "Create membership", `<form class="form-grid"><label>Plan name<input name="name" value="${esc(plan.name)}" required></label><label>Price<input name="price" type="number" min="0" step="0.01" value="${number(plan.price)}" required></label><label>Billing interval<select name="interval">${["week", "month", "year", "one time"].map(interval => `<option ${plan.interval === interval ? "selected" : ""}>${interval}</option>`).join("")}</select></label><label class="wide">Description<textarea name="description">${esc(plan.description)}</textarea></label><label class="wide">Stripe Payment Link<input name="stripeLink" type="url" value="${esc(plan.stripeLink)}" placeholder="https://buy.stripe.com/..."></label><div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Save membership</button></div></form>`, async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget); const link = f.get("stripeLink").trim();
      if (link && !/^https:\/\/(buy\.)?stripe\.com\//i.test(link)) return notify("Use a secure Stripe Payment Link beginning with https://buy.stripe.com/", true);
      const record = { ...plan, id: plan.id || id(), name: f.get("name").trim(), description: f.get("description").trim(), price: number(f.get("price")), interval: f.get("interval"), stripeLink: link };
      if (editing) data.plans[data.plans.findIndex(item => item.id === plan.id)] = record; else data.plans.push(record);
      await saveData(); closeModal(); notify("Membership saved."); render();
    });
    $("[data-close]", modalBody).addEventListener("click", closeModal);
  }

  function productModal(product) {
    const editing = Boolean(product); product ||= { name: "", sku: "", description: "", price: 0, stock: 0 };
    openModal(editing ? "Edit product" : "Create product", `<form class="form-grid"><label>Product name<input name="name" value="${esc(product.name)}" required></label><label>SKU<input name="sku" value="${esc(product.sku)}"></label><label>Price<input name="price" type="number" min="0" step="0.01" value="${number(product.price)}" required></label><label>Stock<input name="stock" type="number" min="0" step="1" value="${number(product.stock)}" required></label><label class="wide">Description<textarea name="description">${esc(product.description)}</textarea></label><div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Save product</button></div></form>`, async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget); const record = { ...product, id: product.id || id(), name: f.get("name").trim(), sku: f.get("sku").trim(), description: f.get("description").trim(), price: number(f.get("price")), stock: Math.max(0, Math.floor(number(f.get("stock")))) };
      if (editing) data.products[data.products.findIndex(item => item.id === product.id)] = record; else data.products.push(record);
      await saveData(); closeModal(); notify("Product saved."); render();
    });
    $("[data-close]", modalBody).addEventListener("click", closeModal);
  }

  function paymentModal(member) {
    const plan = data.plans.find(item => item.id === member.planId);
    openModal("Record membership payment", `<form class="form-grid"><label class="wide">Member<input value="${esc(member.name)}" disabled></label><label>Amount before tax<input name="amount" type="number" min="0" step="0.01" value="${number(plan?.price)}" required></label><label>Reduce outstanding debt by<input name="debtPayment" type="number" min="0" step="0.01" value="${Math.min(number(member.debt), number(plan?.price))}"></label><div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Record payment</button></div></form>`, async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget); const subtotal = number(f.get("amount")); const tax = subtotal * number(data.settings.taxRate) / 100;
      data.sales.push({ id: id(), time: new Date().toISOString(), kind: "membership", memberId: member.id, memberName: member.name, planId: member.planId, subtotal, tax, total: subtotal + tax });
      member.debt = Math.max(0, number(member.debt) - number(f.get("debtPayment")));
      if (member.status === "pending" || member.status === "past_due") member.status = "active";
      await saveData(); closeModal(); notify("Membership payment recorded."); render();
    });
    $("[data-close]", modalBody).addEventListener("click", closeModal);
  }

  async function handleTag(rawTag, source = "NFC") {
    const tag = String(rawTag || "").trim();
    if (!tag) return notify("The reader did not return a tag value.", true);
    const prefix = data.settings.nfc.tagPrefix || "";
    const clean = prefix && tag.startsWith(prefix) ? tag.slice(prefix.length) : tag;
    const member = data.members.find(item => item.nfcTag === clean || item.nfcTag === tag);
    const allowed = Boolean(member && member.status === "active" && number(member.debt) <= 0);
    data.visits.push({ id: id(), memberId: member?.id || "", memberName: member?.name || "Unknown key", tag: clean, time: new Date().toISOString(), result: allowed ? "allowed" : "denied", source });
    await saveData();
    if (allowed) { notify(`${member.name} approved. Opening door.`); await doorAction("unlock"); }
    else notify(member ? `${member.name} was denied: ${member.status !== "active" ? `membership is ${member.status}` : "outstanding debt"}.` : "Unknown NFC key denied.", true);
    render();
  }

  async function startWebNfc() {
    if (!("NDEFReader" in window)) throw new Error("Web NFC is unavailable. Use Android Chrome or connect an external reader.");
    nfcReader = new NDEFReader();
    await nfcReader.scan();
    nfcReader.onreadingerror = () => notify("The NFC tag could not be read.", true);
    nfcReader.onreading = event => {
      let value = event.serialNumber || "";
      for (const record of event.message.records) {
        if (record.recordType === "text" || record.recordType === "url") { value = new TextDecoder(record.encoding || "utf-8").decode(record.data); break; }
      }
      handleTag(value, "Web NFC");
    };
    notify("NFC permission granted. Hold a tag near the device."); render();
  }

  async function writeNfc() {
    if (!("NDEFReader" in window)) throw new Error("NFC writing requires Android Chrome with Web NFC.");
    openModal("Write NFC tag", `<form class="form-grid"><label class="wide">Member<select name="memberId" required><option value="">Select member</option>${data.members.map(member => `<option value="${member.id}">${esc(member.name)}</option>`).join("")}</select></label><label class="wide">Tag value<input name="tag" value="${id()}" required></label><div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Write tag</button></div></form>`, async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget); const member = data.members.find(item => item.id === f.get("memberId")); if (!member) return;
      const tag = f.get("tag").trim(); const writer = new NDEFReader(); await writer.write({ records: [{ recordType: "text", data: `${data.settings.nfc.tagPrefix || ""}${tag}` }] }); member.nfcTag = tag; await saveData(); closeModal(); notify(`Tag written and assigned to ${member.name}.`); render();
    });
    $("[data-close]", modalBody).addEventListener("click", closeModal);
  }

  async function connectSerial() {
    if (!navigator.serial) throw new Error("Web Serial is unavailable. Use desktop Chrome or Edge.");
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: number(data.settings.nfc.serialBaud) || 9600 });
    notify("Serial NFC reader connected. Scans will be processed automatically."); render();
    const decoder = new TextDecoderStream();
    serialPort.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break; buffer += value;
        const lines = buffer.split(/\r?\n/); buffer = lines.pop();
        lines.map(line => line.trim()).filter(Boolean).forEach(tag => handleTag(tag, "Serial NFC reader"));
      }
    } finally { reader.releaseLock(); }
  }

  function connectNetworkReader() {
    const url = data.settings.nfc.wsUrl;
    if (!url) throw new Error("Add a secure reader WebSocket URL in Settings first.");
    nfcSocket?.close(); nfcSocket = new WebSocket(url);
    nfcSocket.onopen = () => { notify("Network NFC reader connected."); render(); };
    nfcSocket.onclose = () => { notify("Network NFC reader disconnected.", true); render(); };
    nfcSocket.onerror = () => notify("Could not connect to the network NFC reader.", true);
    nfcSocket.onmessage = event => { try { const parsed = JSON.parse(event.data); handleTag(parsed.tag || parsed.id || event.data, "Network NFC reader"); } catch { handleTag(event.data, "Network NFC reader"); } };
  }

  async function connectDoorBluetooth() {
    const d = data.settings.door;
    if (!navigator.bluetooth) throw new Error("Web Bluetooth is unavailable in this browser.");
    if (!d.serviceUuid || !d.characteristicUuid) throw new Error("Add the door service and characteristic UUIDs in Settings first.");
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [d.serviceUuid] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(d.serviceUuid);
    doorCharacteristic = await service.getCharacteristic(d.characteristicUuid);
    device.addEventListener("gattserverdisconnected", () => { doorCharacteristic = null; notify("Door Bluetooth disconnected.", true); render(); });
    data.settings.door.type = "bluetooth"; await saveData(); notify(`Connected to ${device.name || "Bluetooth door controller"}.`); render();
  }

  async function doorAction(action) {
    try {
      const d = data.settings.door;
      if (doorCharacteristic) {
        const command = action === "unlock" ? d.unlockCommand : d.lockCommand;
        await doorCharacteristic.writeValue(new TextEncoder().encode(command));
      } else if (d.type === "wifi" && d.wifiUrl) {
        const path = action === "unlock" ? d.unlockPath : d.lockPath;
        const headers = d.token ? { Authorization: `Bearer ${d.token}` } : {};
        const response = await fetch(`${d.wifiUrl}${path.startsWith("/") ? path : `/${path}`}`, { method: d.method || "POST", headers });
        if (!response.ok) throw new Error(`Controller returned ${response.status}.`);
      } else throw new Error("Connect a Bluetooth door or configure a Wi-Fi controller first.");
      doorOpen = action === "unlock";
      notify(action === "unlock" ? "Door open command sent." : "Door close command sent.");
      render();
      if (action === "unlock" && number(data.settings.unlockSeconds) > 0) setTimeout(() => doorAction("lock"), number(data.settings.unlockSeconds) * 1000);
    } catch (error) { notify(error.message, true); }
  }

  function removeById(collection, recordId) { const index = collection.findIndex(item => item.id === recordId); if (index >= 0) collection.splice(index, 1); }

  view.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action, recordId = button.dataset.id;
    try {
      if (action === "add-member") memberModal();
      else if (action === "edit-member") memberModal(data.members.find(item => item.id === recordId));
      else if (action === "record-payment") paymentModal(data.members.find(item => item.id === recordId));
      else if (action === "delete-member" && confirm("Remove this member and keep their visit history?")) { removeById(data.members, recordId); await saveData(); render(); }
      else if (action === "add-plan") planModal();
      else if (action === "edit-plan") planModal(data.plans.find(item => item.id === recordId));
      else if (action === "delete-plan" && confirm("Remove this membership option? Members will remain but show No plan.")) { removeById(data.plans, recordId); await saveData(); render(); }
      else if (action === "open-stripe") { const plan = data.plans.find(item => item.id === recordId); if (plan?.stripeLink) window.open(plan.stripeLink, "_blank", "noopener,noreferrer"); }
      else if (action === "add-product") productModal();
      else if (action === "edit-product") productModal(data.products.find(item => item.id === recordId));
      else if (action === "delete-product" && confirm("Remove this product?")) { removeById(data.products, recordId); cart = cart.filter(item => item.productId !== recordId); await saveData(); render(); }
      else if (action === "cart-add") { const product = data.products.find(item => item.id === recordId); const line = cart.find(item => item.productId === recordId); const quantity = line?.quantity || 0; if (product && quantity < number(product.stock)) line ? line.quantity++ : cart.push({ productId: recordId, quantity: 1 }); render(); }
      else if (action === "cart-minus") { const line = cart.find(item => item.productId === recordId); if (line && --line.quantity <= 0) cart = cart.filter(item => item.productId !== recordId); render(); }
      else if (action === "checkout") {
        const totals = cartTotals(); const lines = cart.map(item => { const product = data.products.find(p => p.id === item.productId); return { productId: item.productId, name: product.name, quantity: item.quantity, unitPrice: number(product.price) }; });
        for (const item of cart) { const product = data.products.find(p => p.id === item.productId); product.stock = Math.max(0, number(product.stock) - item.quantity); }
        data.sales.push({ id: id(), time: new Date().toISOString(), kind: "clothing", lines, subtotal: totals.subtotal, tax: totals.tax, total: totals.total }); cart = []; await saveData(); notify("Sale completed and saved."); render();
      }
      else if (action === "select-signup-plan") { selectedSignupPlan = recordId; render(); }
      else if (action === "clear-visits" && confirm("Permanently clear all visit history from the data file?")) { data.visits = []; await saveData(); render(); }
      else if (action === "gh-disconnect") disconnectGitHub();
      else if (action === "gh-refresh") await refreshRepos();
      else if (action === "web-tab") { web.tab = button.dataset.tab; renderWebsite(); }
      else if (action === "web-preview") updatePreview();
      else if (action === "web-publish") await publishHtml();
      else if (action === "scan-nfc") await startWebNfc();
      else if (action === "write-nfc") await writeNfc();
      else if (action === "connect-serial") await connectSerial();
      else if (action === "connect-reader") connectNetworkReader();
      else if (action === "connect-door") await connectDoorBluetooth();
      else if (action === "door-unlock") await doorAction("unlock");
      else if (action === "door-lock") await doorAction("lock");
    } catch (error) { if (error.name !== "NotFoundError" && error.name !== "AbortError") notify(error.message, true); }
  });
})();
