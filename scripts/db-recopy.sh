#!/usr/bin/env bash
# Re-copy ALL rows from one Supabase project (OLD) into another (NEW) whose
# schema is already in place (pg_restore of the public schema; docs/speed-plan.md E).
# Truncates NEW first, so every row there is dropped. Needs Docker (postgres:17,
# host networking for IPv6). Usage: db-recopy.sh <OLD_DB_URL> <NEW_DB_URL>
set -euo pipefail
OLD="$1"; NEW="$2"; PG="docker run --rm -i --network host postgres:17"
D=$(dirname "$0")/dump; mkdir -p "$D"
t0=$(date +%s)
echo "1 dump"; $PG pg_dump "$OLD?sslmode=require" --data-only --table=auth.users --table=auth.identities --no-owner > "$D/auth.sql"
$PG pg_dump "$OLD?sslmode=require" --data-only --schema=public --no-owner --format=custom > "$D/public-data.dump"
echo "   $(( $(date +%s) - t0 ))s, $(du -h "$D/public-data.dump" | cut -f1)"
TABLES=$($PG psql "$NEW?sslmode=require" -tA -c "select string_agg('public.'||quote_ident(relname), ', ') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
echo "2 truncate + drop trigger"; $PG psql "$NEW?sslmode=require" -v ON_ERROR_STOP=1 -q -c "drop trigger if exists on_auth_user_created on auth.users; truncate auth.identities, auth.users, $TABLES cascade;"
echo "3 restore"; $PG psql "$NEW?sslmode=require" -v ON_ERROR_STOP=1 -q < "$D/auth.sql" >/dev/null
$PG pg_restore --dbname="$NEW?sslmode=require" --data-only --no-owner --exit-on-error < "$D/public-data.dump"
echo "4 trigger + analyze"; $PG psql "$NEW?sslmode=require" -v ON_ERROR_STOP=1 -q -c "create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();" -c "analyze"  2>&1 | grep -v WARNING || true
echo "5 exact counts old vs new"
COUNTS="select string_agg(relname||'='||(xpath('/row/c/text()', query_to_xml('select count(*) c from public.'||quote_ident(relname), false, true, '')))[1]::text, ' ' order by relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"
A=$($PG psql "$OLD?sslmode=require" -tA -c "$COUNTS"); B=$($PG psql "$NEW?sslmode=require" -tA -c "$COUNTS")
echo "   old: $A"; echo "   new: $B"; [ "$A" = "$B" ] && echo "   MATCH" || echo "   MISMATCH"
echo "   auth old: $($PG psql "$OLD?sslmode=require" -tA -c "select count(*) from auth.users")/$($PG psql "$OLD?sslmode=require" -tA -c "select count(*) from auth.identities")  new: $($PG psql "$NEW?sslmode=require" -tA -c "select count(*) from auth.users")/$($PG psql "$NEW?sslmode=require" -tA -c "select count(*) from auth.identities")"
echo "total $(( $(date +%s) - t0 ))s"
