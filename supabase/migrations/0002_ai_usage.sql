-- Spend ledger for the public demo. Every AI call the web app makes is recorded with its cost, so the
-- daily, total and per-visitor budgets hold even if the code misbehaves or someone abuses the site.
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('analysis', 'evidence_check')),
  client text not null,               -- truncated hash of the visitor's IP address, never the address itself
  cost_usd numeric(10, 4) not null check (cost_usd >= 0),
  ok boolean not null default true,   -- false: the call failed and cost_usd is a conservative estimate
  created_at timestamptz not null default now()
);

create index ai_usage_created_idx on ai_usage (created_at desc);
create index ai_usage_client_idx on ai_usage (client, created_at desc);

alter table ai_usage enable row level security;
grant all on ai_usage to service_role;

-- Spend so far: the last 24 hours, all time, and this visitor's last hour.
create function ai_spend(p_client text)
returns table (day_usd numeric, total_usd numeric, client_hour_usd numeric)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(cost_usd) filter (where created_at > now() - interval '24 hours'), 0),
    coalesce(sum(cost_usd), 0),
    coalesce(sum(cost_usd) filter (where client = p_client and created_at > now() - interval '1 hour'), 0)
  from ai_usage;
$$;

revoke execute on function ai_spend(text) from public, anon, authenticated;
grant execute on function ai_spend(text) to service_role;

-- Never used: batch grouping lives in each analysis (match.target points at the report that opens the ticket).
drop table proposed_groups;
