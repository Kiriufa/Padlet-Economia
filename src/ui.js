import { colorFor, initials } from './utils.js';

// Crea un elemento de forma segura (el texto nunca se interpreta como HTML)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // solo para iconos constantes
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

export function avatar(member, userId, size = '') {
  const name = member?.name || '?';
  const fallback = () => el('span', { class: `avatar ${size}`, title: name, style: `background:${colorFor(userId)}`, text: initials(name) });
  if (!member?.avatar_url) return fallback();
  const img = el('img', { class: `avatar ${size}`, title: name, alt: name, src: member.avatar_url, referrerpolicy: 'no-referrer', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

// Textarea que crece mientras escribes
export function autosize(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

let toastTimer;
export function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// Diálogo de confirmación/pregunta. Devuelve true/false, o el texto si lleva input.
export function ask({ title, text = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false, input = null }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('ask-dialog');
    const field = input ? el('input', { class: 'input', required: true, ...input }) : null;
    const form = el('form', { method: 'dialog', class: 'ask' },
      el('h2', { text: title }),
      text && el('p', { text }),
      field,
      el('div', { class: 'actions' },
        cancel && el('button', { type: 'button', class: 'btn ghost', value: 'no', text: cancel, onclick: () => dlg.close('no') }),
        el('button', { type: 'submit', class: `btn ${danger ? 'danger' : 'primary'}`, value: 'yes', text: ok })));
    dlg.replaceChildren(form);
    dlg.onclose = () => {
      const yes = dlg.returnValue === 'yes';
      resolve(field ? (yes ? field.value : false) : yes);
    };
    dlg.returnValue = '';
    dlg.showModal();
    (field || form.querySelector('[type=submit]')).focus();
  });
}

export const ICONS = {
  todo: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 2.6"/></svg>',
  doing: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="8.5"/><path d="M12 6.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" stroke="none"/></svg>',
  done: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9.7" fill="currentColor"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  userPlus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  play: '<svg viewBox="0 0 68 48" width="56" height="40"><path d="M66.5 7.7a8.5 8.5 0 0 0-6-6C55.3.3 34 .3 34 .3s-21.3 0-26.5 1.4a8.5 8.5 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6C12.7 47.7 34 47.7 34 47.7s21.3 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3Z" fill="#f00"/><path d="M45 24 27 14v20" fill="#fff"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
