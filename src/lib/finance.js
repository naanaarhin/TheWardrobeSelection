// ═══════════════════════════════════════════════════════════════════════════
// FINANCE HELPERS — pure functions (no React, no network) so they can be
// unit-tested. Used by the Reports and Expenses screens.
// ═══════════════════════════════════════════════════════════════════════════

function localDay(str, hour = 12) {
  const [y, m, d] = String(str || "").slice(0, 10).split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, hour);
}

// Today's date as "YYYY-MM-DD" in the device's LOCAL timezone (toISOString() would give the UTC date).
export function localTodayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Period → { start, end } as local-time Date objects.
//   daily   = today
//   weekly  = last 7 days including today (rolling)
//   monthly = 1st of this month → today
//   yearly  = 1 Jan → today
//   custom  = the two dates the user picked (swapped if entered back-to-front)
export function periodRange(period, custom, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  let start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period === "daily") { /* today */ }
  else if (period === "weekly")  { start.setDate(start.getDate() - 6); }
  else if (period === "monthly") { start.setDate(1); }
  else if (period === "yearly")  { start.setMonth(0, 1); }
  else if (period === "custom" && custom?.from && custom?.to) {
    // Date inputs give "YYYY-MM-DD"; parse as LOCAL days (new Date("YYYY-MM-DD") would be UTC).
    let s = localDay(custom.from, 0);
    let e = localDay(custom.to, 0); e.setHours(23, 59, 59, 999);
    if (s > e) { const a = localDay(custom.to, 0); const b = localDay(custom.from, 0); b.setHours(23, 59, 59, 999); return { start: a, end: b }; }
    return { start: s, end: e };
  }
  return { start, end };
}

// For full timestamps (sales, returns).
export function inRange(iso, range) {
  const d = new Date(iso);
  return d >= range.start && d <= range.end;
}

// Expenses store a plain calendar day ("YYYY-MM-DD"). Parse it as local NOON so
// the day can never slip into a neighbouring day because of a timezone offset.
export function expenseDay(dateStr) {
  return localDay(dateStr, 12);
}

export function expensesInRange(expenses, range) {
  return (expenses || []).filter(e => { const d = expenseDay(e.date); return d >= range.start && d <= range.end; });
}

export const sumAmounts = (list) => (list || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);

// Gross profit = profit on items sold, minus the profit given back on returns.
export function grossProfitFor(sales, returns, range) {
  const fromSales = (sales || []).filter(s => inRange(s.date, range)).reduce((a, s) => a + (s.profit || 0), 0);
  const fromReturns = (returns || []).filter(r => inRange(r.date, range))
    .reduce((a, r) => a + (r.items || []).reduce((x, it) => x + (it.price - it.cost) * it.qty, 0), 0);
  return fromSales - fromReturns;
}

// Net profit = gross profit minus operating expenses in the same range.
export function netProfitFor(sales, returns, expenses, range) {
  return grossProfitFor(sales, returns, range) - sumAmounts(expensesInRange(expenses, range));
}

export function expensesByCategory(list) {
  const map = {};
  (list || []).forEach(e => { const k = e.category || "Other"; map[k] = (map[k] || 0) + (Number(e.amount) || 0); });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// Chart buckets for a period. Returns { labels, indexOf(Date) → bucket index or -1 }.
export function makeBuckets(period, range) {
  const startDay = new Date(range.start); startDay.setHours(0, 0, 0, 0);
  const dayIndex = (d) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startDay) / 86400000);

  if (period === "daily") {
    const labels = []; for (let h = 8; h <= 20; h += 2) labels.push(`${h}h`);
    return { labels, indexOf: (d) => { const i = Math.floor((d.getHours() - 8) / 2); return i >= 0 && i < labels.length ? i : -1; } };
  }
  if (period === "weekly") {
    const labels = [];
    for (let i = 0; i < 7; i++) { const d = new Date(startDay); d.setDate(d.getDate() + i); labels.push(d.toLocaleDateString("en-GH", { weekday: "short" }).slice(0, 2)); }
    return { labels, indexOf: (d) => { const i = dayIndex(d); return i >= 0 && i < 7 ? i : -1; } };
  }
  if (period === "monthly") {
    return { labels: ["W1", "W2", "W3", "W4", "W5"], indexOf: (d) => Math.min(4, Math.floor((d.getDate() - 1) / 7)) };
  }
  if (period === "yearly") {
    return { labels: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"], indexOf: (d) => d.getMonth() };
  }

  // custom: one bar per day (≤ 31 days), else per month (≤ ~2 years), else per year
  const nDays = Math.floor((range.end - range.start) / 86400000) + 1;
  if (nDays <= 31) {
    const labels = [];
    for (let i = 0; i < nDays; i++) { const d = new Date(startDay); d.setDate(d.getDate() + i); labels.push(String(d.getDate())); }
    return { labels, indexOf: (d) => { const i = dayIndex(d); return i >= 0 && i < nDays ? i : -1; } };
  }
  const sy = range.start.getFullYear(), sm = range.start.getMonth();
  const ey = range.end.getFullYear(),   em = range.end.getMonth();
  if (nDays <= 800) {
    const n = (ey - sy) * 12 + (em - sm) + 1;
    const multiYear = sy !== ey;
    const labels = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(sy, sm + i, 1);
      labels.push(d.toLocaleDateString("en-GH", { month: "short" }) + (multiYear ? ` ${String(d.getFullYear()).slice(2)}` : ""));
    }
    return { labels, indexOf: (d) => { const i = (d.getFullYear() - sy) * 12 + (d.getMonth() - sm); return i >= 0 && i < n ? i : -1; } };
  }
  const n = ey - sy + 1;
  const labels = []; for (let i = 0; i < n; i++) labels.push(String(sy + i));
  return { labels, indexOf: (d) => { const i = d.getFullYear() - sy; return i >= 0 && i < n ? i : -1; } };
}
