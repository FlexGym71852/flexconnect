(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const gate = $("#storageGate");
  const app = $("#app");
  const view = $("#view");
  const modal = $("#modal");
  const modalBody = $("#modalBody");
  const titles = { overview: "Overview", members: "Members", plans: "Memberships", reports: "Visits & Reports", access: "Access & NFC", pos: "Clothing POS", signup: "Public Signup", settings: "Settings" };
  const freshData = () => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      businessName: "Flex Connect", taxRate: 0, currency: "USD", unlockSeconds: 5,
      door: { type: "none", wifiUrl: "", unlockPath: "/unlock", lockPath: "/lock", method: "POST", token: "", serviceUuid: "", characteristicUuid: "", unlockCommand: "unlock", lockCommand: "lock" },
      nfc: { wsUrl: "", serialBaud: 9600, tagPrefix: "flex:" }
    },
    plans: [], members: [], visits: [], products: [], sales: []
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
      visits: Array.isArray(incoming.visits) ? incoming.visits : [], products: Array.isArray(incoming.products) ? incoming.products : [], sales: Array.isArray(incoming.sales) ? incoming.sales : []
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
    ({ overview: renderOverview, members: renderMembers, plans: renderPlans, reports: renderReports, access: renderAccess, pos: renderPos, signup: renderSignup, settings: renderSettings })[currentView]();
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
