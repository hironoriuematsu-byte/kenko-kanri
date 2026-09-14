-- 就業判定の一括入力で、従業員ごとに異なる「医師の意見」を入れられるようにする。
--   例: 「γ-GTP、HbA1cにつき医療機関受診 / 但し受診が条件」のように、
--       その方の要医療項目(D)・就業制限項目(R)の項目名を含めた文章を1人ずつ保存する
--
-- 既存の hm_bulk_work_judgment(p_ids, p_judgment, p_note) はそのまま残し、
-- p_notes(jsonb: {"<健診ID>": "<医師の意見>", ...}) を受け取る版を追加する。
--   * p_notes に該当IDがあればその文章、無ければ p_note を使う
--   * どちらも無ければ既存の「医師の意見」を保持する
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run
-- 再実行しても問題ない(create or replace)

create or replace function public.hm_bulk_work_judgment(
  p_ids uuid[],
  p_judgment text,
  p_note text,
  p_notes jsonb
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
         work_judgment_date = current_date,
         updated_at = now()
   where c.id = any (p_ids);
  get diagnostics v_count = row_count;

  perform public.hm_log_access(
    'bulk_work_judgment', 'hm_checkups', null,
    jsonb_build_object('ids', to_jsonb(p_ids), 'judgment', p_judgment, 'count', v_count)
  );
  return v_count;
end;
$$;

grant execute on function public.hm_bulk_work_judgment(uuid[], text, text, jsonb) to authenticated;

-- 確認用: 4引数の版が登録されていれば true
-- select exists (
--   select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'hm_bulk_work_judgment' and p.pronargs = 4
-- ) as "0131 完了";
