# Despliegue — Cronos Fichajes

## Arquitectura en producción

```
                     ┌─────────────────────────────────┐
                     │     Droplet DigitalOcean         │
                     │     (1 vCPU / 1 GB RAM)          │
                     │                                  │
  Internet ──────▶   │  Nginx (reverse proxy + SSL)     │
                     │    ├── gestion.cronosfichajes.es  │
                     │    │     → 127.0.0.1:3000         │
                     │    │     (Gimnasio Cronos)         │
                     │    └── cronosfichajes.es           │
                     │          → 127.0.0.1:3001         │
                     │          (Cronos Fichajes)         │
                     └──────────────┬───────────────────┘
                                    │
                     ┌──────────────▼───────────────────┐
                     │  DigitalOcean Managed PostgreSQL  │
                     │  db-postgresql-fra1-86634         │
                     │  Base: defaultdb (compartida)     │
                     │  ├── 8 tablas Fichajes            │
                     │  └── 34 tablas Gimnasio           │
                     └──────────────────────────────────┘
```

## Requisitos previos

- Docker y Docker Compose instalados
- Nginx instalado
- Certbot (Let's Encrypt) para certificados SSL
- Acceso al repositorio Git

## Variables de entorno (.env)

Crear un archivo `.env` en el directorio del proyecto (`/var/www/app`):

```env
# Base de datos DigitalOcean (obligatorio — una de las dos)
EXTERNAL_DATABASE_URL=postgresql://doadmin:PASSWORD@host:25060/defaultdb?sslmode=require
# DATABASE_URL=postgresql://...  (fallback si EXTERNAL_DATABASE_URL no está)

# Seguridad (obligatorio)
JWT_ACCESS_SECRET=clave-secreta-access-min-32-chars
JWT_REFRESH_SECRET=clave-secreta-refresh-min-32-chars
KIOSK_KEY=clave-secreta-kiosk-min-32-chars

# CORS (obligatorio)
CORS_ORIGIN=https://cronosfichajes.es

# Puerto externo (por defecto 3001 para no chocar con Gimnasio en 3000)
PORT=3001

# Opcionales
EXPECTED_DAILY_MINUTES=480
OVERTIME_MIN_THRESHOLD=15
GEO_DECIMALS=4
```

## Despliegue inicial

```bash
# 1. Clonar el repositorio
cd /var/www
git clone <repo-url> app
cd app

# 2. Crear archivo .env con las variables anteriores
nano .env

# 3. Construir y levantar
docker compose build
docker compose up -d

# 4. Verificar que funciona
docker compose logs -f
curl http://localhost:3001/healthz
```

## Actualización

```bash
cd /var/www/app
git pull origin main
docker compose build
docker compose up -d
docker compose logs --tail 20
```

## Configuración Nginx

Copiar la configuración de referencia:

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/cronosfichajes
sudo ln -s /etc/nginx/sites-available/cronosfichajes /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Certificados SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d cronosfichajes.es -d www.cronosfichajes.es
```

## Coexistencia con Gimnasio Cronos

| Aspecto | Gimnasio Cronos | Cronos Fichajes |
|---|---|---|
| Dominio | gestion.cronosfichajes.es | cronosfichajes.es |
| Puerto externo | 3000 | 3001 |
| Puerto interno | 3000 | 3000 |
| Contenedor | cronos_app | cronos_fichajes_app |
| Base de datos | defaultdb (34 tablas) | defaultdb (8 tablas) |
| Enlace entre apps | `monitors.email` | `employees.email` |
| Healthcheck | /healthz | /healthz |

**IMPORTANTE:** Las dos aplicaciones comparten la misma base de datos (`defaultdb`). No modificar las tablas de la otra aplicación.

## Comandos útiles

```bash
# Ver logs en tiempo real
docker compose logs -f

# Reiniciar
docker compose restart

# Reconstruir sin caché
docker compose build --no-cache
docker compose up -d

# Estado de los contenedores
docker compose ps

# Entrar en el contenedor
docker compose exec app sh

# Verificar salud
curl http://localhost:3001/healthz
curl http://localhost:3001/api/health
```

## Resolución de problemas

### El contenedor no arranca
```bash
docker compose logs --tail 50
```
Buscar errores `[ENTRYPOINT][FATAL]` o `[PG-URL][FATAL]`.

### Error de conexión a la base de datos
- Verificar que `EXTERNAL_DATABASE_URL` o `DATABASE_URL` está definido en `.env`
- Verificar que el certificado SSL está embebido en la imagen (se copia durante el build)
- Verificar acceso desde el Droplet: `curl -v telnet://host:25060`

### Error 502 en Nginx
- Verificar que el contenedor está corriendo: `docker compose ps`
- Verificar que el puerto 3001 está expuesto: `docker compose port app 3000`
- Verificar logs Nginx: `sudo tail -f /var/log/nginx/error.log`
