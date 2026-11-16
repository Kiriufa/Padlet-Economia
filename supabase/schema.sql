-- =====================================================================
--  Tablero de tareas (tipo Padlet) - Esquema completo para Supabase
--  Pega TODO este archivo en: Supabase > SQL Editor > New query > Run
--  Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

-- Perfil: el nombre que cada persona elige mostrar
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  avatar_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.boards (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null check (char_length(name) between 1 and 80),
  admin_pin_hash text not null,
  created_by     uuid not null default auth.uid() references auth.users on delete cascade,
  created_at     timestamptz not null default now()
);

create table if not exists public.members (
  board_id   uuid not null references public.boards on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  avatar_url text,
  is_admin   boolean not null default false,
  pin_fails  int not null default 0,
  joined_at  timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.cards (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards on delete cascade,
  status      text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  position    double precision not null default 0,
  title       text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  kind        text not null default 'text' check (kind in ('text', 'image', 'file', 'link', 'youtube')),
  url         text check (url is null or url ~* '^https?://'),
  file_path   text,
  file_name   text,
  file_size   bigint,
  color       text check (color in ('red', 'orange', 'green', 'blue', 'purple')),
  due_date    date,
  created_by  uuid not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (file_path is null or file_path like board_id::text || '/%')
);
create index if not exists cards_board_idx on public.cards (board_id);

create table if not exists public.card_assignees (
  card_id  uuid not null references public.cards on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  board_id uuid not null references public.boards on delete cascade,
  primary key (card_id, user_id)
);
create index if not exists card_assignees_board_idx on public.card_assignees (board_id);

-- ---------------------------------------------------------------------
-- Funciones auxiliares para las políticas
-- ---------------------------------------------------------------------

create or replace function public.is_member(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where board_id = b and user_id = auth.uid());
$$;

create or replace function public.is_admin(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where board_id = b and user_id = auth.uid() and is_admin);
$$;

-- Versión para Storage (la carpeta del archivo es el id del tablero, como texto)
create or replace function public.board_role(folder text)
returns text language sql stable security definer set search_path = '' as $$
  select case when m.is_admin then 'admin' else 'member' end
  from public.members m
  where m.board_id::text = folder and m.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.boards         enable row level security;
alter table public.members        enable row level security;
alter table public.cards          enable row level security;
alter table public.card_assignees enable row level security;

-- profiles: cada uno ve el suyo; se escribe con set_my_name()
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

-- boards: nadie la lee directamente (así el hash del PIN nunca sale).
-- Todo pasa por las funciones RPC de abajo.

-- members: los miembros ven a los demás miembros. Altas solo vía RPC.
drop policy if exists "members_select" on public.members;
create policy "members_select" on public.members
  for select to authenticated using (public.is_member(board_id));

-- cards
drop policy if exists "cards_select" on public.cards;
create policy "cards_select" on public.cards
  for select to authenticated using (public.is_member(board_id));

drop policy if exists "cards_insert" on public.cards;
create policy "cards_insert" on public.cards
  for insert to authenticated
  with check (public.is_member(board_id) and created_by = auth.uid());

-- Cualquier miembro del tablero puede editar y borrar cualquier tarjeta
drop policy if exists "cards_update" on public.cards;
create policy "cards_update" on public.cards
  for update to authenticated
  using (public.is_member(board_id))
  with check (public.is_member(board_id));

drop policy if exists "cards_delete" on public.cards;
create policy "cards_delete" on public.cards
  for delete to authenticated
  using (public.is_member(board_id));

-- card_assignees: cualquiera del tablero puede asignar y quitar a gente del tablero.
drop policy if exists "assignees_select" on public.card_assignees;
create policy "assignees_select" on public.card_assignees
  for select to authenticated using (public.is_member(board_id));

drop policy if exists "assignees_insert" on public.card_assignees;
create policy "assignees_insert" on public.card_assignees
  for insert to authenticated
  with check (
    public.is_member(board_id)
    and exists (select 1 from public.cards c where c.id = card_id and c.board_id = card_assignees.board_id)
    and exists (select 1 from public.members m where m.board_id = card_assignees.board_id and m.user_id = card_assignees.user_id)
  );

drop policy if exists "assignees_delete" on public.card_assignees;
create policy "assignees_delete" on public.card_assignees
  for delete to authenticated
  using (public.is_member(board_id));

-- Permisos de tabla (RLS decide qué filas). Los anónimos no tocan nada.
revoke all on public.profiles, public.boards, public.members, public.cards, public.card_assignees from anon;
revoke all on public.boards, public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant select on public.members to authenticated;
grant select, insert, update, delete on public.cards to authenticated;
grant select, insert, delete on public.card_assignees to authenticated;

-- ---------------------------------------------------------------------
-- Funciones RPC
-- ---------------------------------------------------------------------

-- Datos del usuario de Google (nombre y foto) desde su sesión
create or replace function public._my_profile(out p_name text, out p_avatar text)
language sql stable security definer set search_path = '' as $$
  select
    coalesce(
      (select name from public.profiles where id = auth.uid()),
      nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
      nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
      split_part(coalesce(auth.jwt() ->> 'email', 'Usuario'), '@', 1)
    ),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'avatar_url', auth.jwt() -> 'user_metadata' ->> 'picture');
$$;

-- Crear tablero: quien lo crea queda como admin
create or replace function public.create_board(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_code  text;
  v_board public.boards;
  v_prof  record;
  chars   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if coalesce(char_length(trim(p_name)), 0) = 0 then raise exception 'Falta el nombre del tablero'; end if;
  if coalesce(char_length(p_pin), 0) < 4 then raise exception 'El PIN debe tener al menos 4 caracteres'; end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.boards where code = v_code);
  end loop;

  insert into public.boards (code, name, admin_pin_hash, created_by)
  values (v_code, trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')), auth.uid())
  returning * into v_board;

  select * into v_prof from public._my_profile();
  insert into public.members (board_id, user_id, name, avatar_url, is_admin)
  values (v_board.id, auth.uid(), v_prof.p_name, v_prof.p_avatar, true);

  return json_build_object('id', v_board.id, 'code', v_board.code, 'name', v_board.name);
end $$;

-- Entrar a un tablero con su código
create or replace function public.join_board(p_code text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_board public.boards;
  v_prof  record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_board from public.boards where code = upper(trim(p_code));
  if not found then raise exception 'No existe ningún tablero con ese código'; end if;

  select * into v_prof from public._my_profile();
  insert into public.members (board_id, user_id, name, avatar_url)
  values (v_board.id, auth.uid(), v_prof.p_name, v_prof.p_avatar)
  on conflict (board_id, user_id) do update
    set name = excluded.name, avatar_url = excluded.avatar_url;

  return json_build_object('id', v_board.id, 'code', v_board.code, 'name', v_board.name);
end $$;

-- Hacerse admin con el PIN (se comprueba aquí, nunca en el navegador)
create or replace function public.claim_admin(p_board uuid, p_pin text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_fails int;
  v_ok    boolean;
begin
  select pin_fails into v_fails from public.members where board_id = p_board and user_id = auth.uid();
  if not found then raise exception 'No perteneces a este tablero'; end if;
  if v_fails >= 5 then raise exception 'Demasiados intentos fallidos'; end if;

  select admin_pin_hash = extensions.crypt(p_pin, admin_pin_hash) into v_ok
  from public.boards where id = p_board;

  if v_ok then
    update public.members set is_admin = true, pin_fails = 0 where board_id = p_board and user_id = auth.uid();
  else
    update public.members set pin_fails = pin_fails + 1 where board_id = p_board and user_id = auth.uid();
  end if;
  return coalesce(v_ok, false);
end $$;

-- Mover una tarjeta (cualquier miembro). Solo cambia columna y orden.
create or replace function public.move_card(p_card uuid, p_status text, p_position double precision)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('todo', 'doing', 'done') then raise exception 'Columna no válida'; end if;
  update public.cards set status = p_status, position = p_position, updated_at = now()
  where id = p_card and public.is_member(board_id);
  if not found then raise exception 'Tarjeta no encontrada'; end if;
end $$;

-- Elegir o cambiar el nombre que ven los demás (se actualiza en todos tus tableros)
create or replace function public.set_my_name(p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(p_name);
  v_avatar text := coalesce(auth.jwt() -> 'user_metadata' ->> 'avatar_url', auth.jwt() -> 'user_metadata' ->> 'picture');
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if coalesce(char_length(v_name), 0) not between 1 and 60 then raise exception 'El nombre debe tener entre 1 y 60 caracteres'; end if;
  insert into public.profiles (id, name, avatar_url) values (auth.uid(), v_name, v_avatar)
  on conflict (id) do update set name = excluded.name, avatar_url = excluded.avatar_url, updated_at = now();
  update public.members set name = v_name where user_id = auth.uid() and name is distinct from v_name;
end $$;

-- Mis tableros
create or replace function public.my_boards()
returns table (id uuid, code text, name text, is_admin boolean, cards bigint)
language sql stable security definer set search_path = '' as $$
  select b.id, b.code, b.name, m.is_admin,
         (select count(*) from public.cards c where c.board_id = b.id)
  from public.members m join public.boards b on b.id = m.board_id
  where m.user_id = auth.uid()
  order by m.joined_at desc;
$$;

-- Salir de un tablero (deja de aparecer en "Mis tableros")
create or replace function public.leave_board(p_board uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.card_assignees where board_id = p_board and user_id = auth.uid();
  delete from public.members where board_id = p_board and user_id = auth.uid();
$$;

-- Borrar el tablero entero (solo admin)
create or replace function public.delete_board(p_board uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(p_board) then raise exception 'Solo el admin puede borrar el tablero'; end if;
  delete from public.boards where id = p_board;
end $$;

revoke execute on function public.create_board(text, text), public.join_board(text),
  public.claim_admin(uuid, text), public.move_card(uuid, text, double precision),
  public.delete_board(uuid), public._my_profile(), public.set_my_name(text),
  public.my_boards(), public.leave_board(uuid) from public, anon;
revoke execute on function public._my_profile() from authenticated;
grant execute on function public.create_board(text, text), public.join_board(text),
  public.claim_admin(uuid, text), public.move_card(uuid, text, double precision),
  public.delete_board(uuid), public.set_my_name(text), public.my_boards(),
  public.leave_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Tiempo real
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['cards', 'card_assignees', 'members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Storage: bucket "uploads" (público para ver/descargar, 50 MB por archivo)
-- Rutas: <id_del_tablero>/<aleatorio>-<nombre>
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', true, 52428800, array[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'text/plain', 'text/csv'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "uploads_insert" on storage.objects;
create policy "uploads_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and public.board_role((storage.foldername(name))[1]) is not null);

drop policy if exists "uploads_delete" on storage.objects;
create policy "uploads_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and public.board_role((storage.foldername(name))[1]) is not null);

-- Para poder borrar, Storage necesita poder "ver" la fila
drop policy if exists "uploads_select" on storage.objects;
create policy "uploads_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and public.board_role((storage.foldername(name))[1]) is not null);
