-- ============================================================
-- 0135_hm_csv_uploads.sql : 事業者担当者がCSVを「送る」→ 産業医事務所が列を指定して取り込む
-- ============================================================
-- 事業者担当者はCSVファイルをそのまま送るだけにし、どの列をどう取り込むかは
-- 産業医事務所(実施者)が取込画面で指定する。
--   ・hm_csv_uploads: 送られたCSV(内容は取込が終わったら消す)
--   ・hm_submit_csv_upload: 事業者担当者(または実施者)がCSVを送る
--   ・hm_csv_uploads_pending: 取込待ちの一覧(実施者のみ)
--   ・hm_csv_upload_get: 1件の内容を取り出す(実施者のみ)
--   ・hm_csv_upload_finish: 取込済み/破棄にして内容を消す(実施者のみ)
--   ・hm_csv_uploads_for_company: 自社の送信状況(事業者担当者・実施者)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create table if not exists public.hm_csv_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text not null,
  content text,                      -- CSVの中身(UTF-8)。取込・破棄の後は null
  row_count int not null default 0,  -- データ行数(見出しを除く)
  fiscal_year int,
  checkup_type text,
  round int not null default 1,
  special_kind text,
  note text,                         -- 事業者担当者からの連絡事項
  status text not null default 'pending'
    check (status in ('pending', 'imported', 'discarded')),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  finished_by uuid,
  batch_id uuid                      -- 取込後の取込ID(hm_checkups.import_batch_id)
);

alter table public.hm_csv_uploads enable row level security;

create index if not exists hm_csv_uploads_pending_idx
  on public.hm_csv_uploads (created_at desc) where status = 'pending';
create index if not exists hm_csv_uploads_company_idx
  on public.hm_csv_uploads (company_id, created_at desc);


-- ------------------------------------------------------------
-- CSVを送る(事業者担当者は自社のみ。閲覧のみの担当者は不可)
-- ------------------------------------------------------------
create or replace function public.hm_submit_csv_upload(
  p_company_id uuid,
  p_file_name text,
  p_content text,
  p_row_count int,
  p_fiscal_year int default null,
  p_checkup_type text default null,
  p_round int default 1,
  p_special_kind text default null,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.hm_company_can_write(p_company_id) then
    raise exception 'permission denied';
  end if;
  if coalesce(p_content, '') = '' then
    raise exception 'empty content';
  end if;
  if length(p_content) > 20 * 1024 * 1024 then
    raise exception 'file too large';
  end if;

  insert into public.hm_csv_uploads (
    company_id, file_name, content, row_count, fiscal_year, checkup_type, round,
    special_kind, note, uploaded_by
  ) values (
    p_company_id, coalesce(nullif(trim(p_file_name), ''), 'upload.csv'), p_content,
    coalesce(p_row_count, 0), p_fiscal_year, p_checkup_type,
    greatest(1, least(4, coalesce(p_round, 1))),
    nullif(trim(coalesce(p_special_kind, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
    auth.uid()
  ) returning id into v_id;

  perform public.hm_log_access(
    'csv_upload', 'hm_csv_uploads', v_id,
    jsonb_build_object('company_id', p_company_id, 'file_name', p_file_name, 'rows', p_row_count)
  );
  return v_id;
end;
$$;

grant execute on function public.hm_submit_csv_upload(uuid, text, text, int, int, text, int, text, text) to authenticated;


-- ------------------------------------------------------------
-- 取込待ちの一覧(実施者のみ。内容は含めない)
-- ------------------------------------------------------------
create or replace function public.hm_csv_uploads_pending()
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  file_name text,
  row_count int,
  fiscal_year int,
  checkup_type text,
  round int,
  special_kind text,
  note text,
  uploaded_by_name text,
  created_at timestamptz
)
language sql security definer
set search_path = public
as $$
  select u.id, u.company_id, c.name, u.file_name, u.row_count, u.fiscal_year,
         u.checkup_type, u.round, u.special_kind, u.note, p.name, u.created_at
    from public.hm_csv_uploads u
    join public.companies c on c.id = u.company_id
    left join public.profiles p on p.user_id = u.uploaded_by
   where public.hm_is_office() and u.status = 'pending'
   order by u.created_at;
$$;

grant execute on function public.hm_csv_uploads_pending() to authenticated;


-- ------------------------------------------------------------
-- 1件の内容(実施者のみ)
-- ------------------------------------------------------------
create or replace function public.hm_csv_upload_get(p_id uuid)
returns table (
  id uuid,
  company_id uuid,
  file_name text,
  content text,
  row_count int,
  fiscal_year int,
  checkup_type text,
  round int,
  special_kind text,
  note text,
  status text,
  created_at timestamptz
)
language sql security definer
set search_path = public
as $$
  select u.id, u.company_id, u.file_name, u.content, u.row_count, u.fiscal_year,
         u.checkup_type, u.round, u.special_kind, u.note, u.status, u.created_at
    from public.hm_csv_uploads u
   where public.hm_is_office() and u.id = p_id;
$$;

grant execute on function public.hm_csv_upload_get(uuid) to authenticated;


-- ------------------------------------------------------------
-- 取込済み / 破棄にして内容を消す(実施者のみ)
-- ------------------------------------------------------------
create or replace function public.hm_csv_upload_finish(
  p_id uuid,
  p_status text,
  p_batch uuid default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_status not in ('imported', 'discarded') then
    raise exception 'invalid status';
  end if;
  update public.hm_csv_uploads
     set status = p_status,
         content = null,
         finished_at = now(),
         finished_by = auth.uid(),
         batch_id = coalesce(p_batch, batch_id)
   where id = p_id;
  perform public.hm_log_access(
    'csv_upload_' || p_status, 'hm_csv_uploads', p_id,
    jsonb_build_object('batch_id', p_batch)
  );
end;
$$;

grant execute on function public.hm_csv_upload_finish(uuid, text, uuid) to authenticated;


-- ------------------------------------------------------------
-- 自社の送信状況(事業者担当者は自社のみ。実施者は全社)。内容は含めない
-- ------------------------------------------------------------
create or replace function public.hm_csv_uploads_for_company(p_company_id uuid)
returns table (
  id uuid,
  file_name text,
  row_count int,
  fiscal_year int,
  checkup_type text,
  round int,
  status text,
  created_at timestamptz,
  finished_at timestamptz
)
language sql security definer
set search_path = public
as $$
  select u.id, u.file_name, u.row_count, u.fiscal_year, u.checkup_type, u.round,
         u.status, u.created_at, u.finished_at
    from public.hm_csv_uploads u
   where u.company_id = p_company_id
     and (public.hm_is_office()
          or (public.hm_my_role() = 'company' and p_company_id = public.hm_my_company()))
   order by u.created_at desc
   limit 20;
$$;

grant execute on function public.hm_csv_uploads_for_company(uuid) to authenticated;

-- 確認用: true なら完了
-- select exists (
--   select 1 from information_schema.tables where table_name = 'hm_csv_uploads'
-- ) as "0135 完了";
