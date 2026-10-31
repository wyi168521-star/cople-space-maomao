\set ON_ERROR_STOP on
\pset pager off

-- Run with psql as the local database administrator after applying migrations.
-- All fixtures, temporary helpers, grants, and RPC writes are rolled back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select set_config('request.jwt.claims', '{}', true);

create temporary table pairing_rpc_state (
  key text primary key,
  value text not null
);
insert into pairing_rpc_state (key, value)
select fixture, gen_random_uuid()::text
from unnest(array[
  'creator', 'partner', 'third', 'validation', 'missing_profile',
  'legacy_creator', 'legacy_partner', 'missing_couple'
]) as fixture;

create function pg_temp.fixture_id(p_key text) returns uuid
language sql stable set search_path = '' as $$
  select value::uuid from pg_temp.pairing_rpc_state where key = p_key;
$$;

create function pg_temp.assert_true(p_condition boolean, p_label text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_condition is distinct from true then
    raise exception 'Pairing RPC check failed: %', p_label;
  end if;
end;
$$;

create function pg_temp.expect_error(p_sql text, p_expected text) returns void
language plpgsql set search_path = '' as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) = 0 then
      raise exception 'Expected error containing "%", received "%"', p_expected, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected rejection containing "%": %', p_expected, p_sql;
end;
$$;

grant select, insert on pg_temp.pairing_rpc_state to authenticated;
revoke all on function pg_temp.fixture_id(text) from public;
revoke all on function pg_temp.assert_true(boolean, text) from public;
revoke all on function pg_temp.expect_error(text, text) from public;
grant execute on function pg_temp.fixture_id(text) to authenticated;
grant execute on function pg_temp.assert_true(boolean, text) to authenticated;
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data)
select value::uuid, 'pairing-rpc-' || value || '@example.test',
  jsonb_build_object('display_name', '测试-' || key)
from pg_temp.pairing_rpc_state where key <> 'missing_couple';
delete from public.profiles where id = pg_temp.fixture_id('missing_profile');

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.create_couple(text,text,date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.join_couple(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_couple(text,text,date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.join_couple(uuid)', 'EXECUTE'),
  'only authenticated API callers can execute pairing RPCs');
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.couple_members', 'INSERT'),
  'membership INSERT privilege remains closed');
select pg_temp.assert_true((
  select count(*) = 2 and bool_and(p.prosecdef)
    and bool_and(exists (
      select 1 from pg_options_to_table(p.proconfig) o
      where o.option_name = 'search_path' and o.option_value in ('', '""')
    ))
  from pg_proc p where p.oid in (
    'public.create_couple(text,text,date)'::regprocedure,
    'public.join_couple(uuid)'::regprocedure
  )
), 'both RPCs use SECURITY DEFINER with an empty search_path');

set local role anon;
select pg_temp.expect_error(
  $$select public.create_couple('甲','乙','2023-05-20')$$,
  'permission denied for function create_couple');
select pg_temp.expect_error(
  $$select public.join_couple(null)$$,
  'permission denied for function join_couple');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error(
  $$select public.create_couple('甲','乙','2023-05-20')$$, '请先登录');
select pg_temp.expect_error($$select public.join_couple(null)$$, '请先登录');

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('missing_profile')::text, true);
select pg_temp.expect_error(
  $$select public.create_couple('甲','乙','2023-05-20')$$, '用户资料尚未就绪');
select pg_temp.expect_error(
  $$select public.join_couple(pg_temp.fixture_id('missing_couple'))$$, '用户资料尚未就绪');

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('validation')::text, true);
select pg_temp.expect_error(
  $$select public.create_couple(null,'乙','2023-05-20')$$, '双方昵称需要 1-40 个字符');
select pg_temp.expect_error(
  $$select public.create_couple('甲','   ','2023-05-20')$$, '双方昵称需要 1-40 个字符');
select pg_temp.expect_error(
  $$select public.create_couple(repeat('甲',41),'乙','2023-05-20')$$, '双方昵称需要 1-40 个字符');
select pg_temp.expect_error(
  $$select public.create_couple('甲',repeat('乙',41),'2023-05-20')$$, '双方昵称需要 1-40 个字符');
select pg_temp.expect_error(
  $$select public.create_couple('甲','乙',null)$$, '请选择在一起的日期');
select pg_temp.expect_error($$select public.join_couple(null)$$, '请输入空间 ID');
select pg_temp.expect_error(
  $$select public.join_couple(pg_temp.fixture_id('missing_couple'))$$, '空间不存在');
select pg_temp.assert_true(
  not exists (select 1 from public.couple_members where user_id = auth.uid()),
  'invalid requests do not add a membership');

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('creator')::text, true);
insert into pg_temp.pairing_rpc_state (key, value)
values ('couple', public.create_couple('  阿甲  ', '  阿乙  ', '2023-05-20')::text);
select pg_temp.assert_true((
  select name_a = '阿甲' and name_b = '阿乙' and name = '阿甲 & 阿乙'
    and start_date = '2023-05-20'::date and relationship_start = start_date
    and created_by = auth.uid()
  from public.couples where id = pg_temp.fixture_id('couple')
), 'create returns a readable couple with trimmed names and legacy aliases');
select pg_temp.assert_true((
  select count(*) = 1 and bool_and(role = 'a' and user_id = auth.uid())
  from public.couple_members where couple_id = pg_temp.fixture_id('couple')
), 'create adds the caller exactly once as role a');
select pg_temp.expect_error(
  $$select public.create_couple('重复','创建','2023-05-20')$$, '你已经加入了一个情侣空间');
select pg_temp.expect_error(
  $$select public.join_couple(pg_temp.fixture_id('couple'))$$, '你已经加入了一个情侣空间');

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('partner')::text, true);
select pg_temp.assert_true(
  public.join_couple(pg_temp.fixture_id('couple')) = pg_temp.fixture_id('couple'),
  'join returns the requested couple ID');
select pg_temp.assert_true((
  select count(*) = 1 and bool_and(role = 'b' and user_id = auth.uid())
  from public.couple_members where couple_id = pg_temp.fixture_id('couple')
), 'join adds role b while membership RLS exposes only the caller');
select pg_temp.assert_true((
  select name_b = '阿乙' from public.couples where id = pg_temp.fixture_id('couple')
), 'join preserves the supplied partner nickname');
select pg_temp.expect_error(
  $$select public.join_couple(pg_temp.fixture_id('couple'))$$, '你已经加入了一个情侣空间');

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('third')::text, true);
select pg_temp.assert_true(
  not exists (select 1 from public.couple_members where couple_id = pg_temp.fixture_id('couple')),
  'a nonmember cannot read the target memberships');
select pg_temp.expect_error(
  $$select public.join_couple(pg_temp.fixture_id('couple'))$$, '这个空间已满');

reset role;
select pg_temp.assert_true((
  select count(*) = 1 from public.couples where created_by = pg_temp.fixture_id('creator')
), 'duplicate create leaves no orphan couple');
select pg_temp.assert_true(
  not exists (select 1 from public.couples where created_by in (
    pg_temp.fixture_id('validation'), pg_temp.fixture_id('missing_profile')
  )), 'failed requests leave no couple rows');
select pg_temp.assert_true((
  select count(*) = 2 from public.couple_members where couple_id = pg_temp.fixture_id('couple')
), 'full-space rejection leaves exactly two members');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.fixture_id('creator')::text, true);
select public.leave_couple_space();
select set_config('request.jwt.claim.sub', pg_temp.fixture_id('third')::text, true);
select pg_temp.expect_error(
  $$select public.join_couple(pg_temp.fixture_id('couple'))$$, '这个空间已满');

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('legacy_creator')::text, true);
insert into pg_temp.pairing_rpc_state (key, value)
values ('legacy_invitation', public.create_couple_with_invitation('旧 RPC', '2023-05-20'));
insert into pg_temp.pairing_rpc_state (key, value)
select 'legacy_couple', couple_id::text from public.couple_members where user_id = auth.uid();
select set_config('request.jwt.claim.sub', pg_temp.fixture_id('legacy_partner')::text, true);
select public.accept_couple_invitation((
  select value from pg_temp.pairing_rpc_state where key = 'legacy_invitation'
));
select pg_temp.assert_true((
  select count(*) = 1 and bool_and(role = 'b' and user_id = auth.uid())
  from public.couple_members where couple_id = pg_temp.fixture_id('legacy_couple')
), 'legacy invitation create and accept RPCs remain functional');

reset role;
select pg_temp.assert_true((
  select count(*) = 1 and bool_and(role = 'b')
  from public.couple_members where couple_id = pg_temp.fixture_id('couple')
), 'an occupied role b still blocks joining after role a leaves');
select pg_temp.assert_true(
  not exists (select 1 from public.couple_members where user_id = pg_temp.fixture_id('third')),
  'rejected third user remains unpaired');

rollback;
\echo 'Pairing RPC functional checks passed; all fixtures and writes rolled back.'
