// Utilidades para el contenido con formato (documento JSON del editor).
// No dependen del editor: sirven para el resumen de las tarjetas del tablero.

import { STORAGE_PREFIX, DEMO } from './supabase.js';

// Solo se aceptan imágenes subidas a nuestro almacenamiento (o, en la demo, guardadas en el navegador)
export function isAllowedImage(src) {
  if (typeof src !== 'string' || src.length > 3_000_000) return false;
  if (STORAGE_PREFIX && src.startsWith(STORAGE_PREFIX)) return true;
  return DEMO && /^(data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]|blob:)/.test(src);
}

// Paleta corta de colores (texto y resaltado)
export const TEXT_COLORS = [
  ['Gris', '#6b7280'], ['Rojo', '#dc2626'], ['Naranja', '#ea580c'], ['Ámbar', '#b45309'],
  ['Verde', '#16a34a'], ['Azul', '#2563eb'], ['Morado', '#7c3aed'], ['Rosa', '#db2777'],
];
export const HIGHLIGHTS = [
  ['Amarillo', '#fef08a'], ['Naranja', '#fed7aa'], ['Rojo', '#fecaca'], ['Verde', '#bbf7d0'],
  ['Azul', '#bfdbfe'], ['Morado', '#ddd6fe'], ['Rosa', '#fbcfe8'], ['Gris', '#e5e7eb'],
];

const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  'blockquote', 'horizontalRule', 'hardBreak', 'details', 'detailsSummary', 'detailsContent', 'codeBlock', 'image',
]);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle', 'highlight']);
const textColors = new Set(TEXT_COLORS.map(([, c]) => c));
const highlightColors = new Set(HIGHLIGHTS.map(([, c]) => c));
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// Limpia un documento que viene de la base de datos: solo nodos, marcas,
// colores y enlaces conocidos. Así nadie puede colar estilos o enlaces raros.
export function cleanDoc(doc) {
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return null;
  const walk = (node) => {
    if (!node || typeof node !== 'object' || !ALLOWED_NODES.has(node.type)) return null;
    const out = { type: node.type };
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text) return null;
      out.text = node.text;
    }
    if (node.type === 'image') {
      if (!isAllowedImage(node.attrs?.src)) return null;
      const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt.slice(0, 300) : null;
      return { type: 'image', attrs: { src: node.attrs.src, alt } };
    }
    if (node.attrs && typeof node.attrs === 'object') {
      const a = {};
      if (node.type === 'heading') a.level = [1, 2, 3].includes(node.attrs.level) ? node.attrs.level : 2;
      if (node.type === 'taskItem') a.checked = node.attrs.checked === true;
      if (node.type === 'orderedList' && Number.isInteger(node.attrs.start)) a.start = node.attrs.start;
      if (Object.keys(a).length) out.attrs = a;
    }
    if (Array.isArray(node.marks)) {
      const marks = [];
      for (const m of node.marks) {
        if (!m || !ALLOWED_MARKS.has(m.type)) continue;
        if (m.type === 'link') {
          const href = String(m.attrs?.href || '');
          if (SAFE_URL.test(href)) marks.push({ type: 'link', attrs: { href } });
        } else if (m.type === 'textStyle') {
          const color = m.attrs?.color;
          if (textColors.has(color)) marks.push({ type: 'textStyle', attrs: { color } });
        } else if (m.type === 'highlight') {
          const color = m.attrs?.color;
          // Sin color (o uno desconocido) → amarillo de la paleta, en vez de perder el resaltado
          marks.push({ type: 'highlight', attrs: { color: highlightColors.has(color) ? color : HIGHLIGHTS[0][1] } });
        } else {
          marks.push({ type: m.type });
        }
      }
      if (marks.length) out.marks = marks;
    }
    if (Array.isArray(node.content)) {
      const kids = node.content.map(walk).filter(Boolean);
      if (kids.length) out.content = kids;
    }
    return out;
  };
  return walk(doc);
}

// Texto plano → documento (cada línea, un párrafo)
export function textToDoc(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => (line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' })),
  };
}

const inlineText = (node) => {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(inlineText).join('');
};

// Documento → texto plano (para el buscador, el resumen y copiar)
export function docToText(doc) {
  const lines = [];
  const block = (node, prefix = '') => {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        lines.push(prefix + inlineText(node));
        break;
      case 'bulletList':
        (node.content || []).forEach((li) => (li.content || []).forEach((b, i) => block(b, i ? `${prefix}  ` : `${prefix}• `)));
        break;
      case 'orderedList':
        (node.content || []).forEach((li, n) => (li.content || []).forEach((b, i) => block(b, i ? `${prefix}   ` : `${prefix}${(node.attrs?.start || 1) + n}. `)));
        break;
      case 'taskList':
        (node.content || []).forEach((li) => (li.content || []).forEach((b, i) => block(b, i ? `${prefix}  ` : `${prefix}${li.attrs?.checked ? '☑' : '☐'} `)));
        break;
      case 'details':
        (node.content || []).forEach((part) => {
          if (part.type === 'detailsSummary') lines.push(`${prefix}▸ ${inlineText(part)}`);
          else (part.content || []).forEach((b) => block(b, `${prefix}  `));
        });
        break;
      case 'horizontalRule':
        lines.push(`${prefix}—`);
        break;
      default:
        (node.content || []).forEach((b) => block(b, prefix));
    }
  };
  (doc?.content || []).forEach((b) => block(b));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Vacío = sin texto y sin imágenes (una tarjeta con solo una foto no está vacía)
export function isEmptyDoc(doc) {
  if (!doc) return true;
  const hasImage = (n) => n?.type === 'image' || (n?.content || []).some(hasImage);
  return !docToText(doc) && !hasImage(doc);
}

// Resumen para la tarjeta cerrada: primeras líneas, casillas y secciones
export function summarize(doc, fallbackText = '') {
  if (!doc) return { lines: fallbackText ? fallbackText.split('\n').slice(0, 3) : [], tasks: null, sections: 0, image: null, images: 0, imageList: [] };
  let done = 0, total = 0, sections = 0, images = 0, image = null;
  const imageList = [];
  const count = (node) => {
    if (node.type === 'taskItem') { total++; if (node.attrs?.checked) done++; }
    if (node.type === 'details') sections++;
    if (node.type === 'image') { images++; if (!image) image = node.attrs; if (imageList.length < 50) imageList.push(node.attrs); }
    (node.content || []).forEach(count);
  };
  count(doc);
  const lines = [];
  for (const node of doc.content || []) {
    if (lines.length >= 3) break;
    if (node.type === 'details') {
      const summary = (node.content || []).find((p) => p.type === 'detailsSummary');
      lines.push(`▸ ${inlineText(summary) || 'Sección'}`);
    } else if (['bulletList', 'orderedList', 'taskList'].includes(node.type)) {
      for (const li of node.content || []) {
        if (lines.length >= 3) break;
        const mark = node.type === 'taskList' ? (li.attrs?.checked ? '☑ ' : '☐ ') : node.type === 'orderedList' ? '' : '• ';
        const t = inlineText((li.content || [])[0]);
        if (t) lines.push(mark + t);
      }
    } else {
      const t = inlineText(node).trim();
      if (t) lines.push(t);
    }
  }
  return { lines, tasks: total ? { done, total } : null, sections, image, images, imageList };
}

// Rutas de almacenamiento de las imágenes del texto (para borrarlas con la tarjeta)
export function imagePaths(doc) {
  const out = [];
  const walk = (n) => {
    if (n?.type === 'image' && STORAGE_PREFIX && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(STORAGE_PREFIX)) {
      out.push(decodeURIComponent(n.attrs.src.slice(STORAGE_PREFIX.length).split('?')[0]));
    }
    (n?.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}
