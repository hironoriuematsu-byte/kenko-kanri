-- ============================================================
-- 0119_hm_checkup_person_link.sql : 健診結果の本人特定を強化
-- ============================================================
--   * hm_checkups に birth_date(生年月日) と person_id(カルテへの紐付け) を追加
--   * 取込RPCが生年月日・カルテIDを受け取れるようにする
--   * 既存データのうち、企業内で氏名が一意に定まるものはカルテへ自動紐付け
-- 同姓同名がいる企業でも、社員番号・生年月日で本人を区別できるようになる。
-- ============================================================

alter table public.hm_checkups
  add column if not exists birth_date date,
  add column if not exists person_id uuid references public.hm_persons(id);

create index if not exists hm_checkups_person_idx
  on public.hm_checkups (person_id);

create or replace function public.hm_import_checkups(
  p_company_id uuid,
  p_fiscal_year int,
  p_checkup_type text,
  p_findings_judgments text[],
  p_rows jsonb
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_checkup_id uuid;
  v_count int := 0;
  v_has_findings boolean;
  v_overall text;
  v_needs_followup boolean;
  v_order int;
begin
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and p_company_id = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(v_row ->> 'target_name'), '') = '' then
      continue;
    end if;

    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');

    -- 有所見(既定ではC以上)
    v_has_findings := v_overall = any (coalesce(p_findings_judgments, '{}'));
    if not v_has_findings and v_row ? 'items' then
      select exists (
        select 1 from jsonb_array_elements(v_row -> 'items') it
        where (it ->> 'judgment') = any (coalesce(p_findings_judgments, '{}'))
      ) into v_has_findings;
    end if;

    -- 事後措置: 総合判定 D 以上のみ受診勧奨、A〜Cは措置不要
    v_needs_followup := v_overall is not null and upper(left(v_overall, 1)) in ('D', 'E');

    insert into public.hm_checkups (
      company_id, person_id, target_user_id, target_name, employee_no, sex, birth_date,
      fiscal_year, checkup_type, checkup_date, overall_judgment,
      has_findings, followup_status, created_by
    ) values (
      p_company_id,
      nullif(v_row ->> 'person_id', '')::uuid,
      nullif(v_row ->> 'target_user_id', '')::uuid,
      trim(v_row ->> 'target_name'),
      nullif(trim(coalesce(v_row ->> 'employee_no', '')), ''),
      nullif(v_row ->> 'sex', ''),
      nullif(v_row ->> 'birth_date', '')::date,
      p_fiscal_year,
      p_checkup_type,
      nullif(v_row ->> 'checkup_date', '')::date,
      v_overall,
      v_has_findings,
      case when v_needs_followup then 'pending' else 'none' end,
      auth.uid()
    ) returning id into v_checkup_id;

    v_order := 0;
    if v_row ? 'items' then
      for v_item in select * from jsonb_array_elements(v_row -> 'items') loop
        if coalesce(trim(v_item ->> 'name'), '') = '' then
          continue;
        end if;
        insert into public.hm_checkup_items (checkup_id, item_name, value, judgment, sort_order)
        values (
          v_checkup_id,
          trim(v_item ->> 'name'),
          nullif(trim(coalesce(v_item ->> 'value', '')), ''),
          nullif(trim(coalesce(v_item ->> 'judgment', '')), ''),
          v_order
        );
        v_order := v_order + 1;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  perform public.hm_log_access(
    'import', 'hm_checkups', null,
    jsonb_build_object(
      'company_id', p_company_id,
      'fiscal_year', p_fiscal_year,
      'checkup_type', p_checkup_type,
      'count', v_count
    )
  );
  return v_count;
end;
$$;

-- 既存データの紐付け(企業内で氏名が一意に定まるもののみ)
update public.hm_checkups c
   set person_id = p.id
  from public.hm_persons p
 where c.person_id is null
   and p.company_id = c.company_id
   and p.full_name = c.target_name
   and (
     select count(*) from public.hm_persons p2
      where p2.company_id = c.company_id and p2.full_name = c.target_name
   ) = 1;
