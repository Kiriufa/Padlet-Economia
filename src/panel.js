// Panel de una tarea: título, texto con formato, encargados, etiqueta, fecha y adjunto.
// Se guarda solo (autoguardado) y avisa si otra persona cambia la misma tarea a la vez.

import { supabase, BUCKET } from './supabase.js';
import { el, ask, toast, avatar, autosize, colorPicker, fadeOutCopy, clearFades, ICONS } from './ui.js';
import { COLORS, STATUSES, formatDate, isOverdue, domainOf, extOf, IMAGE_TYPES, MAX_FILE, MAX_FILE_MB } from './utils.js';
import { cleanDoc, textToDoc, docToText, isEmptyDoc } from './richtext.js';
import { openAttachmentForm } from './cardForm.js';

const SAVE_DELAY = 700;
const loadEditor = () => import('./editor.js');

let ctx = null; // lo pone el tablero con setPanelContext()
let P = null; // panel abierto

export function setPanelContext(c) {
  ctx = c;
  // Precargar el editor cuando el navegador esté libre, para que abrir una tarjeta sea instantáneo
  const preload = () => loadEditor().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(preload, { timeout: 3000 });
  else setTimeout(preload, 1500);
}
export const isPanelOpen = () => Boolean(P);

// ---------------------------------------------------------------------
// Abrir / cerrar
// ---------------------------------------------------------------------

/** Abre una tarea existente (card) o una nueva en `status`. */
export function openPanel({ card = null, status = 'todo', returnFocus = null, template = null } = {}) {
  if (P) { switchTo(card, status); return; }
  clearFades();
  const dlg = document.getElementById('task-panel');
  P = {
    dlg, returnFocus,
    id: null, version: 0, status, color: null, due: null, title: '',
    dirty: false, saving: false, pendingSave: false, seq: 0, timer: null,
    conflict: null, deleted: false, editor: null, ready: false, template,
  };
  build();
  load(card, status);
  dlg.showModal();
  fitToViewport();
  // Se abre "creciendo" desde la tarjeta o el botón que lo abrió
  if (returnFocus?.getBoundingClientRect) {
    const a = returnFocus.getBoundingClientRect(), r = P.box.getBoundingClientRect();
    P.box.style.transformOrigin = `${a.left + a.width / 2 - r.left}px ${a.top + a.height / 2 - r.top}px`;
  }
  document.documentElement.classList.add('panel-open');
  // El título recibe el foco al momento (en el iPad así sale el teclado)
  if (!card) P.titleEl.focus();
  mountEditor();
}

async function switchTo(card, status) {
  await flush();
  if (!P || P.conflict || P.deleted) return;
  load(card, status);
  setEditorContent(contentOf(card));
  if (!card) P.titleEl.focus();
}

export async function closePanel() {
  if (!P) return;
  clearTimeout(P.timer);
  if (P.conflict || P.deleted) {
    const ok = await ask({ title: 'Hay cambios sin guardar', text: 'Si cierras ahora, se pierde lo que has escrito desde el aviso.', ok: 'Cerrar igualmente', danger: true });
    if (!ok) return;
  } else {
    await flush();
    if (!P || P.conflict || P.deleted) return; // ha surgido un aviso al guardar
    if (P.dirty) {
      const ok = await ask({ title: 'No se ha podido guardar', text: 'Comprueba la conexión. Si cierras ahora, se pierde lo último que has escrito.', ok: 'Cerrar igualmente', cancel: 'Seguir aquí', danger: true });
      if (!ok || !P) return;
    }
  }
  const { dlg, returnFocus, box } = P;
  // Se cierra al momento (la página responde enseguida) y una copia se desvanece encima
  fadeOutCopy(box);
  P.editor?.destroy();
  P = null;
  dlg.close();
  dlg.replaceChildren();
  document.documentElement.classList.remove('panel-open');
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------

function build() {
  const { dlg } = P;
  P.statusEl = el('span', { class: 'tp-save', role: 'status', 'aria-live': 'polite' });
  P.columnSel = el('select', { class: 'tp-column', 'aria-label': 'Columna' },
    ...STATUSES.map(([v, l]) => el('option', { value: v, text: l })));
  P.columnSel.onchange = () => changeColumn(P.columnSel.value);

  P.titleEl = el('textarea', { class: 'tp-title', id: 'tp-title', rows: '1', maxlength: '200', placeholder: 'Título de la tarea', 'aria-label': 'Título' });
  P.fitTitle = autosize(P.titleEl);
  P.titleEl.addEventListener('input', () => { P.title = P.titleEl.value; changed(); });
  P.titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (P.editor) P.editor.focus('start');
      else P.focusEditorWhenReady = true; // el editor aún se está cargando
    }
  });

  P.banner = el('div', { class: 'tp-banner', hidden: true, role: 'alert' });
  P.meta = el('div', { class: 'tp-meta' });
  P.toolbar = el('div', { class: 'tp-toolbar', role: 'toolbar', 'aria-label': 'Formato del texto' },
    el('span', { class: 'tp-toolbar-loading', text: 'Cargando editor…' }));
  P.editorEl = el('div', { class: 'tp-editor' });
  // Tocar el espacio en blanco debajo del texto pone el cursor al final (como en un documento)
  P.editorEl.addEventListener('mousedown', (e) => {
    if (e.target === P.editorEl && P.editor) { e.preventDefault(); P.editor.focus('end'); }
  });
  P.scroll = el('div', { class: 'tp-scroll' }, P.banner, P.titleEl, P.meta, P.editorEl);

  const head = el('header', { class: 'tp-head' },
    P.columnSel,
    P.statusEl,
    el('span', { class: 'tp-spacer' }),
    el('button', { class: 'btn tp-new', type: 'button', title: 'Guardar y crear otra tarea', onclick: newAnother },
      el('span', { html: ICONS.plus }), el('span', { class: 'tp-new-label', text: 'Otra tarea' })),
    P.deleteBtn = el('button', { class: 'tp-icon', type: 'button', title: 'Borrar tarea', 'aria-label': 'Borrar tarea', html: ICONS.trash, onclick: removeTask }),
    el('button', { class: 'tp-icon', type: 'button', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', text: '✕', onclick: closePanel }));

  P.box = el('div', { class: 'tp' }, head, P.toolbar, P.scroll);
  dlg.replaceChildren(P.box);
  dlg.oncancel = (e) => { e.preventDefault(); closePanel(); };
  // Esc cierra el panel. Lo gestionamos nosotros (el navegador no siempre lanza "cancel"),
  // salvo si Esc ya se ha usado para cerrar el menú "/" o el cuadro del enlace.
  // Se mira antes que el editor (fase de captura): ProseMirror siempre "consume" Esc.
  // Se escucha en toda la página: el foco puede quedar fuera del panel (p. ej. tras elegir una foto)
  if (!dlg.dataset.escBound) dlg.dataset.escBound = '1', document.addEventListener('keydown', (e) => {
    if (!P || e.key !== 'Escape' || e.isComposing) return;
    if (document.getElementById('ask-dialog').open || document.getElementById('card-dialog').open) return;
    if (P?.box.querySelector('.slash-menu')) return; // Esc cierra primero el menú "/"
    if (P?.editor?.closeMenus()) { e.preventDefault(); e.stopPropagation(); P.editor.focus(null); return; }
    e.preventDefault();
    e.stopPropagation();
    closePanel();
  }, true);
  // Clic fuera del panel: solo si el clic empezó también fuera (no al soltar una selección de texto)
  dlg.onpointerdown = (e) => { P.downOutside = e.target === dlg; };
  dlg.onclick = (e) => { if (e.target === dlg && P?.downOutside) closePanel(); };
}

function contentOf(card) {
  if (!card) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return cleanDoc(card.content) || textToDoc(card.description || '');
}

function load(card, status) {
  Object.assign(P, {
    id: card?.id || null,
    version: card?.version || 0,
    status: card?.status || status,
    color: card?.color || null,
    due: card?.due_date || null,
    title: card?.title || '',
    dirty: false, conflict: null, deleted: false, seq: 0, assignOpen: false,
  });
  P.titleEl.value = P.title;
  P.fitTitle();
  clearTimeout(P.timer);
  P.columnSel.value = P.status;
  hideBanner();
  setStatus(card ? '' : 'Nueva tarea');
  P.deleteBtn.hidden = !card;
  renderMeta();
}

async function mountEditor() {
  const panel = P;
  try {
    const { createRichEditor } = await loadEditor();
    if (P !== panel) return;
    const card = P.id ? ctx.getCard(P.id) : null;
    P.editor = createRichEditor({
      element: P.editorEl,
      toolbar: P.toolbar,
      layer: P.box,
      content: card ? contentOf(card) : (P.template || contentOf(null)),
      onChange: editorChanged,
      uploadImage: uploadInlineImage,
    });
    // Punto de partida para saber si hay cambios (sin contar los ajustes del propio editor)
    P.baseline = norm(P.editor.getJSON());
    if (P.focusEditorWhenReady) { P.focusEditorWhenReady = false; P.editor.focus('start'); }
    else if (card && document.activeElement !== P.titleEl) P.editor.focus('end');
    P.ready = true;
  } catch (e) {
    P.toolbar.replaceChildren(el('span', { class: 'error', text: 'No se pudo cargar el editor. Recarga la página.' }));
  }
}

// Sube una imagen del texto al almacenamiento del tablero y devuelve su dirección pública
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
async function uploadInlineImage(file) {
  const ext = extOf(file.name) || MIME_EXT[file.type];
  if (!IMAGE_TYPES[ext]) throw new Error('Formato de imagen no válido (usa JPG, PNG, GIF o WEBP).');
  if (file.size > MAX_FILE) throw new Error(`La imagen pesa demasiado (máx. ${MAX_FILE_MB} MB).`);
  const base = (file.name || 'imagen').replace(/\.[^.]+$/, '').normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-60) || 'imagen';
  const path = `${ctx.board().id}/${crypto.randomUUID()}-${base}.${ext}`;
  const named = file.name && extOf(file.name) ? file : new File([file], `${base}.${ext}`, { type: IMAGE_TYPES[ext] });
  const { error } = await supabase.storage.from(BUCKET).upload(path, named, { contentType: IMAGE_TYPES[ext], upsert: false });
  if (error) throw new Error(/exceeded|too large|413/i.test(error.message) ? `La imagen pesa demasiado (máx. ${MAX_FILE_MB} MB).` : error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------
// Datos de la tarjeta: encargados, etiqueta, fecha, adjunto
// ---------------------------------------------------------------------

export function refreshPanel() {
  if (!P) return;
  // Si estás escribiendo en un campo de esta zona (la fecha), se redibuja cuando termines
  const active = document.activeElement;
  if (P.meta.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
    if (!P.metaPending) {
      P.metaPending = true;
      P.meta.addEventListener('focusout', () => setTimeout(() => { if (P && P.metaPending && !P.meta.contains(document.activeElement)) { P.metaPending = false; renderMeta(); } }, 0), { once: true });
    }
    return;
  }
  renderMeta();
}

function renderMeta() {
  const me = ctx.me();
  const ids = P.id ? [...ctx.assigneesOf(P.id)] : [];
  const mine = ids.includes(me);
  const card = P.id ? ctx.getCard(P.id) : null;

  // Encargados
  const people = el('div', { class: 'tp-people' },
    ids.length
      ? ids.map((u) => el('span', { class: 'tp-person' }, avatar(ctx.member(u), u, 'sm'), el('span', { text: u === me ? 'Tú' : (ctx.member(u)?.name || '?') })))
      : el('span', { class: 'muted small', text: 'Sin encargado' }));
  const claim = el('button', { class: `btn small ${mine ? 'ghost' : 'claim'}`, type: 'button', text: mine ? 'Soltar' : 'Me lo quedo' });
  claim.onclick = () => busy(claim, mine ? 'Soltando…' : 'Guardando…', async () => {
    if (!(await ensureSaved())) return;
    if (mine) await ctx.unassign(P.id, me); else await ctx.assign(P.id, me);
  });
  const assignBtn = el('button', { class: 'btn small', type: 'button', title: 'Asignar a otra persona' }, el('span', { html: ICONS.userPlus }), 'Asignar');
  const list = el('div', { class: 'tp-assign', hidden: !P.assignOpen });
  assignBtn.onclick = () => busy(assignBtn, 'Abriendo…', async () => {
    if (!(await ensureSaved())) return;
    P.assignOpen = !P.assignOpen;
    renderMeta();
  });
  if (P.assignOpen && P.id) {
    list.replaceChildren(...ctx.members().map(([uid, m]) => {
      const on = ids.includes(uid);
      return el('button', { class: `tp-chip${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on),
        onclick: () => (on ? ctx.unassign(P.id, uid) : ctx.assign(P.id, uid)) },
      avatar(m, uid, 'sm'), el('span', { text: uid === me ? `${m.name} (tú)` : m.name }), on ? el('span', { class: 'check', text: '✓' }) : null);
    }));
  }

  // Etiqueta de color
  const swatches = colorPicker({ value: P.color, compact: true, onChange: (c) => setColor(c, false) });

  // Fecha límite
  const due = el('input', { class: 'input tp-date', type: 'date', value: P.due || '', 'aria-label': 'Fecha límite' });
  due.onchange = () => { P.due = due.value || null; changed(true); };
  const overdue = isOverdue(P.due, P.status);

  // Adjunto
  let attach = 'Ninguno';
  if (card?.kind === 'image' || card?.kind === 'file') attach = card.file_name;
  else if (card?.kind === 'link') attach = domainOf(card.url);
  else if (card?.kind === 'youtube') attach = 'Vídeo de YouTube';
  const attachBtn = el('button', { class: 'btn small tp-attach', type: 'button', title: 'Imagen, archivo, enlace o vídeo' },
    el('span', { html: ICONS.link }), attach === 'Ninguno' ? 'Añadir' : attach);
  attachBtn.onclick = async () => {
    let ok = false;
    await busy(attachBtn, 'Abriendo…', async () => { ok = await ensureSaved(); });
    if (!ok || !P) return;
    const saved = await openAttachmentForm({ board: ctx.board(), card: ctx.getCard(P.id) });
    if (saved && P) { P.version = saved.version; ctx.upsertLocal(saved); renderMeta(); }
  };

  P.meta.replaceChildren(
    el('div', { class: 'tp-field' }, el('span', { class: 'tp-label', text: 'Encargados' }),
      el('div', { class: 'tp-row' }, people, claim, assignBtn), list),
    el('div', { class: 'tp-field' }, el('span', { class: 'tp-label', text: 'Etiqueta' }), swatches),
    el('div', { class: 'tp-field' }, el('span', { class: 'tp-label', text: overdue ? `Fecha límite · venció el ${formatDate(P.due)}` : 'Fecha límite' }), due),
    el('div', { class: 'tp-field' }, el('span', { class: 'tp-label', text: 'Adjunto' }), attachBtn));
  P.meta.classList.toggle('overdue', overdue);
}

function setColor(name, redraw = true) {
  P.color = name;
  if (redraw) renderMeta();
  changed(true);
}

async function changeColumn(status) {
  P.status = status;
  if (!P.id) return; // se usará al crearla
  await ctx.move(P.id, status);
}

// Respuesta inmediata al tocar un botón que tiene que esperar a la red
async function busy(button, text, fn) {
  if (button.disabled) return;
  const old = [...button.childNodes];
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
  try { await fn(); } finally {
    if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.replaceChildren(...old); }
  }
}

// Para asignar o adjuntar hace falta que la tarea exista: si aún no está guardada, se guarda ya
// (si no tiene título, como "Sin título"; se puede poner después)
async function ensureSaved() {
  // Ya existe: se termina de guardar lo pendiente para que no se cruce con lo que viene (adjunto…)
  if (P.id) {
    await flush();
    return Boolean(P && !P.conflict && !P.deleted);
  }
  P.dirty = true;
  P.forceCreate = true;
  await flush();
  if (P) P.forceCreate = false;
  if (!P?.id) { toast('No se pudo guardar la tarea. Comprueba la conexión.'); return false; }
  return true;
}

// ---------------------------------------------------------------------
// Autoguardado
// ---------------------------------------------------------------------

function setStatus(text, kind = '') {
  if (!P) return;
  P.statusEl.textContent = text;
  P.statusEl.dataset.kind = kind;
}

// El editor añade por su cuenta párrafos vacíos al final: no cuentan como cambio
function norm(doc) {
  const c = [...(doc?.content || [])];
  while (c.length && c[c.length - 1].type === 'paragraph' && !c[c.length - 1].content) c.pop();
  return JSON.stringify(c);
}

// Solo cuenta como cambio si el texto es distinto del último guardado/cargado
function editorChanged() {
  if (!P?.editor || P.baseline == null) return;
  if (P.dirty) { changed(); return; } // ya hay cambios: no hace falta comparar el documento entero
  if (norm(P.editor.getJSON()) === P.baseline) return;
  changed();
}

function setEditorContent(doc) {
  if (!P.editor) return;
  P.editor.setContent(doc);
  P.baseline = norm(P.editor.getJSON());
}

function changed(now = false) {
  if (!P) return;
  P.dirty = true;
  P.seq++;
  if (P.conflict || P.deleted) return; // no se guarda hasta resolver el aviso
  setStatus('Sin guardar', 'pending');
  clearTimeout(P.timer);
  P.timer = setTimeout(save, now ? 50 : SAVE_DELAY);
}

async function flush() {
  if (!P) return;
  clearTimeout(P.timer);
  while (P && P.saving) await new Promise((r) => setTimeout(r, 40));
  if (P && P.dirty && !P.conflict && !P.deleted) await save();
}

function snapshot() {
  const doc = P.editor ? P.editor.getJSON() : contentOf(P.id ? ctx.getCard(P.id) : null);
  const title = P.titleEl.value.replace(/\s+/g, ' ').trim().slice(0, 200);
  const text = docToText(doc);
  return { title, doc, text };
}

async function save({ force = false } = {}) {
  if (!P || !P.dirty) return;
  if (P.saving) { P.pendingSave = true; return; }
  const panel = P;
  const seq = P.seq;
  const { title, doc, text } = snapshot();

  // Nueva y vacía: no se crea nada
  if (!P.id && !title && isEmptyDoc(doc) && !P.forceCreate) { P.dirty = false; setStatus('Nueva tarea'); return; }

  const fields = {
    title: title || 'Sin título',
    content: isEmptyDoc(doc) ? null : doc,
    description: text ? text.slice(0, 20000) : null,
    color: P.color,
    due_date: P.due,
  };
  P.saving = true;
  setStatus('Guardando…', 'saving');
  let data, error;
  if (!P.id) {
    ({ data, error } = await supabase.from('cards')
      .insert({ ...fields, board_id: ctx.board().id, status: P.status, position: ctx.endPosition(P.status) })
      .select().single());
  } else {
    let q = supabase.from('cards').update(fields).eq('id', P.id);
    if (!force) q = q.eq('version', P.version); // solo si nadie la ha cambiado mientras
    const res = await q.select();
    error = res.error;
    data = res.data?.[0];
    if (!error && !data) {
      // No se guardó: o la han cambiado o la han borrado
      const { data: current } = await supabase.from('cards').select('*').eq('id', P.id).maybeSingle();
      if (P !== panel) return;
      P.saving = false;
      if (!current) return showDeleted();
      return showConflict(current);
    }
  }
  if (P !== panel) return;
  P.saving = false;
  if (error && (error.code === '23514' || /content_size|description_len/.test(error.message || ''))) {
    setStatus('Demasiado largo para guardar: acorta el texto', 'error');
    return;
  }
  if (error) {
    setStatus('No se pudo guardar · reintentando', 'error');
    clearTimeout(P.timer);
    P.timer = setTimeout(save, 3000);
    return;
  }
  const isNew = !P.id;
  P.id = data.id;
  P.version = data.version;
  ctx.upsertLocal(data);
  if (isNew) { P.deleteBtn.hidden = false; renderMeta(); }
  if (P.seq === seq) { P.dirty = false; P.baseline = norm(doc); setStatus('Guardado', 'saved'); }
  if (P.pendingSave || P.dirty) { P.pendingSave = false; clearTimeout(P.timer); P.timer = setTimeout(save, SAVE_DELAY); }
}

// ---------------------------------------------------------------------
// Cambios de otras personas
// ---------------------------------------------------------------------

/** El tablero avisa cuando llega un cambio de una tarjeta por tiempo real. */
export function remoteCardUpdate(card) {
  if (!P || card.id !== P.id) return;
  if (card.version <= P.version) {
    // Un movimiento de columna u otro cambio que no toca el contenido
    if (card.status !== P.status) { P.status = card.status; P.columnSel.value = card.status; }
    renderMeta();
    return;
  }
  if (P.saving) {
    // Puede ser el eco de nuestro propio guardado: lo decidimos al terminar
    setTimeout(() => remoteCardUpdate(ctx.getCard(card.id) || card), 300);
    return;
  }
  if (P.dirty) { showConflict(card); return; }
  applyRemote(card);
  const who = card.updated_by && card.updated_by !== ctx.me() ? ctx.member(card.updated_by)?.name : null;
  setStatus(who ? `Actualizado por ${who.split(' ')[0]}` : 'Actualizado', 'saved');
}

export function remoteCardDelete(id) {
  if (P && id === P.id && !P.saving && !P.removing) showDeleted();
}

/** Tras recargar el tablero (volver a la pestaña, reconexión) se sincroniza la tarea abierta. */
export function syncOpenPanel(getCard) {
  if (!P?.id || P.saving || P.removing) return;
  const card = getCard(P.id);
  if (card) remoteCardUpdate(card); else showDeleted();
}

function applyRemote(card) {
  P.version = card.version;
  P.title = card.title;
  P.titleEl.value = card.title;
  P.fitTitle();
  P.color = card.color;
  P.due = card.due_date;
  P.status = card.status;
  P.columnSel.value = card.status;
  setEditorContent(contentOf(card));
  P.dirty = false;
  renderMeta();
}

function showConflict(theirs) {
  clearTimeout(P.timer);
  P.conflict = theirs;
  const fromMe = theirs.updated_by === ctx.me();
  const who = !fromMe && theirs.updated_by ? ctx.member(theirs.updated_by)?.name || 'Otra persona' : 'Otra persona';
  setStatus('Sin guardar', 'error');
  P.banner.replaceChildren(
    el('p', {}, el('strong', { text: fromMe ? 'Has cambiado esta tarea en otra pestaña o dispositivo mientras escribías aquí.' : `${who} ha cambiado esta tarea mientras escribías.` }),
      ' Tus cambios no se han guardado todavía. Elige qué hacer:'),
    el('div', { class: 'tp-banner-actions' },
      el('button', { class: 'btn small', type: 'button', text: 'Ver su versión', onclick: takeTheirs }),
      el('button', { class: 'btn small primary', type: 'button', text: 'Guardar la mía encima', onclick: keepMine })));
  P.banner.hidden = false;
  P.scroll.scrollTo({ top: 0, behavior: 'smooth' });
}

async function takeTheirs() {
  // Copiamos lo tuyo para que no se pierda
  const { title, text } = snapshot();
  try {
    await navigator.clipboard.writeText(`${title}\n\n${text}`);
    toast('Tu versión está copiada: puedes pegarla donde quieras');
  } catch {
    toast('No se pudo copiar tu versión automáticamente');
  }
  const theirs = ctx.getCard(P.conflict.id) || P.conflict;
  P.conflict = null;
  hideBanner();
  applyRemote(theirs);
  setStatus('Guardado', 'saved');
}

async function keepMine() {
  const theirs = ctx.getCard(P.conflict.id) || P.conflict;
  P.version = theirs.version;
  P.conflict = null;
  hideBanner();
  P.dirty = true;
  await save();
}

function showDeleted() {
  clearTimeout(P.timer);
  P.deleted = true;
  setStatus('Sin guardar', 'error');
  P.banner.replaceChildren(
    el('p', {}, el('strong', { text: 'Otra persona ha borrado esta tarea.' }), ' Lo que tienes escrito sigue aquí.'),
    el('div', { class: 'tp-banner-actions' },
      el('button', { class: 'btn small primary', type: 'button', text: 'Volver a crearla', onclick: async () => {
        P.deleted = false; P.id = null; P.version = 0; hideBanner(); P.dirty = true; await save();
      } }),
      el('button', { class: 'btn small ghost', type: 'button', text: 'Cerrar', onclick: () => { P.deleted = false; P.dirty = false; closePanel(); } })));
  P.banner.hidden = false;
}

function hideBanner() { P.banner.hidden = true; P.banner.replaceChildren(); }

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------

async function newAnother() {
  await flush();
  if (!P || P.conflict || P.deleted) return;
  const status = P.status;
  load(null, status);
  setEditorContent(contentOf(null));
  P.titleEl.focus();
  P.scroll.scrollTo({ top: 0 });
}

async function removeTask() {
  if (!P.id) return;
  const ok = await ask({ title: '¿Borrar esta tarea?', text: `"${P.titleEl.value || 'Sin título'}" se borrará para todos.`, ok: 'Borrar', danger: true });
  if (!ok || !P) return;
  clearTimeout(P.timer);
  const card = ctx.getCard(P.id);
  P.removing = true;
  const done = await ctx.remove(card);
  if (!P) return;
  if (done) { P.dirty = false; P.deleted = false; P.conflict = null; P.id = null; await closePanel(); }
  else P.removing = false;
}

// ---------------------------------------------------------------------
// iPad / móvil: cuando sale el teclado, el panel ocupa solo la parte visible
// ---------------------------------------------------------------------

function fitToViewport() {
  const vv = window.visualViewport;
  const dlg = document.getElementById('task-panel');
  const apply = () => {
    if (!vv || !dlg.open) return;
    dlg.style.setProperty('--vvh', `${vv.height}px`);
    dlg.style.setProperty('--vvt', `${vv.offsetTop}px`);
  };
  apply();
  if (vv && !fitToViewport.bound) {
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    fitToViewport.bound = true;
  }
}
