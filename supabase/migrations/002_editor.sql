-- =====================================================================
--  Migración 002: texto con formato (editor), versiones y autor del cambio
--  Se puede ejecutar más de una vez. No borra nada.
-- =====================================================================

-- Contenido con formato (documento JSON del editor Tiptap)
alter table public.cards add column if not exists content jsonb;
-- Versión de la tarjeta: sube en cada cambio de contenido (para detectar ediciones a la vez)
alter table public.cards add column if not exists version integer not null default 1;
-- Quién hizo el último cambio de contenido (para el aviso "X ha cambiado esta tarea")
alter table public.cards add column if not exists updated_by uuid references auth.users on delete set null;

-- Límite de tamaño del contenido (~200 KB)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cards_content_size') then
    alter table public.cards add constraint cards_content_size
      check (content is null or (jsonb_typeof(content) = 'object' and pg_column_size(content) < 200000));
  end if;
end $$;

-- Convertir las descripciones que ya existen (cada línea, un párrafo)
update public.cards c
set content = jsonb_build_object('type', 'doc', 'content', coalesce((
  select jsonb_agg(
    case when t.line = '' then jsonb_build_object('type', 'paragraph')
         else jsonb_build_object('type', 'paragraph', 'content',
              jsonb_build_array(jsonb_build_object('type', 'text', 'text', t.line)))
    end order by t.ord)
  from regexp_split_to_table(c.description, E'\n') with ordinality as t(line, ord)
), '[]'::jsonb))
where c.content is null and coalesce(c.description, '') <> '';

-- Subir la versión cuando cambia el contenido de la tarjeta (no al moverla de columna)
create or replace function public.cards_bump_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.title is distinct from old.title
     or new.content is distinct from old.content
     or new.description is distinct from old.description
     or new.color is distinct from old.color
     or new.due_date is distinct from old.due_date
     or new.kind is distinct from old.kind
     or new.url is distinct from old.url
     or new.file_path is distinct from old.file_path then
    new.version := old.version + 1;
    new.updated_by := auth.uid();
    new.updated_at := now();
  else
    new.version := old.version;
  end if;
  return new;
end $$;

drop trigger if exists cards_bump_version on public.cards;
create trigger cards_bump_version before update on public.cards
  for each row execute function public.cards_bump_version();

-- La descripción pasa a ser un resumen en texto del contenido (puede ser más larga)
alter table public.cards drop constraint if exists cards_description_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cards_description_len') then
    alter table public.cards add constraint cards_description_len check (char_length(description) <= 20000);
  end if;
end $$;
