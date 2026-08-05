let ready: Promise<void> | null = null;
let bindingPromise: Promise<D1Database> | null = null;

class LazyStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly query: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  resolve(database: D1Database) { return database.prepare(this.query).bind(...this.values); }
  async first<T = Record<string, unknown>>() { return (await this.databaseStatement()).first<T>(); }
  async all<T = Record<string, unknown>>() { return (await this.databaseStatement()).all<T>(); }
  async run<T = Record<string, unknown>>() { return (await this.databaseStatement()).run<T>(); }
  private async databaseStatement() { return this.resolve(await loadBinding()); }
}

class LazyDatabase {
  prepare(query: string) { return new LazyStatement(query); }
  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    const database = await loadBinding();
    const resolved = statements.map((statement) => statement instanceof LazyStatement ? statement.resolve(database) : statement);
    return database.batch<T>(resolved);
  }
}

const lazyDatabase = new LazyDatabase();

async function loadBinding() {
  if (!bindingPromise) bindingPromise = import("cloudflare:workers").then(({ env }) => {
    if (!env.DB) throw new Error("Flex Connect database is not configured.");
    return env.DB;
  });
  return bindingPromise;
}

export function getD1() {
  return lazyDatabase;
}

export async function ensureDatabase() {
  if (ready) return ready;
  ready = initialize();
  return ready;
}

async function initialize() {
  const d1 = getD1();
  const statements = [
    `CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL, interval TEXT NOT NULL DEFAULT 'month', stripe_price_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', plan_id TEXT REFERENCES plans(id), status TEXT NOT NULL DEFAULT 'active', balance_cents INTEGER NOT NULL DEFAULT 0, nfc_token TEXT UNIQUE, stripe_customer_id TEXT, stripe_subscription_id TEXT, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_visit_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), method TEXT NOT NULL DEFAULT 'manual', result TEXT NOT NULL DEFAULT 'approved', denial_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE, details TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, subtotal_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL, payment_method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'paid', stripe_session_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id TEXT NOT NULL REFERENCES sales(id), product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, member_id TEXT REFERENCES members(id), source TEXT NOT NULL, amount_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'paid', description TEXT NOT NULL DEFAULT '', stripe_reference TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS door_events (id TEXT PRIMARY KEY, member_id TEXT REFERENCES members(id), action TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS visits_member_idx ON visits(member_id)`,
    `CREATE INDEX IF NOT EXISTS visits_created_idx ON visits(created_at)`,
    `CREATE INDEX IF NOT EXISTS payments_created_idx ON payments(created_at)`,
    `CREATE INDEX IF NOT EXISTS members_status_idx ON members(status)`,
  ];
  await d1.batch(statements.map((statement) => d1.prepare(statement)));

  const count = await d1.prepare("SELECT COUNT(*) AS count FROM plans").first<{ count: number }>();
  if (Number(count?.count ?? 0) > 0) return;

  const now = new Date();
  const day = (offset: number, hour: number) => {
    const value = new Date(now);
    value.setDate(value.getDate() - offset);
    value.setHours(hour, 0, 0, 0);
    return value.toISOString();
  };

  await d1.batch([
    d1.prepare("INSERT INTO plans (id,name,description,price_cents,interval,active) VALUES (?,?,?,?,?,1)").bind("unlimited", "Unlimited", "24/7 gym access and all group classes", 4900, "month"),
    d1.prepare("INSERT INTO plans (id,name,description,price_cents,interval,active) VALUES (?,?,?,?,?,1)").bind("open-gym", "Open Gym", "Gym floor access during staffed hours", 2900, "month"),
    d1.prepare("INSERT INTO plans (id,name,description,price_cents,interval,active) VALUES (?,?,?,?,?,1)").bind("student", "Student", "Unlimited access with valid student ID", 3500, "month"),
    d1.prepare("INSERT INTO members (id,name,email,phone,plan_id,status,balance_cents,nfc_token,joined_at,last_visit_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("mem-maya", "Maya Brooks", "maya@example.com", "(870) 555-0142", "unlimited", "active", 0, "fc_maya_042", day(150, 9), day(0, 6)),
    d1.prepare("INSERT INTO members (id,name,email,phone,plan_id,status,balance_cents,nfc_token,joined_at,last_visit_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("mem-andre", "Andre Wilson", "andre@example.com", "(870) 555-0188", "open-gym", "active", 0, "fc_andre_188", day(86, 9), day(0, 5)),
    d1.prepare("INSERT INTO members (id,name,email,phone,plan_id,status,balance_cents,nfc_token,joined_at,last_visit_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("mem-jenna", "Jenna Cole", "jenna@example.com", "(870) 555-0109", "unlimited", "past_due", 4900, "fc_jenna_109", day(240, 9), day(1, 19)),
    d1.prepare("INSERT INTO members (id,name,email,phone,plan_id,status,balance_cents,joined_at,last_visit_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("mem-eli", "Eli Turner", "eli@example.com", "(870) 555-0175", "student", "active", 0, day(44, 9), day(1, 16)),
    d1.prepare("INSERT INTO members (id,name,email,phone,plan_id,status,balance_cents,nfc_token,joined_at,last_visit_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("mem-sofia", "Sofia Reed", "sofia@example.com", "(870) 555-0134", "open-gym", "paused", 2900, "fc_sofia_134", day(120, 9), day(4, 8)),
    d1.prepare("INSERT INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("shirt", "Flex heavyweight tee", "FC-TEE-BLK", "Black · S–2XL", 2800, 34),
    d1.prepare("INSERT INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("hoodie", "Classic training hoodie", "FC-HOOD-CHR", "Charcoal · M–2XL", 5200, 16),
    d1.prepare("INSERT INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("tank", "Performance tank", "FC-TANK-ORG", "Orange · S–XL", 2400, 21),
    d1.prepare("INSERT INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("cap", "Embroidered cap", "FC-CAP-BLK", "Black · One size", 2200, 12),
    d1.prepare("INSERT INTO settings (key,value) VALUES (?,?)").bind("tax_rate", "8.25"),
    d1.prepare("INSERT INTO settings (key,value) VALUES (?,?)").bind("door_unlock_seconds", "5"),
    d1.prepare("INSERT INTO settings (key,value) VALUES (?,?)").bind("deny_past_due", "true"),
  ]);

  const visitSeeds = [
    ["mem-maya", day(0, 6)], ["mem-andre", day(0, 5)], ["mem-jenna", day(1, 19)], ["mem-eli", day(1, 16)],
    ["mem-maya", day(2, 6)], ["mem-andre", day(2, 18)], ["mem-eli", day(3, 7)], ["mem-maya", day(4, 6)],
  ];
  await d1.batch(visitSeeds.map(([memberId, createdAt]) => d1.prepare("INSERT INTO visits (id,member_id,method,result,created_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), memberId, "nfc", "approved", createdAt)));
  await d1.batch([
    d1.prepare("INSERT INTO payments (id,member_id,source,amount_cents,tax_cents,status,description,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), "mem-maya", "membership", 4900, 0, "paid", "Unlimited membership", day(2, 10)),
    d1.prepare("INSERT INTO payments (id,member_id,source,amount_cents,tax_cents,status,description,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), "mem-andre", "membership", 2900, 0, "paid", "Open Gym membership", day(3, 10)),
    d1.prepare("INSERT INTO payments (id,member_id,source,amount_cents,tax_cents,status,description,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), null, "pos", 5600, 429, "paid", "Clothing sale", day(1, 17)),
  ]);
}
