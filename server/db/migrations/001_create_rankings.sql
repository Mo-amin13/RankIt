-- One row per ranking. The engine state is stored as JSON so the ranking
-- logic stays in TypeScript; revision supports optimistic locking.
-- Applied by hand in the Neon SQL editor (dev branch: 2026-10-08).
-- Never edit this file after it has been applied; add a new migration instead.

create table rankings (
  id          text primary key,
  state       jsonb not null,
  undo_state  jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  revision    integer not null default 0
);
