// Vista previa de una tarjeta: en grande, para leerla (texto con formato, imágenes,
// vídeo, archivo o enlace). Para cambiar algo está el botón "Editar".

import { supabase, BUCKET, DEMO } from './supabase.js';
import { el, avatar, toast, clearFades, fadeOutCopy, autosize, ICONS } from './ui.js';
import { collage, openLightbox } from './gallery.js';
import { cleanDoc, textToDoc } from './richtext.js';
import { COLORS, COLOR_NAMES, STATUSES, domainOf, extOf, formatDate, formatSize, isOverdue, youtubeId } from './utils.js';

let V = null; // vista abierta
let ctx = null;

const publicUrl = (path, download) =>
  supabase.storage.from(BUCKET).getPublicUrl(path, download ? { download } : undefined).data.publicUrl;

export const isPreviewOpen = () => Boolean(V);

/**
 * c: { getCard(id), siblings(card) → tarjetas de su columna en orden, edit(card, from),
 *      member(u), assigneesOf(id), me(), comments(id), addComment(id, text), removeComment(c) }
 * opts.comments: abrir ya con los comentarios a la vista
 */
export function openPreview(card, c, from = null, opts = {}) {
  ctx = c;
  clearFades();
  const dlg = document.getElementById('preview');
  if (!V) {
    V = { dlg, from, expanded: false };
    // Esc: si estás en los comentarios, primero se cierran ellos (así no pierdes lo escrito)
    dlg.oncancel = (e) => {
      e.preventDefault();
      if (V?.commentsOpen && V.aside?.contains(document.activeElement)) toggleComments();
      else closePreview();
    };
    dlg.onpointerdown = (e) => { V && (V.downOutside = e.target === dlg); };
    dlg.onclick = (e) => { if (e.target === dlg && V?.downOutside) closePreview(); };
    dlg.onkeydown = onKey;
  }
  V.id = card.id;
  V.expanded = false;
  if (opts.comments) V.commentsOpen = true;
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
  if (opts.comments) V.commentInput?.focus({ preventScroll: true });
  else V.box.querySelector('.pv-edit')?.focus({ preventScroll: true });
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
  // Los comentarios se redibujan aparte (así no se pierde lo que estás escribiendo)
  if (commentsKey() !== V.commentsKey) drawComments();
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
    V.commentsBtn = el('button', { class: 'btn pv-comments-btn', type: 'button', title: 'Comentarios', 'aria-expanded': String(Boolean(V.commentsOpen)), onclick: toggleComments },
      el('span', { html: COMMENT_ICON }), el('span', { class: 'pv-btn-label', text: 'Comentarios' }), el('span', { class: 'pv-badge' })),
    el('button', { class: 'btn primary pv-edit', type: 'button', title: 'Editar (E)', onclick: edit }, el('span', { html: ICONS.edit }), el('span', { class: 'pv-btn-label', text: 'Editar' })),
    el('button', { class: 'tp-icon', type: 'button', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', text: '✕', onclick: () => closePreview() }));

  const doc = cleanDoc(card.content) || (card.description ? textToDoc(card.description) : null);
  // Todas las fotos de la tarea, para el visor (la del adjunto va primero)
  V.photos = card.kind === 'image' && card.file_path ? [{ src: publicUrl(card.file_path), alt: card.file_name || card.title }] : [];
  const body = doc ? renderDoc(doc, V.photos) : null;
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
      pdfViewer(card),
      !body && !attach && el('p', { class: 'pv-empty' }, 'Todavía no tiene texto. ', el('button', { class: 'linklike', type: 'button', text: 'Escribir algo', onclick: edit }))));

  // Comentarios: panel al lado (o encima en pantallas pequeñas). Se conserva lo que estabas escribiendo.
  const draft = V.commentInput?.value || '';
  V.commentList = el('div', { class: 'pv-c-list', role: 'log', 'aria-live': 'polite' });
  V.commentInput = el('textarea', { class: 'input pv-c-input', rows: '1', maxlength: '2000', placeholder: 'Escribe un comentario…', 'aria-label': 'Escribe un comentario' });
  V.commentInput.value = draft;
  const fit = autosize(V.commentInput);
  const send = el('button', { class: 'btn primary pv-c-send', type: 'submit', text: 'Enviar' });
  const form = el('form', { class: 'pv-c-form' }, V.commentInput, send);
  V.commentInput.addEventListener('keydown', (e) => {
    // Enter envía; Mayús+Enter hace un salto de línea
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = V.commentInput.value.trim();
    if (!text || send.disabled) return;
    send.disabled = true;
    const ok = await ctx.addComment(card.id, text);
    if (!V) return;
    send.disabled = false;
    if (ok) { V.commentInput.value = ''; fit(); drawComments(); V.commentList.scrollTop = V.commentList.scrollHeight; }
    V.commentInput.focus({ preventScroll: true });
  };
  V.aside = el('aside', { class: 'pv-comments', hidden: !V.commentsOpen, 'aria-label': 'Comentarios' },
    el('header', { class: 'pv-c-head' }, el('strong', { text: 'Comentarios' }), el('span', { class: 'tp-spacer' }),
      el('button', { class: 'tp-icon', type: 'button', 'aria-label': 'Cerrar comentarios', title: 'Cerrar comentarios', text: '✕', onclick: toggleComments })),
    V.commentList, form);

  V.box = el('div', { class: `tp pv${V.commentsOpen ? ' with-comments' : ''}` }, head, el('div', { class: 'pv-main' }, V.scroll, V.aside));
  V.dlg.replaceChildren(V.box);
  drawComments();
  requestAnimationFrame(fit);
}

const COMMENT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>';

function toggleComments() {
  V.commentsOpen = !V.commentsOpen;
  V.aside.hidden = !V.commentsOpen;
  V.box.classList.toggle('with-comments', V.commentsOpen);
  V.commentsBtn.setAttribute('aria-expanded', String(V.commentsOpen));
  if (V.commentsOpen) {
    V.commentList.scrollTop = V.commentList.scrollHeight;
    V.commentInput.focus({ preventScroll: true });
    V.aside.animate?.([{ opacity: 0, transform: 'translateX(16px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
  } else {
    V.commentsBtn.focus({ preventScroll: true });
  }
}

const commentsKey = () => {
  const list = ctx.comments(V.id);
  return JSON.stringify(list.map((c) => c.id).concat(list.map((c) => ctx.member(c.user_id)?.name || '')));
};

function drawComments() {
  if (!V?.commentList) return;
  const list = ctx.comments(V.id);
  V.commentsKey = commentsKey();
  const badge = V.commentsBtn.querySelector('.pv-badge');
  badge.textContent = list.length ? String(list.length) : '';
  badge.hidden = !list.length;
  const atBottom = V.commentList.scrollHeight - V.commentList.scrollTop - V.commentList.clientHeight < 40;
  const known = new Set([...V.commentList.querySelectorAll('.pv-c')].map((n) => n.dataset.id));
  V.commentList.replaceChildren(...(list.length ? list.map((c) => {
    const mine = c.user_id === ctx.me();
    const who = mine ? 'Tú' : (ctx.member(c.user_id)?.name || 'Alguien');
    const node = el('div', { class: `pv-c${mine ? ' mine' : ''}`, 'data-id': c.id },
      avatar(ctx.member(c.user_id), c.user_id, 'sm'),
      el('div', { class: 'pv-c-bubble' },
        el('div', { class: 'pv-c-meta' }, el('strong', { text: who }), el('time', { datetime: c.created_at, title: new Date(c.created_at).toLocaleString('es-ES'), text: ago(c.created_at) }),
          mine && el('button', { class: 'pv-c-del', type: 'button', text: 'Borrar', 'aria-label': 'Borrar mi comentario', onclick: async () => {
            if (await ctx.removeComment(c)) drawComments();
          } })),
        el('p', { class: 'pv-c-text', text: c.body })));
    if (known.size && !known.has(c.id)) node.classList.add('new');
    return node;
  }) : [el('p', { class: 'pv-c-empty' }, 'Todavía no hay comentarios.', el('br'), '¡Escribe el primero!')]));
  if (atBottom || !known.size) V.commentList.scrollTop = V.commentList.scrollHeight;
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ayer';
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

const chevron = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

// Los PDF se pueden leer aquí mismo (debajo del texto)
function pdfViewer(card) {
  if (DEMO || card.kind !== 'file' || !card.file_path || extOf(card.file_name) !== 'pdf') return null;
  return el('iframe', { class: 'pv-pdf', src: publicUrl(card.file_path), title: card.file_name || 'PDF', loading: 'lazy' });
}

function attachment(card) {
  try {
    if (card.kind === 'image' && card.file_path) {
      const src = publicUrl(card.file_path);
      return el('button', { class: 'pv-media', type: 'button', title: 'Ver en grande', onclick: () => openLightbox(V.photos, 0) },
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
      return box;
    }
  } catch (e) { console.warn('Adjunto no válido', e); }
  return null;
}

// Documento del editor (ya limpio con cleanDoc) → HTML de solo lectura
// photos: lista donde se van apuntando las fotos (para el visor)
let photos = [];
export function renderDoc(doc, list = []) {
  photos = list;
  return kids(doc, document.createDocumentFragment());
}

// Varias fotos seguidas se juntan en un collage
function kids(n, parent) {
  const items = n.content || [];
  for (let k = 0; k < items.length; k++) {
    if (items[k].type === 'image') {
      const run = [];
      while (k < items.length && items[k].type === 'image') { if (items[k].attrs?.src) run.push(items[k].attrs); k++; }
      k--;
      const start = photos.length;
      photos.push(...run.map((a) => ({ src: a.src, alt: a.alt || '' })));
      const all = photos;
      if (run.length > 1) parent.append(collage(run, { className: 'pv-collage', onOpen: (i) => openLightbox(all, start + i) }));
      else if (run.length) {
        parent.append(el('button', { class: 'pv-img', type: 'button', title: 'Ver en grande', onclick: () => openLightbox(all, start) },
          el('img', { src: run[0].src, alt: run[0].alt || '', loading: 'lazy' })));
      }
      continue;
    }
    const x = node(items[k]);
    if (x) parent.append(x);
  }
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
