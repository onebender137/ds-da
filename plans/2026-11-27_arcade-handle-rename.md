# DSDA Arcade — Handle Rename (Player Name Choice)

**Date:** 2026-11-27 · **Status:** DESIGN — awaiting Claude review, then build
**Scope:** board Worker (`~/dsda-board/`) + site (`~/ds-da/`) + prod D1 migration
**Goal:** Fundy (BRC-100) logins with no account create `player-XXXXXX` and there is no way
to change it. Boards full of `player-XXXXXX`s make the arcade look dead. Players may keep
the auto name, but they need a way to pick their own.

## 1. Findings (prod D1, read-only, 2026-11-27)

Tables:
- `players` — `id TEXT PK`, `handle TEXT` (partial unique index, nullable), `email TEXT UNIQUE`,
  `password_hash`, `address TEXT UNIQUE`, `avatar_nft`, `plays`, `created`, `updated`,
  `settings TEXT DEFAULT '{}'`, `avatar TEXT` (ALTER'd in).
- `scores` — `id INTEGER PK`, `game`, `initials TEXT`, `score`, `created`, `seeded`.
  **Keyed on initials text. No account column.**
- `score_handles` — `id INTEGER PK`, `score_id INTEGER` (FK→`scores.id`), `handle TEXT`,
  `created`. **Keyed on handle TEXT, not account id.**

Indexes (user): `idx_players_handle_unique` (partial unique on `players(handle) WHERE handle IS NOT NULL`),
`idx_ps_account`, `idx_pscore_acct_game`, `idx_pscore_game_score`, `idx_scores_game_score`,
`idx_scores_game_initials`, `idx_scores_game_seeded`, `idx_scores_game_live`, `idx_sh_score`,
`idx_sh_handle`, `idx_challenge_players_player`, `idx_challenges_status`.

Keying audit:
| Store | Keyed on | Follows a rename? |
|---|---|---|
| `player_scores` (account history) | `account` = `players.id` | ✅ yes |
| `player_badges` / `player_daily_state` / `player_milestones` / `avatars` | account id | ✅ yes |
| `challenges` + `challenge_players`/`_runs`/`_results` | `player_id` = `players.id` | ✅ yes (handle joined for display only) |
| `scores` (public boards) | `initials` text | n/a (anonymous rows) |
| `score_handles` (board↔account bridge) | **handle text** | ❌ **no — the migration target** |
| sync per-board PB bests (`WHERE sh.handle = ?`) | **handle text** | ❌ **no — migration target** |
| challenge `?vs=<handle>-<score>` / `?handle=` | handle, resolved→id at create/accept | transient link only |

Data: 5 accounts total, **2 with `player-` handles**, 0 null handles.

Auto-handle origin: `src/index.js:416` — `cleanHandle(body.handle) || 'player-' + address.slice(0, 6)`
in `handleLoginBrc100` (first Fundy login with no handle supplied).

## 2. Migration (proposed — NOT run)

Purely additive; no ALTER/DROP on `players` columns that existing code reads, no data rewrites
beyond the backfill. Applied to prod with `wrangler d1 execute <uuid> --remote --file=…` AFTER
a verified `d1 export`.

**Pre-migration read-only check** (run 2026-11-27: **result = 0, clean**):
```sql
SELECT COUNT(*) FROM score_handles sh LEFT JOIN players p ON p.handle = sh.handle WHERE p.id IS NULL;
```
Must be 0 — any unmatched row would drop off the member's personal-best sync after the backfill.
If non-zero, paste the offenders: `SELECT sh.handle, COUNT(*) AS n FROM score_handles sh
LEFT JOIN players p ON p.handle = sh.handle WHERE p.id IS NULL GROUP BY sh.handle`
(email-prefix handles from before Nov 20 were the suspected ones — there are none).

```sql
-- 1. account key on the bridge table
ALTER TABLE score_handles ADD COLUMN account_id TEXT;
CREATE INDEX idx_sh_account ON score_handles(account_id);

-- 2. 30-day hold on released names
CREATE TABLE IF NOT EXISTS released_handles (
  handle       TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  released_at  INTEGER NOT NULL,   -- epoch ms
  available_at INTEGER NOT NULL    -- released_at + 30d
);

-- 3. rename cooldown stamp
ALTER TABLE players ADD COLUMN last_handle_change INTEGER;  -- epoch ms, NULL = never

-- 4. backfill bridge from current handle text (5 accounts → ~100% match)
UPDATE score_handles
   SET account_id = (SELECT id FROM players WHERE handle = score_handles.handle)
 WHERE account_id IS NULL;
```

D1 schema-cache caveat: `ALTER TABLE ADD COLUMN` has once left the Worker's D1 connection blind
to the new column. Precedent (`players.avatar`) recovered after redeploy; the deploy smoke test
must prove the Worker sees `account_id` (a member score post, then read back via the live API).

Rollback = none needed (additive). Old Worker code keeps working on the new schema (it ignores
`account_id`/`last_handle_change`; `released_handles` unused until the new code ships).

## 3. Worker changes (`~/dsda-board/src/index.js` — additive)

### 3.1 Shared validation (EVERY place that sets a handle — one function)

`cleanHandle` stays: `toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,16)`.
New `validateHandle(raw, { holderId = null })` used by **all three** handle-setting paths —
`handleRegister`, `POST /api/account/handle`, AND `handleLoginBrc100` (the client-supplied
`body.handle` there must pass the full validation; if it doesn't, the login falls back to the
auto name `player-<addr6>` — a Fundy login must not skip the blocked words, the `player-` ban
or the hold just by sending its own handle):

- length 2–16 (HANDLE_MIN/HANDLE_MAX)
- must NOT start with `player-` (reserved for the auto-name namespace)
- NOT in `BLOCKED_HANDLES` — reserved set applied to register too (register has none today;
  adding it is part of "same validation as register" going forward):
  `admin, mod, support, system, api, dsda, null, none, guest, danny, fundy, arcade, official, root, owner`
- **hold check lives INSIDE `validateHandle`** (not only in the rename endpoint):
  `SELECT * FROM released_handles WHERE handle = ? AND available_at > now` → 409
  `that name is on hold — available in N days`. Exception: the account that released the name
  can take it back (`holderId === row.account_id` → allowed).
- uniqueness: case-insensitive by construction (lowercased before insert + existing partial
  unique index `idx_players_handle_unique`). The rename endpoint also does an explicit
  `SELECT id FROM players WHERE handle = ? AND id != me` → 409 `handle already taken`
  (matches register's 409 semantics).

**Race rule:** a unique-index violation thrown INSIDE the write batch (two requests racing for
the same name) must be caught and returned as **409 `handle already taken`**, never a 500.

### 3.2 `POST /api/account/handle` (Bearer, new route under existing `/api/account/*` prefixes —
both `api.ds-da.ca` and `ds-da.ca` same-origin twins, no new route entries needed)

Body: `{ handle }`. Flow:
1. `requireAccount` → row (401 if none).
2. No-op guard: `cleanHandle(body.handle) === row.handle` → 200 `{ ok:true, unchanged:true }`.
3. `validateHandle(body.handle, { holderId: row.id })` → 400 on validation failure, 409 on hold
   (the holder exception lets an account take back a name it just released).
4. **Cooldown rule:** if `row.handle` starts with `player-` → free rename, no check.
   Else if `row.last_handle_change` and `now - last_handle_change < 30d` →
   **429** + `Retry-After` in **seconds** (RFC 9110, house rule) + `seconds_left` in body.
5. Burst bucket: `rateAllow(db, 'handle', 'acct:<id>', 5)` → 429 (backstop for fat-finger loops;
   independent of the 30-day rule).
6. `db.batch` (single atomic write), wrapped in try/catch — a unique-index violation
   (two requests racing for the same name) → **409 `handle already taken`**, never 500:
   - upsert old handle into `released_handles` — **EXCEPT `player-` names** (the prefix is
     reserved anyway; holding them just fills the table) — `ON CONFLICT(handle) DO UPDATE`
     (re-releasing a name extends the hold),
   - `UPDATE players SET handle=?, last_handle_change=now, updated=now WHERE id=me`.
7. Prune: `DELETE FROM released_handles WHERE available_at < now` (same pattern as nonces).
8. Return `{ ok:true, account: publicAccount(updated) }`.

`publicAccount` gains `last_handle_change` (public info; the card UI shows "next change in Nd").

### 3.3 Write paths (store the id, keep the text)

- `handleScore` (cabinet post, member path ~line 879):
  `INSERT INTO score_handles (score_id, handle, account_id, created) VALUES (?,?,?,?)`
  — binds `account.id`. Casuals: `account_id` NULL (as today, no row).
- `handleScoreSubmit` (account signed submit): same — it already holds the account row.

### 3.4 Read paths (boards show the CURRENT handle)

- `readBoard` (~line 160) and the `/api/board/all` window query (~line 250):
  `LEFT JOIN score_handles sh ON sh.score_id = s.id
   LEFT JOIN players p ON p.id = sh.account_id`
  emit `h = p.handle ?? sh.handle` — live handle wins, historical text is the fallback
  (covers rows whose account no longer exists, and pre-migration rows if backfill missed any).
  Response shape unchanged (`{n,s,d,h}`) → cabinets, `◆ MEMBER` badge, and the champ alert
  (`x.t.h || x.t.n` in arcade-social.js) all follow the rename with zero client changes.
- sync per-board bests (~line 672): `WHERE sh.account_id = ?1` (backfill makes this complete).
  Bests follow the **account id**, so a rename does NOT re-seed them — the member's board rows
  keep their `account_id`, the PB gate keeps working: no lockout, no drop.
- `readLeaderboard` (season rank) and `profile/:id`: already id-keyed — untouched.
- Challenges: untouched (id-keyed). `?vs=<handle>-<score>` invite links resolve handle→id at
  accept time; a link minted before a rename 404s at accept — acceptable (links are transient;
  documented in the design, not in UI).

### 3.5 Anchored data — never rewritten

- D1 has NO snapshot table today (monthly snapshots + year-end tally live in the
  "BSV Score Anchors (Year-End Payout)" project, not yet built).
- Rule for when the snapshot writer ships: **freeze `handle` text at snapshot time**
  (snapshot JSON carries the name as it was); the snapshot is anchored to BSV and is immutable.
- The year-end tally aggregates **by account id** (consistent with the Gated Score Ticket design:
  "the tally always resolves sub → canonical user … historical values are immutable").
- This design changes NO anchored artifact; it only makes the live display + tally inputs
  id-following.

## 4. Client changes (`~/ds-da/`)

### 4.1 `games/arcade-account.js` (v10 → v11)

- `setHandle(handle)` → POST `/api/account/handle` (Bearer). On success, **write the updated
  account to `localStorage['dsda-account']`** — `member()` and `isMe()` read the handle from
  that cache; a stale cache means self-champ alerts and wrong initials after a rename.
- **Refresh the cached account from the server once per page load** — the existing
  `/api/account/sync` GET already returns the current account object, so the refresh is
  overwriting `dsda-account` from that response (add it if the module doesn't already do it).
  This is what makes other devices the player is logged in on pick up the new name.
- `needsName(account)` → `!!(account && account.handle && account.handle.startsWith('player-'))`.
- Login/register flows already return `account`; no flow change.

### 4.2 `account/index.html` (card page)

- **"Pick your arcade name" overlay** — shown when the page loads in owner mode with
  `needsName(account)` true (covers: fresh Fundy login landing here, and a player- handle
  that never got renamed). Contents: input (same client validation as the register form:
  2–16, a-z 0-9 _ -, live preview, `player-` prefix + blocked-word messages),
  **Keep player-XXXXXX** button (closes overlay, no API call), **Set name** button
  (`setHandle` → re-render card).
- **"Change name" link** on the owner card's handle row → same overlay. If a cooldown is
  active (`last_handle_change` within 30d and current handle is not `player-`), the overlay
  shows "next change available in N days" and disables Set.
- Public view (`?player=<id>`) shows the current handle as before (profile API is id-keyed).

### 4.3 Version bumps (house rule — verified against the tree 2026-11-27)

- `arcade-account.js` → `?v=11` in ALL THREE load sites: the `arcade-social.js` injector
  (currently v10), `account/index.html` (currently v8 — fix the drift), and
  `games/challenge-login.html` (currently v10).
- Changing the injector line inside `arcade-social.js` changes `arcade-social.js` itself →
  `arcade-social.js?v=` **v17 → v18 in all 19 files that load it** (18 cabinets + hall index)
  AND `games/sw.js` `CACHE` v24 → v25.

## 5. Testing — staging D1 only (guard stays in place)

Staging = `[env.staging]` (`cb73aa04-fa41-4fe2-a3d4-8578358bd8bf`), `wrangler dev --env
staging` on `127.0.0.1:8787`, local miniflare D1 seeded with `schema.sql` + the migration,
served same-origin via `~/ds-da/dev-server.py` (port 8897, proxies `/api/*` → 8787).
The E2E harness hard-checks staging URL + local D1 path before any DELETE (exit 2 otherwise);
negative paths verified.

Test matrix (real signup path for accounts, rows wiped between runs):
1. Register `Player-x` / `player-x` → 400 (prefix). Register `admin` → 400 (blocked).
2. Fundy-style new login (BRC-100 with fresh key, no handle) → `player-XXXXXX` created.
3. `POST /api/account/handle` `player-XXXXXX` → `bob` → 200; boards show `bob`
   (readBoard + `/all` + member badge); `player_scores`/badges/challenges unchanged (id-keyed).
4. Immediate second rename `bob` → `bob2` → 429 + `Retry-After` seconds.
5. Case-insensitive uniqueness: account B registers while A holds `bob`… A renames to `BOB`
   (same) → 200 unchanged; B tries `bob` → 409.
6. Hold: A renames `bob` → `carl` (force last_handle_change old in staging D1); B tries `bob`
   → 409 on-hold with days left. (30-day expiry untestable live — assert the `available_at`
   arithmetic in the row.)
7. Sync: member's per-board bests come from `sh.account_id` after rename.
8. Challenge: create/accept with the NEW handle; old-handle `?vs=` link → graceful 404/unknown.
10. Casual board post (no account) → `score_handles` row untouched (no account_id) — parity.
11. `EXPLAIN QUERY PLAN` on both read queries → `USING INDEX` on both join sides (no SCAN).
12. BRC-100 login with `body.handle` set to `admin` / `player-x` / a name on hold → each falls
    back to the auto name `player-<addr6>` (blocked words, prefix ban, and hold all enforced
    at login, not just at register/rename).
13. Register trying to take a name on hold → 409 on-hold.
14. Two renames racing for one name (parallel requests) → one 200, one 409 (the unique-index
    violation inside the batch surfaces as 409, never 500).
15. Live checks through Fundy use **wallet B only** (never the primary wallet).

## 6. Prod rollout (same sequence as the challenges rollout)

1. **Export first:** `wrangler d1 export <prod-uuid> --remote --output=…` → verify (non-empty,
   `CREATE TABLE`, ≥1 `INSERT INTO "scores"`, row count ≥ 80% of last backup).
2. **Migrate:** `--remote --file=migration-handle-rename.sql` (the §2 block) → verify with a
   follow-up `--remote` SELECT (backfill count = expected; `PRAGMA`-style table_info check).
3. **Read-cost gate (read-only, STOP on regression):** run the OLD `/all` window SELECT
   (no players join) and the NEW one (with `LEFT JOIN players p ON p.id = sh.account_id`)
   against prod with `--remote`, and report both `meta.rows_read` values. Staging
   `EXPLAIN QUERY PLAN` shows both plans index-driven (players join = PK lookup per bridge
   row), but the number is the gate: **if the new number is more than ~2× the old, stop and
   report before deploying.**
4. **Deploy Worker** (`deploy` script re-asserts `SESSION_SECRET` + `BOARD_SECRET`) → confirm
   NEW Version ID.
5. **Smoke test:** curl `/api/board/all` + `/api/board/leaderboard?game=dropblock` (shape
   byte-identical, `h` fields intact); one REAL member score post from a live cabinet (not curl)
   → confirm it lands with `account_id` populated (data-layer read-back); `/api/account/nonce`
   200; non-board `api.ds-da.ca/api/proof/` still tunnels (404 JSON).
6. **Frontend:** push `~/ds-da` (arcade-account.js v11, account/index.html, sw.js v25) →
   Pages deploy ~1–4 min → verify the pick-name overlay on a staging-style fresh account via
   the live site's login flow (test wallet, then nuke the test account row-by-row by id).

## 7. Risks / open questions

- **`player-` prefix on register:** register currently accepts `player-anything`; §3.1 closes
  that. Existing 2 `player-` accounts are unaffected (they can rename away; they can't
  re-grab the prefix).
- **PB gate on rename:** no drop. The per-board bests query switches to `sh.account_id = ?`,
  and a rename does not touch `score_handles.account_id` — the member's board rows and gate
  bests follow the account id, unchanged. (An earlier draft said bests re-seed on rename —
  that was wrong; the id-keyed query is strictly MORE stable than the old handle query.)
- **Schema cache:** if the Worker can't see `account_id` after deploy, fallback = the new
  `released_handles` table proves new-table visibility; the ALTER column would need the
  drop-and-recreate treatment (unlikely; avatar precedent).
- **Old challenge links:** accepted breakage (transient links), documented above.
