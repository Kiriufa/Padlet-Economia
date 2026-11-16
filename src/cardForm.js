import { supabase, BUCKET } from './supabase.js';
import { el } from './ui.js';
import { FILE_TYPES, IMAGE_TYPES, MAX_FILE, MAX_FILE_MB, extOf, formatSize, normalizeUrl, youtubeId } from './utils.js';

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
 * Ventana de adjunto de una tarea (imagen, archivo, enlace o vídeo de YouTube).
 * El título, el texto, el color y la fecha se editan en el panel de la tarea.
 * Devuelve la tarjeta guardada o null si se cancela.
 */
export function openAttachmentForm({ board, card }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('card-dialog');
    let kind = card.kind || 'text';
    let file = null;
    let done = false;

    const urlInput = el('input', { class: 'input', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', placeholder: '', value: ['link', 'youtube'].includes(card.kind) ? card.url : '' });
    const fileInput = el('input', { type: 'file', class: 'file-input' });
    const fileInfo = el('div', { class: 'file-pick-info' });
    const preview = el('img', { class: 'preview', alt: '', hidden: true });
    const err = el('p', { class: 'error' });
    const save = el('button', { class: 'btn primary', type: 'submit', text: 'Guardar adjunto' });

    const kindTabs = el('div', { class: 'seg', role: 'tablist' });
    const kindBody = el('div', { class: 'kind-body' });
    const pickZone = el('label', { class: 'dropzone' }, fileInput, el('span', { class: 'dz-text' }), fileInfo);

    const drawKind = () => {
      kindTabs.replaceChildren(...KINDS.map(([k, label]) => el('button', {
        type: 'button', class: `seg-btn${kind === k ? ' on' : ''}`, role: 'tab', 'aria-selected': String(kind === k), text: k === 'text' ? 'Ninguno' : label,
        onclick: () => { if (kind !== k) { kind = k; file = null; fileInput.value = ''; err.textContent = ''; drawKind(); } },
      })));
      const keepsFile = card.kind === kind && card.file_path;
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
        kindBody.replaceChildren(el('p', { class: 'hint', text: 'La tarea no tendrá imagen, archivo, enlace ni vídeo.' }));
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
      el('h2', { text: 'Adjunto' }),
      el('div', { class: 'field' }, kindTabs, kindBody),
      err,
      el('div', { class: 'actions' },
        el('button', { class: 'btn ghost', type: 'button', text: 'Cancelar', onclick: () => dlg.close() }),
        save));

    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      const row = { kind, url: null, file_path: null, file_name: null, file_size: null };

      if (kind === 'link') {
        row.url = normalizeUrl(urlInput.value);
        if (!row.url) return (err.textContent = 'El enlace no es válido.');
      }
      if (kind === 'youtube') {
        const id = youtubeId(urlInput.value);
        if (!id) return (err.textContent = 'No es un enlace de YouTube válido.');
        row.url = `https://www.youtube.com/watch?v=${id}`;
      }
      const keepsFile = card.kind === kind && card.file_path && !file;
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
        const { data, error } = await supabase.from('cards').update(row).eq('id', card.id).select().single();
        if (error) throw error;
        // Si se cambió o quitó el archivo, se borra el antiguo
        if (card.file_path && card.file_path !== data.file_path) {
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
        save.textContent = 'Guardar adjunto';
      }
    };

    dlg.onclose = () => { if (!done) resolve(null); };
    dlg.replaceChildren(form);
    dlg.showModal();
  });
}
