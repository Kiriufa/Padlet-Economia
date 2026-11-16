import { supabase, BUCKET } from './supabase.js';
import { el, ask, toast, avatar, ICONS } from './ui.js';
import { STATUSES } from './utils.js';
import { buildCard } from './card.js';
import { openCardForm } from './cardForm.js';
import { initDnd } from './dnd.js';

// Estado del tablero
const S = {
  board: null,
  me: null,
  cards: new Map(), // id -> card
  assignees: new Map(), // card_id -> Set(user_id)
  members: new Map(), // user_id -> { name, avatar_url, is_admin }
  filter: 'all', // 'all' | 'mine' | user_id
  search: '',
  dragging: false,
  dirty: false,
};
const cache = new Map(); // id -> { key, node }
const ui = {};
let actions;

export const isAdmin = () => Boolean(S.members.get(S.me)?.is_admin);
const canEdit = (card) => card.created_by === S.me || isAdmin();
const assigneesOf = (id) => S.assignees.get(id) || new Set();

export function openBoard(app, board, user, acts) {
  S.board = board;
  S.me = user.id;
  actions = acts;
  buildLayout(app);
  initDnd(ui.board, {
    onStart: () => (S.dragging = true),
    onEnd: () => { S.dragging = false; if (S.dirty) render(); },
    onDrop: moveCard,
    onTab: (status) => showColumn(status),
  });
  subscribe();
  load();
}

// ---------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------

async function load() {
  const id = S.board.id;
  const [cards, assignees, members] = await Promise.all([
    supabase.from('cards').select('*').eq('board_id', id),
    supabase.from('card_assignees').select('card_id,user_id').eq('board_id', id),
    supabase.from('members').select('user_id,name,avatar_url,is_admin').eq('board_id', id),
  ]);
  const error = cards.error || assignees.error || members.error;
  if (error) return toast(`No se pudo cargar el tablero: ${error.message}`);

  S.cards = new Map(cards.data.map((c) => [c.id, c]));
  S.assignees = new Map();
  for (const a of assignees.data) addAssignee(a.card_id, a.user_id);
  S.members = new Map(members.data.map((m) => [m.user_id, m]));
  render();
}

function addAssignee(cardId, userId) {
  if (!S.assignees.has(cardId)) S.assignees.set(cardId, new Set());
  S.assignees.get(cardId).add(userId);
}

function subscribe() {
  const id = S.board.id;
  const filter = `board_id=eq.${id}`;
  const on = (event, table, fn, withFilter = true) => [
    'postgres_changes',
    { event, schema: 'public', table, ...(withFilter ? { filter } : {}) },
    fn,
  ];
  supabase
    .channel(`board-${id}`)
    .on(...on('INSERT', 'cards', ({ new: c }) => { S.cards.set(c.id, c); render(); }))
    .on(...on('UPDATE', 'cards', ({ new: c }) => { S.cards.set(c.id, c); render(); }))
    // Los DELETE no se pueden filtrar: solo traen el id
    .on(...on('DELETE', 'cards', ({ old }) => {
      if (S.cards.delete(old.id)) { S.assignees.delete(old.id); render(); }
    }, false))
    .on(...on('INSERT', 'card_assignees', ({ new: a }) => { addAssignee(a.card_id, a.user_id); render(); }))
    .on(...on('DELETE', 'card_assignees', ({ old }) => {
      if (S.assignees.get(old.card_id)?.delete(old.user_id)) render();
    }, false))
    .on(...on('INSERT', 'members', ({ new: m }) => { S.members.set(m.user_id, m); render(); }))
    .on(...on('UPDATE', 'members', ({ new: m }) => { S.members.set(m.user_id, m); render(); }))
    .on(...on('DELETE', 'members', ({ old }) => {
      if (old.board_id === id && old.user_id === S.me) {
        ask({ title: 'Este tablero se ha borrado', ok: 'Vale', cancel: null }).then(actions.leave);
      }
    }, false))
    .subscribe((status) => {
      // Al (re)conectar recargamos todo por si nos perdimos algo
      if (status === 'SUBSCRIBED') load();
    });
}

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------

function upsertLocal(card) {
  S.cards.set(card.id, card);
  render();
}

export async function newCard(status = 'todo') {
  const inCol = [...S.cards.values()].filter((c) => c.status === status);
  const position = inCol.length ? Math.min(...inCol.map((c) => c.position)) - 1 : 0;
  const card = await openCardForm({ board: S.board, status, position });
  if (card) { upsertLocal(card); showColumn(status); }
}

async function editCard(card) {
  const saved = await openCardForm({ board: S.board, card });
  if (saved) upsertLocal(saved);
}

async function deleteCard(card) {
  const ok = await ask({ title: '¿Borrar esta tarea?', text: `"${card.title}" se borrará para todos.`, ok: 'Borrar', danger: true });
  if (!ok) return;
  const { error } = await supabase.from('cards').delete().eq('id', card.id);
  if (error) return toast(error.message);
  if (card.file_path) supabase.storage.from(BUCKET).remove([card.file_path]);
  S.cards.delete(card.id);
  render();
}

async function assign(card, userId) {
  addAssignee(card.id, userId);
  render();
  const { error } = await supabase.from('card_assignees').insert({ card_id: card.id, user_id: userId, board_id: S.board.id });
  if (error && error.code !== '23505') { toast(error.message); load(); }
}

async function unassign(card, userId) {
  assigneesOf(card.id).delete(userId);
  render();
  const { error } = await supabase.from('card_assignees').delete().match({ card_id: card.id, user_id: userId });
  if (error) { toast(error.message); load(); }
}

async function moveCard(id, status, prevId, nextId) {
  const card = S.cards.get(id);
  if (!card) return;
  const prev = S.cards.get(prevId)?.position;
  const next = S.cards.get(nextId)?.position;
  let position;
  if (prev != null && next != null) position = (prev + next) / 2;
  else if (prev != null) position = prev + 1;
  else if (next != null) position = next - 1;
  else position = 0;

  const from = card.status;
  if (from === status && position === card.position) return;
  upsertLocal({ ...card, status, position });
  const { error } = await supabase.rpc('move_card', { p_card: id, p_status: status, p_position: position });
  if (error) { toast(error.message); load(); return; }

  if (status === 'doing' && from !== 'doing' && assigneesOf(id).size === 0) {
    const yes = await ask({ title: 'Esta tarea no tiene encargado', text: '¿Te la quedas tú?', ok: 'Me la quedo', cancel: 'Ahora no' });
    if (yes) assign(card, S.me);
  }
}

async function becomeAdmin() {
  const pin = await ask({ title: 'Entrar como admin', text: 'Escribe el PIN de admin del tablero.', ok: 'Entrar', input: { type: 'password', placeholder: 'PIN', autocomplete: 'off' } });
  if (!pin) return;
  const { data, error } = await supabase.rpc('claim_admin', { p_board: S.board.id, p_pin: pin });
  if (error) return toast(error.message);
  if (!data) return toast('PIN incorrecto');
  S.members.get(S.me).is_admin = true;
  toast('Ahora eres admin de este tablero');
  render();
}

async function deleteBoard() {
  const ok = await ask({ title: '¿Borrar el tablero entero?', text: `Se borrarán todas las tareas y archivos de "${S.board.name}" para todos. No se puede deshacer.`, ok: 'Borrar tablero', danger: true });
  if (!ok) return;
  const store = supabase.storage.from(BUCKET);
  const { data: files } = await store.list(S.board.id, { limit: 1000 });
  if (files?.length) await store.remove(files.map((f) => `${S.board.id}/${f.name}`));
  const { error } = await supabase.rpc('delete_board', { p_board: S.board.id });
  if (error) return toast(error.message);
  actions.leave();
}

function copyLink() {
  const url = `${location.origin}${location.pathname}?b=${S.board.code}`;
  navigator.clipboard?.writeText(url).then(
    () => toast('Enlace del tablero copiado'),
    () => toast(`Código: ${S.board.code}`),
  );
}

// ---------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------

function buildLayout(app) {
  ui.search = el('input', { class: 'input search', type: 'search', placeholder: 'Buscar por título…', 'aria-label': 'Buscar' });
  ui.search.oninput = () => { S.search = ui.search.value.trim().toLowerCase(); render(); };

  ui.filterAll = el('button', { class: 'chip', type: 'button', text: 'Todas', onclick: () => setFilter('all') });
  ui.filterMine = el('button', { class: 'chip', type: 'button', text: 'Mis tareas', onclick: () => setFilter('mine') });
  ui.person = el('select', { class: 'chip select', 'aria-label': 'Filtrar por persona' });
  ui.person.onchange = () => setFilter(ui.person.value || 'all');

  ui.menuBtn = el('button', { class: 'me-btn', type: 'button', 'aria-label': 'Menú' });
  ui.menu = el('div', { class: 'menu', hidden: true });
  ui.menuBtn.onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener('click', (e) => { if (!ui.menu.contains(e.target)) ui.menu.hidden = true; });

  ui.adminBadge = el('span', { class: 'badge', text: 'Admin', hidden: true });

  const header = el('header', { class: 'topbar' },
    el('div', { class: 'topbar-row' },
      el('div', { class: 'title' },
        el('h1', { text: S.board.name }),
        el('button', { class: 'code-btn', type: 'button', title: 'Copiar enlace para invitar', onclick: copyLink }, `Código: ${S.board.code}`),
        ui.adminBadge),
      el('div', { class: 'top-actions' },
        el('button', { class: 'btn primary add-btn', type: 'button', onclick: () => newCard('todo') },
          el('span', { html: ICONS.plus }), el('span', { class: 'add-label', text: 'Nueva tarea' })),
        el('div', { class: 'me-wrap' }, ui.menuBtn, ui.menu))),
    el('div', { class: 'topbar-row filters' },
      el('label', { class: 'search-wrap' }, el('span', { class: 'search-icon', html: ICONS.search }), ui.search),
      el('div', { class: 'chips' }, ui.filterAll, ui.filterMine, ui.person)));

  ui.tabs = el('nav', { class: 'tabs' });
  ui.columns = {};
  ui.lists = {};
  ui.counts = {};
  ui.tabCounts = {};
  ui.board = el('main', { class: 'board' });

  for (const [status, label] of STATUSES) {
    ui.counts[status] = el('span', { class: 'count', text: '0' });
    ui.tabCounts[status] = el('span', { class: 'count', text: '0' });
    ui.lists[status] = el('div', { class: 'cards', 'data-status': status });
    ui.columns[status] = el('section', { class: `column col-${status}`, 'data-status': status },
      el('div', { class: 'column-head' },
        el('h2', {}, el('span', { class: 'dot' }), label),
        ui.counts[status],
        el('button', { class: 'icon-btn col-add', type: 'button', title: `Añadir en "${label}"`, 'aria-label': `Añadir en ${label}`, html: ICONS.plus, onclick: () => newCard(status) })),
      ui.lists[status]);
    ui.board.append(ui.columns[status]);
    ui.tabs.append(el('button', { class: `tab col-${status}`, type: 'button', 'data-status': status, onclick: () => showColumn(status) }, label, ui.tabCounts[status]));
  }

  // Pestaña activa en móvil según el scroll horizontal
  ui.board.addEventListener('scroll', () => {
    const i = Math.round(ui.board.scrollLeft / (ui.board.scrollWidth / STATUSES.length));
    setActiveTab(STATUSES[Math.min(i, 2)][0]);
  }, { passive: true });

  ui.popover = el('div', { class: 'popover', hidden: true });
  document.addEventListener('pointerdown', (e) => {
    if (!ui.popover.hidden && !ui.popover.contains(e.target) && !e.target.closest('.assign-btn')) ui.popover.hidden = true;
  });

  app.replaceChildren(header, ui.tabs, ui.board, ui.popover);
  setActiveTab('todo');
}

function setActiveTab(status) {
  for (const t of ui.tabs.children) t.classList.toggle('active', t.dataset.status === status);
}

function showColumn(status) {
  setActiveTab(status);
  if (ui.board.scrollWidth > ui.board.clientWidth) {
    ui.board.scrollTo({ left: ui.columns[status].offsetLeft - 16, behavior: 'smooth' });
  }
}

function setFilter(f) {
  S.filter = f;
  render();
}

function toggleMenu() {
  const me = S.members.get(S.me);
  const item = (text, onclick, cls = '') => el('button', { class: `menu-item ${cls}`, type: 'button', text, onclick: () => { ui.menu.hidden = true; onclick(); } });
  ui.menu.replaceChildren(
    el('div', { class: 'menu-head' }, avatar(me, S.me), el('span', { text: me?.name || '' })),
    item('Copiar enlace de invitación', copyLink),
    isAdmin() ? item('Borrar tablero', deleteBoard, 'danger') : item('Entrar como admin (PIN)', becomeAdmin),
    item('Cambiar de tablero', actions.leave),
    item('Cerrar sesión', actions.logout));
  ui.menu.hidden = !ui.menu.hidden;
}

function openAssign(card, anchor) {
  const list = el('div', { class: 'pop-list' });
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Buscar persona…' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const current = assigneesOf(card.id);
    const people = [...S.members.entries()]
      .filter(([, m]) => m.name.toLowerCase().includes(q))
      .sort((a, b) => (a[0] === S.me ? -1 : b[0] === S.me ? 1 : a[1].name.localeCompare(b[1].name)));
    list.replaceChildren(...people.map(([uid, m]) => {
      const on = current.has(uid);
      const allowed = !on || uid === S.me || card.created_by === S.me || isAdmin();
      return el('button', {
        class: `pop-item ${on ? 'on' : ''}`, type: 'button', disabled: !allowed,
        title: allowed ? '' : 'Solo esa persona, el autor o el admin pueden quitarla',
        onclick: () => { (on ? unassign : assign)(card, uid); draw(); },
      }, avatar(m, uid, 'sm'), el('span', { text: uid === S.me ? `${m.name} (tú)` : m.name }), el('span', { class: 'check', text: on ? '✓' : '' }));
    }));
  };
  search.oninput = draw;
  draw();
  ui.popover.replaceChildren(el('div', { class: 'pop-title', text: 'Asignar a…' }), search, list);
  ui.popover.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(280, innerWidth - 16);
  ui.popover.style.width = `${w}px`;
  ui.popover.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8)) + scrollX}px`;
  ui.popover.style.top = `${r.bottom + 6 + scrollY}px`;
  if (matchMedia('(pointer: fine)').matches) search.focus();
}

function visible(card) {
  if (S.search && !card.title.toLowerCase().includes(S.search)) return false;
  if (S.filter === 'mine') return assigneesOf(card.id).has(S.me);
  if (S.filter !== 'all') return assigneesOf(card.id).has(S.filter);
  return true;
}

function renderFilters() {
  ui.filterAll.classList.toggle('active', S.filter === 'all');
  ui.filterMine.classList.toggle('active', S.filter === 'mine');
  const people = [...S.members.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const isPerson = S.filter !== 'all' && S.filter !== 'mine';
  ui.person.replaceChildren(
    el('option', { value: '', text: 'Por persona…' }),
    ...people.map(([uid, m]) => el('option', { value: uid, text: uid === S.me ? `${m.name} (tú)` : m.name })));
  ui.person.value = isPerson ? S.filter : '';
  ui.person.classList.toggle('active', isPerson);
  ui.adminBadge.hidden = !isAdmin();
  ui.menuBtn.replaceChildren(avatar(S.members.get(S.me), S.me));
}

function render() {
  if (S.dragging) { S.dirty = true; return; }
  S.dirty = false;
  renderFilters();

  const handlers = {
    claim: (c) => assign(c, S.me),
    leave: (c) => unassign(c, S.me),
    assign: openAssign,
    edit: editCard,
    remove: deleteCard,
  };
  const seen = new Set();
  const sorted = [...S.cards.values()].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  for (const [status] of STATUSES) {
    const list = ui.lists[status];
    const cards = sorted.filter((c) => c.status === status && visible(c));
    const nodes = cards.map((card) => {
      seen.add(card.id);
      const ids = [...assigneesOf(card.id)].sort();
      const people = ids.map((u) => [u, S.members.get(u)]);
      const editable = canEdit(card);
      const key = JSON.stringify([card, people, editable]);
      let entry = cache.get(card.id);
      if (!entry || entry.key !== key) {
        const node = buildCard({ card, people, me: S.me, editable, handlers });
        entry?.node.replaceWith(node);
        entry = { key, node };
        cache.set(card.id, entry);
      }
      return entry.node;
    });
    // Reordenar sin recrear (así un vídeo que se está viendo no se corta)
    nodes.forEach((node, i) => { if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null); });
    while (list.children.length > nodes.length) list.lastChild.remove();
    ui.counts[status].textContent = cards.length;
    ui.tabCounts[status].textContent = cards.length;
  }
  for (const id of cache.keys()) if (!seen.has(id)) { cache.get(id).node.remove(); cache.delete(id); }
}
