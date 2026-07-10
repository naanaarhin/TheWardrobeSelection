import { supabase, SHOP_ID } from "./supabaseClient.js";

// ═══════════════════════════════════════════════════════════════════════════
// OFFLINE-FIRST SYNC LAYER
// Every write goes to local cache immediately (instant UI) AND to an outbox
// queue. The queue drains to Supabase whenever the device is online. On load,
// the app pulls the latest cloud state so any device sees every other
// device's changes after a refresh.
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_KEY  = "tws_cache_v1";
const OUTBOX_KEY = "tws_outbox_v1";

// ── Local cache (instant read, works fully offline) ─────────────────────────
export function loadCache() {
  try { const r = localStorage.getItem(CACHE_KEY); if (r) return JSON.parse(r); } catch (_) {}
  return null;
}
export function saveCache(db) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(db)); } catch (_) {}
}

// ── Outbox queue (pending writes not yet confirmed in the cloud) ────────────
function loadOutbox() {
  try { const r = localStorage.getItem(OUTBOX_KEY); if (r) return JSON.parse(r); } catch (_) {}
  return [];
}
function saveOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q)); } catch (_) {}
}
function enqueue(op) {
  const q = loadOutbox();
  q.push({ ...op, queuedAt: Date.now() });
  saveOutbox(q);
}
export function pendingCount() { return loadOutbox().length; }

// ── Table row mappers (app shape <-> Supabase row shape) ────────────────────
const toProductRow = (p) => ({ id: p.id, shop_id: SHOP_ID, name: p.name, category: p.category, sku: p.sku, cost: p.cost, price: p.price, qty: p.qty, threshold: p.threshold, size: p.size, color: p.color, updated_at: new Date().toISOString() });
const fromProductRow = (r) => ({ id: r.id, name: r.name, category: r.category, sku: r.sku, cost: r.cost, price: r.price, qty: r.qty, threshold: r.threshold, size: r.size, color: r.color });

const toSaleRow = (s) => ({ id: s.id, shop_id: SHOP_ID, date: s.date, items: s.items, subtotal: s.subtotal, discount: s.discount, total: s.total, profit: s.profit, pay_method: s.payMethod, customer_id: s.customerId, customer_name: s.customerName, sold_by: s.soldBy });
const fromSaleRow = (r) => ({ id: r.id, date: r.date, items: r.items, subtotal: r.subtotal, discount: r.discount, total: r.total, profit: r.profit, payMethod: r.pay_method, customerId: r.customer_id, customerName: r.customer_name, soldBy: r.sold_by });

const toCustomerRow = (c) => ({ id: c.id, shop_id: SHOP_ID, name: c.name, phone: c.phone, note: c.note, spent: c.spent || 0, visits: c.visits || 0, updated_at: new Date().toISOString() });
const fromCustomerRow = (r) => ({ id: r.id, name: r.name, phone: r.phone, note: r.note, spent: r.spent, visits: r.visits });

const toStaffRow = (s) => ({ id: s.id, shop_id: SHOP_ID, name: s.name, pin: s.pin, updated_at: new Date().toISOString() });
const fromStaffRow = (r) => ({ id: r.id, name: r.name, pin: r.pin });

const toSettingsRow = (s) => ({ shop_id: SHOP_ID, shop_name: s.shopName, location: s.location, phone: s.phone, updated_at: new Date().toISOString() });
const fromSettingsRow = (r) => ({ shopName: r.shop_name, location: r.location, phone: r.phone, lowStockAlerts: true });

// ── Pull full state from cloud (used on load / manual refresh) ──────────────
export async function pullAll() {
  const [products, sales, customers, staff, settingsRes] = await Promise.all([
    supabase.from("tws_products").select("*").eq("shop_id", SHOP_ID),
    supabase.from("tws_sales").select("*").eq("shop_id", SHOP_ID).order("date", { ascending: false }),
    supabase.from("tws_customers").select("*").eq("shop_id", SHOP_ID),
    supabase.from("tws_staff").select("*").eq("shop_id", SHOP_ID),
    supabase.from("tws_settings").select("*").eq("shop_id", SHOP_ID).maybeSingle(),
  ]);

  const errors = [products.error, sales.error, customers.error, staff.error, settingsRes.error].filter(Boolean);
  if (errors.length) throw errors[0];

  return {
    products: (products.data || []).map(fromProductRow),
    sales: (sales.data || []).map(fromSaleRow),
    customers: (customers.data || []).map(fromCustomerRow),
    staff: (staff.data || []).map(fromStaffRow),
    settings: settingsRes.data ? fromSettingsRow(settingsRes.data) : { shopName: "The Wardrobe Selection", location: "Accra, Ghana", phone: "0597147460", lowStockAlerts: true },
  };
}

// ── Queue a write (called from app actions — always succeeds instantly) ─────
export function queueUpsert(table, appRow) {
  const mapped = {
    products:  toProductRow,
    sales:     toSaleRow,
    customers: toCustomerRow,
    staff:     toStaffRow,
    settings:  toSettingsRow,
  }[table](appRow);
  enqueue({ type: "upsert", table, row: mapped });
  drainOutbox();
}

export function queueDelete(table, id) {
  enqueue({ type: "delete", table, id });
  drainOutbox();
}

// ── Table name mapping (app table -> supabase table) ─────────────────────────
const SB_TABLE = { products: "tws_products", sales: "tws_sales", customers: "tws_customers", staff: "tws_staff", settings: "tws_settings" };

// ── Drain queue to Supabase whenever possible ────────────────────────────────
let draining = false;
export async function drainOutbox(onStatusChange) {
  if (draining) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  draining = true;
  try {
    let q = loadOutbox();
    while (q.length > 0) {
      const op = q[0];
      const sbTable = SB_TABLE[op.table];
      try {
        if (op.type === "upsert") {
          const conflictKey = op.table === "settings" ? "shop_id" : "id";
          const { error } = await supabase.from(sbTable).upsert(op.row, { onConflict: conflictKey });
          if (error) throw error;
        } else if (op.type === "delete") {
          const { error } = await supabase.from(sbTable).delete().eq("id", op.id);
          if (error) throw error;
        }
        q = q.slice(1);
        saveOutbox(q);
        onStatusChange?.({ pending: q.length, ok: true });
      } catch (e) {
        // Network or server error — stop draining, retry later
        onStatusChange?.({ pending: q.length, ok: false, error: e.message });
        break;
      }
    }
  } finally {
    draining = false;
  }
}

// ── Full wipe (used by Reset All Data) ───────────────────────────────────────
export async function clearCloud() {
  await Promise.all([
    supabase.from("tws_products").delete().eq("shop_id", SHOP_ID),
    supabase.from("tws_sales").delete().eq("shop_id", SHOP_ID),
    supabase.from("tws_customers").delete().eq("shop_id", SHOP_ID),
    supabase.from("tws_staff").delete().eq("shop_id", SHOP_ID),
  ]);
}

// ── Auto-drain on reconnect ───────────────────────────────────────────────────
if (typeof window !== "undefined") {
  window.addEventListener("online", () => drainOutbox());
  // Also retry periodically in case 'online' event is unreliable
  setInterval(() => drainOutbox(), 20000);
}
