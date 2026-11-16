export const STATUSES = [
  ['todo', 'Por hacer'],
  ['doing', 'En proceso'],
  ['done', 'Hecho'],
];

export const COLORS = {
  red: '#ef4444',
  orange: '#f59e0b',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
};

// Nombres en castellano de las etiquetas de color (el valor guardado sigue siendo red, orange…)
export const COLOR_NAMES = { red: 'Rojo', orange: 'Naranja', green: 'Verde', blue: 'Azul', purple: 'Morado' };

export const MAX_FILE_MB = 50;
export const MAX_FILE = MAX_FILE_MB * 1024 * 1024;

// Extensión -> tipo MIME. Debe coincidir con allowed_mime_types del bucket.
export const IMAGE_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};
export const FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
  txt: 'text/plain',
  csv: 'text/csv',
  ...IMAGE_TYPES,
};

export const extOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function normalizeUrl(value) {
  const v = value.trim();
  if (!v) return '';
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes('.') ? u.href : '';
  } catch {
    return '';
  }
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function youtubeId(url) {
  try {
    const u = new URL(normalizeUrl(url));
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
      else id = u.pathname.split('/')[2] || ''; // /embed/ID, /shorts/ID, /live/ID
    }
    id = id.split(/[/?&]/)[0];
    return /^[\w-]{11}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

export function initials(name = '?') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export function colorFor(id = '') {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 60% 48%)`;
}

const today = () => new Date().toISOString().slice(0, 10);
export const isOverdue = (due, status) => Boolean(due) && status !== 'done' && due < today();

export function formatDate(due) {
  const [y, m, d] = due.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
