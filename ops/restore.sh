#!/bin/sh
# Cronos Fichajes - Script de restauracion PostgreSQL
# Compatible POSIX (sh)
# Uso: ./ops/restore.sh <archivo_backup>

set -e

# Configuracion
CONTAINER_NAME="${DB_CONTAINER:-cronos_db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-cronos_fichajes}"

# Verificar argumento
if [ -z "$1" ]; then
    echo "Uso: $0 <archivo_backup>"
    echo "Ejemplo: $0 backups/backup_2024-01-15_0300.dump"
    echo ""
    echo "Backups disponibles:"
    if [ -d "./backups" ]; then
        ls -lh ./backups/backup_*.dump 2>/dev/null || echo "  (ninguno encontrado)"
    else
        echo "  (directorio backups no existe)"
    fi
    exit 1
fi

BACKUP_FILE="$1"

# Verificar que el archivo existe
if [ ! -f "$BACKUP_FILE" ]; then
    echo "[ERROR] Archivo no encontrado: $BACKUP_FILE"
    exit 1
fi

# Mostrar informacion del backup
BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
BACKUP_DATE=$(ls -lh "$BACKUP_FILE" | awk '{print $6, $7, $8}')

echo "=============================================="
echo "RESTAURACION DE BASE DE DATOS"
echo "=============================================="
echo "Archivo: $BACKUP_FILE"
echo "Tamano: $BACKUP_SIZE"
echo "Fecha: $BACKUP_DATE"
echo "Contenedor: $CONTAINER_NAME"
echo "Base de datos: $POSTGRES_DB"
echo "=============================================="
echo ""
echo "ADVERTENCIA: Esta operacion sobrescribira todos los datos actuales."
echo ""
printf "Desea continuar? (escriba 'si' para confirmar): "
read CONFIRM

if [ "$CONFIRM" != "si" ]; then
    echo "[INFO] Restauracion cancelada por el usuario"
    exit 0
fi

echo ""
echo "[INFO] Iniciando restauracion..."

# Detener conexiones activas
echo "[INFO] Terminando conexiones activas..."
docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
    > /dev/null 2>&1 || true

# Eliminar y recrear la base de datos
echo "[INFO] Recreando base de datos..."
docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS $POSTGRES_DB;" > /dev/null
docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $POSTGRES_DB;" > /dev/null

# Restaurar desde el backup
echo "[INFO] Restaurando datos..."
if cat "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges; then
    echo "[OK] Restauracion completada exitosamente"
else
    echo "[WARN] Restauracion completada con advertencias (esto es normal)"
fi

echo ""
echo "[INFO] Reinicia la aplicacion para aplicar los cambios:"
echo "       docker compose restart app"
