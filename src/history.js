// Historial para deshacer y rehacer lo que haces en el tablero (borrar, crear, mover, editar).
// Se guarda en este navegador (por tablero), así que sobrevive a recargar la página.

const MAX = 40;
let H = { key: null, undo: [], redo: [] };
let hooks = { onChange() {}, onDrop() {} };

const persist = () => {
  try { localStorage.setItem(H.key, JSON.stringify({ undo: H.undo, redo: H.redo })); } catch {
    // Lleno: se guardan solo las últimas acciones (y si ni así cabe, queda solo en memoria)
    try { localStorage.setItem(H.key, JSON.stringify({ undo: H.undo.slice(-8), redo: H.redo.slice(-8) })); } catch {
      try { localStorage.removeItem(H.key); } catch { /* bloqueado */ }
    }
  }
};

/** onDrop(entry): una entrada sale del historial para siempre (para limpiar archivos). */
export function initHistory(boardId, h) {
  hooks = { ...hooks, ...h };
  H = { key: `tablero-historial-${boardId}`, undo: [], redo: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(H.key) || 'null');
    if (saved && Array.isArray(saved.undo) && Array.isArray(saved.redo)) { H.undo = saved.undo; H.redo = saved.redo; }
  } catch { /* nada guardado */ }
  hooks.onChange();
}

export function record(entry) {
  H.undo.push({ ...entry, at: Date.now() });
  const dropped = H.redo.splice(0);
  while (H.undo.length > MAX) dropped.push(H.undo.shift());
  persist();
  dropped.forEach((e) => hooks.onDrop(e));
  hooks.onChange();
}

export const peekUndo = () => H.undo[H.undo.length - 1] || null;
export const peekRedo = () => H.redo[H.redo.length - 1] || null;

// Saca la última acción para deshacerla. Si al aplicarla falla, se vuelve a dejar donde estaba.
export async function step(dir, apply) {
  const from = dir === 'undo' ? H.undo : H.redo;
  const to = dir === 'undo' ? H.redo : H.undo;
  const entry = from.pop();
  if (!entry) return null;
  persist();
  hooks.onChange();
  let ok = false;
  try { ok = await apply(entry, dir); } catch (e) { console.warn(e); }
  if (ok === 'gone') { persist(); hooks.onChange(); return entry; } // ya no se puede (p. ej. la tarjeta no existe)
  (ok ? to : from).push(entry);
  persist();
  hooks.onChange();
  return ok ? entry : null;
}

/** Cambia una entrada guardada (p. ej. la tarjeta recuperada tiene datos nuevos). */
export function updateEntries(fn) {
  H.undo = H.undo.map(fn);
  H.redo = H.redo.map(fn);
  persist();
}
