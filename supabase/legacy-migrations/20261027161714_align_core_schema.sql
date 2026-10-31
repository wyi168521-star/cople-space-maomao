-- 在 20261027090005_init 之后执行：补齐五张核心表清单中的列默认值。
-- 保留旧字段和上一份迁移；不改写历史数据或业务权限。
begin;
set local lock_timeout = '10s';

create function public.love_anniversary_insert_default() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  -- DEFAULT 在 BEFORE 触发器之前填入。此处必须优先兼容旧客户端的 false。
  -- INSERT 同时提交 repeat_yearly=true 和 recurring=false 时也采用 recurring=false。
  -- UPDATE 不经过本分支，仍按 love_sync_core 的字段变更逻辑同步。
  if new.recurring is false and new.repeat_yearly is true then
    new.repeat_yearly := false;
  end if;
  return new;
end $$;

-- PostgreSQL 按名称顺序执行同类触发器；本触发器排在 love_sync_core 之前。
create trigger love_anniversary_insert_default
before insert on public.anniversaries
for each row execute function public.love_anniversary_insert_default();

alter table public.anniversaries alter column repeat_yearly set default true;
revoke all on function public.love_anniversary_insert_default() from public;
comment on column public.anniversaries.repeat_yearly is
  '默认每年重复；兼容旧 recurring。INSERT 的 true/false 歧义组合按旧 recurring=false 保存';
notify pgrst, 'reload schema';
commit;
