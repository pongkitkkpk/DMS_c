# Deploying the demo

This puts the system on the public internet as a demonstration — the mock
auth provider, not ICIT (see `DMS_REBUILD_STRATEGY.md`, "Stack"). Three
pieces, all free, none needing a credit card:

- **Aiven** — a managed MySQL database
- **Render** — two services from one repo: the API (`dms-demo-api`) and the
  built React app as a static site (`dms-demo`)

`render.yaml` at the repo root describes both Render services. Most of the
work below is filling in the values it deliberately leaves blank
(`sync: false`) — secrets belong on the dashboard, not committed to git.

## 1. Create the database (Aiven)

1. Sign up at [aiven.io](https://aiven.io) — no card required for the free
   plan.
2. Create a new service → **MySQL** → free plan → any region close to your
   users.
3. Once it's running, open the service page and note, from the **Overview**
   tab:
   - **Host**
   - **Port**
   - **User** (Aiven's default service user, *not* `root` — the app's own
     config refuses `DB_USER=root` in production anyway, see `config.js`)
   - **Password**
   - **Database name** — either use the default `defaultdb` or create one
     named `dms` (Aiven's console has a "Databases" tab for this)

## 2. Load the schema and demo data

**Migrations no longer need doing by hand** — `render.yaml` runs
`npm run db:migrate` as part of the API's build, so every deploy brings the
schema up to date before the new code starts. The step below is still how you
do it the *first* time, because the demo data (`db:seed`) is not part of a
deploy and never will be: seeding truncates the tables it owns, which is right
for standing up a fresh database and catastrophic on a running one.

The migration and seed scripts read the same `DB_*` environment variables the
running app does. From `backend/`, with a `.env` pointed at Aiven instead of
XAMPP:

```env
DB_HOST=<aiven host>
DB_PORT=<aiven port>
DB_USER=<aiven user>
DB_PASS=<aiven password>
DB_NAME=dms
DB_SSL=1
```

Then, from `backend/`:

```bash
npm run db:migrate
npm run db:seed
```

`db:seed` (no `--no-fixtures` flag) loads the demonstration accounts shown on
the login page — that's the point of a demo. Confirm it worked:

```bash
npm run check:all
```

against the same `.env`. This is the same 483-assertion suite the project
already runs locally; seeing it pass against Aiven means the schema and
fixtures are in place before Render ever sees them.

## 3. Generate the two secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

This is `JWT_SECRET` — tokens are signed with it, and it needs to be at
least 32 characters (see `config.js`'s own check).

`MOCK_PASSWORD` is whatever shared password you want to hand out with the
demo link — at least 8 characters. It is a door on a demonstration, not
authentication (`config.js` says the same thing where it's defined):
everyone who has the link and this password can sign in as any fixture
account, `fixture.admin` included.

## 4. Deploy on Render

1. Sign up at [render.com](https://render.com) — no card required for the
   free plan.
2. **New → Blueprint**, connect the GitHub repo
   (`pongkitkkpk/DMS_c`). Render reads `render.yaml` and proposes both
   services — confirm.
3. Before the first deploy finishes successfully, open **dms-demo-api →
   Environment** and fill in every `sync: false` value from the file:
   `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` (from step 1),
   `JWT_SECRET`, `MOCK_PASSWORD` (from step 3).
4. Save — Render redeploys the API with the real values.

**If you set up TLS before this file dropped the CA-cert step**, `dms-demo-api`
may still carry a `DB_SSL_CA_PATH` variable pointing at a Secret File
(`/etc/secrets/aiven-ca.pem`) that no longer exists — `render.yaml` no longer
declares it, but a Blueprint sync only manages variables *currently in the
file* and does not delete one added earlier by hand. The symptom is the API
crashing on boot with `ENOENT: ... /etc/secrets/aiven-ca.pem`, because
`connectionOptions.js` prefers a CA path over `DB_SSL=1` whenever one is set,
found or not. Fix: **dms-demo-api → Environment**, delete `DB_SSL_CA_PATH`
(and the Secret File, if one is still attached) — `DB_SSL=1` alone is correct
and needs no file.

Both service names are fixed in `render.yaml` (`dms-demo-api`, `dms-demo`)
specifically so each one's URL is known before the other builds — a static
site's `REACT_APP_API_BASE` is baked in at *build* time, not read at
runtime, so it has to be right in the blueprint from the start. If either
name is already taken on Render, edit both the taken one *and* the other
service's env var/URL that references it before deploying, or the frontend
will build pointing at a URL that doesn't exist.

**This happened on the actual deploy.** `dms-demo-api` was already taken, so
the live API landed at `dms-demo-api-hqwa.onrender.com` instead — `dms-demo`
came through unchanged. `render.yaml`'s `REACT_APP_API_BASE` is pinned to the
real API URL to match. If you redeploy under different service names, update
that value and push — the static site does not pick up a changed env var
until its *next build*, so a dashboard-only edit with no redeploy leaves the
old URL baked into the files already served.

## 5. Check it

- `https://<your-api-service>.onrender.com/api/health` → `{"status":"ok","database":"ok",...}`
- `https://<your-frontend-service>.onrender.com` → the login page, with the
  demonstration account list showing (confirms `GET /api/auth/mode` is
  reachable and `ALLOW_MOCK_AUTH`/`MOCK_PASSWORD` are both set — see
  `config.js`, deviation 19 in `docs/DECISIONS.md`). Pick any account, enter
  the shared `MOCK_PASSWORD`.

## Known limits of this setup, worth knowing before sharing the link

- **Free-tier cold start.** Render's free web services spin down after 15
  minutes idle and take ~30–50 seconds to wake on the next request. Fine for
  a demo; the first click after a while looks like nothing is happening.
- **Uploaded attachments do not persist.** Render's free web service disk is
  ephemeral — a redeploy or restart clears anything written to
  `backend/uploads`. Attaching a file will work within a session but should
  not be relied on to survive one. Moving attachment storage to something
  durable (S3-compatible object storage) is a real change, not a config
  flag, and is out of scope for standing this demo up.
- **Aiven's free MySQL is 1 GB.** Comfortably enough for the reference data
  and fixtures; not sized for load-testing.
