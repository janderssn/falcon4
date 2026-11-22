// The order summary: the glider as configured, with the sail panels, the cloth upgrades and
// the options, and what each adds to the price. Prices come from ORDER in fabrics.js; where
// Wills Wing gives none, the line says "Dealer quote". Copy as text, print, or close.
import { ORDER, isUpgrade } from './fabrics.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => `$${n.toLocaleString('en-US')}`;

/** The upgrade part for a cloth on a panel, if any. */
function upgradePart(zone, id) {
  if (!isUpgrade(id)) return null;
  const U = ORDER.upgrades;
  if (id === 'white-205mt') return U.mt205[zone] || null;
  if (/240/.test(id)) return U.heavy[zone] || null;
  return U.uvpx[zone] || U.heavy[zone] || null;
}

/**
 * Lines for the sail. panels: [{ zone, name, fabric: { id, name, hex, opacity } | null }].
 * Each line: what it is, its cost (number, 0 for included, null for a quote) and part numbers.
 */
export function sailLines(panels) {
  const lines = [];
  for (const p of panels) {
    const id = p.fabric?.id || null;
    const cloth = !id ? 'As built' : isUpgrade(id) ? (/^uv/.test(id) ? 'Laminate' : 'Heavy woven ripstop') : 'Woven polyester';
    const items = [];
    const c = ORDER.colouredPanel;
    if (c.zones.includes(p.zone) && id && id !== c.standard) items.push({ what: 'Colour choice', cost: c.price, part: c.part });
    const up = upgradePart(p.zone, id);
    if (isUpgrade(id)) items.push({ what: 'Cloth upgrade', cost: null, part: up });
    lines.push({ ...p, cloth, items });
  }
  return lines;
}

/** Opens the order. data: { title, subtitle, image, diagram, panels, extras: [{ name, value }] }. */
export function openOrder(data, chosen = new Set()) {
  const root = $('#order');
  const lines = sailLines(data.panels);
  const render = () => {
    const options = ORDER.options.map((o) => ({ ...o, on: chosen.has(o.id) }));
    const items = [...lines.flatMap((l) => l.items), ...options.filter((o) => o.on).map((o) => ({ cost: o.price }))];
    const known = items.reduce((s, i) => s + (i.cost || 0), 0);
    const quotes = items.filter((i) => i.cost === null).length;
    root.innerHTML = `
      <div class="order-card" role="document">
        <header class="order-head">
          <div>
            <p class="order-kicker">Your order</p>
            <h2 id="order-title">${esc(data.title)}</h2>
            <p class="order-sub">${esc(data.subtitle)}</p>
          </div>
          <button type="button" class="icon order-close" aria-label="Close"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </header>
        <div class="order-hero">
          <img src="${data.image}" alt="The glider as configured">
          <div class="order-plan">${data.diagram}</div>
        </div>
        <section class="order-sec">
          <h3>Sail</h3>
          ${lines.map((l) => `
            <div class="order-line">
              <span class="order-sw${l.fabric && l.fabric.opacity < 1 ? ' clear' : ''}" style="--c:${l.fabric?.hex || l.asBuilt || '#888'};--o:${l.fabric?.opacity ?? 1}"></span>
              <span class="order-what"><b>${esc(l.name)}</b><small>${esc(l.fabric?.name || 'As built')} · ${esc(l.cloth)}</small></span>
              <span class="order-cost">${l.items.length ? l.items.map((i) => `<span>${i.cost === null ? 'Dealer quote' : `+${usd(i.cost)}`}<small>${esc(i.what)}${i.part ? ` · ${i.part}` : ''}</small></span>`).join('') : '<span class="incl">Included</span>'}</span>
            </div>`).join('')}
        </section>
        <section class="order-sec">
          <h3>Options</h3>
          ${options.map((o) => `
            <label class="order-line order-opt">
              <input type="checkbox" data-opt="${o.id}" ${o.on ? 'checked' : ''}>
              <span class="order-tick" aria-hidden="true"></span>
              <span class="order-what"><b>${esc(o.name)}</b><small>${esc(o.note)} · ${o.part}</small></span>
              <span class="order-cost"><span>${o.price === null ? 'Dealer quote' : `+${usd(o.price)}`}</span></span>
            </label>`).join('')}
        </section>
        ${data.extras.length ? `<section class="order-sec order-extras"><h3>In the viewer only</h3><p>${data.extras.map((e) => `${esc(e.name)}: ${esc(e.value)}`).join(' · ')}</p></section>` : ''}
        <footer class="order-foot">
          <div class="order-total">
            <small>Extras on top of the glider</small>
            <b>${usd(known)}</b>
            <small>${quotes ? `plus ${quotes} item${quotes > 1 ? 's' : ''} quoted by your dealer` : 'nothing left to quote'}</small>
          </div>
          <div class="order-btns">
            <button type="button" class="order-btn" data-act="copy">Copy order</button>
            <button type="button" class="order-btn" data-act="print">Print</button>
          </div>
          <p class="order-note">Prices from willswing.com (Falcon 4 options, November 2026). The glider's own price and the final total come from your Wills Wing dealer.</p>
        </footer>
      </div>`;
    root.hidden = false;
    document.body.classList.add('ordering');
    $('.order-close', root).focus();
    return { known, quotes, options };
  };
  let summary = render();
  const close = () => { root.hidden = true; document.body.classList.remove('ordering'); root.onclick = root.onchange = null; removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  root.onchange = (e) => {
    const id = e.target.dataset.opt;
    if (!id) return;
    if (e.target.checked) chosen.add(id); else chosen.delete(id);
    summary = render();
  };
  root.onclick = async (e) => {
    if (e.target === root || e.target.closest('.order-close')) return close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') print();
    if (act === 'copy') {
      const text = [
        `${data.title} (${data.subtitle})`, '',
        'Sail:',
        ...lines.map((l) => `  ${l.name}: ${l.fabric?.name || 'As built'} (${l.cloth})${l.items.map((i) => `, ${i.what} ${i.cost === null ? 'dealer quote' : `+${usd(i.cost)}`}${i.part ? ` [${i.part}]` : ''}`).join('')}`),
        '', 'Options:',
        ...(summary.options.filter((o) => o.on).map((o) => `  ${o.name} ${o.price === null ? 'dealer quote' : `+${usd(o.price)}`} [${o.part}]`)),
        ...(summary.options.some((o) => o.on) ? [] : ['  none']),
        '', `Extras: ${usd(summary.known)}${summary.quotes ? ` plus ${summary.quotes} dealer-quoted` : ''}`,
        `Link: ${location.href}`,
      ].join('\n');
      try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
    }
  };
}
