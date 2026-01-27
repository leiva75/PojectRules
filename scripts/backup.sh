#!/bin/bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/cronos_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Iniciando backup de la base de datos..."

pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

echo "[$(date)] Backup creado: $BACKUP_FILE"

echo "[$(date)] Eliminando backups con más de $RETENTION_DAYS días..."
find "$BACKUP_DIR" -name "cronos_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete

BACKUP_COUNT=$(find "$BACKUP_DIR" -name "cronos_*.sql.gz" -type f | wc -l)
echo "[$(date)] Backup completado. Total de backups: $BACKUP_COUNT"
