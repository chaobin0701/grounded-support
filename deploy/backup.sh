#!/bin/sh
set -eu
umask 077
cd /opt/hexu-support
exec 9>backups/.backup.lock
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="/opt/hexu-support/backups/${stamp}"
mkdir -m 700 "$destination"
compose() { docker compose --env-file .env.production -f compose.production.yml "$@"; }
# Quiesce writes briefly so SQL and uploads describe one state. No volumes are removed.
trap 'compose start api worker edge >/dev/null' EXIT
compose stop --timeout 30 edge worker api >/dev/null
compose run --rm --no-deps --user 0 -v /opt/hexu-support/deploy/backup-manifest.cjs:/app/backup-manifest.cjs:ro api node backup-manifest.cjs > "$destination/manifest.json"
compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$destination/database.dump"
tar -czf "$destination/uploads.tar.gz" -C data uploads
cp .env.production compose.production.yml "$destination/"
sha256sum "$destination/database.dump" "$destination/uploads.tar.gz" > "$destination/SHA256SUMS"
printf 'Backup completed: %s\n' "$destination"
# No automatic deletion; inspect disk and copy completed backups off the server.
