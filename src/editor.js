// Editor de texto con formato (Tiptap 3, sin React).
// Se carga solo al abrir una tarjeta (import dinámico), así el tablero sigue siendo ligero.

import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Placeholder } from '@tiptap/extensions';
import Suggestion from '@tiptap/suggestion';
import Image from '@tiptap/extension-image';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import DOMPurify from 'dompurify';
import { TEXT_COLORS, HIGHLIGHTS, isAllowedImage } from './richtext.js';
import { el, toast } from './ui.js';
import { DEMO } from './supabase.js';
import { prepareImage, IMAGE_ACCEPT, isHeic } from './images.js';
import { normalizeUrl } from './utils.js';

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

const svg = (path, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const I = {
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: svg('<path d="M19 4h-9M14 20H5M15 4 9 20"/>'),
  underline: svg('<path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 21h16"/>'),
  strike: svg('<path d="M16 6.5C15 5 13.6 4.5 12 4.5c-2.5 0-4 1.3-4 3.2 0 1.6 1 2.5 3 3.1"/><path d="M4 12h16"/><path d="M8 17c1 1.7 2.5 2.5 4.3 2.5 2.6 0 4.2-1.4 4.2-3.3 0-.8-.2-1.4-.6-2"/>'),
  bigger: svg('<path d="M4 18 9 6l5 12M5.6 14h6.8"/><path d="M18 4v6M15 7h6"/>'),
  smaller: svg('<path d="M4 18 9 6l5 12M5.6 14h6.8"/><path d="M15 7h6"/>'),
  color: svg('<path d="m5 17 5.5-13h3L19 17M7.3 12h9.4"/>'),
  bullet: svg('<circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><path d="M10 7h10M10 12h10M10 17h10"/>'),
  ordered: svg('<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 5.5 5.5 5v4M4 9h3M4 14.5c.5-.7 2.5-.8 2.5.4 0 1-2.5 1.6-2.5 3.1h2.6" stroke-width="1.6"/>'),
  task: svg('<rect x="3.5" y="5" width="6" height="6" rx="1.5"/><path d="m4.8 8 1.3 1.3L8.4 6.8"/><rect x="3.5" y="14" width="6" height="6" rx="1.5"/><path d="M13 8h8M13 17h8"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  details: svg('<path d="m6 9 3 3-3 3"/><path d="M12 12h8"/><path d="M12 18h8" opacity=".5"/><path d="M12 6h8"/>'),
  slash: svg('<path d="M15 4 9 20"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5L6 20"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
};

const STYLES = [
  ['Texto normal', 'p'],
  ['Título', 1],
  ['Subtítulo', 2],
];

// Bloques del menú "/"
const BLOCKS = [
  { title: 'Texto', hint: 'Párrafo normal', keys: 'texto parrafo normal', run: (c) => c.setParagraph() },
  { title: 'Título', hint: 'Letra grande', keys: 'titulo encabezado h1', run: (c) => c.setHeading({ level: 1 }) },
  { title: 'Subtítulo', hint: 'Letra mediana', keys: 'subtitulo h2', run: (c) => c.setHeading({ level: 2 }) },
  { title: 'Lista', hint: 'Con viñetas', keys: 'lista viñetas puntos', run: (c) => c.toggleBulletList() },
  { title: 'Lista numerada', hint: '1, 2, 3…', keys: 'numerada numeros ordenada', run: (c) => c.toggleOrderedList() },
  { title: 'Casillas', hint: 'Lista de tareas', keys: 'casillas checklist tareas check', run: (c) => c.toggleTaskList() },
  { title: 'Desplegable', hint: 'Sección que se abre y se cierra', keys: 'desplegable seccion toggle details', run: (c) => c.setDetails() },
  { title: 'Imagen', hint: 'Subir una foto o captura', keys: 'imagen foto picture image captura', run: (c) => { window.dispatchEvent(new CustomEvent('rt-pick-image')); return c; } }, // el selector se abre en el mismo toque (Safari lo exige)
  { title: 'Cita', hint: 'Texto destacado', keys: 'cita quote', run: (c) => c.toggleBlockquote() },
  { title: 'Separador', hint: 'Línea horizontal', keys: 'separador linea', run: (c) => c.setHorizontalRule() },
];
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Menú "/" (con @tiptap/suggestion)
function slashMenu(layer) {
  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        items: ({ query }) => BLOCKS.filter((b) => !query || norm(b.title).includes(norm(query)) || norm(b.keys).includes(norm(query))),
        command: ({ editor, range, props }) => props.run(editor.chain().focus().deleteRange(range)).run(),
        render: () => {
          let menu, items = [], selected = 0, command;
          const draw = () => {
            menu.replaceChildren(...(items.length ? items.map((b, i) => el('button', {
              class: `slash-item${i === selected ? ' on' : ''}`, type: 'button',
              onmousedown: (e) => e.preventDefault(),
              onclick: () => command(b),
            }, el('strong', { text: b.title }), el('span', { text: b.hint }))) : [el('p', { class: 'slash-empty', text: 'Nada con ese nombre' })]));
          };
          const place = (rect) => {
            if (!rect) return;
            const lr = layer.getBoundingClientRect();
            const w = Math.min(280, lr.width - 16);
            menu.style.width = `${w}px`;
            menu.style.left = `${Math.max(8, Math.min(rect.left - lr.left, lr.width - w - 8))}px`;
            const below = rect.bottom - lr.top + 6;
            const fitsBelow = below + 300 < lr.height;
            menu.style.top = fitsBelow ? `${below}px` : '';
            menu.style.bottom = fitsBelow ? '' : `${lr.bottom - rect.top + 6}px`;
          };
          return {
            onStart(props) {
              items = props.items; command = props.command; selected = 0;
              menu = el('div', { class: 'slash-menu', role: 'listbox', 'aria-label': 'Insertar bloque' });
              layer.append(menu);
              draw(); place(props.clientRect?.());
            },
            onUpdate(props) {
              items = props.items; command = props.command; selected = 0;
              draw(); place(props.clientRect?.());
            },
            onKeyDown({ event }) {
              if (event.key === 'ArrowDown') { selected = (selected + 1) % Math.max(1, items.length); draw(); return true; }
              if (event.key === 'ArrowUp') { selected = (selected - 1 + items.length) % Math.max(1, items.length); draw(); return true; }
              if (event.key === 'Enter') { if (items[selected]) command(items[selected]); return true; }
              if (event.key === 'Escape') { event.preventDefault(); menu?.remove(); return true; }
              return false;
            },
            onExit() { menu?.remove(); },
          };
        },
      })];
    },
  });
}

// Ctrl/Cmd+K para enlaces
const LinkShortcut = (openLink) => Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts() { return { 'Mod-k': () => { openLink(); return true; } }; },
});

/**
 * Crea el editor dentro de `element` y su barra de herramientas en `toolbar`.
 * `layer` es el contenedor donde se pintan los menús flotantes (dentro del panel).
 */
export function createRichEditor({ element, toolbar, layer, content, onChange, uploadImage }) {
  let editor;

  // ---- Imágenes dentro del texto ----
  const insertImages = async (files, pos = null) => {
    const images = [...files].filter((f) => /^image\//.test(f.type) || isHeic(f));
    if (!images.length || !uploadImage) return false;
    // Con el cursor en el título de una sección desplegable, la imagen va dentro de la sección (y se abre)
    if (pos == null) {
      const $from = editor.state.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name !== 'detailsSummary') continue;
        const detailsPos = $from.before(d - 1);
        $from.node(d - 1).forEach((child, off) => {
          if (child.type.name !== 'detailsContent') return;
          const start = detailsPos + 1 + off + 1;
          // Sección vacía (solo un párrafo vacío): la imagen ocupa su lugar
          const only = child.childCount === 1 && child.firstChild.type.name === 'paragraph' && !child.firstChild.content.size;
          pos = only ? { from: start, to: start + child.firstChild.nodeSize } : start + child.content.size;
        });
        const dom = editor.view.nodeDOM(detailsPos);
        if (dom && !dom.classList.contains('is-open')) dom.querySelector(':scope > button')?.click();
        break;
      }
    }
    for (const file of images) {
      // HEIC → JPG, fotos grandes reducidas, y comprobar que no está dañada
      let ready;
      try { ready = await prepareImage(file); } catch (e) { toast(e.message); continue; }
      toast('Subiendo imagen…');
      try {
        const src = await uploadImage(ready);
        if (!isAllowedImage(src)) throw new Error('No se pudo subir la imagen');
        const node = { type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') } };
        if (pos != null) { editor.chain().focus().insertContentAt(pos, node).run(); pos = null; }
        else editor.chain().focus().insertContent(node).run();
        // Que la imagen no quede seleccionada (lo siguiente la sustituiría): cursor justo debajo
        if (editor.state.selection instanceof NodeSelection) {
          const after = editor.state.selection.to;
          const next = editor.state.doc.resolve(after).nodeAfter;
          if (next?.isTextblock) editor.commands.setTextSelection(after + 1);
          else editor.commands.createParagraphNear();
        }
        toast('Imagen añadida');
      } catch (e) {
        toast(e.message || 'No se pudo subir la imagen');
      }
    }
    return true;
  };
  const pickImage = () => {
    const input = el('input', { type: 'file', accept: IMAGE_ACCEPT, multiple: true, hidden: true });
    input.onchange = () => { insertImages(input.files); input.remove(); };
    document.body.append(input);
    input.click();
  };
  const onPickRequest = () => pickImage();
  window.addEventListener('rt-pick-image', onPickRequest);

  // ---- Mover el bloque actual (párrafo, imagen, lista…) arriba o abajo ----
  const moveBlock = (dir) => {
    const { state, view } = editor;
    const sel = state.selection;
    let start, node;
    if (sel instanceof NodeSelection && sel.$from.depth === 0) { start = sel.from; node = sel.node; }
    else if (sel.$from.depth >= 1) { start = sel.$from.before(1); node = sel.$from.node(1); }
    else return false;
    const end = start + node.nodeSize;
    const index = state.doc.resolve(start).index(0);
    const sibling = state.doc.maybeChild(index + dir);
    if (!sibling) return false;
    const offset = sel.from - start;
    let tr = state.tr, newStart;
    if (dir < 0) { newStart = start - sibling.nodeSize; tr = tr.delete(start, end).insert(newStart, node); }
    else { tr = tr.insert(end + sibling.nodeSize, node).delete(start, end); newStart = start + sibling.nodeSize; }
    try {
      tr = tr.setSelection(sel instanceof NodeSelection ? NodeSelection.create(tr.doc, newStart) : TextSelection.create(tr.doc, newStart + offset));
    } catch { /* deja la selección por defecto */ }
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return true;
  };
  const buttons = [];
  let openPop = null;

  const closePop = () => { openPop?.remove(); openPop = null; };
  const popover = (anchor, ...children) => {
    closePop();
    const lr = layer.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const pop = el('div', { class: 'tb-pop', onmousedown: (e) => { if (!e.target.closest('input')) e.preventDefault(); } }, ...children);
    pop.style.top = `${r.bottom - lr.top + 6}px`;
    layer.append(pop);
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(r.left - lr.left, lr.width - w - 8))}px`;
    openPop = pop;
    return pop;
  };
  const onDocDown = (e) => { if (openPop && !openPop.contains(e.target) && !e.target.closest('.tb-btn')) closePop(); };
  document.addEventListener('pointerdown', onDocDown, true);

  const btn = (icon, label, run, isActive, extra = {}) => {
    const b = el('button', {
      class: 'tb-btn', type: 'button', title: label, 'aria-label': label, html: icon,
      // No robar el foco al editor (el teclado del iPad no se cierra)
      onmousedown: (e) => e.preventDefault(),
      onclick: (e) => run(e.currentTarget),
      ...extra,
    });
    buttons.push({ b, isActive });
    return b;
  };
  const sep = () => el('span', { class: 'tb-sep', 'aria-hidden': 'true' });
  const chain = () => editor.chain().focus();

  // Estilo de texto: Normal / Título / Subtítulo
  const styleBtn = el('button', { class: 'tb-btn tb-style', type: 'button', title: 'Tamaño del texto', onmousedown: (e) => e.preventDefault() }, 'Texto normal');
  styleBtn.onclick = () => {
    if (openPop) return closePop();
    popover(styleBtn, ...STYLES.map(([label, level]) => el('button', {
      class: `pop-opt style-${level}`, type: 'button', text: label,
      onclick: () => { (level === 'p' ? chain().setParagraph() : chain().setHeading({ level })).run(); closePop(); },
    })));
  };
  const currentLevel = () => (editor.isActive('heading', { level: 1 }) ? 1 : editor.isActive('heading', { level: 2 }) ? 2 : editor.isActive('heading', { level: 3 }) ? 3 : 0);
  const bigger = () => { const l = currentLevel(); if (l === 0 || l === 3) chain().setHeading({ level: 2 }).run(); else if (l === 2) chain().setHeading({ level: 1 }).run(); };
  const smaller = () => { const l = currentLevel(); if (l === 1) chain().setHeading({ level: 2 }).run(); else if (l) chain().setParagraph().run(); };

  // Colores
  const colorBtn = btn(I.color, 'Color y resaltado', (anchor) => {
    if (openPop) return closePop();
    const swatch = (name, value, kind) => el('button', {
      class: `pop-swatch ${kind}`, type: 'button', title: name, 'aria-label': `${kind === 'text' ? 'Texto' : 'Resaltado'} ${name}`,
      style: kind === 'text' ? `color:${value}` : `background:${value}`,
      text: kind === 'text' ? 'A' : '',
      onclick: () => {
        if (kind === 'text') chain().setColor(value).run();
        else chain().setHighlight({ color: value }).run();
        closePop();
      },
    });
    popover(anchor,
      el('p', { class: 'pop-label', text: 'Color del texto' }),
      el('div', { class: 'pop-grid' }, ...TEXT_COLORS.map(([n, v]) => swatch(n, v, 'text'))),
      el('p', { class: 'pop-label', text: 'Resaltado' }),
      el('div', { class: 'pop-grid' }, ...HIGHLIGHTS.map(([n, v]) => swatch(n, v, 'mark'))),
      el('button', { class: 'pop-opt', type: 'button', text: 'Quitar colores', onclick: () => { chain().unsetColor().unsetHighlight().run(); closePop(); } }));
  }, () => editor.isActive('textStyle') || editor.isActive('highlight'));

  // Enlaces
  const openLink = (anchor = linkBtn) => {
    const current = editor.getAttributes('link').href || '';
    const input = el('input', { class: 'input', type: 'text', inputmode: 'url', placeholder: 'https://…', value: current, 'aria-label': 'Dirección del enlace', autocapitalize: 'off' });
    const apply = () => {
      const href = normalizeUrl(input.value);
      if (!input.value.trim()) chain().extendMarkRange('link').unsetLink().run();
      else if (href && SAFE_URL.test(href)) {
        if (editor.state.selection.empty && !editor.isActive('link')) {
          chain().insertContent({ type: 'text', text: input.value.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
        } else chain().extendMarkRange('link').setLink({ href }).run();
      } else { input.setCustomValidity('Enlace no válido'); input.reportValidity(); return; }
      closePop();
    };
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') { e.preventDefault(); closePop(); editor.commands.focus(); } });
    popover(anchor,
      el('p', { class: 'pop-label', text: 'Enlace' }),
      input,
      el('div', { class: 'pop-row' },
        el('button', { class: 'btn primary small', type: 'button', text: 'Guardar', onclick: apply }),
        current && el('a', { class: 'btn small', href: current, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir' }),
        current && el('button', { class: 'btn ghost small', type: 'button', text: 'Quitar', onclick: () => { chain().extendMarkRange('link').unsetLink().run(); closePop(); } })));
    setTimeout(() => input.focus(), 0);
  };
  const linkBtn = btn(I.link, 'Enlace (Ctrl+K)', (a) => (openPop ? closePop() : openLink(a)), () => editor.isActive('link'));

  toolbar.replaceChildren(
    btn(I.undo, 'Deshacer (Ctrl+Z)', () => chain().undo().run(), null, { 'data-cmd': 'undo' }),
    btn(I.redo, 'Rehacer (Ctrl+Mayús+Z)', () => chain().redo().run(), null, { 'data-cmd': 'redo' }),
    sep(),
    styleBtn,
    btn(I.bigger, 'Letra más grande', bigger),
    btn(I.smaller, 'Letra más pequeña', smaller),
    sep(),
    btn(I.bold, 'Negrita (Ctrl+B)', () => chain().toggleBold().run(), () => editor.isActive('bold')),
    btn(I.italic, 'Cursiva (Ctrl+I)', () => chain().toggleItalic().run(), () => editor.isActive('italic')),
    btn(I.underline, 'Subrayado (Ctrl+U)', () => chain().toggleUnderline().run(), () => editor.isActive('underline')),
    btn(I.strike, 'Tachado (Ctrl+Mayús+S)', () => chain().toggleStrike().run(), () => editor.isActive('strike')),
    colorBtn,
    sep(),
    btn(I.bullet, 'Lista con viñetas', () => chain().toggleBulletList().run(), () => editor.isActive('bulletList')),
    btn(I.ordered, 'Lista numerada', () => chain().toggleOrderedList().run(), () => editor.isActive('orderedList')),
    btn(I.task, 'Casillas', () => chain().toggleTaskList().run(), () => editor.isActive('taskList')),
    linkBtn,
    btn(I.image, 'Imagen (también puedes pegarla o arrastrarla)', pickImage),
    btn(I.details, 'Sección desplegable', () => chain().setDetails().run(), () => editor.isActive('details')),
    sep(),
    btn(I.up, 'Subir bloque (Alt+↑)', () => moveBlock(-1)),
    btn(I.down, 'Bajar bloque (Alt+↓)', () => moveBlock(1)),
    sep(),
    btn(I.slash, 'Insertar bloque (escribe /)', () => chain().insertContent('/').run()),
  );

  // Si la barra no cabe, se difumina el borde para que se note que hay más botones
  const fade = () => {
    const more = toolbar.scrollWidth - toolbar.clientWidth - toolbar.scrollLeft > 4;
    toolbar.classList.toggle('more-right', more);
    toolbar.classList.toggle('more-left', toolbar.scrollLeft > 4);
  };
  toolbar.addEventListener('scroll', fade, { passive: true });
  const ro = new ResizeObserver(fade);
  ro.observe(toolbar);

  const refresh = () => {
    for (const { b, isActive } of buttons) if (isActive) b.classList.toggle('on', Boolean(isActive()));
    const l = currentLevel();
    styleBtn.textContent = l === 1 ? 'Título' : l === 2 ? 'Subtítulo' : l === 3 ? 'Subtítulo' : 'Texto normal';
    toolbar.querySelector('[data-cmd=undo]').disabled = !editor.can().undo();
    toolbar.querySelector('[data-cmd=redo]').disabled = !editor.can().redo();
  };

  editor = new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        code: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: 'https',
          protocols: ['http', 'https', 'mailto'],
          // Acepta también "www.ine.es" (se le pone https:// al crear el enlace)
          isAllowedUri: (url, { defaultValidate }) => SAFE_URL.test(url) || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url) && defaultValidate(`https://${url}`)),
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
      TextStyle,
      Color,
      // Ctrl/Cmd+Mayús+H resalta en el amarillo de la paleta
      Highlight.extend({
        addKeyboardShortcuts() { return { 'Mod-Shift-h': () => this.editor.commands.toggleHighlight({ color: HIGHLIGHTS[0][1] }) }; },
      }).configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Details.configure({ persist: false, HTMLAttributes: { class: 'rt-details' } }),
      DetailsSummary,
      DetailsContent,
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) => {
          if (node.type.name === 'detailsSummary') return 'Título de la sección';
          if (node.type.name === 'heading') return 'Título';
          return 'Escribe aquí… (pulsa / para insertar listas, casillas o secciones)';
        },
      }),
      slashMenu(layer),
      LinkShortcut(() => openLink()),
      Image.configure({ inline: false, allowBase64: DEMO, HTMLAttributes: { class: 'rt-img', loading: 'lazy' } }),
      Extension.create({
        name: 'moveBlocks',
        addKeyboardShortcuts() { return { 'Alt-ArrowUp': () => moveBlock(-1), 'Alt-ArrowDown': () => moveBlock(1) }; },
      }),
    ],
    editorProps: {
      attributes: { class: 'rt-content', 'aria-label': 'Descripción de la tarea', spellcheck: 'true' },
      // Todo lo que se pega desde otras webs pasa por DOMPurify
      transformPastedHTML: (html) => DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'img', 'video', 'audio', 'svg', 'math'],
        FORBID_ATTR: ['style', 'class', 'id'],
      }),
      // Pegar o soltar imágenes (capturas, fotos del iPad…) las sube y las mete en el texto
      handlePaste: (view, event) => {
        const files = event.clipboardData?.files;
        if (files?.length && [...files].some((f) => /^image\//.test(f.type) || isHeic(f))) { insertImages(files); return true; }
        return false;
      },
      handleDrop: (view, event, slice, moved) => {
        const files = event.dataTransfer?.files;
        if (moved || !files?.length || ![...files].some((f) => /^image\//.test(f.type) || isHeic(f))) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        insertImages(files, pos);
        return true;
      },
      // Ctrl/Cmd + clic abre el enlace
      handleClick: (view, pos, event) => {
        const a = event.target.closest?.('a[href]');
        if (a && (event.metaKey || event.ctrlKey) && SAFE_URL.test(a.getAttribute('href'))) {
          window.open(a.getAttribute('href'), '_blank', 'noopener');
          return true;
        }
        return false;
      },
    },
    onUpdate: () => onChange?.(),
    onSelectionUpdate: refresh,
    onTransaction: refresh,
  });
  refresh();

  return {
    editor,
    getJSON: () => editor.getJSON(),
    // Lo que llega de fuera no entra en el historial (Ctrl+Z no vuelve a la versión anterior)
    setContent: (doc) => editor.chain().setMeta('addToHistory', false).setContent(doc, { emitUpdate: false }).run(),
    // El foco pasa al editor al instante (Tiptap lo haría en el siguiente fotograma
    // y las letras escritas muy rápido acabarían en el título)
    focus: (pos = 'start') => { editor.view.dom.focus({ preventScroll: true }); editor.commands.focus(pos); },
    // Cierra el menú de la barra que esté abierto (colores, tamaño, enlace). Devuelve si había alguno.
    closeMenus: () => { const had = Boolean(openPop); closePop(); return had; },
    destroy: () => { window.removeEventListener('rt-pick-image', onPickRequest); ro.disconnect(); closePop(); document.removeEventListener('pointerdown', onDocDown, true); editor.destroy(); },
  };
}
