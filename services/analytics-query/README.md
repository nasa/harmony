# Analytics query service

Runs read-only SQL queries against the Harmony Iceberg analytics tables (the copies of the jobs
database the cron service's analytics job writes to S3 Tables), using DuckDB. It is the backend for
the `/admin/analytics` page in the harmony frontend. Only the frontend calls it: the frontend checks
that the user is an admin or log viewer, then calls this service with a shared secret and the user's
name.

## The page

`/admin/analytics` in the harmony frontend (`services/harmony/app/frontends/analytics.ts`,
`public/js/analytics`) is the UI. It's open to admins and log viewers:
`ADMIN_OR_LOG_VIEWER_PATHS` in `app/middleware/permission-groups.ts` exempts it from the admin-only
check on other `/admin` routes. It has:
- a SQL editor with DuckDB-flavoured highlighting
- table/column completion from `/api/schema`
- errors underlined as you type, from `/api/validate`
- a form for the query's parameters
- a results table with CSV download
- saved queries, including the parameter values to use by default. These are stored in the jobs
  database's `analytics_queries` table and served by the frontend itself, at
  `/admin/analytics/api/queries`. Everyone who can use the page can see and run every saved query.
  Only its owner or an admin can change or delete one. `?query=<id>` links to a saved query.
- a chart of the results, saved with the query (`public/js/analytics/chart.js`), as columns
  (stacked for several series) or lines. Either several numeric columns are each a series, or one
  is split into a series per value of another column. Past eight series the smallest are combined
  as "Other". Times are shown in UTC, the timezone queries run in. It uses the admin dashboard's
  chart kit (`public/js/dashboard/charts.js`) and its palette, so charts have the same tooltips and
  table view.

The frontend passes `/admin/analytics/api/{schema,validate,query}` to this service, adding the
shared secret and the user. `ANALYTICS_QUERY_URL`, `ANALYTICS_QUERY_SHARED_SECRET` and
`ANALYTICS_QUERY_REQUEST_TIMEOUT_MS` in `services/harmony/env-defaults` configure that. POSTs must be
JSON, which stops a cross-site form from running a query as a logged-in user.

The editor is CodeMirror 6, bundled into `public/js/vendor/codemirror.js` by
`services/harmony/bin/build-codemirror-bundle` from the pinned versions in
`services/harmony/vendor-build/codemirror`. The bundle is committed. Rebuild it only to update
CodeMirror or change what the page imports from it.

## API

Every `/api` request needs `Authorization: Bearer $ANALYTICS_QUERY_SHARED_SECRET` and an
`x-harmony-user` header naming the user (for the audit log).

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/schema` | | `{ tables: [{ name, columns: [{ name, type }] }], warnings, loadedAt }`. Cached for `ANALYTICS_SCHEMA_CACHE_SECONDS`. `warnings` lists timestamp columns that aren't `TIMESTAMPTZ`. |
| `POST /api/validate` | `{ sql }` | `{ valid, errors: [{ message, position }], columns, parameters }`, always with a 200. `position` is a character offset into `sql` (or null), for marking the error in an editor. |
| `POST /api/query` | `{ sql, params?, limit? }` | `{ columns, rows, rowCount, truncated, durationMs }`. At most `limit` rows are returned (default and maximum `ANALYTICS_QUERY_MAX_ROWS`, which `/api/schema` reports as `limits.maxRows`), whether or not the query has a LIMIT. Reading stops at the limit, so the rest of the result is never read. `truncated` says there were more. Each row is an array in column order. Timestamps are ISO 8601 UTC strings. Integers that fit in a JS number are numbers. |
| `GET /liveness`, `GET /readiness` | | For Kubernetes. Not ready until the catalog is attached. |

Errors are `{ code, message, errors }`. An invalid query or bad parameter gets a 400, a missing
secret a 401, a query past `ANALYTICS_QUERY_TIMEOUT_MS` a 408, and a 503 means the catalog isn't
attached yet or too many queries are already running or waiting.

Queries can use named parameters (`$start`) and the values are bound, never put into the SQL. A
value is a string, number, boolean, null, or a list of one of those. DuckDB casts it to the type it
inferred for the parameter, so an ISO string works for a timestamp. A parameter DuckDB can't infer
a type for needs a cast, e.g. `unnest($ids::BIGINT[])`.

## How queries are kept read-only

There are several layers, and each holds on its own:

1. **IAM (deployed only).** The service's role can only read the table bucket. That role is
   defined in harmony-ci-cd.
2. **The DuckDB connection** (`app/query/catalog.ts`):
   - The catalog is attached `READ_ONLY`, so writes fail.
   - `enable_external_access=false`, with `allowed_directories` limited to the catalog's REST
     endpoint and `s3://`, so local files and every other URL (including the instance metadata
     endpoint) can't be read.
   - Extension install and autoload are off.
   - The configuration is locked, so no query can undo any of this.
3. **Validation** (`app/query/validate.ts`), run again on every execution:
   - DuckDB's own parser (`json_serialize_sql`) must accept the query as exactly one SELECT.
   - Every table must be an analytics table, or a CTE the query defines.
   - Table functions are allowlisted and a few scalar functions are denied.
   - The query must bind cleanly.
4. **Limits:** a time limit (enforced with `interrupt()`), a row cap (results are streamed and
   reading stops at the cap), and caps on how many queries run and wait at once.

Every query is logged with the user, SQL, parameters and outcome.

`test/validate.ts` and `test/catalog.ts` check layers 2 and 3 against a local DuckDB file. Layer 2
is checked with the validator bypassed. `test/iceberg-integration.ts` runs the layer-2 checks
against real Iceberg tables in ministack.

## Things learned the hard way

- **The Iceberg catalog looks up table names case-sensitively** (`JOBS` fails, quoted or not).
  Catalog, schema and column names aren't case-sensitive. The validator rejects mis-cased table
  names with a hint, so a query behaves the same everywhere.
- **`iceberg` needs the `avro` extension.** With autoinstall off, all four extensions (`aws`,
  `httpfs`, `avro`, `iceberg`) are installed when the Docker image is built.
- **`TimeZone` is per connection, and locked once the configuration is.** It's set globally to UTC
  before the lock, and every connection runs `USE catalog.iceberg`.
- **The node API renders `TIMESTAMPTZ` values in the process's local timezone,** whatever DuckDB's
  setting, so results convert them to UTC from the raw microseconds.
- **DuckDB rounds a fractional number bound to an integer parameter,** so the service rejects one.
- **Ministack's Iceberg REST endpoint can't drop tables,** and its S3 Tables API used to lose
  `timestamptz` and partition specs. `bin/create-iceberg-tables` now creates the ministack tables
  through REST (`bin/create-ministack-iceberg-tables.mjs`).

## Running it locally

`bin/start-dev-services` starts it on port 5007 (debugger on 9307) against the local dev ministack.
To run it on its own:

```fish
cd services/analytics-query
npm install   # once, on each OS you run it on - it installs that platform's DuckDB bindings
env PORT=5007 LOCALSTACK_HOST=localhost npm run start-dev-fast
curl -H 'Authorization: Bearer local-development-only' -H 'x-harmony-user: me' localhost:5007/api/schema
```

The first start downloads the DuckDB extensions into `~/.duckdb/extensions`.

## Testing

```fish
npm test                 # lint, mocha with coverage, audit
npm run test-fast        # mocha only
# also run the lockdown checks against the local dev ministack
env ANALYTICS_QUERY_ICEBERG_TEST=ministack LOCALSTACK_HOST=localhost npm run test-fast
```

## Deploying

Outside local development the service needs:
- `S3_TABLE_BUCKET_ARN`
- a real `ANALYTICS_QUERY_SHARED_SECRET`, which the service refuses to start without. Keep it in an
  `analytics-query-secrets` k8s secret, not `harmony-secrets`, which the backend service containers
  can read. The harmony frontend needs the same value.
- a read-only IAM role for its service account (`s3tables:Get*`/`List*` and `s3:GetObject` on the
  table bucket)
