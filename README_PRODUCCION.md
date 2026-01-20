# Pointeuse Hybride - Guía de Producción (VPS)

Esta guía explica cómo desplegar la aplicación en un servidor VPS sin depender de Replit.

## Requisitos Previos

- Ubuntu 20.04+ o Debian 11+
- Docker y Docker Compose instalados
- Un dominio configurado (opcional pero recomendado para HTTPS)

## 1. Instalación de Docker

```bash
# Actualizar paquetes
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Agregar usuario al grupo docker
sudo usermod -aG docker $USER

# Instalar Docker Compose
sudo apt install docker-compose-plugin -y

# Verificar instalación
docker --version
docker compose version
```

## 2. Configuración del Proyecto

### Clonar el repositorio
```bash
git clone <url-del-repositorio> pointeuse
cd pointeuse
```

### Crear archivo de configuración
```bash
cp .env.example .env
nano .env
```

### Variables de entorno requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DB_PASSWORD` | Contraseña de PostgreSQL | `mi_password_seguro_123` |
| `SESSION_SECRET` | Clave secreta para JWT (min 32 caracteres) | `abc123...` |
| `CORS_ORIGIN` | URL del frontend | `https://mi-dominio.com` |
| `NODE_ENV` | Entorno de ejecución | `production` |

## 3. Despliegue con Docker Compose

```bash
# Construir y arrancar en segundo plano
docker compose up -d --build

# Ver logs
docker compose logs -f

# Verificar estado
docker compose ps
```

La aplicación estará disponible en el puerto 5000.

## 4. Configuración de HTTPS con Caddy

Caddy es un servidor web moderno que obtiene certificados SSL automáticamente.

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
mi-dominio.com {
    reverse_proxy localhost:5000
}
```

### Reiniciar Caddy
```bash
sudo systemctl restart caddy
sudo systemctl enable caddy
```

Caddy obtendrá automáticamente un certificado Let's Encrypt.

## 5. Backups de la Base de Datos

### Backup manual
```bash
docker compose exec app /bin/bash -c "./scripts/backup.sh"
```

### Configurar backup automático (cron)
```bash
crontab -e
```

Agregar línea para backup diario a las 3 AM:
```
0 3 * * * cd /ruta/al/proyecto && docker compose exec -T app ./scripts/backup.sh >> /var/log/pointeuse-backup.log 2>&1
```

Los backups se guardan en `/backups` con retención de 30 días.

## 6. Restaurar Base de Datos

### Desde un backup
```bash
# Listar backups disponibles
ls -la /backups/

# Restaurar (reemplazar TIMESTAMP con la fecha del backup)
gunzip -c /backups/pointeuse_TIMESTAMP.sql.gz | docker compose exec -T db psql -U postgres pointeuse
```

### Restaurar datos de seed (datos iniciales)
```bash
docker compose exec app npx tsx server/seed.ts
```

## 7. Comandos Útiles

```bash
# Ver logs de la aplicación
docker compose logs -f app

# Ver logs de la base de datos
docker compose logs -f db

# Reiniciar servicios
docker compose restart

# Detener todo
docker compose down

# Detener y eliminar volúmenes (PRECAUCIÓN: borra datos)
docker compose down -v

# Actualizar aplicación
git pull
docker compose up -d --build
```

## 8. Monitoreo

### Verificar estado de la aplicación
```bash
curl http://localhost:5000/api/health
```

### Ver página de estado (requiere login admin)
Navegar a: `https://mi-dominio.com/admin` → pestaña "Estado"

Muestra:
- Versión de la aplicación
- Entorno (dev/prod)
- Estado de la base de datos
- Número de empleados y sitios

## 9. Solución de Problemas

### La aplicación no arranca
```bash
# Ver logs detallados
docker compose logs app

# Verificar variables de entorno
docker compose exec app env | grep -E "(DATABASE|SESSION|CORS)"
```

### Error de conexión a la base de datos
```bash
# Verificar que PostgreSQL está corriendo
docker compose ps db

# Probar conexión
docker compose exec db psql -U postgres -c "SELECT 1"
```

### Certificado SSL no funciona
```bash
# Ver logs de Caddy
sudo journalctl -u caddy -f

# Verificar DNS
nslookup mi-dominio.com
```

## 10. Seguridad

- Cambiar contraseñas por defecto antes del primer uso
- Usar contraseñas fuertes (min 16 caracteres)
- Mantener Docker y el sistema actualizados
- Configurar firewall (UFW):
  ```bash
  sudo ufw allow 22    # SSH
  sudo ufw allow 80    # HTTP
  sudo ufw allow 443   # HTTPS
  sudo ufw enable
  ```
- No exponer el puerto 5000 directamente (usar Caddy como proxy)
