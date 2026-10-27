# FanThynks TEST — deployment prerequisites

These scripts are **deployment prerequisites**, not migrations.

They live outside `packages/db/migrations/` deliberately: the migration runner
globs that directory and would otherwise treat a prerequisite as a historical,
checksum-recorded migration — which must never happen.

## `fanthynks-test-migrator-prerequisites.sql`

**sha256:** `4e63c878d92dcafc9511fc3fa14bb87fd29b5656dc36d1de9ebf299cd7e0dff6`
**applies to:** FanThynks TEST (`fanthynks_test` database)
**execute as:** `fanthynks_admin` (owner of the affected tables)
**idempotent:** yes

### Why it is required

This database was bootstrapped in two stages. Most tables were created by
`axiom_migrator`, but six were created by `fanthynks_admin`. Four of those are
touched by migrations 0027..0047, which run **as `axiom_migrator`**:

| table | requirement | remedy |
|---|---|---|
| `agent_permission` | FK target of 0028 | column-level `REFERENCES (id)` grant |
| `asset_variant` | FK target of 0030/0033/0036 **and** `ALTER`ed by 0035 | grant **+ ownership** |
| `viral_recipe` | `ALTER`ed by 0040 | ownership |
| `bandit_state` | `CREATE INDEX` by 0041 | ownership |

PostgreSQL has no grantable `ALTER` privilege — `ALTER TABLE` and `CREATE INDEX`
require ownership. `REFERENCES`, by contrast, is grantable and is kept as narrow
as possible (column-level, on `id` only).

### Net effect

* **3** ownership transfers — `asset_variant`, `viral_recipe`, `bandit_state`
* **2** `REFERENCES (id)` grants — `agent_permission`, `asset_variant`
* **`agent_permission` keeps its existing owner** (`fanthynks_admin`)

### Deliberately excluded

`kill_switch`, `api_key`, `api_idempotency` are also `fanthynks_admin`-owned but
are **not** referenced by any migration in 0027..0047. No blanket grants.

### Not done

No rewriting of checksum-recorded migrations · no dropped foreign keys · no
superuser execution of the migration set · no `REASSIGN OWNED` · no
`GRANT ... ON ALL TABLES` · no `GRANT fanthynks_admin TO ...`.

### Execution

Run transactionally with `ON_ERROR_STOP`:

```bash
psql -X -v ON_ERROR_STOP=1 -U fanthynks_admin -d fanthynks_test \
     -f deploy/prerequisites/fanthynks-test-migrator-prerequisites.sql
```

The script asserts its own preconditions and raises an exception if the
resulting state does not match the expectation, so a partial or unexpected
application aborts the transaction rather than leaving the database in between
states.
