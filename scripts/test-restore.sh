#!/usr/bin/env bash
# Restore drill: proves a backup can be brought back. On a throw-away Postgres it builds a company through the real
# server code (many people selling, buying and paying at once), takes the backup exactly as the nightly job does
# (.github/workflows/backup.yml: pg_dump, then openssl encryption), restores it the way docs/RECOVERY.md says into an
# empty database, and checks that every table, every row and the company as the app loads it are identical.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
DIR=$(mktemp -d)
AS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; AS=(runuser -u postgres --); fi
"${AS[@]}" "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -o "-p 54339 -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
trap '"${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT
LIVE="postgresql://postgres@/postgres?host=$DIR&port=54339"
COPY="postgresql://postgres@/restored?host=$DIR&port=54339"
run() { psql "$1" -v ON_ERROR_STOP=1 -q -f "$2"; }

echo "1. A live company: every migration, then a day of work through the real server code"
run "$LIVE" supabase/tests/supabase_stub.sql
for m in supabase/migrations/*.sql; do run "$LIVE" "$m"; done
SIM_DATABASE_URL="$LIVE" SIM_SIZE=${SIM_SIZE:-0} SIM_PEOPLE=${SIM_PEOPLE:-8} SIM_ROUNDS=${SIM_ROUNDS:-4} npx vitest run src/lib/dbsim.test.ts >/dev/null
WS=$(psql "$LIVE" -X -t -A -c "select id from public.workspaces order by created_at desc limit 1")
echo "   company $WS"

echo "2. The nightly backup, as .github/workflows/backup.yml takes it"
PASS="restore-drill-$(date +%s)"
"${AS[@]}" "$BIN/pg_dump" "$LIVE" --format=custom --no-owner --no-privileges --schema=public --schema=private --schema=auth > "$DIR/backup.dump"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "pass:$PASS" -in "$DIR/backup.dump" -out "$DIR/backup.dump.enc"
rm "$DIR/backup.dump"
echo "   $(stat -c %s "$DIR/backup.dump.enc") bytes, encrypted"

echo "3. Restored the way docs/RECOVERY.md says, into an empty database"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "pass:$PASS" -in "$DIR/backup.dump.enc" -out "$DIR/restored.dump"
psql "$LIVE" -q -c "create database restored"
# the roles (anon, authenticated …) belong to the server, as on a new Supabase project
# an empty database (like a new Supabase project) already has the public schema: everything else is restored
"$BIN/pg_restore" -l "$DIR/restored.dump" | grep -v ' SCHEMA - public ' > "$DIR/restore.list"
"${AS[@]}" "$BIN/pg_restore" --no-owner --no-privileges --exit-on-error -L "$DIR/restore.list" --dbname "$COPY" "$DIR/restored.dump"

echo "4. Compared table by table, row by row"
SUMS="select string_agg(t || '=' || n || ':' || h, E'\n' order by t) from (
  select c.table_schema || '.' || c.table_name as t,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', c.table_schema, c.table_name), false, true, '')))[1]::text as n,
    (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) as h from %I.%I x', c.table_schema, c.table_name), false, true, '')))[1]::text as h
  from information_schema.tables c where c.table_schema in ('public', 'private') and c.table_type = 'BASE TABLE') s"
A=$(psql "$LIVE" -X -t -A -c "$SUMS")
B=$(psql "$COPY" -X -t -A -c "$SUMS")
if [ "$A" != "$B" ]; then diff <(echo "$A") <(echo "$B") || true; echo "RESTORE DRILL FAILED: the restored tables differ"; exit 1; fi
TABLES=$(echo "$A" | wc -l)
ROWS=$(echo "$A" | sed -E 's/.*=([0-9]+):.*/\1/' | paste -sd+ | bc)
echo "   $TABLES tables, $ROWS rows: identical"
LA=$(psql "$LIVE" -X -t -A -c "select md5(public.load_workspace('$WS')::text)")
LB=$(psql "$COPY" -X -t -A -c "select md5(public.load_workspace('$WS')::text)")
if [ "$LA" != "$LB" ]; then echo "RESTORE DRILL FAILED: the company loads differently"; exit 1; fi
echo "   the company as the app loads it: identical ($LA)"
echo "RESTORE DRILL PASSED"
