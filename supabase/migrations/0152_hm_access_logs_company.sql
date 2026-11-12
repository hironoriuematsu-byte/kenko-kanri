-- ============================================================
-- 0152_hm_access_logs_company.sql : 健康管理Webの操作ログに「どの企業の操作か」を記録する
-- ============================================================
-- 健康管理Webの操作ログ(hm_access_logs)を、ストレスチェックWebの実施者画面「ログ」で
-- ストレスチェックWebのログと一緒に、企業ごとに確認できるようにする。
--
--   * hm_access_logs.company_id を追加
--   * ログが書かれるときに、対象の記録(議事録・健診・面談・カルテなど。面談ルームは企業そのもの)の企業を自動で入れる。
--     対象から企業がわからないとき(削除後など)は、操作した人の所属企業を入れる(実施者は空)
--   * これまでのログにも同じ方法で企業を入れる
--   * 日時の新しい順に読むための索引
--
-- 方針: 追加のみ / hm_ 接頭辞 / ログの書き込み方法(hm_log_access など)は変えない
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_access_logs add column if not exists company_id uuid;

create index if not exists hm_access_logs_created_idx on public.hm_access_logs (created_at desc);

-- 対象の記録の企業(表に company_id と id の列があるときだけ調べる)
create or replace function public.hm_log_company_of(p_table text, p_id uuid, p_user uuid)
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_rel regclass;
  v uuid;
begin
  if p_table is not null and p_id is not null then
    v_rel := to_regclass('public.' || quote_ident(p_table));
    if v_rel is not null
       and exists (select 1 from pg_attribute where attrelid = v_rel and attname = 'company_id' and not attisdropped)
       and exists (select 1 from pg_attribute where attrelid = v_rel and attname = 'id' and not attisdropped) then
      begin
        execute format('select company_id from %s where id = $1', v_rel) into v using p_id;
      exception when others then
        v := null;
      end;
    end if;
  end if;
  -- 面談ルームなど、企業そのものを対象として記録しているログ
  if v is null and p_id is not null and exists (select 1 from public.companies c where c.id = p_id) then
    v := p_id;
  end if;
  if v is null and p_user is not null then
    select p.company_id into v from public.profiles p where p.user_id = p_user;
  end if;
  return v;
end;
$$;

revoke all on function public.hm_log_company_of(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.hm_access_logs_fill_company()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := public.hm_log_company_of(new.target_table, new.target_id, new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists hm_access_logs_fill_company on public.hm_access_logs;
create trigger hm_access_logs_fill_company
  before insert on public.hm_access_logs
  for each row execute function public.hm_access_logs_fill_company();

-- これまでのログにも企業を入れる
update public.hm_access_logs l
   set company_id = public.hm_log_company_of(l.target_table, l.target_id, l.user_id)
 where l.company_id is null;

-- 適用状況の確認
select * from (
  values
    ('ログの企業(列)',
     (select case when count(*) = 1 then '✅OK' else '❌未適用' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_access_logs' and column_name = 'company_id')),
    ('ログの企業を自動で入れる(トリガー)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end from pg_trigger where tgname = 'hm_access_logs_fill_company')),
    ('企業がわかったログ / すべてのログ',
     (select count(company_id)::text || ' / ' || count(*)::text from public.hm_access_logs))
) as t(項目, 状態);
