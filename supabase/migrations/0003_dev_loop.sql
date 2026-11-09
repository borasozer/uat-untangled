-- The developer's side of the loop: who owns a ticket, and what happened to it after the manager approved it.
-- A developer picks a ticket up and marks it fixed; each tester who reported it then retests and says whether
-- it works now. Nothing here reopens or closes a ticket by itself: every change is one person's action.

alter table tickets add column assignee_id text references people(id);

create table ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  kind text not null check (kind in ('picked_up', 'fixed', 'retest_passed', 'retest_failed', 'reopened')),
  feedback_id uuid references feedback(id) on delete cascade,   -- the tester's report, for retest results
  note text,
  by_id text references people(id),
  at timestamptz not null default now()
);

create index ticket_events_ticket_idx on ticket_events (ticket_id, at);

alter table ticket_events enable row level security;
grant all on ticket_events to service_role;
