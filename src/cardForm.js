import { supabase, BUCKET } from './supabase.js';
import { el, autosize } from './ui.js';
import { COLORS, FILE_TYPES, IMAGE_TYPES, MAX_FILE, MAX_FILE_MB, extOf, formatSize, normalizeUrl, youtubeId } from './utils.js';

const KINDS = [
  ['text', 'Texto'],
  ['image', 'Imagen'],
  ['file', 'Archivo'],
  ['link', 'Enlace'],
  ['youtube', 'YouTube'],
];

const accept = (types) => Object.keys(types).map((e) => `.${e}`).join(',');

function checkFile(file, kind) {
  const types = kind === 'image' ? IMAGE_TYPES : FILE_TYPES;
  const ext = extOf(file.name);
  if (!types[ext]) {
    return kind === 'image'
      ? 'Formato de imagen no válido (usa JPG, PNG, GIF o WEBP).'
      : `Tipo de archivo no permitido. Permitidos: ${Object.keys(FILE_TYPES).join(', ')}.`;
  }
  if (file.size > MAX_FILE) return `El archivo pesa ${formatSize(file.size)}. El máximo es ${MAX_FILE_MB} MB.`;
  return '';
}

/**
 * Abre el formulario para crear (sin card) o editar (con card).
 * Devuelve la tarjeta guardada o null si se cancela.
 */
export function openCardForm({ board, card = null, status = 'todo', position = 0, draft = null }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('card-dialog');
    let kind = card?.kind || 'text';
    let file = null;
    let done = false;

    const title = el('input', { class: 'input', name: 'title', maxlength: '200', required: true, placeholder: '¿Qué hay que hacer?', value: card?.title || draft?.title || '' });
    const desc = el('textarea', { class: 'input', name: 'desc', rows: '3', maxlength: '5000', placeholder: 'Descripción (opcional)' });
    desc.value = card?.description || draft?.description || '';
    autosize(desc);
    const urlInput = el('input', { class: 'input', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', placeholder: '', value: ['link', 'youtube'].includes(card?.kind) ? card.url : '' });
    const fileInput = el('input', { type: 'file', class: 'file-input' });
    const fileInfo = el('div', { class: 'file-pick-info' });
    const preview = el('img', { class: 'preview', alt: '', hidden: true });
    const due = el('input', { class: 'input', type: 'date', value: card?.due_date || '' });
    const err = el('p', { class: 'error' });
    const save = el('button', { class: 'btn primary', type: 'submit', text: card ? 'Guardar' : 'Crear tarea' });

    // Etiqueta de color
    let color = card?.color || null;
    const swatches = el('div', { class: 'swatches' });
    const drawSwatches = () => swatches.replaceChildren(
      el('button', { type: 'button', class: `swatch none${color ? '' : ' on'}`, title: 'Sin color', 'aria-label': 'Sin color', onclick: () => { color = null; drawSwatches(); } }),
      ...Object.entries(COLORS).map(([name, hex]) => el('button', {
        type: 'button', class: `swatch${color === name ? ' on' : ''}`, style: `background:${hex}`, title: name, 'aria-label': name,
        onclick: () => { color = name; drawSwatches(); },
      })));
    drawSwatches();

    // Tipo de contenido
    const kindTabs = el('div', { class: 'seg', role: 'tablist' });
    const kindBody = el('div', { class: 'kind-body' });
    const pickZone = el('label', { class: 'dropzone' }, fileInput, el('span', { class: 'dz-text' }), fileInfo);

    const drawKind = () => {
      kindTabs.replaceChildren(...KINDS.map(([k, label]) => el('button', {
        type: 'button', class: `seg-btn${kind === k ? ' on' : ''}`, role: 'tab', 'aria-selected': String(kind === k), text: label,
        onclick: () => { if (kind !== k) { kind = k; file = null; fileInput.value = ''; err.textContent = ''; drawKind(); } },
      })));
      const keepsFile = card && card.kind === kind && card.file_path;
      fileInfo.textContent = keepsFile ? `Actual: ${card.file_name} (${formatSize(card.file_size)})` : '';
      preview.hidden = !(kind === 'image' && keepsFile);
      if (!preview.hidden) preview.src = supabase.storage.from(BUCKET).getPublicUrl(card.file_path).data.publicUrl;

      if (kind === 'image' || kind === 'file') {
        fileInput.accept = accept(kind === 'image' ? IMAGE_TYPES : FILE_TYPES);
        pickZone.querySelector('.dz-text').textContent = `${keepsFile ? 'Cambiar' : 'Elegir'} ${kind === 'image' ? 'imagen' : 'archivo'} · máx. ${MAX_FILE_MB} MB`;
        kindBody.replaceChildren(pickZone, kind === 'image' ? preview : '');
      } else if (kind === 'link' || kind === 'youtube') {
        urlInput.placeholder = kind === 'link' ? 'https://…' : 'https://www.youtube.com/watch?v=…';
        kindBody.replaceChildren(urlInput);
      } else {
        kindBody.replaceChildren();
      }
    };

    fileInput.onchange = () => {
      file = fileInput.files[0] || null;
      err.textContent = '';
      if (!file) return drawKind();
      const problem = checkFile(file, kind);
      if (problem) { err.textContent = problem; file = null; fileInput.value = ''; return; }
      fileInfo.textContent = `${file.name} (${formatSize(file.size)})`;
      if (kind === 'image') { preview.src = URL.createObjectURL(file); preview.hidden = false; }
    };
    drawKind();

    const form = el('form', { class: 'card-form', method: 'dialog' },
      el('h2', { text: card ? 'Editar tarea' : 'Nueva tarea' }),
      title, desc,
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'Contenido' }), kindTabs, kindBody),
      el('div', { class: 'row wrap' },
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Etiqueta' }), swatches),
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Fecha límite' }), due)),
      err,
      el('div', { class: 'actions' },
        el('button', { class: 'btn ghost', type: 'button', text: 'Cancelar', onclick: () => dlg.close() }),
        save));

    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      const row = {
        title: title.value.trim(),
        description: desc.value.trim() || null,
        kind,
        color,
        due_date: due.value || null,
        url: null,
        file_path: null,
        file_name: null,
        file_size: null,
      };
      if (!row.title) return (err.textContent = 'Escribe un título.');

      if (kind === 'link') {
        row.url = normalizeUrl(urlInput.value);
        if (!row.url) return (err.textContent = 'El enlace no es válido.');
      }
      if (kind === 'youtube') {
        const id = youtubeId(urlInput.value);
        if (!id) return (err.textContent = 'No es un enlace de YouTube válido.');
        row.url = `https://www.youtube.com/watch?v=${id}`;
      }

      const keepsFile = card && card.kind === kind && card.file_path && !file;
      if ((kind === 'image' || kind === 'file') && !file && !keepsFile) {
        return (err.textContent = kind === 'image' ? 'Elige una imagen.' : 'Elige un archivo.');
      }
      if (keepsFile) Object.assign(row, { file_path: card.file_path, file_name: card.file_name, file_size: card.file_size });

      save.disabled = true;
      save.textContent = file ? 'Subiendo…' : 'Guardando…';
      let uploaded = null;
      try {
        if (file) {
          const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
          uploaded = `${board.id}/${crypto.randomUUID()}-${safe}`;
          const { error } = await supabase.storage.from(BUCKET).upload(uploaded, file, {
            contentType: FILE_TYPES[extOf(file.name)],
            upsert: false,
          });
          if (error) { uploaded = null; throw error; }
          Object.assign(row, { file_path: uploaded, file_name: file.name, file_size: file.size });
        }

        const query = card
          ? supabase.from('cards').update({ ...row, updated_at: new Date().toISOString() }).eq('id', card.id)
          : supabase.from('cards').insert({ ...row, board_id: board.id, status, position });
        const { data, error } = await query.select().single();
        if (error) throw error;

        // Si se cambió o quitó el archivo, se borra el antiguo
        if (card?.file_path && card.file_path !== data.file_path) {
          supabase.storage.from(BUCKET).remove([card.file_path]);
        }
        done = true;
        dlg.close();
        resolve(data);
      } catch (error) {
        if (uploaded) supabase.storage.from(BUCKET).remove([uploaded]);
        const msg = /exceeded|too large|413/i.test(error.message) ? `El archivo supera el máximo permitido (${MAX_FILE_MB} MB).` : error.message;
        err.textContent = `No se pudo guardar: ${msg}`;
        save.disabled = false;
        save.textContent = card ? 'Guardar' : 'Crear tarea';
      }
    };

    dlg.onclose = () => { if (!done) resolve(null); };
    dlg.replaceChildren(form);
    // Ctrl/Cmd + Enter guarda desde cualquier campo
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
    });
    dlg.showModal();
    if (!card) { title.focus(); title.setSelectionRange(title.value.length, title.value.length); }
  });
}

