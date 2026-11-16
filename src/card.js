import { supabase, BUCKET, DEMO } from './supabase.js';
import { el, avatar, toast, ICONS } from './ui.js';
import { COLORS, domainOf, extOf, formatDate, formatSize, isOverdue, youtubeId } from './utils.js';

const publicUrl = (path, download) =>
  supabase.storage.from(BUCKET).getPublicUrl(path, download ? { download } : undefined).data.publicUrl;

function content(card) {
  switch (card.kind) {
    case 'image': {
      const src = publicUrl(card.file_path);
      return el('a', { class: 'media', href: src, target: '_blank', rel: 'noopener', title: 'Ver imagen completa' },
        el('img', { src, alt: card.file_name || card.title, loading: 'lazy', draggable: 'false' }));
    }
    case 'file':
      return el('div', { class: 'file' },
        el('span', { class: `file-ext ext-${extOf(card.file_name)}`, text: extOf(card.file_name).toUpperCase() || 'FILE' }),
        el('div', { class: 'file-info' },
          el('span', { class: 'file-name', text: card.file_name, title: card.file_name }),
          el('span', { class: 'muted small', text: formatSize(card.file_size) })),
        el('a', { class: 'btn small', href: publicUrl(card.file_path, card.file_name), title: 'Descargar', onclick: DEMO ? (e) => { e.preventDefault(); toast('En la demo los archivos no se descargan'); } : null },
          el('span', { html: ICONS.download }), 'Descargar'));
    case 'link':
      return el('a', { class: 'linkbox', href: card.url, target: '_blank', rel: 'noopener noreferrer', title: card.url },
        !DEMO && el('img', { class: 'favicon', alt: '', src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainOf(card.url))}&sz=32`, loading: 'lazy', draggable: 'false', onerror: (e) => e.target.remove() }),
        el('span', { class: 'domain', text: domainOf(card.url) }),
        el('span', { class: 'open', html: ICONS.link }));
    case 'youtube': {
      const id = youtubeId(card.url);
      if (!id) return null;
      // En la demo (sin acceso a YouTube) se abre el vídeo en otra pestaña
      if (DEMO) {
        return el('a', { class: 'yt', href: card.url, target: '_blank', rel: 'noopener', title: 'Ver en YouTube' },
          el('span', { html: ICONS.play }));
      }
      // Miniatura ligera: el reproductor solo se carga al pulsar
      const box = el('button', { class: 'yt', type: 'button', title: 'Reproducir vídeo', style: `background-image:url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` },
        el('span', { html: ICONS.play }));
      box.onclick = () => box.replaceWith(el('div', { class: 'yt playing' },
        el('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`,
          title: card.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
        })));
      return box;
    }
    default:
      return null;
  }
}

// "Tú", "Luis", "Luis y Sofía", "Luis, Sofía +2"
function whoText(people, me) {
  const names = people.map(([u, m]) => (u === me ? 'Tú' : (m?.name || '?').split(' ')[0]));
  names.sort((a, b) => (a === 'Tú' ? -1 : b === 'Tú' ? 1 : 0));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

export function buildCard({ card, people, me, editable, handlers, fresh = null }) {
  const mine = people.some(([u]) => u === me);
  const overdue = isOverdue(card.due_date, card.status);

  return el('article', { class: `card${card.color ? ' tagged' : ''}`, 'data-id': card.id, style: card.color ? `--tag:${COLORS[card.color]}` : '' },
    el('div', { class: 'card-top' },
      el('span', { class: 'drag-handle', title: 'Arrastra desde aquí para mover', 'aria-hidden': 'true' }),
      el('h3', { text: card.title }),
      editable && el('div', { class: 'card-tools' },
        el('button', { class: 'icon-btn', type: 'button', title: 'Editar', 'aria-label': 'Editar', html: ICONS.edit, onclick: () => handlers.edit(card) }),
        el('button', { class: 'icon-btn', type: 'button', title: 'Borrar', 'aria-label': 'Borrar', html: ICONS.trash, onclick: () => handlers.remove(card) }))),
    card.description && el('p', { class: 'desc', text: card.description }),
    content(card),
    card.due_date && el('div', { class: `due${overdue ? ' overdue' : ''}`, title: overdue ? 'Fecha límite pasada' : 'Fecha límite' },
      el('span', { html: ICONS.calendar }), overdue ? `Venció el ${formatDate(card.due_date)}` : formatDate(card.due_date)),
    el('div', { class: 'card-foot' },
      el('div', { class: 'avatars' },
        people.length
          ? people.map(([u, m]) => {
            const a = avatar(m, u, 'sm');
            if (fresh?.has(u)) a.classList.add('pop');
            return a;
          })
          : el('span', { class: 'muted small', text: 'Sin encargado' }),
        people.length > 0 && el('span', { class: 'who', text: whoText(people, me), title: people.map(([, m]) => m?.name || '?').join(', ') })),
      el('div', { class: 'foot-actions' },
        mine
          ? el('button', { class: 'btn small ghost', type: 'button', text: 'Soltar', title: 'Quitarme de esta tarea', onclick: () => handlers.leave(card) })
          : el('button', { class: 'btn small claim', type: 'button', text: 'Me lo quedo', onclick: () => handlers.claim(card) }),
        el('button', { class: 'icon-btn assign-btn', type: 'button', title: 'Asignar a…', 'aria-label': 'Asignar a…', html: ICONS.userPlus, onclick: (e) => handlers.assign(card, e.currentTarget) }))));
}
