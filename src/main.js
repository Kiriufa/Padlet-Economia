import './styles.css';
import { supabase, configured, DEMO } from './supabase.js';
import { DEMO_PIN } from './demo.js';
import { el, ask, toast } from './ui.js';
import { openBoard } from './board.js';

const app = document.getElementById('app');
const LAST_BOARD = 'tablero:ultimo';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const urlCode = () => new URL(location.href).searchParams.get('b');

function setUrlCode(code) {
  try {
    const url = new URL(location.href);
    if (code) url.searchParams.set('b', code);
    else url.searchParams.delete('b');
    url.searchParams.delete('code'); // restos del login de Google
    url.hash = '';
    history.replaceState(null, '', url);
  } catch { /* algunos marcos no dejan cambiar la dirección */ }
}

// Mensajes de Supabase en castellano
function niceError(error) {
  const m = error?.message || String(error);
  if (/invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Todavía no has confirmado tu email. Revisa tu correo.';
  if (/already registered|already been registered/i.test(m)) return 'Ya existe una cuenta con ese email. Entra con tu contraseña.';
  if (/password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/unable to validate email|invalid email/i.test(m)) return 'Ese email no es válido.';
  if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera un momento y vuelve a probar.';
  return m;
}

const logo = () => el('div', { class: 'logo' }, el('span', { class: 'logo-mark' }), el('span', { text: 'Tablero de tareas' }));
const miniBoard = () => el('div', { class: 'mini-board', 'aria-hidden': 'true' },
  el('div', { class: 'mini-col' }, el('i'), el('b'), el('b'), el('b')),
  el('div', { class: 'mini-col' }, el('i'), el('b'), el('b')),
  el('div', { class: 'mini-col' }, el('i'), el('b')));
const screen = (...children) => app.replaceChildren(el('main', { class: 'center' }, el('div', { class: 'panel' }, ...children)));

const GOOGLE_ICON = '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

// ---------------------------------------------------------------------
// Entrar / crear cuenta
// ---------------------------------------------------------------------

function showLogin(mode = urlCode() ? 'signup' : 'login') {
  const invited = urlCode();
  const msg = el('p', { class: 'error' });
  const ok = el('p', { class: 'notice' });
  const busy = (form, on) => form.querySelectorAll('button, input').forEach((n) => (n.disabled = on));

  const nameIn = el('input', { class: 'input', id: 'signup-name', placeholder: 'Tu nombre (lo verán los demás)', maxlength: '60', required: true, autocomplete: 'name' });
  const emailIn = el('input', { class: 'input', id: 'auth-email', type: 'email', placeholder: 'Email', required: true, autocomplete: 'email' });
  const passIn = el('input', { class: 'input', id: 'auth-pass', type: 'password', placeholder: mode === 'signup' ? 'Contraseña (mín. 6)' : 'Contraseña', minlength: mode === 'signup' ? '6' : null, required: true, autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });

  const form = el('form', { class: 'stack' },
    mode === 'signup' && nameIn,
    emailIn,
    passIn,
    el('button', { class: 'btn primary', type: 'submit', text: mode === 'signup' ? 'Crear cuenta' : 'Entrar' }),
    mode === 'login' && el('button', { class: 'link-btn small-link', type: 'button', text: '¿Olvidaste la contraseña?', onclick: forgot }),
    msg, ok);

  form.onsubmit = async (e) => {
    e.preventDefault();
    msg.textContent = ''; ok.textContent = '';
    busy(form, true);
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: emailIn.value.trim(),
        password: passIn.value,
        options: { data: { full_name: nameIn.value.trim() }, emailRedirectTo: location.href },
      });
      busy(form, false);
      if (error) return (msg.textContent = niceError(error));
      if (!data.session) {
        ok.textContent = `Te hemos enviado un correo a ${emailIn.value.trim()}. Ábrelo para confirmar la cuenta y volverás aquí.`;
        return;
      }
      afterLogin(data.session);
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailIn.value.trim(), password: passIn.value });
      busy(form, false);
      if (error) return (msg.textContent = niceError(error));
      afterLogin(data.session);
    }
  };

  async function forgot() {
    msg.textContent = ''; ok.textContent = '';
    const email = emailIn.value.trim();
    if (!email) { msg.textContent = 'Escribe tu email y vuelve a pulsar.'; emailIn.focus(); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href });
    if (error) msg.textContent = niceError(error);
    else ok.textContent = 'Te hemos enviado un correo para elegir una contraseña nueva.';
  }

  const google = el('button', { class: 'btn google', type: 'button' }, el('span', { class: 'g', html: GOOGLE_ICON }), 'Continuar con Google');
  google.onclick = async () => {
    google.disabled = true;
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } });
    if (error) { msg.textContent = niceError(error); google.disabled = false; }
  };

  const tabs = el('div', { class: 'seg', role: 'tablist' },
    el('button', { type: 'button', class: `seg-btn${mode === 'login' ? ' on' : ''}`, role: 'tab', text: 'Entrar', onclick: () => mode !== 'login' && showLogin('login') }),
    el('button', { type: 'button', class: `seg-btn${mode === 'signup' ? ' on' : ''}`, role: 'tab', text: 'Crear cuenta', onclick: () => mode !== 'signup' && showLogin('signup') }));

  screen(
    logo(),
    miniBoard(),
    el('h1', { text: invited ? 'Te han invitado a un tablero' : 'Organiza las tareas del grupo' }),
    el('p', { class: 'muted', text: invited
      ? 'Crea tu cuenta (o entra si ya tienes una) y pasarás directamente al tablero.'
      : 'Crea tu cuenta para ver tus tableros y que todos sepan quién se encarga de cada tarea.' }),
    tabs,
    form,
    el('div', { class: 'divider' }, el('span', { text: 'o' })),
    google);
  (mode === 'signup' ? nameIn : emailIn).focus();
}

// ---------------------------------------------------------------------
// Nombre
// ---------------------------------------------------------------------

async function myName(user) {
  const { data } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
  return data?.name || null;
}

function askName(user, { prefill = '', first = true } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { class: 'input', id: 'my-name', maxlength: '60', required: true, value: prefill, placeholder: 'Ej: Marta Gil', autocomplete: 'name' });
    const msg = el('p', { class: 'error' });
    const form = el('form', { class: 'stack' },
      el('label', { class: 'label', for: 'my-name', text: 'Tu nombre' }),
      input,
      el('p', { class: 'hint', text: 'Es el nombre que verán los demás en las tareas. Puedes cambiarlo cuando quieras.' }),
      el('button', { class: 'btn primary', type: 'submit', text: first ? 'Continuar' : 'Guardar' }),
      msg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await supabase.rpc('set_my_name', { p_name: input.value });
      if (error) return (msg.textContent = niceError(error));
      resolve(input.value.trim());
    };
    screen(logo(), el('h1', { text: first ? '¿Cómo quieres que te vean?' : 'Cambiar mi nombre' }), form);
    input.focus();
    input.select();
  });
}

async function changeName(user) {
  const current = await myName(user);
  const name = await ask({ title: 'Cambiar mi nombre', text: 'Es el nombre que verán los demás en todos tus tableros.', ok: 'Guardar', input: { value: current || '', maxlength: '60', placeholder: 'Tu nombre' } });
  if (!name) return null;
  const { error } = await supabase.rpc('set_my_name', { p_name: name });
  if (error) { toast(niceError(error)); return null; }
  toast('Nombre cambiado');
  return name.trim();
}

// ---------------------------------------------------------------------
// Inicio: mis tableros, unirse con código, crear tablero
// ---------------------------------------------------------------------

async function showHome(user, name, errorText = '') {
  const codeInput = el('input', { class: 'input code', id: 'code', placeholder: 'Ej: K7P2QX', maxlength: '6', autocomplete: 'off', required: true, 'aria-label': 'Código del tablero' });
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase()));
  const err = el('p', { class: 'error', text: errorText });
  const joinForm = el('form', { class: 'stack' },
    el('label', { class: 'label', text: 'Unirme con un código', for: 'code' }),
    el('div', { class: 'row' }, codeInput, el('button', { class: 'btn primary', type: 'submit', text: 'Unirme' })),
    err);
  joinForm.onsubmit = (e) => { e.preventDefault(); join(user, codeInput.value, err); };

  const boardName = el('input', { class: 'input', id: 'new-board', placeholder: 'Nombre del tablero', maxlength: '80', required: true });
  const pin = el('input', { class: 'input', id: 'new-pin', type: 'password', placeholder: 'PIN de admin (mín. 4)', minlength: '4', required: true, autocomplete: 'new-password' });
  const createErr = el('p', { class: 'error' });
  const createForm = el('form', { class: 'stack' },
    boardName, pin,
    el('p', { class: 'hint', text: 'Serás el admin (puedes borrar el tablero). El PIN sirve para hacer admin a otra cuenta.' }),
    el('button', { class: 'btn', type: 'submit', text: 'Crear tablero' }),
    createErr);
  createForm.onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.rpc('create_board', { p_name: boardName.value, p_pin: pin.value });
    if (error) return (createErr.textContent = niceError(error));
    enter(user, data, { justCreated: true });
  };

  const list = el('div', { class: 'board-list' }, el('p', { class: 'muted small', text: 'Cargando…' }));

  screen(
    logo(),
    el('div', { class: 'whoami' },
      el('span', {}, 'Hola, ', el('strong', { text: name })),
      el('span', { class: 'whoami-actions' },
        el('button', { class: 'link-btn', type: 'button', text: 'Cambiar nombre', onclick: async () => { const n = await changeName(user); if (n) showHome(user, n); } }),
        el('button', { class: 'link-btn', type: 'button', text: 'Salir', onclick: logout }))),
    el('section', { class: 'stack' }, el('h2', { class: 'section-title', text: 'Mis tableros' }), list),
    joinForm,
    el('details', { class: 'create' },
      el('summary', { text: 'Crear un tablero nuevo' }),
      createForm));

  const { data, error } = await supabase.rpc('my_boards');
  if (error) { list.replaceChildren(el('p', { class: 'error', text: niceError(error) })); return; }
  if (!data.length) {
    list.replaceChildren(el('p', { class: 'muted small', text: 'Aún no estás en ningún tablero. Abre el enlace que te hayan pasado, escribe un código o crea uno nuevo.' }));
    return;
  }
  list.replaceChildren(...data.map((b) => el('button', { class: 'board-item', type: 'button', onclick: () => enter(user, b) },
    el('span', { class: 'board-item-name', text: b.name }),
    el('span', { class: 'board-item-meta' },
      b.is_admin && el('span', { class: 'badge', text: 'Admin' }),
      `${b.cards} ${b.cards === 1 ? 'tarea' : 'tareas'} · ${b.code}`),
    el('span', { class: 'board-item-arrow', text: '→' }))));
}

// ---------------------------------------------------------------------
// Flujo
// ---------------------------------------------------------------------

let currentUser = null;
let currentName = null;

async function join(user, code, errEl) {
  const { data, error } = await supabase.rpc('join_board', { p_code: code });
  if (error) {
    store.set(LAST_BOARD, null);
    setUrlCode(null);
    if (errEl) errEl.textContent = niceError(error);
    else showHome(user, currentName, niceError(error));
    return;
  }
  enter(user, data);
}

function enter(user, board, { justCreated = false } = {}) {
  store.set(LAST_BOARD, board.code);
  if (DEMO) store.set('tablero:demo-visto', '1');
  setUrlCode(board.code);
  openBoard(app, board, user, {
    home: () => { store.set(LAST_BOARD, null); setUrlCode(null); location.reload(); },
    leave: async () => {
      const okLeave = await ask({ title: '¿Salir de este tablero?', text: 'Dejarás de verlo en "Mis tableros" y se te quitará de sus tareas. Podrás volver con el enlace.', ok: 'Salir', danger: true });
      if (!okLeave) return;
      await supabase.rpc('leave_board', { p_board: board.id });
      store.set(LAST_BOARD, null); setUrlCode(null); location.reload();
    },
    rename: () => changeName(user),
    logout,
    justCreated,
  });
}

async function logout() {
  await supabase.auth.signOut();
  store.set(LAST_BOARD, null);
  setUrlCode(null);
  location.reload();
}

async function afterLogin(session) {
  const user = session.user;
  currentUser = user;
  let name = await myName(user);
  if (!name) {
    const meta = user.user_metadata || {};
    const fromSignup = user.app_metadata?.provider === 'email' && meta.full_name;
    if (fromSignup) {
      await supabase.rpc('set_my_name', { p_name: meta.full_name });
      name = meta.full_name;
    } else {
      name = await askName(user, { prefill: meta.full_name || meta.name || '' });
    }
  }
  currentName = name;

  // En la demo, la primera vez se abre directamente el tablero de ejemplo
  const code = urlCode() || store.get(LAST_BOARD) || (DEMO && !store.get('tablero:demo-visto') ? 'DEMO24' : null);
  setUrlCode(code);
  if (code) join(user, code);
  else showHome(user, name);
}

function showDemoBar() {
  const bar = el('div', { class: 'demo-bar', role: 'note' },
    el('p', {},
      el('strong', { text: 'Demo' }),
      ` · Eres ${supabase.demoUser.name}. Abre otra pestaña para ser otra persona y ver el tiempo real. PIN de admin: ${DEMO_PIN}`),
    el('button', { class: 'btn small', type: 'button', text: 'Reiniciar', title: 'Volver a los datos de ejemplo', onclick: () => { supabase.resetDemo(); store.set(LAST_BOARD, null); store.set('tablero:demo-visto', null); location.reload(); } }),
    el('button', { class: 'btn small', type: 'button', text: '–', title: 'Minimizar', 'aria-label': 'Minimizar aviso', onclick: (e) => {
      const min = bar.toggleAttribute('data-min');
      e.currentTarget.textContent = min ? 'Demo' : '–';
    } }));
  document.body.append(bar);
}

async function start() {
  if (!configured) {
    screen(
      el('h1', { text: 'Falta configurar Supabase' }),
      el('p', { text: 'Crea un archivo .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (mira el README).' }),
      el('a', { class: 'btn', href: '?demo', text: 'Ver la demo' }));
    return;
  }

  // Volver desde el correo de "olvidé mi contraseña"
  supabase.auth.onAuthStateChange?.((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    setTimeout(async () => {
      const password = await ask({ title: 'Elige una contraseña nueva', ok: 'Guardar', cancel: null, input: { type: 'password', minlength: '6', placeholder: 'Contraseña nueva (mín. 6)', autocomplete: 'new-password' } });
      if (!password) return;
      const { error } = await supabase.auth.updateUser({ password });
      toast(error ? niceError(error) : 'Contraseña cambiada');
    }, 0);
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (DEMO) showDemoBar();
  if (!session) return showLogin();
  afterLogin(session);
}

start();
