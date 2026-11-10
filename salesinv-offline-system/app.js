/* =========================================================
   Offline Sales & Inventory Management  (single-file app)
   Storage: IndexedDB (users, products, sales, moves)
   ========================================================= */

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dayKey = d => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const cfg = () => Object.assign({ store: 'My Store', cur: '₱', low: 5 }, JSON.parse(localStorage.getItem('cfg') || '{}'));
const money = n => cfg().cur + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

function toast(msg, bad) {
  const d = document.createElement('div');
  d.textContent = msg; if (bad) d.className = 'bad';
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 3500);
}
function modal(html, wide) {
  const m = $('#modal');
  m.innerHTML = `<div class="box ${wide ? 'wide' : ''}">${html}</div>`;
  m.classList.remove('hidden');
  m.onmousedown = e => { if (e.target === m) closeModal(); };
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

function download(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function csv(name, rows) {
  const t = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  download(name, 'text/csv', '\ufeff' + t);
}

/* ---------- IndexedDB ---------- */
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('salesinv', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('users', { keyPath: 'id', autoIncrement: true }).createIndex('username', 'username', { unique: true });
      d.createObjectStore('products', { keyPath: 'id', autoIncrement: true }).createIndex('sku', 'sku', { unique: true });
      d.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('moves', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
const store = (s, m = 'readonly') => db.transaction(s, m).objectStore(s);
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const all = s => req(store(s).getAll());
const get = (s, id) => req(store(s).get(id));
const put = (s, o) => req(store(s, 'readwrite').put(o));
const add = (s, o) => req(store(s, 'readwrite').add(o));
const del = (s, id) => req(store(s, 'readwrite').delete(id));

/* ---------- auth ---------- */
async function hash(pw, salt) {
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pw));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  // fallback for non-secure contexts (weaker)
  let h = 5381; const s = salt + pw;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'x' + h;
}
async function createUser(username, name, role, pw) {
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return add('users', { username: username.trim().toLowerCase(), name: name.trim(), role, salt, hash: await hash(pw, salt) });
}

let me = null;

function showSetup() {
  $('#app').classList.add('hidden');
  const a = $('#auth'); a.classList.remove('hidden');
  a.innerHTML = `<form class="card login" id="sf">
    <h2>Welcome 👋</h2><p class="muted">First-time setup: create the administrator account. Everything is stored on this device.</p>
    <label>Store name<input name="store" required value="My Store"></label>
    <label>Your full name<input name="name" required></label>
    <label>Username<input name="u" required autocomplete="username"></label>
    <label>Password (min 6 characters)<input name="p" type="password" minlength="6" required autocomplete="new-password"></label>
    <label>Confirm password<input name="p2" type="password" minlength="6" required autocomplete="new-password"></label>
    <button class="pri">Create account</button></form>`;
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('p') !== f.get('p2')) return toast('Passwords do not match', 1);
    localStorage.setItem('cfg', JSON.stringify({ ...cfg(), store: f.get('store').trim() }));
    const id = await createUser(f.get('u'), f.get('name'), 'admin', f.get('p'));
    sessionStorage.setItem('uid', id);
    startApp();
  };
}

function showLogin() {
  $('#app').classList.add('hidden');
  const a = $('#auth'); a.classList.remove('hidden');
  a.innerHTML = `<form class="card login" id="lf">
    <h2>${esc(cfg().store)}</h2><p class="muted">Sales &amp; Inventory — works offline</p>
    <label>Username<input name="u" required autocomplete="username" autofocus></label>
    <label>Password<input name="p" type="password" required autocomplete="current-password"></label>
    <button class="pri">Log in</button></form>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const u = await req(store('users').index('username').get(f.get('u').trim().toLowerCase()));
    if (!u || u.hash !== await hash(f.get('p'), u.salt)) return toast('Invalid username or password', 1);
    sessionStorage.setItem('uid', u.id);
    startApp();
  };
}

/* ---------- app shell ---------- */
const VIEWS = {
  dashboard: { t: 'Dashboard', i: '📊', r: ['admin'], f: viewDash },
  pos: { t: 'Point of Sale', i: '🛒', r: ['admin', 'cashier'], f: viewPOS },
  inventory: { t: 'Inventory', i: '📦', r: ['admin', 'cashier'], f: viewInventory },
  sales: { t: 'Sales History', i: '🧾', r: ['admin', 'cashier'], f: viewSales },
  users: { t: 'Users', i: '👥', r: ['admin'], f: viewUsers },
  settings: { t: 'Settings & Backup', i: '⚙️', r: ['admin'], f: viewSettings }
};
let current = '';

async function startApp() {
  me = await get('users', +sessionStorage.getItem('uid'));
  if (!me) return showLogin();
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#brand').textContent = cfg().store;
  $('#who').textContent = `${me.name} (${me.role})`;
  $('#nav').innerHTML = Object.entries(VIEWS)
    .filter(([, v]) => v.r.includes(me.role))
    .map(([k, v]) => `<a data-v="${k}">${v.i} ${v.t}</a>`).join('');
  $('#nav').onclick = e => { const a = e.target.closest('a'); if (a) go(a.dataset.v); };
  go(me.role === 'admin' ? 'dashboard' : 'pos');
}
function go(v) {
  if (!VIEWS[v] || !VIEWS[v].r.includes(me.role)) return;
  current = v;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
  VIEWS[v].f();
}
$('#logout').onclick = () => { sessionStorage.removeItem('uid'); me = null; cart = []; showLogin(); };
function netState() {
  const n = $('#net'); const on = navigator.onLine;
  n.textContent = on ? '● Online' : '● Offline mode'; n.classList.toggle('off', !on);
}
window.addEventListener('online', netState);
window.addEventListener('offline', netState);

/* =========================================================
   DASHBOARD / ANALYTICS
   ========================================================= */
let dashDays = 30;
async function viewDash() {
  const [sales, prods] = await Promise.all([all('sales'), all('products')]);
  const live = sales.filter(s => !s.voided);
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (dashDays - 1));
  const inRange = live.filter(s => new Date(s.date) >= from);

  const cost = s => s.items.reduce((a, i) => a + i.cost * i.qty, 0);
  const revenue = inRange.reduce((a, s) => a + s.total, 0);
  const profit = inRange.reduce((a, s) => a + s.total - cost(s), 0);
  const itemsSold = inRange.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0);
  const invValue = prods.reduce((a, p) => a + p.cost * p.stock, 0);
  const retailValue = prods.reduce((a, p) => a + p.price * p.stock, 0);
  const lowList = prods.filter(p => p.stock <= p.reorder).sort((a, b) => a.stock - b.stock);

  const todayKey = dayKey(new Date());
  const todaySales = live.filter(s => dayKey(s.date) === todayKey);
  const todayRev = todaySales.reduce((a, s) => a + s.total, 0);

  // daily buckets
  const labels = [], rev = [], prof = [], idx = {};
  for (let i = 0; i < dashDays; i++) {
    const d = new Date(from); d.setDate(from.getDate() + i);
    idx[dayKey(d)] = i; labels.push(pad(d.getMonth() + 1) + '/' + pad(d.getDate())); rev.push(0); prof.push(0);
  }
  inRange.forEach(s => { const i = idx[dayKey(s.date)]; if (i != null) { rev[i] += s.total; prof[i] += s.total - cost(s); } });

  // top products & categories
  const byP = {}, byC = {};
  inRange.forEach(s => s.items.forEach(i => {
    const p = byP[i.name] = byP[i.name] || { qty: 0, rev: 0 }; p.qty += i.qty; p.rev += i.qty * i.price;
    const c = byC[i.category || 'Uncategorized'] = (byC[i.category || 'Uncategorized'] || 0) + i.qty * i.price;
  }));
  const topP = Object.entries(byP).sort((a, b) => b[1].rev - a[1].rev).slice(0, 6);
  const topC = Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const bars = (arr, val, fmt) => {
    const mx = Math.max(1, ...arr.map(val));
    return arr.length ? arr.map(a => `<div class="hb"><div class="t"><span>${esc(a[0])}</span><b>${fmt(a)}</b></div><div class="b"><i style="width:${val(a) / mx * 100}%"></i></div></div>`).join('') : '<p class="muted">No sales in this period.</p>';
  };

  // payment methods
  const byPay = {};
  inRange.forEach(s => byPay[s.payment] = (byPay[s.payment] || 0) + s.total);
  const pays = Object.entries(byPay).sort((a, b) => b[1] - a[1]);

  // weekday pattern
  const wd = [0, 0, 0, 0, 0, 0, 0];
  inRange.forEach(s => wd[new Date(s.date).getDay()] += s.total);
  const wdn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  $('#main').innerHTML = `
    <div class="bar"><h1 class="grow" style="margin:0">Dashboard</h1>
      <select id="rng"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></div>
    <div class="kpis">
      <div class="card kpi"><div class="l">Today's sales</div><div class="v">${money(todayRev)}</div><div class="muted">${todaySales.length} transaction(s)</div></div>
      <div class="card kpi"><div class="l">Revenue (${dashDays}d)</div><div class="v">${money(revenue)}</div><div class="muted">${inRange.length} sales</div></div>
      <div class="card kpi"><div class="l">Gross profit (${dashDays}d)</div><div class="v" style="color:var(--ok)">${money(profit)}</div><div class="muted">Margin ${revenue ? (profit / revenue * 100).toFixed(1) : 0}%</div></div>
      <div class="card kpi"><div class="l">Avg. sale</div><div class="v">${money(inRange.length ? revenue / inRange.length : 0)}</div><div class="muted">${itemsSold} items sold</div></div>
      <div class="card kpi"><div class="l">Stock value (cost)</div><div class="v">${money(invValue)}</div><div class="muted">Retail ${money(retailValue)}</div></div>
      <div class="card kpi"><div class="l">Low / out of stock</div><div class="v" style="color:${lowList.length ? 'var(--bad)' : 'var(--ok)'}">${lowList.length}</div><div class="muted">of ${prods.length} products</div></div>
    </div>
    <div class="two">
      <div class="card"><h3>Daily revenue &amp; profit</h3><canvas id="c1"></canvas>
        <div class="legend"><span><i style="background:#2563eb"></i>Revenue</span><span><i style="background:#16a34a"></i>Profit</span></div></div>
      <div class="card"><h3>Top products (by revenue)</h3>${bars(topP, a => a[1].rev, a => money(a[1].rev) + ' · ' + a[1].qty + ' pcs')}</div>
    </div>
    <div class="two eq">
      <div class="card"><h3>Sales by category</h3>${bars(topC, a => a[1], a => money(a[1]))}
        <h3 style="margin-top:18px">Payment methods</h3>${bars(pays, a => a[1], a => money(a[1]))}</div>
      <div class="card"><h3>Sales by weekday</h3><canvas id="c2"></canvas></div>
    </div>
    <div class="card"><h3>⚠️ Restock alerts</h3>
      ${lowList.length ? `<div class="tw"><table><tr><th>SKU</th><th>Product</th><th class="n">Stock</th><th class="n">Reorder at</th><th>Status</th></tr>
      ${lowList.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td class="n">${p.stock}</td><td class="n">${p.reorder}</td><td><span class="tag ${p.stock <= 0 ? 'bad' : 'warn'}">${p.stock <= 0 ? 'Out of stock' : 'Low'}</span></td></tr>`).join('')}</table></div>` : '<p class="muted">All products are sufficiently stocked.</p>'}
    </div>`;
  $('#rng').value = dashDays;
  $('#rng').onchange = e => { dashDays = +e.target.value; viewDash(); };
  chart($('#c1'), labels, [{ color: '#2563eb', data: rev }, { color: '#16a34a', data: prof }]);
  chart($('#c2'), wdn, [{ color: '#7c3aed', data: wd }]);
}

function chart(cv, labels, series) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, w, h);
  const L = 46, B = 24, T = 8, R = 6;
  const max = Math.max(1, ...series.flatMap(s => s.data)) * 1.1;
  c.font = '11px system-ui'; c.strokeStyle = '#e2e8f0'; c.fillStyle = '#64748b';
  for (let i = 0; i <= 4; i++) {
    const y = T + (h - T - B) * (1 - i / 4);
    c.beginPath(); c.moveTo(L, y); c.lineTo(w - R, y); c.stroke();
    c.textAlign = 'right'; c.fillText(short(max * i / 4), L - 6, y + 4);
  }
  const n = labels.length, gw = (w - L - R) / n, bw = Math.max(2, gw * 0.72 / series.length);
  series.forEach((s, si) => {
    c.fillStyle = s.color;
    s.data.forEach((v, i) => {
      const bh = (h - T - B) * Math.max(0, v) / max;
      c.fillRect(L + i * gw + gw * 0.14 + si * bw, h - B - bh, Math.max(1, bw - 1), bh);
    });
  });
  c.fillStyle = '#64748b'; c.textAlign = 'center';
  const step = Math.ceil(n / Math.max(1, Math.floor((w - L) / 46)));
  labels.forEach((l, i) => { if (i % step === 0) c.fillText(l, L + i * gw + gw / 2, h - 7); });
}

/* =========================================================
   POINT OF SALE
   ========================================================= */
let cart = [];   // {id, qty}
let POSPRODS = [];

async function viewPOS() {
  POSPRODS = await all('products');
  $('#main').innerHTML = `<h1>Point of Sale</h1>
  <div class="pos">
    <section class="card">
      <input id="q" placeholder="Search name / category, or scan / type SKU then Enter…" autocomplete="off">
      <div id="grid" class="grid"></div>
    </section>
    <section class="card">
      <h3>Current sale</h3>
      <div id="cartItems"></div>
      <div class="tot"><span>Subtotal</span><span id="sub"></span></div>
      <div class="tot"><span>Discount</span><span style="width:120px"><input id="disc" type="number" min="0" step="0.01" value="0"></span></div>
      <div class="tot big"><span>Total</span><span id="tot"></span></div>
      <div class="pay">
        <label>Payment<select id="pay"><option>Cash</option><option>GCash / E-wallet</option><option>Card</option><option>Other</option></select></label>
        <label>Amount received<input id="tend" type="number" min="0" step="0.01"></label>
      </div>
      <div class="tot"><span>Change</span><b id="chg">${money(0)}</b></div>
      <div class="row" style="margin-top:12px"><button id="clr">Clear</button><button class="pri grow" id="done">Complete sale</button></div>
    </section>
  </div>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const list = POSPRODS.filter(p => !q || (p.name + ' ' + p.category + ' ' + p.sku).toLowerCase().includes(q));
    $('#grid').innerHTML = list.length ? list.map(p => `<button class="prod ${p.stock <= 0 ? 'oos' : ''}" onclick="addToCart(${p.id})"><b>${esc(p.name)}</b><div class="muted">${esc(p.sku)} · ${p.stock} in stock</div><div class="p">${money(p.price)}</div></button>`).join('')
      : `<p class="muted">${POSPRODS.length ? 'No matching products.' : 'No products yet. Add some under Inventory.'}</p>`;
  };
  $('#q').oninput = draw;
  $('#q').onkeydown = e => {
    if (e.key === 'Enter') {
      const v = e.target.value.trim().toLowerCase();
      const p = POSPRODS.find(x => x.sku.toLowerCase() === v);
      if (p) { addToCart(p.id); e.target.value = ''; draw(); }
    }
  };
  ['disc', 'tend'].forEach(id => $('#' + id).oninput = calc);
  $('#clr').onclick = () => { cart = []; renderCart(); };
  $('#done').onclick = completeSale;
  draw(); renderCart();
}

function addToCart(id) {
  const p = POSPRODS.find(x => x.id === id); if (!p) return;
  const line = cart.find(l => l.id === id);
  const have = line ? line.qty : 0;
  if (have + 1 > p.stock) return toast(`Only ${p.stock} of "${p.name}" in stock`, 1);
  if (line) line.qty++; else cart.push({ id, qty: 1 });
  renderCart();
}
function setQty(id, v) {
  const p = POSPRODS.find(x => x.id === id), line = cart.find(l => l.id === id);
  let q = Math.floor(num(v));
  if (q <= 0) cart = cart.filter(l => l.id !== id);
  else { if (q > p.stock) { q = p.stock; toast(`Only ${p.stock} in stock`, 1); } line.qty = q; }
  renderCart();
}
function renderCart() {
  const el = $('#cartItems'); if (!el) return;
  el.innerHTML = cart.length ? cart.map(l => {
    const p = POSPRODS.find(x => x.id === l.id);
    return `<div class="cartrow"><div class="nm"><div><b>${esc(p.name)}</b></div><div class="muted">${money(p.price)} each</div></div>
      <div class="qty"><button onclick="setQty(${l.id},${l.qty - 1})">−</button><input value="${l.qty}" onchange="setQty(${l.id},this.value)"><button onclick="setQty(${l.id},${l.qty + 1})">+</button></div>
      <b style="width:80px;text-align:right">${money(p.price * l.qty)}</b></div>`;
  }).join('') : '<p class="muted">Cart is empty. Click a product to add it.</p>';
  calc();
}
function cartTotals() {
  const sub = cart.reduce((a, l) => a + POSPRODS.find(x => x.id === l.id).price * l.qty, 0);
  const disc = Math.min(Math.max(0, num($('#disc').value)), sub);
  return { sub, disc, total: sub - disc };
}
function calc() {
  const t = cartTotals();
  $('#sub').textContent = money(t.sub); $('#tot').textContent = money(t.total);
  $('#chg').textContent = money(Math.max(0, num($('#tend').value) - t.total));
}

function checkout(sale) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(['products', 'sales', 'moves'], 'readwrite');
    const P = t.objectStore('products'); let err = null;
    sale.items.forEach(it => {
      P.get(it.id).onsuccess = e => {
        const p = e.target.result;
        if (!p || p.stock < it.qty) { err = 'Not enough stock for ' + it.name; t.abort(); return; }
        p.stock -= it.qty; P.put(p);
        t.objectStore('moves').add({ date: sale.date, productId: p.id, name: p.name, qty: -it.qty, type: 'Sale', user: sale.user });
      };
    });
    t.objectStore('sales').add(sale).onsuccess = e => { sale.id = e.target.result; };
    t.oncomplete = () => resolve(sale);
    t.onabort = () => reject(new Error(err || 'Transaction failed'));
  });
}
async function completeSale() {
  if (!cart.length) return toast('Cart is empty', 1);
  const t = cartTotals();
  const pay = $('#pay').value, tend = num($('#tend').value);
  if (pay === 'Cash' && $('#tend').value !== '' && tend < t.total) return toast('Amount received is less than the total', 1);
  const sale = {
    date: new Date().toISOString(), user: me.username,
    items: cart.map(l => { const p = POSPRODS.find(x => x.id === l.id); return { id: p.id, sku: p.sku, name: p.name, category: p.category, qty: l.qty, price: p.price, cost: p.cost }; }),
    subtotal: t.sub, discount: t.disc, total: t.total, payment: pay,
    tendered: $('#tend').value === '' ? t.total : tend, voided: false
  };
  try {
    await checkout(sale);
    cart = [];
    toast('Sale completed ✔');
    modal(receipt(sale));
    viewPOS();
  } catch (e) { toast(e.message, 1); viewPOS(); }
}

function receipt(s) {
  const c = cfg();
  return `<div class="receipt" id="rc"><h3>${esc(c.store)}</h3>
    <p class="c">Receipt #${String(s.id).padStart(6, '0')}<br>${new Date(s.date).toLocaleString()}<br>Cashier: ${esc(s.user)}${s.voided ? '<br><b>*** VOIDED ***</b>' : ''}</p><hr>
    <table style="width:100%">${s.items.map(i => `<tr><td colspan="2">${esc(i.name)}</td></tr><tr><td>&nbsp;&nbsp;${i.qty} × ${money(i.price)}</td><td style="text-align:right">${money(i.qty * i.price)}</td></tr>`).join('')}</table><hr>
    <table style="width:100%">
      <tr><td>Subtotal</td><td style="text-align:right">${money(s.subtotal)}</td></tr>
      ${s.discount ? `<tr><td>Discount</td><td style="text-align:right">-${money(s.discount)}</td></tr>` : ''}
      <tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${money(s.total)}</b></td></tr>
      <tr><td>${esc(s.payment)}</td><td style="text-align:right">${money(s.tendered)}</td></tr>
      <tr><td>Change</td><td style="text-align:right">${money(Math.max(0, s.tendered - s.total))}</td></tr></table>
    <p class="c">Thank you!</p>
    <div class="row end noprint"><button onclick="window.print()">🖨 Print</button><button class="pri" onclick="closeModal()">Close</button></div></div>`;
}

/* =========================================================
   INVENTORY
   ========================================================= */
let invFilter = '', invLowOnly = false;
async function viewInventory() {
  const prods = await all('products');
  const isAdmin = me.role === 'admin';
  const cats = [...new Set(prods.map(p => p.category).filter(Boolean))].sort();
  const list = prods.filter(p =>
    (!invFilter || (p.name + ' ' + p.sku + ' ' + p.category).toLowerCase().includes(invFilter.toLowerCase())) &&
    (!invLowOnly || p.stock <= p.reorder)).sort((a, b) => a.name.localeCompare(b.name));
  $('#main').innerHTML = `<h1>Inventory</h1>
    <div class="bar">
      <input id="f" placeholder="Search products…" value="${esc(invFilter)}">
      <label class="row" style="flex-direction:row;color:var(--ink)"><input type="checkbox" id="lo" style="width:auto" ${invLowOnly ? 'checked' : ''}> Low stock only</label>
      <span class="grow"></span>
      ${isAdmin ? '<button class="pri" onclick="productForm()">+ Add product</button><button onclick="stockLog()">Stock log</button><button id="ex">Export CSV</button>' : ''}
    </div>
    <div class="card tw"><table>
      <tr><th>SKU</th><th>Product</th><th>Category</th><th class="n">Cost</th><th class="n">Price</th><th class="n">Stock</th><th class="n">Reorder</th><th>Status</th>${isAdmin ? '<th></th>' : ''}</tr>
      ${list.map(p => `<tr class="${p.stock <= 0 ? 'out' : p.stock <= p.reorder ? 'low' : ''}">
        <td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td class="n">${money(p.cost)}</td><td class="n">${money(p.price)}</td>
        <td class="n"><b>${p.stock}</b></td><td class="n">${p.reorder}</td>
        <td><span class="tag ${p.stock <= 0 ? 'bad' : p.stock <= p.reorder ? 'warn' : 'ok'}">${p.stock <= 0 ? 'Out' : p.stock <= p.reorder ? 'Low' : 'OK'}</span></td>
        ${isAdmin ? `<td class="n"><button class="sm" onclick="adjustForm(${p.id})">± Stock</button> <button class="sm" onclick="productForm(${p.id})">Edit</button> <button class="sm bad" onclick="delProduct(${p.id})">Delete</button></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="9" class="muted">No products found. ${isAdmin ? '<a href="#" onclick="loadSamples();return false">Load sample products</a> to try the system.' : ''}</td></tr>`}
    </table></div>
    <datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
  $('#f').oninput = e => { invFilter = e.target.value; const pos = e.target.selectionStart; viewInventory().then(() => { const f = $('#f'); f.focus(); f.setSelectionRange(pos, pos); }); };
  $('#lo').onchange = e => { invLowOnly = e.target.checked; viewInventory(); };
  if ($('#ex')) $('#ex').onclick = () => csv('inventory.csv', [['SKU', 'Name', 'Category', 'Cost', 'Price', 'Stock', 'Reorder level'], ...prods.map(p => [p.sku, p.name, p.category, p.cost, p.price, p.stock, p.reorder])]);
}

async function productForm(id) {
  const p = id ? await get('products', id) : { sku: '', name: '', category: '', cost: '', price: '', stock: 0, reorder: cfg().low };
  modal(`<h3>${id ? 'Edit' : 'Add'} product</h3><form id="pf" class="form">
    <label>SKU / Barcode<input name="sku" required value="${esc(p.sku)}"></label>
    <label>Name<input name="name" required value="${esc(p.name)}"></label>
    <label>Category<input name="category" list="cats" value="${esc(p.category)}"></label>
    <label>Reorder level<input name="reorder" type="number" min="0" required value="${p.reorder}"></label>
    <label>Cost price<input name="cost" type="number" min="0" step="0.01" required value="${p.cost}"></label>
    <label>Selling price<input name="price" type="number" min="0" step="0.01" required value="${p.price}"></label>
    ${id ? '' : `<label class="full">Opening stock<input name="stock" type="number" min="0" required value="${p.stock}"></label>`}
    <div class="full row end"><button type="button" onclick="closeModal()">Cancel</button><button class="pri">Save</button></div></form>`);
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const o = { ...p, sku: f.get('sku').trim(), name: f.get('name').trim(), category: f.get('category').trim(), cost: num(f.get('cost')), price: num(f.get('price')), reorder: Math.floor(num(f.get('reorder'))) };
    if (!id) o.stock = Math.floor(num(f.get('stock')));
    try {
      const key = await put('products', o);
      if (!id && o.stock > 0) await add('moves', { date: new Date().toISOString(), productId: key, name: o.name, qty: o.stock, type: 'Opening stock', user: me.username });
      closeModal(); toast('Product saved'); viewInventory();
    } catch (err) { toast('SKU already exists', 1); }
  };
}
async function adjustForm(id) {
  const p = await get('products', id);
  modal(`<h3>Adjust stock — ${esc(p.name)}</h3><p class="muted">Current stock: <b>${p.stock}</b>. Use a positive number to add (restock) or negative to remove (damage, loss, correction).</p>
    <form id="af" class="form"><label>Change (+/−)<input name="q" type="number" step="1" required autofocus></label>
    <label>Reason<select name="r"><option>Restock / delivery</option><option>Damaged</option><option>Lost / theft</option><option>Count correction</option><option>Return</option></select></label>
    <div class="full row end"><button type="button" onclick="closeModal()">Cancel</button><button class="pri">Apply</button></div></form>`);
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), q = Math.trunc(num(f.get('q')));
    if (!q) return toast('Enter a non-zero quantity', 1);
    if (p.stock + q < 0) return toast('Stock cannot go below zero', 1);
    p.stock += q; await put('products', p);
    await add('moves', { date: new Date().toISOString(), productId: p.id, name: p.name, qty: q, type: f.get('r'), user: me.username });
    closeModal(); toast('Stock updated'); viewInventory();
  };
}
async function delProduct(id) {
  const p = await get('products', id);
  if (!confirm(`Delete "${p.name}"? Past sales keep their records.`)) return;
  await del('products', id); toast('Deleted'); viewInventory();
}
async function stockLog() {
  const m = (await all('moves')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  modal(`<h3>Stock movements (latest 100)</h3><div class="tw"><table><tr><th>Date</th><th>Product</th><th class="n">Qty</th><th>Type</th><th>By</th></tr>
    ${m.map(x => `<tr><td>${new Date(x.date).toLocaleString()}</td><td>${esc(x.name)}</td><td class="n" style="color:${x.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${x.qty > 0 ? '+' : ''}${x.qty}</td><td>${esc(x.type)}</td><td>${esc(x.user)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No movements yet.</td></tr>'}
    </table></div><div class="row end" style="margin-top:12px"><button onclick="closeModal()">Close</button></div>`, true);
}
async function loadSamples() {
  const S = [['SKU-1001', 'Bottled Water 500ml', 'Beverages', 8, 15, 120, 24], ['SKU-1002', 'Instant Coffee Sachet', 'Beverages', 3, 7, 200, 50], ['SKU-1003', 'Cola 1.5L', 'Beverages', 42, 65, 36, 12],
  ['SKU-2001', 'Instant Noodles', 'Food', 9, 15, 150, 30], ['SKU-2002', 'Canned Sardines', 'Food', 18, 28, 60, 15], ['SKU-2003', 'White Rice 1kg', 'Food', 48, 62, 80, 20],
  ['SKU-2004', 'Cooking Oil 1L', 'Food', 95, 120, 18, 10], ['SKU-3001', 'Laundry Soap Bar', 'Household', 12, 20, 40, 10], ['SKU-3002', 'Dishwashing Liquid', 'Household', 30, 48, 25, 8],
  ['SKU-3003', 'Tissue Roll 4pk', 'Household', 45, 70, 4, 8], ['SKU-4001', 'Shampoo Sachet', 'Personal Care', 4, 8, 180, 40], ['SKU-4002', 'Toothpaste 75ml', 'Personal Care', 38, 59, 30, 10]];
  for (const s of S) {
    try { const id = await add('products', { sku: s[0], name: s[1], category: s[2], cost: s[3], price: s[4], stock: s[5], reorder: s[6] }); await add('moves', { date: new Date().toISOString(), productId: id, name: s[1], qty: s[5], type: 'Opening stock', user: me.username }); } catch (e) { }
  }
  toast('Sample products loaded'); viewInventory();
}

/* =========================================================
   SALES HISTORY
   ========================================================= */
let sFrom = '', sTo = '';
async function viewSales() {
  if (!sFrom) { const d = new Date(); d.setDate(d.getDate() - 29); sFrom = dayKey(d); sTo = dayKey(new Date()); }
  const sales = (await all('sales')).filter(s => dayKey(s.date) >= sFrom && dayKey(s.date) <= sTo).sort((a, b) => b.id - a.id);
  const total = sales.filter(s => !s.voided).reduce((a, s) => a + s.total, 0);
  $('#main').innerHTML = `<h1>Sales History</h1>
    <div class="bar"><label>From<input type="date" id="sf" value="${sFrom}"></label><label>To<input type="date" id="st" value="${sTo}"></label>
      <span class="grow"></span><b>Total: ${money(total)}</b><button id="exs">Export CSV</button></div>
    <div class="card tw"><table><tr><th>Receipt</th><th>Date</th><th>Cashier</th><th class="n">Items</th><th class="n">Total</th><th>Payment</th><th>Status</th><th></th></tr>
    ${sales.map(s => `<tr><td>#${String(s.id).padStart(6, '0')}</td><td>${new Date(s.date).toLocaleString()}</td><td>${esc(s.user)}</td><td class="n">${s.items.reduce((a, i) => a + i.qty, 0)}</td><td class="n">${money(s.total)}</td><td>${esc(s.payment)}</td>
      <td><span class="tag ${s.voided ? 'bad' : 'ok'}">${s.voided ? 'Voided' : 'Paid'}</span></td>
      <td class="n"><button class="sm" onclick="viewReceipt(${s.id})">View</button> ${me.role === 'admin' && !s.voided ? `<button class="sm bad" onclick="voidSale(${s.id})">Void</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="8" class="muted">No sales in this period.</td></tr>'}</table></div>`;
  $('#sf').onchange = e => { sFrom = e.target.value; viewSales(); };
  $('#st').onchange = e => { sTo = e.target.value; viewSales(); };
  $('#exs').onclick = () => csv('sales.csv', [['Receipt', 'Date', 'Cashier', 'Item', 'SKU', 'Qty', 'Price', 'Sale discount', 'Sale total', 'Payment', 'Status'],
  ...sales.flatMap(s => s.items.map(i => [s.id, s.date, s.user, i.name, i.sku, i.qty, i.price, s.discount, s.total, s.payment, s.voided ? 'Voided' : 'Paid']))]);
}
async function viewReceipt(id) { modal(receipt(await get('sales', id))); }
async function voidSale(id) {
  if (!confirm('Void this sale? Items will be returned to stock.')) return;
  const t = db.transaction(['products', 'sales', 'moves'], 'readwrite');
  const s = await new Promise(r => t.objectStore('sales').get(id).onsuccess = e => r(e.target.result));
  s.voided = true; t.objectStore('sales').put(s);
  s.items.forEach(i => {
    t.objectStore('products').get(i.id).onsuccess = e => {
      const p = e.target.result; if (!p) return;
      p.stock += i.qty; t.objectStore('products').put(p);
      t.objectStore('moves').add({ date: new Date().toISOString(), productId: p.id, name: p.name, qty: i.qty, type: 'Void sale #' + id, user: me.username });
    };
  });
  t.oncomplete = () => { toast('Sale voided'); viewSales(); };
}

/* =========================================================
   USERS
   ========================================================= */
async function viewUsers() {
  const users = await all('users');
  $('#main').innerHTML = `<h1>Users</h1><div class="bar"><span class="grow"></span><button class="pri" onclick="userForm()">+ Add user</button></div>
    <div class="card tw"><table><tr><th>Username</th><th>Name</th><th>Role</th><th></th></tr>
    ${users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.name)}</td><td><span class="tag">${u.role}</span></td>
      <td class="n"><button class="sm" onclick="userForm(${u.id})">Edit / reset password</button> ${u.id !== me.id ? `<button class="sm bad" onclick="delUser(${u.id})">Delete</button>` : ''}</td></tr>`).join('')}</table></div>`;
}
async function userForm(id) {
  const u = id ? await get('users', id) : { username: '', name: '', role: 'cashier' };
  modal(`<h3>${id ? 'Edit' : 'Add'} user</h3><form id="uf" class="form">
    <label>Username<input name="u" required value="${esc(u.username)}" ${id ? 'readonly' : ''}></label>
    <label>Full name<input name="n" required value="${esc(u.name)}"></label>
    <label>Role<select name="r"><option value="cashier" ${u.role === 'cashier' ? 'selected' : ''}>Cashier (POS, view inventory/sales)</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin (everything)</option></select></label>
    <label>${id ? 'New password (leave blank to keep)' : 'Password (min 6)'}<input name="p" type="password" minlength="6" ${id ? '' : 'required'} autocomplete="new-password"></label>
    <div class="full row end"><button type="button" onclick="closeModal()">Cancel</button><button class="pri">Save</button></div></form>`);
  $('#uf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      if (id) {
        u.name = f.get('n').trim();
        if (u.id === me.id && f.get('r') !== 'admin') return toast("You can't remove your own admin role", 1);
        u.role = f.get('r');
        if (f.get('p')) { u.salt = Math.random().toString(36).slice(2) + Date.now().toString(36); u.hash = await hash(f.get('p'), u.salt); }
        await put('users', u);
      } else await createUser(f.get('u'), f.get('n'), f.get('r'), f.get('p'));
      closeModal(); toast('User saved'); viewUsers();
    } catch (err) { toast('Username already exists', 1); }
  };
}
async function delUser(id) { if (!confirm('Delete this user?')) return; await del('users', id); viewUsers(); }

/* =========================================================
   SETTINGS & BACKUP
   ========================================================= */
function viewSettings() {
  const c = cfg();
  $('#main').innerHTML = `<h1>Settings &amp; Backup</h1>
    <div class="two eq">
      <form class="card form" id="cf"><h3 class="full">Store settings</h3>
        <label class="full">Store name<input name="store" required value="${esc(c.store)}"></label>
        <label>Currency symbol<input name="cur" required maxlength="4" value="${esc(c.cur)}"></label>
        <label>Default low-stock level<input name="low" type="number" min="0" value="${c.low}"></label>
        <div class="full row end"><button class="pri">Save settings</button></div></form>
      <div class="card"><h3>Backup &amp; restore</h3>
        <p class="muted">All data lives only in this browser. Download a backup regularly and keep a copy somewhere safe (USB / cloud). Restoring replaces ALL current data.</p>
        <div class="row"><button class="pri" id="bk">⬇ Download backup (.json)</button><label class="row" style="flex-direction:row"><button id="rs" type="button">⬆ Restore from file</button></label><input type="file" id="rf" accept=".json" class="hidden"></div></div>
    </div>`;
  $('#cf').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    localStorage.setItem('cfg', JSON.stringify({ store: f.get('store').trim(), cur: f.get('cur').trim(), low: Math.floor(num(f.get('low'))) }));
    $('#brand').textContent = cfg().store; toast('Settings saved');
  };
  $('#bk').onclick = async () => {
    const data = { app: 'salesinv', version: 1, exported: new Date().toISOString(), cfg: cfg() };
    for (const s of ['users', 'products', 'sales', 'moves']) data[s] = await all(s);
    download(`backup-${dayKey(new Date())}.json`, 'application/json', JSON.stringify(data));
  };
  $('#rs').onclick = () => $('#rf').click();
  $('#rf').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== 'salesinv' || !(d.users || []).some(u => u.role === 'admin')) throw new Error('bad');
      if (!confirm('Replace ALL current data with this backup?')) return;
      const names = ['users', 'products', 'sales', 'moves'];
      const t = db.transaction(names, 'readwrite');
      names.forEach(n => { const s = t.objectStore(n); s.clear(); (d[n] || []).forEach(o => s.put(o)); });
      await new Promise((r, j) => { t.oncomplete = r; t.onerror = j; t.onabort = j; });
      if (d.cfg) localStorage.setItem('cfg', JSON.stringify(d.cfg));
      toast('Backup restored. Please log in again.'); sessionStorage.clear(); setTimeout(() => location.reload(), 1200);
    } catch (err) { toast('Invalid backup file', 1); }
  };
}

/* ---------- boot ---------- */
(async () => {
  try { await openDB(); } catch (e) { document.body.innerHTML = '<p style="padding:20px">This browser blocks local storage (IndexedDB). Please use a normal (non-private) window.</p>'; return; }
  netState();
  const users = await all('users');
  if (!users.length) showSetup();
  else if (sessionStorage.getItem('uid')) startApp();
  else showLogin();
})();
