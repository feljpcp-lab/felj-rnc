create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.rnc_cron_config (
  id smallint primary key check (id = 1),
  token_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.rnc_cron_config enable row level security;
