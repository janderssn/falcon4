// The order summary, laid out as a printed order form: reference and date, blank lines for
// customer and dealer, the sail as a line drawing, the sail panels and the options as tables
// with part numbers and prices, and the totals. Prices come from ORDER in fabrics.js; where
// Wills Wing gives none, the line says "Quote". It is a request to take to a dealer, not a
// Wills Wing document, and says so.
import { ORDER, isUpgrade } from './fabrics.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => `$${n.toLocaleString('en-US')}`;
const price = (n) => (n === null ? 'Quote' : n ? usd(n) : '—');

/** The upgrade part for a cloth on a panel, if any. */
function upgradePart(zone, id) {
  if (!isUpgrade(id)) return null;
  const U = ORDER.upgrades;
  if (id === 'white-205mt') return U.mt205[zone] || null;
  if (/240/.test(id)) return U.heavy[zone] || null;
  return U.uvpx[zone] || U.heavy[zone] || null;
}

/** Table rows for the sail: one per panel, and one per charge on it. */
function sailRows(panels) {
  const rows = [];
  for (const p of panels) {
    const id = p.fabric?.id || null;
    const cloth = !id ? '' : isUpgrade(id) ? (/^uv/.test(id) ? 'Laminate' : 'Woven ripstop') : 'Woven polyester';
    rows.push({ panel: p.label, fabric: p.fabric?.name || 'As built', cloth, part: '', cost: 0, main: true, colour: p.fabric?.hex || p.asBuilt, clear: p.fabric?.opacity < 1 });
    const c = ORDER.colouredPanel;
    if (c.zones.includes(p.zone) && id && id !== c.standard) rows.push({ fabric: `Colour choice, ${p.label}`, part: c.part, cost: c.price });
    if (isUpgrade(id)) rows.push({ fabric: `Cloth upgrade, ${p.label} to ${p.fabric.name}`, part: upgradePart(p.zone, id) || '', cost: null });
  }
  return rows;
}

// A short reference for this configuration, from its link.
const reference = (s) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `F4-${(h >>> 0).toString(36).toUpperCase().slice(0, 6)}`;
};

/** Opens the order. data: { model, size, build, colours, diagram, panels, extras: [{ name, value }] }. */
export function openOrder(data, chosen = new Set()) {
  const root = $('#order');
  const rows = sailRows(data.panels);
  const ref = reference(location.search);
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const render = () => {
    const options = ORDER.options.map((o) => ({ ...o, on: chosen.has(o.id) }));
    const charges = [...rows.filter((r) => !r.main), ...options.filter((o) => o.on).map((o) => ({ cost: o.price }))];
    const listed = charges.reduce((s, c) => s + (c.cost || 0), 0);
    const quotes = charges.filter((c) => c.cost === null).length;
    root.innerHTML = `
      <div class="order-bar">
        <span>Order form</span>
        <button type="button" data-act="copy">Copy as text</button>
        <button type="button" data-act="print">Print</button>
        <button type="button" data-act="close" aria-label="Close">Close</button>
      </div>
      <article class="sheet-paper" role="document">
        <header class="of-head">
          <div>
            <h2 id="order-title">${esc(data.model)} — order request</h2>
            <p>Sail colours and options, to place an order through a Wills Wing dealer</p>
          </div>
          <dl class="of-meta">
            <dt>Reference</dt><dd>${ref}</dd>
            <dt>Date</dt><dd>${esc(date)}</dd>
          </dl>
        </header>

        <section class="of-fields">
          <div><span>Customer</span><i></i></div>
          <div><span>Phone / email</span><i></i></div>
          <div><span>Dealer</span><i></i></div>
          <div><span>Delivery</span><i></i></div>
        </section>

        <section class="of-glider">
          <table class="of-kv">
            <tr><th>Model</th><td>${esc(data.model)}</td></tr>
            <tr><th>Size</th><td>${esc(data.size)}</td></tr>
            <tr><th>Sail cloth</th><td>V170 woven polyester unless noted</td></tr>
            <tr><th>Colours shown</th><td>${esc(data.colours)}</td></tr>
          </table>
          <div class="of-plan">${data.diagram}</div>
        </section>

        <h3>Sail</h3>
        <table class="of-table">
          <thead><tr><th>Panel</th><th>Fabric</th><th>Part no.</th><th class="num">Price</th></tr></thead>
          <tbody>
            ${rows.map((r) => r.main
              ? `<tr class="of-main"><td><span class="of-dot${r.clear ? ' clear' : ''}" style="--c:${r.colour}"></span>${esc(r.panel)}</td><td>${esc(r.fabric)}${r.cloth ? `<small>${esc(r.cloth)}</small>` : ''}</td><td></td><td class="num">Included</td></tr>`
              : `<tr class="of-sub"><td></td><td>${esc(r.fabric)}</td><td>${esc(r.part)}</td><td class="num">${price(r.cost)}</td></tr>`).join('')}
          </tbody>
        </table>

        <h3>Options</h3>
        <table class="of-table">
          <thead><tr><th></th><th>Option</th><th>Part no.</th><th class="num">Price</th></tr></thead>
          <tbody>
            ${options.map((o) => `
              <tr class="of-opt${o.on ? ' on' : ''}">
                <td><label class="of-box"><input type="checkbox" data-opt="${o.id}" ${o.on ? 'checked' : ''} aria-label="${esc(o.name)}"><span></span></label></td>
                <td>${esc(o.name)}<small>${esc(o.note)}</small></td>
                <td>${o.part}</td>
                <td class="num">${price(o.price)}</td>
              </tr>`).join('')}
          </tbody>
        </table>

        <section class="of-foot">
          <div class="of-notes">
            <span>Notes</span>
            ${data.extras.length ? `<p>Shown in the configurator only, not factory options: ${data.extras.map((e) => `${esc(e.name)} ${esc(e.value)}`).join(', ')}.</p>` : '<p></p>'}
            <i></i><i></i>
          </div>
          <table class="of-totals">
            <tr><th>Glider, ${esc(data.size)}</th><td class="num of-fill"></td></tr>
            <tr><th>Options listed above</th><td class="num">${usd(listed)}</td></tr>
            <tr><th>Quoted items (${quotes})</th><td class="num of-fill"></td></tr>
            <tr class="of-grand"><th>Total</th><td class="num of-fill"></td></tr>
          </table>
        </section>

        <footer class="of-small">
          <p>Prices from willswing.com, Falcon 4 options, November 2026; the dealer confirms all prices. Prepared with the Falcon 4 configurator; not a Wills Wing document.</p>
          <p class="of-link">${esc(location.href)}</p>
        </footer>
      </article>`;
    root.hidden = false;
    document.body.classList.add('ordering');
    return { listed, quotes, options };
  };
  let summary = render();
  $('[data-act="close"]', root).focus();
  const close = () => { root.hidden = true; document.body.classList.remove('ordering'); root.onclick = root.onchange = null; removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  root.onchange = (e) => {
    const id = e.target.dataset.opt;
    if (!id) return;
    if (e.target.checked) chosen.add(id); else chosen.delete(id);
    summary = render();
  };
  root.onclick = async (e) => {
    if (e.target === root) return close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    if (act === 'print') print();
    if (act === 'copy') {
      const pad = (s, n) => String(s).padEnd(n);
      const text = [
        `${data.model} — order request   ${ref}   ${date}`, '',
        `Size: ${data.size}`, `Colours shown: ${data.colours}`, '',
        'SAIL',
        ...rows.map((r) => (r.main ? `  ${pad(r.panel, 22)}${r.fabric}${r.cloth ? ` (${r.cloth})` : ''}` : `    ${pad(r.fabric, 44)}${pad(r.part, 10)}${price(r.cost)}`)),
        '', 'OPTIONS',
        ...summary.options.filter((o) => o.on).map((o) => `  ${pad(o.name, 44)}${pad(o.part, 10)}${price(o.price)}`),
        ...(summary.options.some((o) => o.on) ? [] : ['  none']),
        '', `Options listed: ${usd(summary.listed)}${summary.quotes ? `; ${summary.quotes} item(s) to be quoted` : ''}`,
        ...(data.extras.length ? [`Configurator only: ${data.extras.map((x) => `${x.name} ${x.value}`).join(', ')}`] : []),
        `Link: ${location.href}`,
      ].join('\n');
      try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
    }
  };
}
