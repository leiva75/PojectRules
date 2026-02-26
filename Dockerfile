# ================================
# Stage 1: Dependencies
# ================================
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ================================
# Stage 2: Build
# ================================
FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build client (Vite) and server (esbuild bundle to dist/index.cjs)
RUN npm run build

# ================================
# Stage 3: Production Dependencies
# ================================
FROM node:18-alpine AS production-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ================================
# Stage 4: Runtime
# ================================
FROM node:18-alpine AS runner
WORKDIR /app

RUN apk add --no-cache tzdata

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=UTC

# Copy production dependencies
COPY --from=production-deps /app/node_modules ./node_modules

# Copy built assets (client static files + server bundle)
COPY --from=builder /app/dist ./dist

# Copy package files for npm start
COPY package*.json ./

# Create backups directory
RUN mkdir -p /backups && chmod 755 /backups

# Expose port
EXPOSE 3000

# Health check - uses lightweight /health endpoint (no DB dependency)
# /api/health is still available for deep checks but not used for platform healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start: runs "node dist/index.cjs" via npm run start
CMD ["npm", "run", "start"]
