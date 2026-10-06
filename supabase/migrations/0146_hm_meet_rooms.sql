-- ============================================================
-- 0146_hm_meet_rooms.sql : 産業医面談ルーム(Google Meet 常設ルーム)
-- ============================================================
-- 事業所(企業)ごとに Google Meet の常設ルームを1つ用意し、
-- 健康管理Webにログインしている産業医事務所(office)と、その企業の
-- 事業者担当者(company)だけが「面談ルームに入る」から入室できるようにする。
-- 同じルームを繰り返し使うため、リンクは作り直さない限り変わらない。
--
--   * hm_meet_rooms   : 企業ごとのルーム(リンク・有効/無効・案内文)。登録・変更はofficeのみ
--   * hm_meet_entries : 健康管理Webからの入室記録(誰が・いつ)。RPC経由でのみ記録
--   * hm_meet_enter() : 権限を確かめて入室を記録し、ルームのリンクを返す
--
-- 方針: 追加のみ / hm_ 接頭辞 / 書き込みはRLSまたはSECURITY DEFINER RPC
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- ------------------------------------------------------------
-- 1. 面談ルーム
-- ------------------------------------------------------------
create table if not exists public.hm_meet_rooms (
  company_id uuid primary key references public.companies(id),
  enabled boolean not null default true,     -- false にすると企業側に表示されない
  meeting_uri text,                          -- https://meet.google.com/xxx-xxxx-xxx
  meeting_code text,                         -- xxx-xxxx-xxx
  space_name text,                           -- Meet REST API の spaces/{id}(APIで作成した場合のみ。在室表示に使う)
  note text,                                 -- 企業向けの案内文(例: 毎月第2火曜 14時〜は産業医が在室)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hm_meet_rooms enable row level security;

-- 閲覧: office=全社 / company=自社の有効なルームのみ
drop policy if exists hm_meet_rooms_select on public.hm_meet_rooms;
create policy hm_meet_rooms_select on public.hm_meet_rooms
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company'
        and company_id = public.hm_my_company()
        and enabled)
  );

-- 登録・変更: officeのみ
drop policy if exists hm_meet_rooms_insert on public.hm_meet_rooms;
create policy hm_meet_rooms_insert on public.hm_meet_rooms
  for insert with check (public.hm_is_office());

drop policy if exists hm_meet_rooms_update on public.hm_meet_rooms;
create policy hm_meet_rooms_update on public.hm_meet_rooms
  for update using (public.hm_is_office()) with check (public.hm_is_office());

-- 物理削除はしない(使わなくなったら enabled = false)
revoke delete on public.hm_meet_rooms from anon, authenticated;

drop trigger if exists hm_meet_rooms_set_updated_at on public.hm_meet_rooms;
create trigger hm_meet_rooms_set_updated_at
  before update on public.hm_meet_rooms
  for each row execute function public.hm_set_updated_at();

-- ------------------------------------------------------------
-- 2. 入室記録(削除・変更不可)
-- ------------------------------------------------------------
create table if not exists public.hm_meet_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null,
  user_name text,          -- 入室時点の氏名(後から氏名が変わっても記録は残す)
  role text not null,      -- office / company
  entered_at timestamptz not null default now()
);

create index if not exists hm_meet_entries_company_idx
  on public.hm_meet_entries (company_id, entered_at desc);

alter table public.hm_meet_entries enable row level security;

drop policy if exists hm_meet_entries_select on public.hm_meet_entries;
create policy hm_meet_entries_select on public.hm_meet_entries
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

-- 書き込みは hm_meet_enter() 経由のみ
revoke insert, update, delete on public.hm_meet_entries from anon, authenticated;

-- ------------------------------------------------------------
-- 3. 入室RPC: 権限確認 → 入室記録 → リンクを返す
-- ------------------------------------------------------------
create or replace function public.hm_meet_enter(p_company_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := public.hm_my_role();
  v_uri text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (v_role = 'office'
          or (v_role = 'company' and p_company_id = public.hm_my_company())) then
    raise exception 'permission denied';
  end if;

  select meeting_uri into v_uri
    from public.hm_meet_rooms
   where company_id = p_company_id and enabled and meeting_uri is not null;
  if v_uri is null then
    raise exception 'meet room not available';
  end if;

  insert into public.hm_meet_entries (company_id, user_id, user_name, role)
  select p_company_id, auth.uid(), p.full_name, v_role
    from public.profiles p
   where p.id = auth.uid();

  perform public.hm_log_access('meet_enter', 'hm_meet_rooms', p_company_id, null);
  return v_uri;
end;
$$;

revoke all on function public.hm_meet_enter(uuid) from public, anon;
grant execute on function public.hm_meet_enter(uuid) to authenticated;

-- ------------------------------------------------------------
-- 確認
-- ------------------------------------------------------------
select * from (
  values
    ('hm_meet_rooms',   (select case when to_regclass('public.hm_meet_rooms')   is not null then '✅OK' else '❌' end)),
    ('hm_meet_entries', (select case when to_regclass('public.hm_meet_entries') is not null then '✅OK' else '❌' end)),
    ('hm_meet_enter()', (select case when count(*) > 0 then '✅OK' else '❌' end
                           from pg_proc where proname = 'hm_meet_enter'))
) as t(内容, 状態);
