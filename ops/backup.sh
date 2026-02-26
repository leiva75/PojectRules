#!/bin/sh
# Cronos Fichajes - Script de backup PostgreSQL
# Compatible POSIX (sh)
# Uso: ./ops/backup.sh

set -e

# Configuracion
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CONTAINER_NAME="${DB_CONTAINER:-cronos_db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-cronos_fichajes}"

# Timestamp para nombre de archivo
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
BACKUP_FILE="backup_${TIMESTAMP}.dump"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

# Crear directorio de backups si no existe
if [ ! -d "$BACKUP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    echo "[INFO] Directorio de backups creado: $BACKUP_DIR"
fi

echo "[INFO] Iniciando backup de la base de datos..."
echo "[INFO] Fecha: $(date)"
echo "[INFO] Contenedor: $CONTAINER_NAME"
echo "[INFO] Base de datos: $POSTGRES_DB"

# Ejecutar pg_dump desde el contenedor
if docker exec "$CONTAINER_NAME" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$BACKUP_PATH"; then
    BACKUP_SIZE=$(ls -lh "$BACKUP_PATH" | awk '{print $5}')
    echo "[OK] Backup creado: $BACKUP_PATH ($BACKUP_SIZE)"
else
    echo "[ERROR] Fallo al crear backup"
    exit 1
fi

# Rotacion: eliminar backups antiguos (mas de RETENTION_DAYS dias)
echo "[INFO] Aplicando rotacion (retencion: $RETENTION_DAYS dias)..."
DELETED_COUNT=0

for file in "$BACKUP_DIR"/backup_*.dump; do
    if [ -f "$file" ]; then
        # Obtener edad del archivo en dias
        FILE_AGE=$(( ($(date +%s) - $(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)) / 86400 ))
        if [ "$FILE_AGE" -gt "$RETENTION_DAYS" ]; then
            rm -f "$file"
            DELETED_COUNT=$((DELETED_COUNT + 1))
            echo "[INFO] Eliminado backup antiguo: $(basename "$file")"
        fi
    fi
done

if [ "$DELETED_COUNT" -gt 0 ]; then
    echo "[INFO] Se eliminaron $DELETED_COUNT backups antiguos"
fi

# Mostrar resumen
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "backup_*.dump" -type f 2>/dev/null | wc -l)
echo "[INFO] Total de backups almacenados: $BACKUP_COUNT"
echo "[OK] Backup completado exitosamente"
