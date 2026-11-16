// Ventana pequeña para añadir una imagen, un archivo, un enlace o un vídeo:
// lo que haya que meter (con vista previa), el título y el color.

import { DEMO } from './supabase.js';
import { el, colorPicker, fadeOutCopy, clearFades } from './ui.js';
import { IMAGE_TYPES, FILE_TYPES, MAX_FILE_MB, extOf, formatSize, normalizeUrl, youtubeId, domainOf } from './utils.js';
import { checkFile, uploadToBoard } from './cardForm.js';
import { prepareImage, IMAGE_ACCEPT, isHeic } from './images.js';

const TEXT = {
  image: { title: 'Añadir imagen', pick: 'Elige una o varias fotos', hint: 'Fototeca, cámara o archivos · JPG, PNG, HEIC… (las fotos grandes se reducen solas)', ok: 'Añadir imagen' },
  file: { title: 'Añadir archivo', pick: 'Elige un archivo', hint: `PDF, Word, PowerPoint, Excel, ZIP… · máx. ${MAX_FILE_MB} MB`, ok: 'Añadir archivo' },
  link: { title: 'Añadir enlace', ok: 'Añadir enlace' },
  youtube: { title: 'Añadir vídeo de YouTube', ok: 'Añadir vídeo' },
};

const titleFromFile = (name) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Abre la ventana. `create(fields)` crea la tarjeta y devuelve la fila creada.
 * Devuelve las tarjetas creadas (o [] si se cancela).
 */
export function openAddDialog({ kind, board, create }) {
  clearFades();
  return new Promise((resolve) => {
    const dlg = document.getElementById('card-dialog');
    const T = TEXT[kind];
    let files = [];
    let titleTouched = false;
    const created = [];

    const err = el('p', { class: 'error', role: 'alert' });
    const title = el('input', { class: 'input ad-title', id: 'ad-title', maxlength: '200', placeholder: 'Título (opcional)', autocomplete: 'off' });
    title.addEventListener('input', () => { titleTouched = Boolean(title.value.trim()); });
    const suggest = (v) => { if (!titleTouched) title.value = v || ''; };
    const picker = colorPicker({ value: null });
    const submit = el('button', { class: 'btn primary', type: 'submit', text: T.ok });

    // --- Lo que hay que meter, según el tipo ---
    let body, getFields;
    if (kind === 'image' || kind === 'file') {
      const types = kind === 'image' ? IMAGE_TYPES : FILE_TYPES;
      const input = el('input', { type: 'file', class: 'file-input', multiple: true, accept: kind === 'image' ? IMAGE_ACCEPT : Object.keys(types).map((e) => `.${e}`).join(',') });
      const list = el('div', { class: 'ad-files' });
      const zoneText = el('span', { class: 'ad-zone-text', text: T.pick });
      const zone = el('label', { class: 'ad-zone', tabindex: '0' }, input,
        el('span', { class: 'ad-zone-ico', html: kind === 'image'
          ? '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5L6 20"/></svg>'
          : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>' }),
        zoneText, el('small', { text: T.hint }));
      zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });

      const setFiles = async (picked) => {
        err.textContent = '';
        const ok = [];
        if (kind === 'image' && picked.length) zoneText.textContent = picked.some(isHeic) ? 'Convirtiendo fotos…' : 'Preparando…';
        for (const f of picked) {
          if (kind === 'image') {
            // HEIC → JPG y fotos grandes reducidas, antes de subir
            try { ok.push(await prepareImage(f)); } catch (ex) { err.textContent = ex.message; }
            continue;
          }
          const problem = checkFile(f, kind);
          if (problem) { err.textContent = `${f.name}: ${problem}`; continue; }
          ok.push(f);
        }
        files = ok;
        list.replaceChildren(...files.map((f, i) => el('div', { class: 'ad-file', style: `--i:${i}` },
          kind === 'image' ? el('img', { src: URL.createObjectURL(f), alt: '' }) : el('span', { class: `file-ext ext-${extOf(f.name)}`, text: extOf(f.name).toUpperCase() }),
          el('span', { class: 'ad-file-name', text: f.name }),
          el('small', { text: formatSize(f.size) }))));
        zone.classList.toggle('has-files', files.length > 0);
        zoneText.textContent = files.length ? (files.length === 1 ? 'Cambiar' : `${files.length} elegidos · cambiar`) : T.pick;
        suggest(files.length === 1 ? titleFromFile(files[0].name) : '');
        title.placeholder = files.length > 1 ? 'Título (opcional, se numera: 1, 2, 3…)' : 'Título (opcional)';
      };
      input.onchange = () => setFiles([...input.files]);
      // Arrastrar archivos a la zona
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); setFiles([...e.dataTransfer.files]); });

      body = el('div', { class: 'ad-body' }, zone, list);
      getFields = async () => {
        if (!files.length) throw new Error(kind === 'image' ? 'Elige al menos una imagen.' : 'Elige un archivo.');
        const base = title.value.trim();
        const out = [];
        for (const [i, f] of files.entries()) {
          submit.lastChild.textContent = files.length > 1 ? `Subiendo ${i + 1} de ${files.length}…` : 'Subiendo…';
          const up = await uploadToBoard(board.id, f);
          const t = base ? (files.length > 1 ? `${base} ${i + 1}` : base) : (titleFromFile(f.name) || 'Sin título');
          out.push({ kind, title: t.slice(0, 200), ...up });
        }
        return out;
      };
    } else {
      const isVideo = kind === 'youtube';
      const url = el('input', { class: 'input', id: 'ad-url', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        placeholder: isVideo ? 'https://www.youtube.com/watch?v=…' : 'https://…' });
      const preview = el('div', { class: 'ad-preview', hidden: true });
      url.addEventListener('input', () => {
        err.textContent = '';
        if (isVideo) {
          const id = youtubeId(url.value);
          preview.hidden = !id;
          if (id) {
            preview.replaceChildren(el('div', { class: 'ad-yt', style: DEMO ? '' : `background-image:url(https://i.ytimg.com/vi/${id}/mqdefault.jpg)` }, el('span', { text: '▶' })), el('span', { text: 'Vídeo de YouTube' }));
            suggest('Vídeo de YouTube');
          }
        } else {
          const u = normalizeUrl(url.value);
          preview.hidden = !u;
          if (u) { preview.replaceChildren(el('span', { class: 'ad-link-ico', text: '🔗' }), el('strong', { text: domainOf(u) })); suggest(domainOf(u)); }
        }
      });
      body = el('div', { class: 'ad-body' }, el('label', { class: 'label', for: 'ad-url', text: isVideo ? 'Enlace del vídeo' : 'Dirección de la página' }), url, preview);
      getFields = async () => {
        if (isVideo) {
          const id = youtubeId(url.value);
          if (!id) throw new Error('No es un enlace de YouTube válido.');
          return [{ kind, url: `https://www.youtube.com/watch?v=${id}`, title: (title.value.trim() || 'Vídeo de YouTube').slice(0, 200) }];
        }
        const u = normalizeUrl(url.value);
        if (!u) throw new Error('El enlace no es válido.');
        return [{ kind, url: u, title: (title.value.trim() || domainOf(u)).slice(0, 200) }];
      };
      setTimeout(() => url.focus(), 60);
    }

    submit.replaceChildren(el('span', { class: 'spinner', hidden: true }), el('span', { text: T.ok }));
    const form = el('form', { class: 'card-form ad-form', method: 'dialog' },
      el('h2', { class: `ad-head k-${kind}` }, el('span', { class: 'add-ico', html: document.querySelector(`.add-opt[data-kind=${kind}] .add-ico`)?.innerHTML || '' }), T.title),
      body,
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'ad-title', text: 'Título' }), title),
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'Color' }), picker),
      err,
      el('div', { class: 'actions' },
        el('button', { class: 'btn ghost', type: 'button', text: 'Cancelar', onclick: () => closeDialog(dlg) }),
        submit));

    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      submit.firstChild.hidden = false;
      try {
        const rows = await getFields();
        for (const row of rows) created.push(await create({ ...row, color: picker.getValue() }));
        closeDialog(dlg);
      } catch (ex) {
        err.textContent = ex.message || 'No se pudo añadir.';
        submit.disabled = false;
        submit.firstChild.hidden = true;
        submit.lastChild.textContent = T.ok;
      }
    };

    dlg.onclose = () => resolve(created);
    dlg.replaceChildren(form);
    dlg.showModal();
  });
}

// Cierre con animación (si el usuario no ha pedido menos movimiento)
export function closeDialog(dlg) {
  if (!dlg.open) return;
  if (dlg.firstElementChild) fadeOutCopy(dlg);
  dlg.close();
}

