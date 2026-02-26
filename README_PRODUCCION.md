# Cronos Fichajes - Guía de Producción (VPS)

Esta guía explica cómo desplegar la aplicación en un servidor VPS con Docker.

## Requisitos Previos

- Ubuntu 20.04+ o Debian 11+
- Docker y Docker Compose instalados
- Un dominio configurado (recomendado para HTTPS)
- Mínimo 1GB RAM, 10GB disco

## 1. Instalación de Docker

```bash
# Actualizar paquetes
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Agregar usuario al grupo docker
sudo usermod -aG docker $USER
newgrp docker

# Verificar instalación
docker --version
docker compose version
```

## 2. Clonar y Configurar

### Clonar el repositorio
```bash
git clone <url-del-repositorio> cronos-fichajes
cd cronos-fichajes
```

### Crear archivo de configuración
```bash
cp .env.production.example .env
nano .env
```

### Variables de Entorno Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL | `MySecureP@ss123!` |
| `JWT_ACCESS_SECRET` | Clave para tokens de acceso (min 32 chars) | `openssl rand -base64 32` |
| `JWT_REFRESH_SECRET` | Clave para tokens de refresco (min 32 chars) | `openssl rand -base64 32` |
| `KIOSK_KEY` | Clave de acceso al modo kiosko (min 16 chars) | `openssl rand -base64 16` |
| `CORS_ORIGIN` | URL del frontend | `https://fichaje.miempresa.com` |

### Generar Secrets Seguros
```bash
# Generar JWT_ACCESS_SECRET
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 32)"

# Generar JWT_REFRESH_SECRET
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 32)"

# Generar KIOSK_KEY
echo "KIOSK_KEY=$(openssl rand -base64 16)"

# Generar POSTGRES_PASSWORD
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
```

## 3. Despliegue con Docker Compose

### Construir e Iniciar
```bash
# Construir y arrancar en segundo plano
docker compose up -d --build

# Ver logs en tiempo real
docker compose logs -f

# Verificar estado de los servicios
docker compose ps
```

La aplicación estará disponible en el puerto 3000.

### Verificar Salud de la Aplicación
```bash
curl http://localhost:3000/api/health
```

Respuesta esperada:
```json
{"status":"ok","db":true,"version":"1.0.0","env":"production"}
```

## 4. Migraciones de Base de Datos

### Aplicar Migraciones (Primera Vez o Cambios de Schema)
```bash
# Comando principal para sincronizar schema
docker compose exec app npm run db:push

# En caso de conflictos, usar --force (con precaución)
docker compose exec app npm run db:push -- --force
```

**Nota:** `db:push` es el comando equivalente a `migrate:prod` para Drizzle ORM.

### Cargar Datos Iniciales (Seed)
```bash
docker compose exec app npx tsx server/seed.ts
```

**Nota:** El seed crea usuarios de prueba. Cambiar contraseñas después del primer login.

## 5. Configuración de HTTPS con Caddy

Caddy obtiene certificados SSL automáticamente.

### Instalar Caddy
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### Configurar Caddyfile
```bash
sudo nano /etc/caddy/Caddyfile
```

Contenido:
```
fichaje.miempresa.com {
    reverse_proxy localhost:3000
}
```

### Reiniciar Caddy
```bash
sudo systemctl restart caddy
sudo systemctl enable caddy
```

## 6. Backups de Base de Datos

### Backup Manual
```bash
./ops/backup.sh
```

Los backups se guardan en `./backups/` con el formato `backup_YYYY-MM-DD_HHMM.dump`.

### Configurar Backup Automático (Cron)

```bash
crontab -e
```

Agregar línea para backup diario a las 3:00 AM:
```
0 3 * * * cd /ruta/a/cronos-fichajes && ./ops/backup.sh >> /var/log/cronos-backup.log 2>&1
```

### Rotación de Backups

El script de backup elimina automáticamente backups con más de 30 días.
Para cambiar la retención:
```bash
RETENTION_DAYS=60 ./ops/backup.sh
```

## 7. Restaurar Base de Datos

### Listar Backups Disponibles
```bash
ls -lh backups/
```

### Restaurar desde Backup
```bash
./ops/restore.sh backups/backup_2024-01-15_0300.dump
```

**ADVERTENCIA:** La restauración elimina todos los datos actuales y los reemplaza con el backup.

Después de restaurar, reiniciar la aplicación:
```bash
docker compose restart app
```

## 8. Comandos Útiles

```bash
# Ver logs de la aplicación
docker compose logs -f app

# Ver logs de la base de datos
docker compose logs -f db

# Reiniciar servicios
docker compose restart

# Detener todo
docker compose down

# Detener y eliminar volúmenes (BORRA DATOS)
docker compose down -v

# Actualizar aplicación
git pull
docker compose up -d --build
```

## 9. Monitoreo

### Health Check Automático
Docker reinicia automáticamente los contenedores si fallan los health checks.

### Verificar Estado
```bash
# Estado de contenedores
docker compose ps

# Health de la aplicación
curl http://localhost:3000/api/health

# Uso de recursos
docker stats
```

### Página de Estado (Admin)
Navegar a: `https://tu-dominio.com/admin` → pestaña "Estado"

Muestra:
- Versión de la aplicación
- Entorno (dev/prod)
- Estado de la base de datos
- Número de empleados

## 10. Solución de Problemas

### La aplicación no arranca
```bash
# Ver logs detallados
docker compose logs app

# Verificar variables de entorno
docker compose config
```

### Error de conexión a la base de datos
```bash
# Verificar que PostgreSQL está corriendo
docker compose ps db

# Probar conexión
docker compose exec db psql -U postgres -c "SELECT 1"
```

### Reiniciar desde cero
```bash
docker compose down -v
docker compose up -d --build
docker compose exec app npm run db:push
docker compose exec app npx tsx server/seed.ts
```

## 11. Seguridad

- Cambiar todas las contraseñas por defecto antes del primer uso
- Usar contraseñas fuertes (mínimo 16 caracteres)
- Mantener Docker y el sistema actualizados
- No exponer el puerto 3000 directamente (usar Caddy como proxy)

### Configurar Firewall
```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

## 12. Actualizaciones

```bash
# Hacer backup antes de actualizar
./ops/backup.sh

# Obtener cambios
git pull

# Reconstruir y reiniciar
docker compose up -d --build

# Aplicar migraciones si hay cambios de schema
docker compose exec app npm run db:push
```
