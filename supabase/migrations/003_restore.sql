-- Deshacer: volver a poner una tarjeta borrada (con su autor y sus encargados).
-- Se puede ejecutar más de una vez.

create or replace function public.restore_card(p_card jsonb, p_assignees uuid[] default '{}')
returns public.cards language plpgsql security definer set search_path = '' as $$
declare
  v public.cards;
  v_board uuid := (p_card ->> 'board_id')::uuid;
begin
  if auth.uid() is null or v_board is null or not public.is_member(v_board) then
    raise exception 'No tienes acceso a este tablero';
  end if;
  v := jsonb_populate_record(null::public.cards, p_card);
  if v.id is null then raise exception 'Tarjeta no válida'; end if;
  if exists (select 1 from public.cards where id = v.id) then
    select * into v from public.cards where id = v.id;
    return v; -- ya estaba (p. ej. otra persona la recuperó antes)
  end if;
  -- Se conserva el autor si sigue existiendo
  if v.created_by is null or not exists (select 1 from auth.users where id = v.created_by) then
    v.created_by := auth.uid();
  end if;
  v.updated_by := auth.uid();
  v.updated_at := now();
  v.version := coalesce(v.version, 1);
  v.created_at := coalesce(v.created_at, now());
  insert into public.cards select v.*;
  insert into public.card_assignees (card_id, user_id, board_id)
    select v.id, m.user_id, v_board from public.members m
    where m.board_id = v_board and m.user_id = any (coalesce(p_assignees, '{}'))
  on conflict do nothing;
  return v;
end $$;

revoke execute on function public.restore_card(jsonb, uuid[]) from public, anon;
grant execute on function public.restore_card(jsonb, uuid[]) to authenticated;
