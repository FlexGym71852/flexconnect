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

  const cleanup = await d1.prepare("SELECT value FROM settings WHERE key = 'seed_data_removed_v2'").first<{ value: string }>();
  if (!cleanup) {
    await d1.batch([
      d1.prepare("DELETE FROM sale_items"),
      d1.prepare("DELETE FROM sales"),
      d1.prepare("DELETE FROM door_events"),
      d1.prepare("DELETE FROM visits"),
      d1.prepare("DELETE FROM payments"),
      d1.prepare("DELETE FROM members"),
      d1.prepare("INSERT INTO settings (key,value) VALUES ('seed_data_removed_v2','true')"),
    ]);
  }

  await d1.batch([
    d1.prepare("INSERT OR IGNORE INTO plans (id,name,description,price_cents,interval,active) VALUES (?,?,?,?,?,1)").bind("unlimited", "Unlimited", "24/7 gym access and all group classes", 4900, "month"),
    d1.prepare("INSERT OR IGNORE INTO plans (id,name,description,price_cents,interval,active) VALUES (?,?,?,?,?,1)").bind("open-gym", "Open Gym", "Gym floor access during staffed hours", 2900, "month"),
    d1.prepare("INSERT OR IGNORE INTO plans (id,name,description,price_cents,interval,active) VALUES (?,?,?,?,?,1)").bind("student", "Student", "Unlimited access with valid student ID", 3500, "month"),
    d1.prepare("INSERT OR IGNORE INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("shirt", "Flex heavyweight tee", "FC-TEE-BLK", "Black · S–2XL", 2800, 34),
    d1.prepare("INSERT OR IGNORE INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("hoodie", "Classic training hoodie", "FC-HOOD-CHR", "Charcoal · M–2XL", 5200, 16),
    d1.prepare("INSERT OR IGNORE INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("tank", "Performance tank", "FC-TANK-ORG", "Orange · S–XL", 2400, 21),
    d1.prepare("INSERT OR IGNORE INTO products (id,name,sku,details,price_cents,stock) VALUES (?,?,?,?,?,?)").bind("cap", "Embroidered cap", "FC-CAP-BLK", "Black · One size", 2200, 12),
    d1.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").bind("tax_rate", "8.25"),
    d1.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").bind("door_unlock_seconds", "5"),
    d1.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").bind("deny_past_due", "true"),
  ]);
}
