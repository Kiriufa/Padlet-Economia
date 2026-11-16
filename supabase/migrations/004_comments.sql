-- Comentarios en las tareas (se ven y se escriben desde la vista grande).
-- No van atados con "on delete cascade" a la tarjeta: si alguien la borra y luego
-- pulsa "Deshacer", sus comentarios vuelven con ella. Se borran con el tablero.
-- Se puede ejecutar más de una vez.

create table if not exists public.card_comments (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null,
  board_id   uuid not null references public.boards on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists card_comments_board_idx on public.card_comments (board_id);
create index if not exists card_comments_card_idx on public.card_comments (card_id);

alter table public.card_comments enable row level security;

drop policy if exists "comments_select" on public.card_comments;
create policy "comments_select" on public.card_comments
  for select to authenticated using (public.is_member(board_id));

-- Solo en tu nombre, en un tablero tuyo y en una tarjeta que exista en ese tablero
drop policy if exists "comments_insert" on public.card_comments;
create policy "comments_insert" on public.card_comments
  for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_member(board_id)
    and exists (select 1 from public.cards c where c.id = card_id and c.board_id = card_comments.board_id)
  );

-- Cada uno borra sus comentarios
drop policy if exists "comments_delete" on public.card_comments;
create policy "comments_delete" on public.card_comments
  for delete to authenticated using (user_id = auth.uid() and public.is_member(board_id));

revoke all on public.card_comments from anon;
grant select, insert, delete on public.card_comments to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card_comments') then
    alter publication supabase_realtime add table public.card_comments;
  end if;
end $$;
