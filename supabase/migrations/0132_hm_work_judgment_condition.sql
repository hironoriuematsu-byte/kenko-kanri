-- 就業判定の「判定条件」を追加する。
--   要医療項目(D)・就業制限項目(R)があるのに「通常勤務可」とする場合に、
--   「受診が条件」という条件付きの判定として記録する(医師の意見とは別の欄)。
--   これまで医師の意見の定型文「但し受診が条件」で表していたものを、判定条件に移す。
--
-- 内容
--   (1) hm_checkups.work_judgment_condition 列(null / 'consult' = 受診が条件)
--   (2) 既存データ: 医師の意見に「但し受診が条件」がある通常勤務可の方は判定条件に移し、
--       医師の意見からその語句を取り除く
--   (3) hm_save_work_judgment: 通常勤務可以外に変えたら判定条件を消す
--   (4) hm_set_work_judgment_condition(p_ids, p_on): 判定条件だけを付け外しする(1人ずつ・複数)
--   (5) hm_bulk_work_judgment: 従業員ごとの医師の意見(p_notes)と判定条件(p_condition_ids)を
--       受け取る5引数の版。0131 の4引数の版は置き換える(0131 未実行でも問題ない)
--   (6) hm_clear_work_judgment: 判定条件も一緒に消す
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない

-- ------------------------------------------------------------
-- (1) 列
-- ------------------------------------------------------------
alter table public.hm_checkups
  add column if not exists work_judgment_condition text;

alter table public.hm_checkups
  drop constraint if exists hm_checkups_work_judgment_condition_check;
alter table public.hm_checkups
  add constraint hm_checkups_work_judgment_condition_check
  check (work_judgment_condition is null or work_judgment_condition in ('consult'));

-- ------------------------------------------------------------
-- (2) 既存データの移行
-- ------------------------------------------------------------
update public.hm_checkups
   set work_judgment_condition = 'consult'
 where work_judgment = 'normal'
   and work_judgment_note like '%但し受診が条件%'
   and work_judgment_condition is null;

update public.hm_checkups c
   set work_judgment_note = sub.n,
       updated_at = now()
  from (
    select id,
           nullif(
             array_to_string(
               array(
                 select trim(x)
                   from unnest(string_to_array(work_judgment_note, '/')) as x
                  where trim(x) <> '' and trim(x) <> '但し受診が条件'
               ),
               ' / '
             ),
             ''
           ) as n
      from public.hm_checkups
     where work_judgment_note like '%但し受診が条件%'
  ) sub
 where c.id = sub.id;

-- ------------------------------------------------------------
-- (3) 1人ずつの就業判定: 通常勤務可以外に変えたら判定条件を消す
-- ------------------------------------------------------------
create or replace function public.hm_save_work_judgment(
  p_id uuid,
  p_judgment text,
  p_note text,
  p_date date default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_checkups
     set work_judgment = nullif(p_judgment, ''),
         work_judgment_note = nullif(p_note, ''),
         work_judgment_date = coalesce(p_date, current_date),
         work_judgment_condition = case
           when nullif(p_judgment, '') = 'normal' then work_judgment_condition
           else null
         end,
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'checkup not found';
  end if;
  perform public.hm_log_access(
    'work_judgment', 'hm_checkups', p_id, jsonb_build_object('judgment', p_judgment)
  );
end;
$$;

-- ------------------------------------------------------------
-- (4) 判定条件だけを付け外しする(通常勤務可の方のみ)
-- ------------------------------------------------------------
create or replace function public.hm_set_work_judgment_condition(
  p_ids uuid[],
  p_on boolean
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  update public.hm_checkups
     set work_judgment_condition = case when p_on then 'consult' else null end,
         updated_at = now()
   where id = any (p_ids)
     and work_judgment = 'normal';
  get diagnostics v_count = row_count;

  perform public.hm_log_access(
    'work_judgment_condition', 'hm_checkups', null,
    jsonb_build_object('ids', to_jsonb(p_ids), 'on', p_on, 'count', v_count)
  );
  return v_count;
end;
$$;

grant execute on function public.hm_set_work_judgment_condition(uuid[], boolean) to authenticated;

-- ------------------------------------------------------------
-- (5) 一括判定
-- ------------------------------------------------------------
-- 3引数の版(共通の医師の意見): 通常勤務可以外に変えたら判定条件を消す
create or replace function public.hm_bulk_work_judgment(
  p_ids uuid[],
  p_judgment text,
  p_note text default null
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_judgment not in ('normal', 'restricted', 'leave', 'pending') then
    raise exception 'invalid judgment';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  update public.hm_checkups
     set work_judgment = p_judgment,
         work_judgment_note = case
           when p_note is null then work_judgment_note
           else nullif(p_note, '')
         end,
         work_judgment_condition = case
           when p_judgment = 'normal' then work_judgment_condition
           else null
         end,
         work_judgment_date = current_date,
         updated_at = now()
   where id = any (p_ids);
  get diagnostics v_count = row_count;

  perform public.hm_log_access(
    'bulk_work_judgment', 'hm_checkups', null,
    jsonb_build_object('ids', to_jsonb(p_ids), 'judgment', p_judgment, 'count', v_count)
  );
  return v_count;
end;
$$;

-- 0131 の4引数の版は5引数の版に置き換える
drop function if exists public.hm_bulk_work_judgment(uuid[], text, text, jsonb);

-- 5引数の版:
--   p_notes         {"<健診ID>": "<医師の意見>", ...}。該当IDが無ければ p_note を使う
--   p_condition_ids 「受診が条件」を付ける健診ID。通常勤務可のときだけ有効で、
--                   指定した方は「受診が条件」、それ以外の方は条件なしになる。
--                   null なら判定条件は変更しない(通常勤務可以外では常に消える)
create or replace function public.hm_bulk_work_judgment(
  p_ids uuid[],
  p_judgment text,
  p_note text,
  p_notes jsonb,
  p_condition_ids uuid[]
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_judgment not in ('normal', 'restricted', 'leave', 'pending') then
    raise exception 'invalid judgment';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  update public.hm_checkups c
     set work_judgment = p_judgment,
         work_judgment_note = case
           when p_notes is not null and p_notes ? c.id::text
             then nullif(p_notes ->> c.id::text, '')
           when p_note is null then c.work_judgment_note
           else nullif(p_note, '')
         end,
         work_judgment_condition = case
           when p_judgment <> 'normal' then null
           when p_condition_ids is null then c.work_judgment_condition
           when c.id = any (p_condition_ids) then 'consult'
           else null
         end,
         work_judgment_date = current_date,
         updated_at = now()
   where c.id = any (p_ids);
  get diagnostics v_count = row_count;

  perform public.hm_log_access(
    'bulk_work_judgment', 'hm_checkups', null,
    jsonb_build_object(
      'ids', to_jsonb(p_ids), 'judgment', p_judgment, 'count', v_count,
      'condition_count', coalesce(array_length(p_condition_ids, 1), 0)
    )
  );
  return v_count;
end;
$$;

grant execute on function public.hm_bulk_work_judgment(uuid[], text, text, jsonb, uuid[]) to authenticated;

-- ------------------------------------------------------------
-- (6) 判定の取り消し: 判定条件も消す
-- ------------------------------------------------------------
create or replace function public.hm_clear_work_judgment(p_ids uuid[])
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  update public.hm_checkups
     set work_judgment = null,
         work_judgment_note = null,
         work_judgment_date = null,
         work_judgment_condition = null,
         updated_at = now()
   where id = any (p_ids)
     and work_judgment is not null;
  get diagnostics v_count = row_count;

  perform public.hm_log_access(
    'clear_work_judgment', 'hm_checkups', null,
    jsonb_build_object('ids', to_jsonb(p_ids), 'count', v_count)
  );
  return v_count;
end;
$$;

grant execute on function public.hm_clear_work_judgment(uuid[]) to authenticated;

-- 確認用: true なら完了
-- select exists (
--   select 1 from information_schema.columns
--   where table_name = 'hm_checkups' and column_name = 'work_judgment_condition'
-- ) as "0132 完了";
