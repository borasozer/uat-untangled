-- UAT Untangled: initial schema
-- All access goes through the Next.js server with the secret key (service_role).
-- The browser never talks to the database directly, so no table is granted to anon/authenticated.

create extension if not exists pgcrypto;

-- A UAT cycle for one release of the app under test.
create table cycles (
  id text primary key,
  name text not null,
  app_name text not null,
  app_description text not null,
  starts_on date not null,
  ends_on date not null
);

-- "By design" behaviours and known constraints the AI must respect.
create table app_rules (
  id text primary key,
  cycle_id text not null references cycles(id) on delete cascade,
  rule text not null
);

create table scripts (
  id text primary key,               -- e.g. TS-04
  cycle_id text not null references cycles(id) on delete cascade,
  title text not null,
  area text not null,
  sort int not null
);

create table steps (
  id text primary key,               -- e.g. TS-04.3
  script_id text not null references scripts(id) on delete cascade,
  step_no int not null,
  instruction text not null,
  expected text not null
);

create table people (
  id text primary key,
  name text not null,
  role text not null,                -- tester | manager | developer
  team text not null
);

-- Bugs and ideas. Known issues are bugs that existed before this cycle.
create table tickets (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,          -- e.g. MIA-101, IDEA-01
  cycle_id text not null references cycles(id) on delete cascade,
  kind text not null check (kind in ('bug', 'idea')),
  origin text not null default 'cycle' check (origin in ('cycle', 'known_issue')),
  title text not null,
  summary text not null,
  step_id text references steps(id),
  steps_to_reproduce text[] not null default '{}',
  expected text,
  actual text,
  severity text check (severity in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'fixed', 'planned', 'wont_fix')),
  status_note text,
  created_by text references people(id),
  created_at timestamptz not null default now()
);

-- Upload batches (spreadsheet imports).
create table batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  source_name text,
  total int not null default 0,
  processed int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'analysing', 'done', 'failed')),
  created_at timestamptz not null default now()
);

-- One piece of tester feedback, in the tester's own words.
create table feedback (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,          -- e.g. FB-021, IMP-07
  cycle_id text not null references cycles(id) on delete cascade,
  tester_id text references people(id),
  step_id text references steps(id),
  text text not null,
  reported_result text check (reported_result in ('pass', 'fail')),
  source text not null default 'tester_app' check (source in ('tester_app', 'import')),
  batch_id uuid references batches(id) on delete set null,
  submitted_at timestamptz not null default now(),
  status text not null default 'new' check (status in (
    'new',             -- not analysed yet
    'awaiting_review', -- AI has a suggestion, waiting for a person
    'needs_info',      -- a person asked the tester a question
    'linked',          -- attached to an existing ticket
    'ticketed',        -- became a new ticket
    'idea',            -- went to the ideas backlog
    'answered',        -- question or by-design behaviour, tester got an answer
    'acknowledged'     -- positive or no-action feedback, tester thanked
  )),
  ticket_id uuid references tickets(id) on delete set null,
  relation text check (relation in ('origin', 'exact_duplicate', 'different_aspect', 'related')),
  follow_up_question text,
  follow_up_answer text,
  tester_message text,               -- plain-language update shown to the tester
  truth jsonb                        -- ground-truth labels for sample data (evaluation only)
);

create index feedback_status_idx on feedback(status);
create index feedback_ticket_idx on feedback(ticket_id);

-- Every AI analysis is kept, so suggestions can be compared with human decisions.
create table analyses (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references feedback(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  suggestion jsonb not null,         -- structured AI output (majority vote)
  samples jsonb not null default '[]'::jsonb, -- each independent run, for the agreement signal
  confidence numeric not null,       -- 0..1, shown to the manager
  confidence_detail jsonb not null default '{}'::jsonb,
  latency_ms int,
  usage jsonb,
  created_at timestamptz not null default now()
);

create index analyses_feedback_idx on analyses(feedback_id, created_at desc);

-- AI-proposed groups of new feedback that describe the same new problem (batch analysis).
-- A group is only a suggestion: each member is still approved one at a time.
create table proposed_groups (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) on delete cascade,
  title text not null,
  reason text not null,
  kind text not null check (kind in ('bug', 'idea')),
  members jsonb not null,            -- [{ "ref": "IMP-04", "relation": "origin" | "exact_duplicate" | "different_aspect", "agreement": 0..1 }]
  ticket_id uuid references tickets(id) on delete set null, -- set when a person creates the ticket from a member
  created_at timestamptz not null default now()
);

-- One row per human decision. No batch decisions: each row is one feedback item.
create table decisions (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references feedback(id) on delete cascade,
  analysis_id uuid references analyses(id) on delete set null,
  action text not null,
  ai_action text,
  overridden boolean not null default false,
  ticket_id uuid references tickets(id) on delete set null,
  note text,
  decided_by text references people(id),
  decided_at timestamptz not null default now()
);

-- Access: server only.
alter table cycles enable row level security;
alter table app_rules enable row level security;
alter table scripts enable row level security;
alter table steps enable row level security;
alter table people enable row level security;
alter table tickets enable row level security;
alter table batches enable row level security;
alter table feedback enable row level security;
alter table analyses enable row level security;
alter table proposed_groups enable row level security;
alter table decisions enable row level security;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
