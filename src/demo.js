// Modo demo: imita la parte de supabase-js que usa la app, sin servidor.
// Los datos se guardan en el navegador y las pestañas abiertas se sincronizan
// entre sí (BroadcastChannel), así se puede ver el "tiempo real" con dos pestañas.
// Aplica los mismos permisos que las políticas RLS de supabase/schema.sql.

import { FILE_TYPES, MAX_FILE, extOf } from './utils.js';

const KEY = 'tablero-demo-v2';
const PEOPLE = ['Marta Gil', 'Jorge Sanz', 'Lucía Moreno', 'Pablo Ortega', 'Nerea Vidal', 'Hugo Castro'];
export const DEMO_PIN = '1234';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const now = () => new Date().toISOString();
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Gráfico de ejemplo (SVG) para la tarjeta con imagen
function chartSvg() {
  const vals = [2.1, 3.3, 3.0, 2.3, 2.0, -10.9, 6.7, 6.2, 2.7, 3.2, 2.9];
  const W = 640, H = 340, base = 200, scale = 8;
  const bars = vals.map((v, i) => {
    const x = 58 + i * 52, h = Math.abs(v) * scale, y = v >= 0 ? base - h : base;
    const fill = v >= 0 ? '#2d5bd7' : '#dc3d43';
    return `<rect x="${x}" y="${y}" width="34" height="${h}" rx="4" fill="${fill}"/><text x="${x + 17}" y="${v >= 0 ? y - 6 : y + h + 15}" font-size="12" text-anchor="middle" fill="#1a1f2e">${v.toString().replace('.', ',')}</text><text x="${x + 17}" y="${H - 14}" font-size="12" text-anchor="middle" fill="#687086">${2015 + i}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/><text x="24" y="34" font-size="18" font-weight="700" fill="#1a1f2e">PIB de España · variación anual (%)</text><line x1="40" y1="${base}" x2="${W - 20}" y2="${base}" stroke="#c9cdd8"/>${bars}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function seed() {
  const B = 'demo-board';
  const p = {
    ana: 'demo-ana', luis: 'demo-luis', eva: 'demo-eva', carlos: 'demo-carlos', sofia: 'demo-sofia',
  };
  const members = [
    [p.ana, 'Ana García', true], [p.luis, 'Luis Pérez'], [p.eva, 'Eva Ruiz'], [p.carlos, 'Carlos Núñez'], [p.sofia, 'Sofía Martín'],
  ].map(([user_id, name, is_admin = false]) => ({ board_id: B, user_id, name, avatar_url: null, is_admin }));

  const base = { board_id: B, description: null, kind: 'text', url: null, file_path: null, file_name: null, file_size: null, color: null, due_date: null };
  const files = {
    [`${B}/grafico-pib.svg`]: { url: chartSvg(), type: 'image/svg+xml' },
    [`${B}/plantilla.pptx`]: { url: 'data:text/plain,Plantilla%20de%20ejemplo', type: FILE_TYPES.pptx },
    [`${B}/bibliografia.pdf`]: { url: 'data:text/plain,Bibliografia%20de%20ejemplo', type: FILE_TYPES.pdf },
  };
  const c = (id, status, position, by, extra) => ({ ...base, id, status, position, version: 1, content: null, created_by: by, created_at: now(), updated_at: now(), ...extra });
  const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const para = (...kids) => ({ type: 'paragraph', content: kids });
  const task = (checked, text) => ({ type: 'taskItem', attrs: { checked }, content: [para(t(text))] });
  const introDoc = { type: 'doc', content: [
    para(t('Máximo '), t('una página', [{ type: 'bold' }]), t('. Contexto + pregunta del trabajo.')),
    { type: 'taskList', content: [task(true, 'Leer los apuntes del tema 1'), task(false, 'Escribir el primer borrador'), task(false, 'Pasárselo a Ana para revisar')] },
    { type: 'details', content: [
      { type: 'detailsSummary', content: [t('Ideas para empezar')] },
      { type: 'detailsContent', content: [
        { type: 'bulletList', content: [
          { type: 'listItem', content: [para(t('Dato llamativo del INE sobre inflación'))] },
          { type: 'listItem', content: [para(t('Pregunta: ¿cómo afecta a las tiendas del barrio?', [{ type: 'highlight', attrs: { color: '#fef08a' } }]))] },
        ] },
        { type: 'details', content: [
          { type: 'detailsSummary', content: [t('Fuentes')] },
          { type: 'detailsContent', content: [para(t('Banco de España, informe trimestral'))] },
        ] },
      ] },
    ] },
  ] };
  const cards = [
    c('c1', 'todo', 1, p.eva, { title: 'Buscar datos de paro juvenil', description: 'Tasa de paro de 16 a 24 años, últimos 10 años.', kind: 'link', url: 'https://www.ine.es/', color: 'blue', due_date: day(3) }),
    c('c2', 'todo', 2, p.ana, { title: 'Leer el tema 4: el mercado', description: 'Oferta, demanda y precio de equilibrio. Subrayad lo que entre en la presentación.', due_date: day(-2) }),
    c('c3', 'todo', 3, p.luis, { title: 'Vídeo: ¿qué es la inflación?', kind: 'youtube', url: 'https://www.youtube.com/watch?v=Q3TQpIqdd0g' }),
    c('c4', 'todo', 4, p.sofia, { title: 'Plantilla de la presentación', kind: 'file', file_path: `${B}/plantilla.pptx`, file_name: 'Plantilla-Economia.pptx', file_size: 2457600, color: 'purple' }),
    c('c5', 'doing', 1, p.luis, { title: 'Gráfico del PIB 2015-2025', kind: 'image', file_path: `${B}/grafico-pib.svg`, file_name: 'grafico-pib.svg', file_size: 48300, color: 'green' }),
    c('c6', 'doing', 2, p.ana, { title: 'Redactar la introducción', description: 'Máximo una página. Contexto + pregunta del trabajo.', content: introDoc, due_date: day(1), color: 'orange' }),
    c('c7', 'doing', 3, p.carlos, { title: 'Encuesta a 20 comercios del barrio', kind: 'link', url: 'https://docs.google.com/forms/', color: 'red', due_date: day(5) }),
    c('c8', 'done', 1, p.ana, { title: 'Elegir el tema del trabajo', description: 'Tema: el impacto de la inflación en el comercio local.' }),
    c('c9', 'done', 2, p.eva, { title: 'Bibliografía inicial', kind: 'file', file_path: `${B}/bibliografia.pdf`, file_name: 'Bibliografia.pdf', file_size: 812000 }),
  ];
  const card_assignees = [
    ['c1', p.eva], ['c5', p.luis], ['c5', p.sofia], ['c6', p.ana], ['c7', p.carlos], ['c8', p.ana], ['c8', p.luis], ['c8', p.eva], ['c9', p.eva],
  ].map(([card_id, user_id]) => ({ card_id, user_id, board_id: B }));

  return {
    boards: [{ id: B, code: 'DEMO24', name: 'Trabajo de Economía', pin: DEMO_PIN, created_by: p.ana }],
    members, cards, card_assignees, files, next: 0,
  };
}

export function createDemoClient() {
  let db = null;
  db = load();
  const memFiles = {}; // archivos demasiado grandes para guardarlos
  const listeners = [];
  const bc = safe(() => new BroadcastChannel('tablero-demo'));

  function load() {
    // Sin localStorage (modo privado, etc.) seguimos con lo que hay en memoria
    return safe(() => JSON.parse(localStorage.getItem(KEY))) || db || seed();
  }
  function save() {
    safe(() => localStorage.setItem(KEY, JSON.stringify(db)));
  }

  // Persona de esta pestaña: cada pestaña nueva es alguien distinto
  let me = safe(() => JSON.parse(sessionStorage.getItem('tablero-demo-user')));
  if (!me) {
    const n = db.next || 0;
    db.next = n + 1;
    save();
    me = { id: `demo-tab-${n % PEOPLE.length}`, name: PEOPLE[n % PEOPLE.length] };
    safe(() => sessionStorage.setItem('tablero-demo-user', JSON.stringify(me)));
  }
  const user = { id: me.id, email: 'demo@ejemplo.es', app_metadata: { provider: 'email' }, user_metadata: { full_name: me.name } };

  const member = (b) => db.members.find((m) => m.board_id === b && m.user_id === me.id);
  const isMember = (b) => Boolean(member(b));
  const isAdmin = (b) => Boolean(member(b)?.is_admin);
  const err = (message, code) => ({ data: null, error: { message, code } });

  function emit(table, event, row, old, remote = false) {
    for (const l of listeners) {
      const f = l.cfg;
      if (f.table !== table || (f.event !== '*' && f.event !== event)) continue;
      if (f.filter) {
        const [col, val] = f.filter.split('=eq.');
        if ((row || {})[col] !== val) continue;
      }
      l.fn({ eventType: event, new: row ? clone(row) : {}, old: old ? clone(old) : {} });
    }
    if (!remote && bc) safe(() => bc.postMessage({ table, event, row, old }));
  }
  if (bc) {
    bc.onmessage = ({ data }) => {
      db = load();
      emit(data.table, data.event, data.row, data.old, true);
    };
  }

  function change(fn) {
    db = load(); // por si otra pestaña cambió algo
    const out = fn();
    save();
    return out;
  }

  // ---- Consultas tipo supabase-js: from(tabla).select/insert/update/delete ----
  class Query {
    constructor(table, op, payload) {
      Object.assign(this, { table, op, payload, filters: [], wantRows: op === 'select', one: false });
    }
    select() { this.wantRows = true; return this; }
    eq(col, val) { this.filters.push([col, val]); return this; }
    match(obj) { for (const e of Object.entries(obj)) this.filters.push(e); return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; this.maybe = true; return this; }
    then(ok, ko) { return Promise.resolve().then(() => this.run()).then(ok, ko); }

    rows() {
      return (db[this.table] || []).filter((r) => this.filters.every(([c, v]) => r[c] === v));
    }
    out(rows) {
      if (!this.wantRows) return { data: null, error: null };
      if (this.one && this.maybe && !rows.length) return { data: null, error: null };
      if (this.one) return rows.length === 1 ? { data: clone(rows[0]), error: null } : err('No se encontró la fila', 'PGRST116');
      return { data: clone(rows), error: null };
    }

    run() {
      const t = this.table;
      if (t === 'boards') return { data: [], error: null };
      if (t === 'profiles') return this.out([{ id: user.id, name: me.name }].filter((r) => this.filters.every(([c, v]) => r[c] === v)));
      if (this.op === 'select') {
        db = load();
        return this.out(this.rows().filter((r) => isMember(r.board_id)));
      }
      return change(() => {
        if (this.op === 'insert') return this.insert();
        if (this.op === 'update') return this.update();
        return this.remove();
      });
    }

    insert() {
      const r = { ...this.payload };
      if (!isMember(r.board_id)) return err('No perteneces a este tablero');
      if (this.table === 'cards') {
        if (r.kind === 'link' && !/^https?:\/\//i.test(r.url || '')) return err('Enlace no válido');
        const row = { id: uid(), status: 'todo', position: 0, description: null, content: null, kind: 'text', url: null, file_path: null, file_name: null, file_size: null, color: null, due_date: null, ...r, version: 1, updated_by: user.id, created_by: user.id, created_at: now(), updated_at: now() };
        db.cards.push(row);
        emit('cards', 'INSERT', row);
        return this.out([row]);
      }
      if (this.table === 'card_assignees') {
        if (!db.members.some((m) => m.board_id === r.board_id && m.user_id === r.user_id)) return err('Esa persona no está en el tablero');
        if (db.card_assignees.some((a) => a.card_id === r.card_id && a.user_id === r.user_id)) return err('Ya asignado', '23505');
        db.card_assignees.push(r);
        emit('card_assignees', 'INSERT', r);
        return this.out([r]);
      }
      return err('No permitido');
    }

    update() {
      if (this.table !== 'cards') return this.out([]);
      const rows = this.rows().filter((c) => isMember(c.board_id));
      const CONTENT = ['title', 'content', 'description', 'color', 'due_date', 'kind', 'url', 'file_path'];
      for (const c of rows) {
        const changed = CONTENT.some((k) => k in this.payload && JSON.stringify(this.payload[k]) !== JSON.stringify(c[k]));
        Object.assign(c, this.payload);
        if (changed) Object.assign(c, { version: (c.version || 1) + 1, updated_by: user.id, updated_at: now() });
        emit('cards', 'UPDATE', c);
      }
      return this.out(rows);
    }

    remove() {
      let rows = this.rows();
      if (this.table === 'cards') {
        rows = rows.filter((c) => isMember(c.board_id));
        db.cards = db.cards.filter((c) => !rows.includes(c));
        for (const c of rows) {
          db.card_assignees = db.card_assignees.filter((a) => a.card_id !== c.id);
          emit('cards', 'DELETE', null, { id: c.id });
        }
      } else if (this.table === 'card_assignees') {
        rows = rows.filter((a) => isMember(a.board_id));
        db.card_assignees = db.card_assignees.filter((a) => !rows.includes(a));
        for (const a of rows) emit('card_assignees', 'DELETE', null, { card_id: a.card_id, user_id: a.user_id });
      } else {
        rows = [];
      }
      return this.out(rows);
    }
  }

  // ---- Funciones RPC ----
  const rpcs = {
    create_board({ p_name, p_pin }) {
      if (!p_name?.trim()) return err('Falta el nombre del tablero');
      if ((p_pin || '').length < 4) return err('El PIN debe tener al menos 4 caracteres');
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const b = { id: uid(), code, name: p_name.trim(), pin: p_pin, created_by: user.id };
      db.boards.push(b);
      db.members.push({ board_id: b.id, user_id: user.id, name: me.name, avatar_url: null, is_admin: true });
      return { data: { id: b.id, code, name: b.name }, error: null };
    },
    join_board({ p_code }) {
      const b = db.boards.find((x) => x.code === String(p_code).trim().toUpperCase());
      if (!b) return err('No existe ningún tablero con ese código');
      if (!isMember(b.id)) {
        const m = { board_id: b.id, user_id: user.id, name: me.name, avatar_url: null, is_admin: false };
        db.members.push(m);
        emit('members', 'INSERT', m);
      }
      return { data: { id: b.id, code: b.code, name: b.name }, error: null };
    },
    claim_admin({ p_board, p_pin }) {
      const m = member(p_board);
      if (!m) return err('No perteneces a este tablero');
      const ok = db.boards.find((b) => b.id === p_board)?.pin === p_pin;
      if (ok) { m.is_admin = true; emit('members', 'UPDATE', m); }
      return { data: ok, error: null };
    },
    move_card({ p_card, p_status, p_position }) {
      const c = db.cards.find((x) => x.id === p_card && isMember(x.board_id));
      if (!c) return err('Tarjeta no encontrada');
      Object.assign(c, { status: p_status, position: p_position, updated_at: now() });
      emit('cards', 'UPDATE', c);
      return { data: null, error: null };
    },
    set_my_name({ p_name }) {
      const name = String(p_name || '').trim();
      if (!name || name.length > 60) return err('El nombre debe tener entre 1 y 60 caracteres');
      me.name = name;
      safe(() => sessionStorage.setItem('tablero-demo-user', JSON.stringify(me)));
      for (const m of db.members.filter((x) => x.user_id === user.id)) { m.name = name; emit('members', 'UPDATE', m); }
      return { data: null, error: null };
    },
    my_boards() {
      const data = db.members.filter((m) => m.user_id === user.id).map((m) => {
        const b = db.boards.find((x) => x.id === m.board_id);
        return { id: b.id, code: b.code, name: b.name, is_admin: m.is_admin, cards: db.cards.filter((c) => c.board_id === b.id).length };
      });
      return { data, error: null };
    },
    leave_board({ p_board }) {
      const gone = db.card_assignees.filter((a) => a.board_id === p_board && a.user_id === user.id);
      db.card_assignees = db.card_assignees.filter((a) => !gone.includes(a));
      for (const a of gone) emit('card_assignees', 'DELETE', null, { card_id: a.card_id, user_id: a.user_id });
      db.members = db.members.filter((m) => !(m.board_id === p_board && m.user_id === user.id));
      return { data: null, error: null };
    },
    delete_board({ p_board }) {
      if (!isAdmin(p_board)) return err('Solo el admin puede borrar el tablero');
      for (const c of db.cards.filter((x) => x.board_id === p_board)) emit('cards', 'DELETE', null, { id: c.id });
      for (const m of db.members.filter((x) => x.board_id === p_board)) emit('members', 'DELETE', null, { board_id: m.board_id, user_id: m.user_id });
      for (const t of ['cards', 'card_assignees', 'members']) db[t] = db[t].filter((r) => r.board_id !== p_board);
      db.boards = db.boards.filter((b) => b.id !== p_board);
      return { data: null, error: null };
    },
  };

  // ---- Storage ----
  const fileUrl = (path) => memFiles[path] || db.files[path]?.url || '';
  const readAsDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  return {
    isDemo: true,
    demoUser: me,
    auth: {
      getSession: async () => ({ data: { session: { user } } }),
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => { safe(() => sessionStorage.removeItem('tablero-demo-user')); return { error: null }; },
      signUp: async () => ({ data: { session: { user } }, error: null }),
      signInWithPassword: async () => ({ data: { session: { user } }, error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table) => ({
      select: () => new Query(table, 'select'),
      insert: (row) => new Query(table, 'insert', row),
      update: (row) => new Query(table, 'update', row),
      delete: () => new Query(table, 'delete'),
    }),
    rpc: async (name, args) => change(() => rpcs[name](args)),
    storage: {
      from: () => ({
        async upload(path, file) {
          if (file.size > MAX_FILE) return err('Payload too large');
          if (!FILE_TYPES[extOf(file.name)]) return err('Tipo de archivo no permitido');
          // En la demo, los archivos grandes solo viven en esta pestaña
          if (file.size < 1.5 * 1024 * 1024) {
            const url = await readAsDataUrl(file);
            change(() => { db.files[path] = { url, type: file.type }; });
          } else {
            memFiles[path] = URL.createObjectURL(file);
          }
          return { data: { path }, error: null };
        },
        async remove(paths) {
          change(() => { for (const p of paths) delete db.files[p]; });
          return { data: paths.map((name) => ({ name })), error: null };
        },
        async list(folder) {
          db = load();
          return { data: Object.keys(db.files).filter((p) => p.startsWith(`${folder}/`)).map((p) => ({ name: p.slice(folder.length + 1) })), error: null };
        },
        getPublicUrl: (path) => ({ data: { publicUrl: fileUrl(path) } }),
      }),
    },
    channel() {
      const ch = {
        on(_type, cfg, fn) { listeners.push({ cfg, fn }); return ch; },
        subscribe(cb) { setTimeout(() => cb?.('SUBSCRIBED'), 0); return ch; },
      };
      return ch;
    },
    resetDemo() {
      safe(() => localStorage.removeItem(KEY));
      safe(() => sessionStorage.removeItem('tablero-demo-user'));
    },
  };
}
