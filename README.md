# Campus Lost & Found Management System

A DBMS mini project: students report **lost** / **found** items, the system generates
**possible matches** with a SQL-based score out of 100, and an **admin** reviews matches,
contacts both parties, and marks confirmed returns as **resolved**.

Stack: **MySQL 8 + Node.js (Express, EJS)** — deliberately simple UI; the SQL is the project.

---

## 1. Quick start

1. **Install prerequisites** (once):
   - [Node.js 18+](https://nodejs.org) (LTS)
   - [MySQL 8](https://dev.mysql.com/downloads/installer/) — remember the root password you set.

2. **Configure** — copy the example env and edit the DB password:
   ```bash
   cp .env.example .env
   # then edit .env and set DB_PASS
   ```

3. **Create + seed the database** (one command):
   ```bash
   npm install
   npm run setup
   ```

4. **Run**:
   ```bash
   npm start
   # → http://localhost:3000
   ```

5. **Log in as admin** at `/admin/login`:
   - `admin@campus.edu` / `admin123`
   - `security@campus.edu` / `admin123`

The seed data already contains matched pairs (watch/wallet/bottle) so the
**Possible Matches** page is populated on first login.

---

## 2. Screens

| Route | Screen |
| --- | --- |
| `/` | Home — I LOST SOMETHING / I FOUND SOMETHING / ADMIN LOGIN |
| `/lost` | Lost item form (photo optional) |
| `/found` | Found item form + "how submitted" radio (keeping / handed to Box) |
| `/admin/login` | Admin login |
| `/admin` | Dashboard: 4 counters (SQL COUNT) + top 5 pending matches |
| `/admin/lost-reports` | All lost reports (table) → detail page |
| `/admin/found-reports` | All found reports (table, with SOURCE) → detail page |
| `/admin/box-entry` | Admin enters an item from the physical Lost & Found Box (`source = BOX`) |
| `/admin/matches` | Possible matches, sorted by score (≥ threshold) |
| `/admin/matches/:id` | Side-by-side detail + contact info + Resolve / Reject |
| `/admin/resolved` | Resolved items history |

## 3. Database design

Six tables + settings, all InnoDB with FKs and CHECK constraints:

```
USERS ──┬──< LOST_REPORTS  >──┐
        │                     │
        └──< FOUND_REPORTS >──┤
                              │
ITEMS ────< LOST_REPORTS      ├──< MATCHES >── (lost_id, found_id)
        │   FOUND_REPORTS     │        │
LOCATIONS─┘                    │   TRG_MATCH_AFTER_UPDATE:
                               │   resolve match ⇒ resolve both reports
APP_SETTINGS (MATCH_THRESHOLD) ┘   + reject other stale pendings
```

- `USERS(user_id, name, email UNIQUE, phone, role STUDENT|ADMIN, password_hash)`
- `ITEMS(item_id, item_name, category, description, color, brand, photo)`
- `LOCATIONS(location_id, location_name UNIQUE)`
- `LOST_REPORTS(lost_id, user_id FK, item_id FK, location_id FK, lost_date, lost_time, status OPEN|RESOLVED)`
- `FOUND_REPORTS(found_id, …, source USER|BOX, status UNCLAIMED|RESOLVED)`
- `MATCHES(match_id, lost_id FK, found_id FK UNIQUE-pair, match_score 0..100, status PENDING|REJECTED|RESOLVED, created_at, resolved_at)`

Views: `possible_matches_view` (full joined detail for the admin UI) and
`resolved_items_view` (resolved history).

### Match score (SQL function `FN_COMPUTE_MATCH_SCORE`)

| Criterion | Points |
| --- | ---: |
| Same category (hard requirement — else score = 0) | +20 |
| Item name: exact / one contains other / ≥2 words overlap | +20 / +15 / +10 |
| Same color (both present) | +15 |
| Same brand (both present) | +15 |
| Same location | +20 |
| Date proximity: ≤1d / 2d / 3d / ≤7d | +10 / +7 / +5 / +3 |
| **Maximum** | **100** |

`SP_REFRESH_MATCHES()` re-runs the scoring across OPEN × UNCLAIMED pairs within 30 days
and inserts/updates/hides MATCHES rows above `MATCH_THRESHOLD` (default 50, stored in
`app_settings`). It is called after every submission and on dashboard load.
`TRG_MATCH_AFTER_UPDATE` cascades a resolution to both reports and rejects stale pendings.

## 4. SQL scripts (`sql/`)

| File | Contents |
| --- | --- |
| `01_schema.sql` | DDL: database, 7 tables, PK/FK/CHECK/UNIQUE, indexes, app_settings, 2 views |
| `02_programmability.sql` | `FN_COMPUTE_MATCH_SCORE`, `SP_REFRESH_MATCHES`, `TRG_MATCH_AFTER_UPDATE` |
| `03_queries.sql` | Demo catalog: all required SELECTs, joins, aggregates (COUNT/MAX/MIN/AVG) |
| `04_seed.sql` | Demo students, locations, matched/unmatched reports (incl. BOX source) |

## 5. Project layout

```
sql/                  SQL scripts (run in numbered order)
scripts/setup-db.js   one-command setup (schema + seed + admin passwords)
src/
  server.js           Express entry point
  db.js               MySQL pool + helpers
  matching.js         JS mirror of the SQL scorer (for "possible matches" preview)
  middleware/auth.js  requireAdmin guard
  routes/public.js    student pages (home, lost, found + photo upload)
  routes/admin.js     admin pages (login, dashboard, reports, box, matches, resolved)
  views/*.ejs         EJS templates
  public/css/style.css
uploads/              uploaded photos (stored as files, path in ITEMS.photo)
```

## 6. Notes / limitations (MVP)

- Admin auth is a single password check (bcrypt) with a session cookie — deliberately simple.
- Matching is plain SQL string/date comparison, no AI or image recognition (per spec).
- "Contact both parties" is out-of-app: the match page shows mailto/tel links.
- To change the match threshold: `UPDATE app_settings SET env_value='40' WHERE env_key='MATCH_THRESHOLD';`
  then reload the dashboard (or edit `MATCH_THRESHOLD` before first setup).
- Re-running `npm run setup` is safe: schema statements are `IF NOT EXISTS` / idempotent.
