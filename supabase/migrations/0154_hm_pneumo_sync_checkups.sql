-- ============================================================
-- 0154_hm_pneumo_sync_checkups.sql : 健康診断管理に入れたじん肺健診を、じん肺健康管理台帳(様式第8号の集計)に自動で写す
-- ============================================================
-- 健康診断管理で「特殊健診」の種類が「じん肺」(塵肺)の健診を登録・取り込み・修正すると、
--   * じん肺健康管理台帳(hm_pneumo_workers)に、その方がいなければ追加する(カルテ → 氏名の順で同じ人を探す)
--   * じん肺健診の受診記録(hm_pneumo_exams)を作る・直す(健診日・健診の区分・エックス線写真の像・肺機能・肺がんに関する検査)
--   * エックス線写真の像が第1型以上(所見あり)で、まだ管理1のままの方は「管理区分の決定待ち」にする
--     (管理区分は労働局長の決定通知を見て台帳で入れる。入れると決定待ちは外れる)
--   * 健康診断管理で健診を消すと、受診記録も消える(台帳の人は残る)
-- 健診の項目名は次のように読む(取込のCSVの列名も同じ):
--   健診の区分: 「じん肺健診の区分」「健診区分」(就業時・定期・定期外・離職時。無ければ定期)
--   エックス線写真の像: 「エックス線写真の像」「X線写真の像」「小陰影の区分」「PR」など(0/0、1/0、PR1、第2型、大陰影 A〜C など)
--   肺機能: 「肺機能検査の判定」など(F(-)・F(+)・F(++))
--   肺がんに関する検査: 「肺がんに関する検査」(定期外健診で行ったとき。「なし」以外の記載があれば実施)
--
-- 0153 の実行後に実行する。方針: 追加のみ / hm_ 接頭辞
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_pneumo_exams add column if not exists checkup_id uuid references public.hm_checkups(id) on delete cascade;
alter table public.hm_pneumo_exams add column if not exists lung_function text; -- 肺機能(F(-)・F(+)・F(++))
create unique index if not exists hm_pneumo_exams_checkup_uniq on public.hm_pneumo_exams (checkup_id) where checkup_id is not null;

-- エックス線写真の像が第1型以上で、管理区分の決定を待っている
alter table public.hm_pneumo_workers add column if not exists kanri_pending boolean not null default false;

-- じん肺健診か(特殊健診の種類に「じん肺」「塵肺」を含む)
create or replace function public.hm_is_pneumo_kind(p_kind text)
returns boolean
language sql immutable
as $$
  select coalesce(p_kind ~ '(じん肺|塵肺|じんぱい)', false)
$$;

-- エックス線写真の像を型(0〜4)にする。読めなければ null
create or replace function public.hm_pneumo_xray_type(p_value text)
returns int
language plpgsql immutable
as $$
declare
  v text := upper(translate(coalesce(p_value, ''), '０１２３４ＡＢＣＰＲ／　', '01234ABCPR/ '));
  m text[];
begin
  if v ~ '^\s*$' then return null; end if;
  if v ~ '大陰影' or v ~ '(^|[^A-Z])[ABC]($|[^A-Z])' then return 4; end if;
  m := regexp_match(v, 'PR\s*([0-4])');
  if m is not null then return m[1]::int; end if;
  m := regexp_match(v, '第\s*([0-4])\s*型');
  if m is not null then return m[1]::int; end if;
  m := regexp_match(v, '^\s*([0-3])\s*/');
  if m is not null then return m[1]::int; end if;
  if v ~ '(所見なし|異常なし|なし)' then return 0; end if;
  return null;
end;
$$;

-- 1件の健診を台帳に写す
create or replace function public.hm_pneumo_sync_checkup(p_checkup_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  c record;
  v_kind text;
  v_xray text;
  v_f text;
  v_lc text;
  v_type int;
  v_worker uuid;
  v_name text;
begin
  select id, company_id, person_id, target_name, checkup_type, special_kind, checkup_date
    into c from public.hm_checkups where id = p_checkup_id;
  if c.id is null then
    return;
  end if;
  -- じん肺健診でなくなった(種類を直した)ときは、写した受診記録を消す
  if c.checkup_type <> 'special' or not public.hm_is_pneumo_kind(c.special_kind) or c.checkup_date is null then
    delete from public.hm_pneumo_exams where checkup_id = c.id;
    return;
  end if;

  select
    max(value) filter (where item_name ~ '(健診|検診)の?区分'),
    max(value) filter (where item_name ~* '((エックス|X|Ｘ)線.*(像|型))|小陰影|^(PR|ＰＲ)'),
    max(coalesce(nullif(judgment, ''), value)) filter (where item_name ~ '肺機能'),
    max(value) filter (where item_name ~ '肺がん')
    into v_kind, v_xray, v_f, v_lc
    from public.hm_checkup_items where checkup_id = c.id;

  v_kind := case
    when v_kind ~ '(就業時|雇入)' then 'hiring'
    when v_kind ~ '(定期外|臨時)' then 'extra'
    when v_kind ~ '離職' then 'leaving'
    else 'periodic'
  end;
  v_type := public.hm_pneumo_xray_type(v_xray);

  -- 台帳の同じ人: カルテ → 氏名(空白を除いて比べる)。退職していない人を優先
  v_name := regexp_replace(coalesce(c.target_name, ''), '[\s　]', '', 'g');
  select w.id into v_worker
    from public.hm_pneumo_workers w
   where w.company_id = c.company_id
     and ((c.person_id is not null and w.person_id = c.person_id)
          or regexp_replace(w.full_name, '[\s　]', '', 'g') = v_name)
   order by (w.person_id is not distinct from c.person_id) desc, (w.left_on is null) desc, w.created_at
   limit 1;
  if v_worker is null then
    insert into public.hm_pneumo_workers (company_id, person_id, full_name, dust_status, kanri, kanri_pending)
    values (c.company_id, c.person_id, coalesce(nullif(trim(c.target_name), ''), '(氏名未登録)'), 'current', '1', coalesce(v_type, 0) >= 1)
    returning id into v_worker;
  else
    update public.hm_pneumo_workers
       set person_id = coalesce(person_id, c.person_id),
           -- 所見あり(第1型以上)で管理1のまま(この健診より後の決定がない)なら、決定待ちにする
           kanri_pending = kanri_pending or (
             coalesce(v_type, 0) >= 1 and kanri = '1' and (kanri_decided_on is null or kanri_decided_on < c.checkup_date)
           )
     where id = v_worker;
  end if;

  insert into public.hm_pneumo_exams (company_id, worker_id, checkup_id, exam_date, exam_kind, xray, lung_function, lung_cancer)
  values (
    c.company_id, v_worker, c.id, c.checkup_date, v_kind, nullif(trim(coalesce(v_xray, '')), ''), nullif(trim(coalesce(v_f, '')), ''),
    v_kind = 'extra' and coalesce(v_lc, '') !~ '^\s*(なし|無し|無|未実施|-|－)?\s*$'
  )
  on conflict (checkup_id) where checkup_id is not null do update
     set worker_id = excluded.worker_id,
         exam_date = excluded.exam_date,
         exam_kind = excluded.exam_kind,
         xray = excluded.xray,
         lung_function = excluded.lung_function,
         lung_cancer = excluded.lung_cancer;
end;
$$;

revoke all on function public.hm_pneumo_sync_checkup(uuid) from public, anon, authenticated;

-- 健診の登録・修正のたびに写す(問題が起きても健診の保存は止めない)
create or replace function public.hm_pneumo_on_checkup_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'hm_checkups' then
    v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_id := old.checkup_id;
  else
    v_id := new.checkup_id;
  end if;
  begin
    -- じん肺健診でなければ何もしない(ほかの健診の取込を遅くしないため、先に軽く確かめる)
    if exists (
      select 1 from public.hm_checkups k
       where k.id = v_id and ((k.checkup_type = 'special' and public.hm_is_pneumo_kind(k.special_kind))
                              or exists (select 1 from public.hm_pneumo_exams e where e.checkup_id = k.id))
    ) then
      perform public.hm_pneumo_sync_checkup(v_id);
    end if;
  exception when others then
    raise warning 'hm_pneumo_sync_checkup failed for %: %', v_id, sqlerrm;
  end;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists hm_pneumo_checkups_sync on public.hm_checkups;
create trigger hm_pneumo_checkups_sync
  after insert or update on public.hm_checkups
  for each row execute function public.hm_pneumo_on_checkup_change();

drop trigger if exists hm_pneumo_checkup_items_sync on public.hm_checkup_items;
create trigger hm_pneumo_checkup_items_sync
  after insert or update or delete on public.hm_checkup_items
  for each row execute function public.hm_pneumo_on_checkup_change();

-- すでに登録されているじん肺健診を写す
do $$
declare
  v uuid;
begin
  for v in
    select id from public.hm_checkups where checkup_type = 'special' and public.hm_is_pneumo_kind(special_kind)
  loop
    perform public.hm_pneumo_sync_checkup(v);
  end loop;
end $$;

-- 適用状況の確認
select * from (
  values
    ('健診 → じん肺台帳の自動反映(トリガー)',
     (select case when count(*) = 2 then '✅OK' else '❌未適用' end
        from pg_trigger where tgname in ('hm_pneumo_checkups_sync', 'hm_pneumo_checkup_items_sync'))),
    ('健康診断管理から写したじん肺健診の数',
     (select count(*)::text from public.hm_pneumo_exams where checkup_id is not null)),
    ('管理区分の決定待ちの人数',
     (select count(*)::text from public.hm_pneumo_workers where kanri_pending))
) as t(項目, 状態);
