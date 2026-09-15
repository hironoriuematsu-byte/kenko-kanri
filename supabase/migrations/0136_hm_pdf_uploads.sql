-- ============================================================
-- 0136_hm_pdf_uploads.sql : 事業者担当者が健診結果のPDFも送れるようにする
-- ============================================================
-- CSVと同じ「送る → 産業医事務所が処理する」流れで、PDFも送れるようにする。
--   ・PDFの中身は既存の非公開バケット hm-files に
--     <company_id>/checkup-uploads/<id>.pdf として保存する(0101 の企業別ポリシーで保護)
--   ・hm_csv_uploads に kind('csv' / 'pdf')・storage_path・file_size を追加
--   ・hm_submit_file_upload: PDFの記録を作る(ファイル本体はブラウザから直接保存)
--   ・hm_csv_uploads_pending / hm_csv_uploads_for_company: kind などを返すよう作り直す
--   産業医事務所はダッシュボードからPDFをダウンロードし、CSVに変換して取込画面から取り込む。
--   ・送られたCSV・PDFの原本は「取込済み」の後も保管し、「破棄」または実施者の削除で消す
--     (hm_csv_upload_finish を作り直し、hm_csv_uploads_archived / hm_csv_upload_purge を追加)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_csv_uploads
  add column if not exists kind text not null default 'csv';
alter table public.hm_csv_uploads
  drop constraint if exists hm_csv_uploads_kind_check;
alter table public.hm_csv_uploads
  add constraint hm_csv_uploads_kind_check check (kind in ('csv', 'pdf'));
alter table public.hm_csv_uploads
  add column if not exists storage_path text;
alter table public.hm_csv_uploads
  add column if not exists file_size bigint;


-- ------------------------------------------------------------
-- PDFの記録を作る(事業者担当者は自社のみ。閲覧のみの担当者は不可)
--   ファイル本体は先にブラウザから hm-files に保存し、そのパスを渡す
-- ------------------------------------------------------------
create or replace function public.hm_submit_file_upload(
  p_id uuid,
  p_company_id uuid,
  p_kind text,
  p_file_name text,
  p_storage_path text,
  p_file_size bigint,
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
begin
  if not public.hm_company_can_write(p_company_id) then
    raise exception 'permission denied';
  end if;
  if p_kind <> 'pdf' then
    raise exception 'invalid kind';
  end if;
  -- 保存先は必ずその企業のフォルダの中
  if p_storage_path is null
     or position(p_company_id::text || '/checkup-uploads/' in p_storage_path) <> 1 then
    raise exception 'invalid storage path';
  end if;

  insert into public.hm_csv_uploads (
    id, company_id, kind, file_name, storage_path, file_size, content, row_count,
    fiscal_year, checkup_type, round, special_kind, note, uploaded_by
  ) values (
    coalesce(p_id, gen_random_uuid()), p_company_id, 'pdf',
    coalesce(nullif(trim(p_file_name), ''), 'upload.pdf'), p_storage_path, p_file_size, null, 0,
    p_fiscal_year, p_checkup_type, greatest(1, least(4, coalesce(p_round, 1))),
    nullif(trim(coalesce(p_special_kind, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
    auth.uid()
  );

  perform public.hm_log_access(
    'pdf_upload', 'hm_csv_uploads', p_id,
    jsonb_build_object('company_id', p_company_id, 'file_name', p_file_name, 'size', p_file_size)
  );
  return p_id;
end;
$$;

grant execute on function public.hm_submit_file_upload(uuid, uuid, text, text, text, bigint, int, text, int, text, text) to authenticated;


-- ------------------------------------------------------------
-- 取込待ちの一覧(実施者のみ)。kind・保存先・サイズを追加(戻り値が変わるため作り直す)
-- ------------------------------------------------------------
drop function if exists public.hm_csv_uploads_pending();

create function public.hm_csv_uploads_pending()
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  kind text,
  file_name text,
  storage_path text,
  file_size bigint,
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
  select u.id, u.company_id, c.name, u.kind, u.file_name, u.storage_path, u.file_size,
         u.row_count, u.fiscal_year, u.checkup_type, u.round, u.special_kind, u.note,
         p.name, u.created_at
    from public.hm_csv_uploads u
    join public.companies c on c.id = u.company_id
    left join public.profiles p on p.user_id = u.uploaded_by
   where public.hm_is_office() and u.status = 'pending'
   order by u.created_at;
$$;

grant execute on function public.hm_csv_uploads_pending() to authenticated;


-- ------------------------------------------------------------
-- 自社の送信状況(事業者担当者は自社のみ。実施者は全社)。kind を追加
-- ------------------------------------------------------------
drop function if exists public.hm_csv_uploads_for_company(uuid);

create function public.hm_csv_uploads_for_company(p_company_id uuid)
returns table (
  id uuid,
  kind text,
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
  select u.id, u.kind, u.file_name, u.row_count, u.fiscal_year, u.checkup_type, u.round,
         u.status, u.created_at, u.finished_at
    from public.hm_csv_uploads u
   where u.company_id = p_company_id
     and (public.hm_is_office()
          or (public.hm_my_role() = 'company' and p_company_id = public.hm_my_company()))
   order by u.created_at desc
   limit 20;
$$;

grant execute on function public.hm_csv_uploads_for_company(uuid) to authenticated;

-- ------------------------------------------------------------
-- 取込済み / 破棄。CSVの中身は「破棄」のときだけ消し、取込済みでは残す
-- (0135 では取込済みでも消していたが、原本として保管したいという要望に合わせる)
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
         content = case when p_status = 'discarded' then null else content end,
         storage_path = case when p_status = 'discarded' then null else storage_path end,
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
-- 保管済みの原本(取込済みのCSV・PDF)の一覧(実施者のみ)
-- ------------------------------------------------------------
create or replace function public.hm_csv_uploads_archived(p_company_id uuid default null)
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  kind text,
  file_name text,
  storage_path text,
  file_size bigint,
  row_count int,
  fiscal_year int,
  checkup_type text,
  round int,
  special_kind text,
  has_content boolean,
  created_at timestamptz,
  finished_at timestamptz
)
language sql security definer
set search_path = public
as $$
  select u.id, u.company_id, c.name, u.kind, u.file_name, u.storage_path, u.file_size,
         u.row_count, u.fiscal_year, u.checkup_type, u.round, u.special_kind,
         (u.content is not null or u.storage_path is not null) as has_content,
         u.created_at, u.finished_at
    from public.hm_csv_uploads u
    join public.companies c on c.id = u.company_id
   where public.hm_is_office()
     and u.status = 'imported'
     and (u.content is not null or u.storage_path is not null)
     and (p_company_id is null or u.company_id = p_company_id)
   order by u.created_at desc
   limit 200;
$$;

grant execute on function public.hm_csv_uploads_archived(uuid) to authenticated;


-- ------------------------------------------------------------
-- 保管済みの原本の削除(実施者のみ)。記録(ファイル名・件数)は残し、中身だけ消す
-- ------------------------------------------------------------
create or replace function public.hm_csv_upload_purge(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_csv_uploads
     set content = null, storage_path = null
   where id = p_id;
  perform public.hm_log_access('csv_upload_purge', 'hm_csv_uploads', p_id, null);
end;
$$;

grant execute on function public.hm_csv_upload_purge(uuid) to authenticated;

-- 確認用: true なら完了
-- select exists (
--   select 1 from information_schema.columns
--   where table_name = 'hm_csv_uploads' and column_name = 'storage_path'
-- ) as "0136 完了";
