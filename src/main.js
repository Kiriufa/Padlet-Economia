import './styles.css';
import { supabase, configured } from './supabase.js';
import { el, toast } from './ui.js';
import { openBoard } from './board.js';

const app = document.getElementById('app');
const LAST_BOARD = 'tablero:ultimo';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

function setUrlCode(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('b', code);
  else url.searchParams.delete('b');
  url.searchParams.delete('code'); // restos del login de Google
  url.hash = '';
  history.replaceState(null, '', url);
}

function logo() {
  return el('div', { class: 'logo' }, el('span', { class: 'logo-mark' }), el('span', { text: 'Tablero de tareas' }));
}

function showLogin() {
  const btn = el('button', { class: 'btn google', type: 'button' },
    el('span', { class: 'g', html: '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' }),
    'Entrar con Google');
  btn.onclick = async () => {
    btn.disabled = true;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.href },
    });
    if (error) { toast(error.message); btn.disabled = false; }
  };
  app.replaceChildren(el('main', { class: 'center' },
    el('div', { class: 'panel' },
      logo(),
      el('h1', { text: 'Organiza las tareas del grupo' }),
      el('p', { class: 'muted', text: 'Entra con tu cuenta de Google para que todos sepan quién se encarga de cada tarea.' }),
      btn)));
}

function showJoin(user, errorText = '') {
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email;
  const codeInput = el('input', { class: 'input code', name: 'code', placeholder: 'Ej: K7P2QX', maxlength: '6', autocomplete: 'off', required: true, 'aria-label': 'Código del tablero' });
  const err = el('p', { class: 'error', text: errorText });

  const joinForm = el('form', { class: 'stack' },
    el('label', { class: 'label', text: 'Código del tablero', for: 'code' }),
    el('div', { class: 'row' }, codeInput, el('button', { class: 'btn primary', type: 'submit', text: 'Entrar' })),
    err);
  codeInput.id = 'code';
  joinForm.onsubmit = async (e) => {
    e.preventDefault();
    await join(user, codeInput.value, err);
  };

  const boardName = el('input', { class: 'input', placeholder: 'Nombre del tablero', maxlength: '80', required: true });
  const pin = el('input', { class: 'input', type: 'password', placeholder: 'PIN de admin (mín. 4)', minlength: '4', required: true, autocomplete: 'new-password' });
  const createErr = el('p', { class: 'error' });
  const createForm = el('form', { class: 'stack' },
    boardName, pin,
    el('p', { class: 'hint', text: 'Serás el admin. Guarda el PIN: sirve para entrar como admin desde otra cuenta.' }),
    el('button', { class: 'btn', type: 'submit', text: 'Crear tablero' }),
    createErr);
  createForm.onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.rpc('create_board', { p_name: boardName.value, p_pin: pin.value });
    if (error) return (createErr.textContent = error.message);
    enter(user, data);
  };

  app.replaceChildren(el('main', { class: 'center' },
    el('div', { class: 'panel' },
      logo(),
      el('div', { class: 'whoami' },
        el('span', { text: `Hola, ${name}` }),
        el('button', { class: 'link-btn', type: 'button', text: 'Cerrar sesión', onclick: logout })),
      joinForm,
      el('details', { class: 'create' },
        el('summary', { text: '¿Eres quien organiza? Crea un tablero nuevo' }),
        createForm))));
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase()));
  codeInput.focus();
}

async function join(user, code, errEl) {
  const { data, error } = await supabase.rpc('join_board', { p_code: code });
  if (error) {
    store.set(LAST_BOARD, null);
    setUrlCode(null);
    if (errEl) errEl.textContent = error.message;
    else showJoin(user, error.message);
    return;
  }
  enter(user, data);
}

function enter(user, board) {
  store.set(LAST_BOARD, board.code);
  setUrlCode(board.code);
  openBoard(app, board, user, {
    leave: () => { store.set(LAST_BOARD, null); setUrlCode(null); location.reload(); },
    logout,
  });
}

async function logout() {
  await supabase.auth.signOut();
  store.set(LAST_BOARD, null);
  setUrlCode(null);
  location.reload();
}

async function start() {
  if (!configured) {
    app.replaceChildren(el('main', { class: 'center' }, el('div', { class: 'panel' },
      el('h1', { text: 'Falta configurar Supabase' }),
      el('p', { text: 'Crea un archivo .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (mira el README).' }))));
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return showLogin();

  const code = new URL(location.href).searchParams.get('b') || store.get(LAST_BOARD);
  setUrlCode(code);
  if (code) join(session.user, code);
  else showJoin(session.user);
}

start();
