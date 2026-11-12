// Seeds the PayPal sandbox with a freelancer's invoice history, so the dashboard has something
// realistic to forecast from: seven clients with distinct payment habits (early, on time, a bit
// late, chronically late), about five months of paid invoices, and a set of open ones.
//
//   npm run seed            create whatever is missing (safe to re-run: existing numbers are skipped)
//   npm run seed -- --dry   print the plan without calling PayPal
//
// Everything goes through the Invoicing v2 API: create draft -> send (no emails) -> record payment.

const BASE = 'https://api-m.sandbox.paypal.com';
const DRY = process.argv.includes('--dry');
const DAY = 86_400_000;

const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set (see .env.local)');

// --- The story --------------------------------------------------------------------

// `lag` is how many days after the due date this client usually pays (negative = early); `jitter`
// varies it per invoice so the history is not suspiciously regular.
const CLIENTS = {
  harbor:    { name: 'Luis Ortega',    company: 'Harbor & Finch Coffee', email: 'luis@harborfinch.example.com',    terms: 15, lag: -4, jitter: 2 },
  juniper:   { name: 'Sara Whitfield', company: 'Juniper Legal',         email: 'sara@juniperlegal.example.com',   terms: 30, lag: 0,  jitter: 2 },
  northwind: { name: 'Maya Chen',      company: 'Northwind Robotics',    email: 'maya@northwindrobotics.example.com', terms: 30, lag: 4, jitter: 3 },
  hannah:    { name: 'Hannah Park',    company: null,                    email: 'hannah.park@example.com',         terms: 15, lag: 9,  jitter: 4 },
  brightline:{ name: 'Priya Raman',    company: 'Brightline Dental',     email: 'priya@brightlinedental.example.com', terms: 15, lag: 18, jitter: 5 },
  atlas:     { name: 'Tom Becker',     company: 'Atlas Outdoor Co',      email: 'tom@atlasoutdoor.example.com',    terms: 30, lag: 34, jitter: 8 },
  kite:      { name: 'Devon Brooks',   company: 'Kite & Key Studio',     email: 'devon@kiteandkey.example.com',    terms: 15, lag: 0,  jitter: 0 },
};

const item = (name, quantity, price, unit = 'AMOUNT') => ({ name, quantity, price, unit });

// [client, invoice date, line items, state]. state: 'paid' (pays per the client's habit), 'open',
// 'partial' (half paid), 'draft'.
const INVOICES = [
  // Harbor & Finch Coffee: monthly retainer, pays early.
  ['harbor', '2026-06-15', [item('Brand & social retainer - June', 1, 1800)], 'paid'],
  ['harbor', '2026-07-15', [item('Brand & social retainer - July', 1, 1800)], 'paid'],
  ['harbor', '2026-08-15', [item('Brand & social retainer - August', 1, 1800)], 'paid'],
  ['harbor', '2026-09-15', [item('Brand & social retainer - September', 1, 1800), item('Menu board redesign', 1, 650)], 'paid'],
  ['harbor', '2026-10-15', [item('Brand & social retainer - October', 1, 1800)], 'paid'],
  ['harbor', '2026-11-02', [item('Brand & social retainer - November', 1, 1800), item('Holiday campaign assets', 1, 900)], 'open'],

  // Juniper Legal: on time, every time.
  ['juniper', '2026-06-22', [item('Website maintenance - Q2', 1, 1200)], 'paid'],
  ['juniper', '2026-08-03', [item('Client portal UX audit', 16, 140, 'HOURS')], 'paid'],
  ['juniper', '2026-09-21', [item('Website maintenance - Q3', 1, 1200)], 'paid'],
  ['juniper', '2026-10-26', [item('Client portal redesign - phase 1', 1, 5200)], 'open'],

  // Northwind Robotics: a few days late, large projects.
  ['northwind', '2026-06-08', [item('Product launch site - discovery', 24, 150, 'HOURS')], 'paid'],
  ['northwind', '2026-07-06', [item('Product launch site - design', 1, 6400)], 'paid'],
  ['northwind', '2026-08-10', [item('Product launch site - build', 1, 8200)], 'paid'],
  ['northwind', '2026-09-14', [item('Launch site - QA and handover', 18, 150, 'HOURS')], 'paid'],
  ['northwind', '2026-10-12', [item('Investor deck design', 1, 3800)], 'open'],
  ['northwind', '2026-11-05', [item('Trade show booth graphics', 1, 4600)], 'open'],

  // Hannah Park: an individual, small jobs, about a week late.
  ['hannah', '2026-07-20', [item('Portfolio site refresh', 1, 950)], 'paid'],
  ['hannah', '2026-09-07', [item('Logo and business card design', 1, 600)], 'paid'],
  ['hannah', '2026-10-19', [item('Portfolio case study pages', 3, 220)], 'open'],

  // Brightline Dental: two to three weeks late.
  ['brightline', '2026-06-29', [item('Patient booking flow redesign', 1, 3400)], 'paid'],
  ['brightline', '2026-07-27', [item('Monthly SEO and content - July', 1, 1100)], 'paid'],
  ['brightline', '2026-08-24', [item('Monthly SEO and content - August', 1, 1100)], 'paid'],
  ['brightline', '2026-09-28', [item('Monthly SEO and content - September', 1, 1100)], 'paid'],
  ['brightline', '2026-10-05', [item('New clinic landing pages', 4, 480)], 'partial'],
  ['brightline', '2026-10-26', [item('Monthly SEO and content - October', 1, 1100)], 'open'],

  // Atlas Outdoor Co: the biggest client and the slowest payer.
  ['atlas', '2026-06-01', [item('E-commerce replatform - phase 1', 1, 9500)], 'paid'],
  ['atlas', '2026-07-13', [item('E-commerce replatform - phase 2', 1, 9500)], 'paid'],
  ['atlas', '2026-08-17', [item('Product photography art direction', 2, 1400, 'AMOUNT')], 'paid'],
  ['atlas', '2026-09-08', [item('E-commerce replatform - phase 3', 1, 11200)], 'open'],
  ['atlas', '2026-10-13', [item('Fall catalog design', 1, 4200), item('Email template set', 6, 250)], 'open'],

  // Kite & Key Studio: brand new client, no payment history.
  ['kite', '2026-11-03', [item('Brand identity workshop', 1, 2400)], 'open'],

  // Not sent yet.
  ['juniper', '2026-11-10', [item('Website maintenance - Q4', 1, 1200)], 'draft'],
  ['atlas', '2026-11-10', [item('Holiday landing page', 1, 3600)], 'draft'],
];

// --- Planning ---------------------------------------------------------------------

const addDays = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

// Deterministic per-invoice variation, so re-running produces the same history.
const wobble = (n, jitter) => (jitter === 0 ? 0 : (((n * 7919) % (2 * jitter + 1)) - jitter));

const plan = INVOICES.map(([clientKey, date, items, state], i) => {
  const client = CLIENTS[clientKey];
  const number = `RW-${String(i + 1).padStart(4, '0')}`;
  const dueDate = addDays(date, client.terms);
  const total = items.reduce((sum, it) => sum + it.quantity * it.price, 0);
  let paymentDate = null;
  if (state === 'paid') {
    paymentDate = addDays(dueDate, client.lag + wobble(i + 1, client.jitter));
    if (paymentDate < date) paymentDate = date;
    if (paymentDate > today) paymentDate = today;
  }
  if (state === 'partial') paymentDate = addDays(date, 20);
  return { number, client, date, dueDate, items, state, total, paymentDate };
});

// --- PayPal -------------------------------------------------------------------------

let token;
async function api(method, path, body) {
  token ??= (
    await (
      await fetch(`${BASE}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
    ).json()
  ).access_token;

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? null : res.json().catch(() => null);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 400));
      continue;
    }
    throw new Error(`PayPal ${res.status} on ${method} ${path}: ${(await res.text()).slice(0, 500)}`);
  }
}

async function existingNumbers() {
  const numbers = new Set();
  for (let page = 1; ; page++) {
    const res = await api('GET', `/v2/invoicing/invoices?total_required=true&page_size=100&page=${page}&fields=all`);
    for (const inv of res.items ?? []) numbers.add(inv.detail?.invoice_number);
    if (page >= (res.total_pages ?? 1)) return numbers;
  }
}

const money = (value) => ({ currency_code: 'USD', value: value.toFixed(2) });

async function create(inv) {
  const [given, ...rest] = inv.client.name.split(' ');
  const created = await api('POST', '/v2/invoicing/invoices', {
    detail: {
      invoice_number: inv.number,
      invoice_date: inv.date,
      currency_code: 'USD',
      note: 'Thank you for your business.',
      payment_term: { due_date: inv.dueDate },
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: given, surname: rest.join(' ') },
          ...(inv.client.company && { business_name: inv.client.company }),
          email_address: inv.client.email,
        },
      },
    ],
    items: inv.items.map((it) => ({
      name: it.name,
      quantity: String(it.quantity),
      unit_amount: money(it.price),
      unit_of_measure: it.unit,
    })),
  });
  // The create call answers with a link to the invoice, not the invoice itself.
  const invoiceId = created.id ?? created.href?.split('/').pop();
  if (inv.state === 'draft') return invoiceId;

  // Marks it as sent without emailing anyone.
  await api('POST', `/v2/invoicing/invoices/${invoiceId}/send`, { send_to_recipient: false, send_to_invoicer: false });

  if (inv.paymentDate) {
    await api('POST', `/v2/invoicing/invoices/${invoiceId}/payments`, {
      method: 'BANK_TRANSFER',
      payment_date: inv.paymentDate,
      amount: money(inv.state === 'partial' ? inv.total / 2 : inv.total),
    });
  }
  return invoiceId;
}

// --- Run ----------------------------------------------------------------------------

if (DRY) {
  for (const inv of plan) {
    console.log(inv.number, inv.date, 'due', inv.dueDate, inv.state.padEnd(7), inv.paymentDate ?? '          ', String(inv.total).padStart(6), inv.client.company ?? inv.client.name);
  }
  console.log(`${plan.length} invoices, $${plan.reduce((s, i) => s + i.total, 0)} total`);
} else {
  const existing = await existingNumbers();
  const todo = plan.filter((inv) => !existing.has(inv.number));
  console.log(`${existing.size} invoices already in the sandbox, creating ${todo.length}`);
  for (const inv of todo) {
    const invoiceId = await create(inv);
    console.log(`  ${inv.number} ${inv.state.padEnd(7)} $${inv.total} ${inv.client.company ?? inv.client.name} -> ${invoiceId}`);
  }
  console.log('Done.');
}
