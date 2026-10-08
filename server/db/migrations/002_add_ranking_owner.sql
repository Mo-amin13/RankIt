-- Rankings belong to an anonymous owner: the SHA-256 hash (hex) of the random
-- secret in the visitor's rankit_owner cookie. The secret itself is never
-- stored. Rows created before this migration have no owner and are not
-- reachable through the API.
-- Applied to the dev branch on 2026-10-08.

alter table rankings add column owner_hash text;

-- "My rankings, most recently changed first."
create index rankings_owner_recent_idx on rankings (owner_hash, updated_at desc);
