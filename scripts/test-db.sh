#!/usr/bin/env bash
# Runs the database permission tests on a throw-away Postgres: the Supabase stand-in, every migration in order, then the tests.
# With DATABASE_URL set (as in CI) it uses that database instead of starting its own.
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ]; then
  BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
  DIR=$(mktemp -d)
  # Postgres won't run as root; use the postgres account when the script is run by root.
  AS=()
  if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; AS=(runuser -u postgres --); fi
  "${AS[@]}" "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
  "${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -o "-p 54329 -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
  trap '"${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT
  DATABASE_URL="postgresql://postgres@/postgres?host=$DIR&port=54329"
fi
run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }
run supabase/tests/supabase_stub.sql
for m in supabase/migrations/*.sql; do run "$m"; done
TESTS=${TESTS:-supabase/tests/permissions.sql}
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -t -A -f "$TESTS" 2>&1 | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR):  //' | grep -vE '^(\{.*\})?$'
