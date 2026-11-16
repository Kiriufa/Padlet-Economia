// Vista previa de una tarjeta: en grande, para leerla (texto con formato, imágenes,
// vídeo, archivo o enlace). Para cambiar algo está el botón "Editar".

import { supabase, BUCKET, DEMO } from './supabase.js';
import { el, avatar, toast, clearFades, fadeOutCopy, ICONS } from './ui.js';
import { cleanDoc, textToDoc } from './richtext.js';
import { COLORS, COLOR_NAMES, STATUSES, domainOf, extOf, formatDate, formatSize, isOverdue, youtubeId } from './utils.js';

let V = null; // vista abierta
let ctx = null;

const publicUrl = (path, download) =>
  supabase.storage.from(BUCKET).getPublicUrl(path, download ? { download } : undefined).data.publicUrl;

export const isPreviewOpen = () => Boolean(V);

/**
 * c: { getCard(id), siblings(card) → tarjetas de su columna en orden, edit(card, from),
 *      member(u), assigneesOf(id), me() }
 */
export function openPreview(card, c, from = null) {
  ctx = c;
  clearFades();
  const dlg = document.getElementById('preview');
  if (!V) {
    V = { dlg, from, expanded: false };
    dlg.oncancel = (e) => { e.preventDefault(); closePreview(); };
    dlg.onpointerdown = (e) => { V && (V.downOutside = e.target === dlg); };
    dlg.onclick = (e) => { if (e.target === dlg && V?.downOutside) closePreview(); };
    dlg.onkeydown = onKey;
  }
  V.id = card.id;
  V.expanded = false;
  draw();
  if (!dlg.open) {
    dlg.showModal();
    document.documentElement.classList.add('panel-open');
    // Crece desde la tarjeta que se ha tocado
    if (from?.getBoundingClientRect) {
      const a = from.getBoundingClientRect(), r = V.box.getBoundingClientRect();
      V.box.style.transformOrigin = `${a.left + a.width / 2 - r.left}px ${a.top + a.height / 2 - r.top}px`;
    }
  }
  V.box.querySelector('.pv-edit')?.focus({ preventScroll: true });
}

export function closePreview({ animate = true } = {}) {
  if (!V) return;
  const { dlg, from, box } = V;
  if (animate) fadeOutCopy(box);
  V = null;
  dlg.close();
  dlg.replaceChildren();
  document.documentElement.classList.remove('panel-open');
  if (from?.isConnected) from.focus({ preventScroll: true });
}

/** El tablero avisa de cambios: si la tarjeta abierta ha cambiado, se vuelve a dibujar. */
export function refreshPreview() {
  if (!V) return;
  const card = ctx.getCard(V.id);
  if (!card) { closePreview(); toast('Esta tarea se ha borrado'); return; }
  if (keyOf(card) !== V.key) {
    const top = V.scroll?.scrollTop || 0;
    draw();
    V.scroll.scrollTop = top;
  }
}

const keyOf = (card) => JSON.stringify([card.version, card.title, card.color, card.due_date, card.status, card.file_path, card.url,
  [...ctx.assigneesOf(card.id)].sort(), ctx.siblings(card).map((s) => s.id)]);

function onKey(e) {
  if (!V || e.target.closest?.('input, textarea, select, iframe')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(e.key === 'ArrowRight' ? 1 : -1); }
  if ((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); edit(); }
}

function go(dir) {
  const card = ctx.getCard(V.id);
  if (!card) return;
  const list = ctx.siblings(card);
  const i = list.findIndex((x) => x.id === card.id);
  const next = list[i + dir];
  if (!next) return;
  V.id = next.id;
  V.expanded = false;
  draw();
  V.box.animate?.([{ opacity: 0.4, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  V.box.querySelector('.pv-edit')?.focus({ preventScroll: true });
}

function edit() {
  const card = ctx.getCard(V.id);
  if (!card) return;
  const from = V.from;
  closePreview({ animate: false });
  ctx.edit(card, from);
}

// ---------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------

function draw() {
  const card = ctx.getCard(V.id);
  if (!card) return;
  V.key = keyOf(card);
  const list = ctx.siblings(card);
  const i = list.findIndex((x) => x.id === card.id);
  const statusLabel = STATUSES.find(([s]) => s === card.status)?.[1] || '';

  const head = el('header', { class: 'tp-head pv-head' },
    el('span', { class: `pv-col col-${card.status}`, html: ICONS[card.status] || '' }, statusLabel),
    list.length > 1 && el('span', { class: 'pv-count muted small', text: `${i + 1} de ${list.length}` }),
    el('span', { class: 'tp-spacer' }),
    el('button', { class: 'tp-icon', type: 'button', title: 'Anterior (←)', 'aria-label': 'Anterior', disabled: i <= 0, onclick: () => go(-1), html: chevron('m15 18-6-6 6-6') }),
    el('button', { class: 'tp-icon', type: 'button', title: 'Siguiente (→)', 'aria-label': 'Siguiente', disabled: i < 0 || i >= list.length - 1, onclick: () => go(1), html: chevron('m9 18 6-6-6-6') }),
    el('button', { class: 'btn primary pv-edit', type: 'button', title: 'Editar (E)', onclick: edit }, el('span', { html: ICONS.edit }), 'Editar'),
    el('button', { class: 'tp-icon', type: 'button', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', text: '✕', onclick: () => closePreview() }));

  const doc = cleanDoc(card.content) || (card.description ? textToDoc(card.description) : null);
  const body = doc ? renderDoc(doc) : null;
  const hasSections = Boolean(body?.querySelector('details'));
  const attach = attachment(card);

  const people = [...ctx.assigneesOf(card.id)];
  const overdue = isOverdue(card.due_date, card.status);
  const meta = el('div', { class: 'pv-meta' },
    card.color && el('span', { class: 'pv-tag', style: `--tag:${COLORS[card.color]}` }, COLOR_NAMES[card.color] || ''),
    people.length
      ? el('span', { class: 'pv-people' }, ...people.map((u) => el('span', { class: 'tp-person' }, avatar(ctx.member(u), u, 'sm'),
        el('span', { text: u === ctx.me() ? 'Tú' : (ctx.member(u)?.name || '?') }))))
      : el('span', { class: 'muted small', text: 'Sin encargado' }),
    card.due_date && el('span', { class: `due${overdue ? ' overdue' : ''}` }, el('span', { html: ICONS.calendar }),
      overdue ? `Venció el ${formatDate(card.due_date)}` : formatDate(card.due_date)));

  const toggle = hasSections && el('button', { class: 'btn small ghost pv-toggle', type: 'button', text: 'Desplegar todo', onclick: (e) => {
    V.expanded = !V.expanded;
    V.scroll.querySelectorAll('.pv-content details').forEach((d) => { d.open = V.expanded; });
    e.currentTarget.textContent = V.expanded ? 'Plegar todo' : 'Desplegar todo';
  } });

  V.scroll = el('div', { class: 'pv-scroll' },
    el('article', { class: 'pv-page' },
      el('h1', { class: 'pv-title', text: card.title || 'Sin título' }),
      meta,
      attach,
      toggle,
      body && el('div', { class: 'pv-content rt-content' }, body),
      !body && !attach && el('p', { class: 'pv-empty' }, 'Todavía no tiene texto. ', el('button', { class: 'linklike', type: 'button', text: 'Escribir algo', onclick: edit }))));

  V.box = el('div', { class: 'tp pv' }, head, V.scroll);
  V.dlg.replaceChildren(V.box);
}

const chevron = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

function attachment(card) {
  try {
    if (card.kind === 'image' && card.file_path) {
      const src = publicUrl(card.file_path);
      return el('a', { class: 'pv-media', href: src, target: '_blank', rel: 'noopener', title: 'Abrir la imagen en otra pestaña' },
        el('img', { src, alt: card.file_name || card.title }));
    }
    if (card.kind === 'youtube' && card.url) {
      const id = youtubeId(card.url);
      if (!id) return null;
      if (DEMO) return el('a', { class: 'pv-link', href: card.url, target: '_blank', rel: 'noopener' }, '▶ Ver el vídeo en YouTube');
      return el('div', { class: 'pv-video' }, el('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${id}`, title: card.title,
        allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy',
      }));
    }
    if (card.kind === 'link' && card.url) {
      return el('a', { class: 'pv-link', href: card.url, target: '_blank', rel: 'noopener noreferrer' },
        el('span', { html: ICONS.link }), el('strong', { text: domainOf(card.url) }), el('span', { class: 'muted small pv-url', text: card.url }));
    }
    if (card.kind === 'file' && card.file_path) {
      const ext = extOf(card.file_name);
      const box = el('div', { class: 'pv-file' },
        el('div', { class: 'file' },
          el('span', { class: `file-ext ext-${ext}`, text: ext.toUpperCase() || 'FILE' }),
          el('div', { class: 'file-info' },
            el('span', { class: 'file-name', text: card.file_name || 'Archivo' }),
            el('span', { class: 'muted small', text: formatSize(card.file_size) })),
          !DEMO && ext === 'pdf' && el('a', { class: 'btn small ghost', href: publicUrl(card.file_path), target: '_blank', rel: 'noopener', text: 'Abrir' }),
          el('a', { class: 'btn small', href: publicUrl(card.file_path, card.file_name), onclick: DEMO ? (e) => { e.preventDefault(); toast('En la demo los archivos no se descargan'); } : null },
            el('span', { html: ICONS.download }), 'Descargar')));
      // Los PDF se pueden leer aquí mismo
      if (ext === 'pdf' && !DEMO) box.append(el('iframe', { class: 'pv-pdf', src: publicUrl(card.file_path), title: card.file_name || 'PDF', loading: 'lazy' }));
      return box;
    }
  } catch (e) { console.warn('Adjunto no válido', e); }
  return null;
}

// Documento del editor (ya limpio con cleanDoc) → HTML de solo lectura
export function renderDoc(doc) {
  const frag = document.createDocumentFragment();
  for (const n of doc.content || []) { const x = node(n); if (x) frag.append(x); }
  return frag;
}

function kids(n, parent) {
  for (const c of n.content || []) { const x = node(c); if (x) parent.append(x); }
  return parent;
}

function node(n) {
  switch (n.type) {
    case 'text': return text(n);
    case 'paragraph': { const p = kids(n, document.createElement('p')); if (!p.childNodes.length) p.append(document.createElement('br')); return p; }
    case 'heading': return kids(n, document.createElement(`h${n.attrs?.level || 2}`));
    case 'bulletList': return kids(n, document.createElement('ul'));
    case 'orderedList': { const ol = kids(n, document.createElement('ol')); if (n.attrs?.start > 1) ol.start = n.attrs.start; return ol; }
    case 'listItem': return kids(n, document.createElement('li'));
    case 'taskList': { const ul = kids(n, document.createElement('ul')); ul.dataset.type = 'taskList'; return ul; }
    case 'taskItem': {
      const checked = n.attrs?.checked === true;
      const li = el('li', { 'data-checked': String(checked) },
        el('label', {}, el('input', { type: 'checkbox', checked, disabled: true, 'aria-label': checked ? 'Hecho' : 'Pendiente' })));
      li.append(kids(n, document.createElement('div')));
      return li;
    }
    case 'blockquote': return kids(n, document.createElement('blockquote'));
    case 'horizontalRule': return document.createElement('hr');
    case 'hardBreak': return document.createElement('br');
    case 'codeBlock': { const pre = document.createElement('pre'); pre.append(kids(n, document.createElement('code'))); return pre; }
    case 'image': {
      const src = n.attrs?.src;
      if (!src) return null;
      return el('a', { class: 'pv-img', href: src, target: '_blank', rel: 'noopener', title: 'Abrir la imagen en otra pestaña' },
        el('img', { src, alt: n.attrs.alt || '', loading: 'lazy' }));
    }
    case 'details': {
      const d = document.createElement('details');
      d.className = 'pv-details';
      for (const part of n.content || []) {
        if (part.type === 'detailsSummary') d.append(kids(part, document.createElement('summary')));
        else if (part.type === 'detailsContent') d.append(kids(part, el('div', { class: 'pv-details-body' })));
      }
      return d;
    }
    default: return n.content ? kids(n, document.createElement('div')) : null;
  }
}

function text(n) {
  let out = document.createTextNode(n.text);
  for (const m of n.marks || []) {
    let w;
    switch (m.type) {
      case 'bold': w = document.createElement('strong'); break;
      case 'italic': w = document.createElement('em'); break;
      case 'underline': w = document.createElement('u'); break;
      case 'strike': w = document.createElement('s'); break;
      case 'code': w = document.createElement('code'); break;
      case 'link': w = el('a', { href: m.attrs.href, target: '_blank', rel: 'noopener noreferrer' }); break;
      case 'textStyle': w = document.createElement('span'); w.style.color = m.attrs.color; break;
      case 'highlight': w = document.createElement('mark'); w.style.backgroundColor = m.attrs.color; break;
      default: continue;
    }
    w.append(out);
    out = w;
  }
  return out;
}
