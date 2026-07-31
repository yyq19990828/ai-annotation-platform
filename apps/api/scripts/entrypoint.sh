#!/bin/sh
set -e
if [ "${ALEMBIC_AUTO_UPGRADE:-true}" = "true" ]; then
  alembic upgrade head
fi
unset MIGRATION_DATABASE_URL
exec "$@"
