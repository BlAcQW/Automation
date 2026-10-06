#!/usr/bin/env bash
# Real-database test harness (wave 3, A10).
#
# Starts a THROWAWAY postgres:16-alpine container on a random loopback port,
# creates a uniquely named database carrying a one-time marker, applies every
# migration with `prisma migrate deploy`, runs `vitest -c vitest.db.config.ts`,
# and removes the container on exit, failure or ctrl-c.
#
# It never reads apps/api/.env or the repo .env and never accepts a
# DATABASE_URL from the caller: the URL is generated here, for the container
# this script created. The vitest side re-verifies that (test/db/helpers/guard.ts).
#
# Usage:  scripts/test-db.sh [vitest args...]      e.g.  scripts/test-db.sh -t "ledger"
# Env:    TEST_DB_KEEP=1      leave the container running (prints how to remove it)
#         TEST_DB_IMAGE=...   override the image (default postgres:16-alpine)
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${TEST_DB_IMAGE:-postgres:16-alpine}"
NAME="bookly-testdb-$$-$RANDOM"
DB_NAME="bookly_test_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
TOKEN="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"

command -v docker >/dev/null || { echo "test-db: docker is required" >&2; exit 2; }

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ "${TEST_DB_KEEP:-}" == "1" ]]; then
    echo "test-db: leaving container running. Remove with: docker rm -f $NAME" >&2
  else
    docker rm -f "$NAME" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
CHILD=""
# Bash only runs a trap once the foreground command ends, so long steps run in
# the background and are `wait`ed on: a signal then interrupts the wait at once,
# the child is stopped, and the EXIT trap removes the container.
on_signal() {
  local code=$1
  trap '' INT TERM
  if [[ -n "$CHILD" ]]; then kill -TERM "$CHILD" 2>/dev/null || true; wait "$CHILD" 2>/dev/null || true; fi
  exit "$code"
}
run() { "$@" & CHILD=$!; wait "$CHILD"; local rc=$?; CHILD=""; return "$rc"; }
trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

# Nothing from the developer's shell may leak into the run (a DATABASE_URL
# exported for the real app, for instance).
unset DATABASE_URL DIRECT_URL SHADOW_DATABASE_URL BOOKLY_TEST_DB_URL BOOKLY_TEST_DB_TOKEN

echo "test-db: starting $IMAGE as $NAME ..." >&2
docker run -d --name "$NAME" \
  --label bookly.test-db=1 \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data \
  "$IMAGE" \
  -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
  -c max_connections=300 -c deadlock_timeout=200ms >/dev/null

PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
[[ -n "$PORT" ]] || { echo "test-db: could not determine the mapped port" >&2; exit 2; }

# The entrypoint runs a temporary socket-only server first; a TCP probe only
# succeeds against the final one.
for i in $(seq 1 90); do
  if docker exec "$NAME" psql -h 127.0.0.1 -U postgres -d postgres -Atc 'select 1' >/dev/null 2>&1; then
    break
  fi
  [[ $i -eq 90 ]] && { echo "test-db: postgres did not become ready" >&2; docker logs "$NAME" >&2 || true; exit 2; }
  sleep 0.5
done

docker exec "$NAME" psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c "CREATE DATABASE \"$DB_NAME\"" \
  -c "ALTER DATABASE \"$DB_NAME\" SET bookly.throwaway = '$TOKEN'" >/dev/null

export DATABASE_URL="postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}?connection_limit=40&pool_timeout=60"
export BOOKLY_TEST_DB_URL="$DATABASE_URL"
export BOOKLY_TEST_DB_TOKEN="$TOKEN"
export NODE_ENV=test

cd "$API_DIR"
echo "test-db: applying migrations to $DB_NAME on 127.0.0.1:$PORT ..." >&2
run npx prisma migrate deploy >&2

echo "test-db: running vitest ..." >&2
set +e
run npx vitest run -c vitest.db.config.ts "$@"
exit $?
