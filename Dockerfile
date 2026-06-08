# Stage 1: Build & Dependencies
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy package descriptors
COPY package*.json ./

# Install packages (omit devDependencies for production)
RUN npm ci --only=production

# Stage 2: Final Run Image
FROM node:22-alpine

WORKDIR /usr/src/app

# Copy production node_modules from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./

# Copy application source code
COPY . .

# Expose backend REST API port
EXPOSE 5000

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=5000

# Run container as a non-privileged user for enhanced system security
USER node

# Launch server
CMD ["node", "server.js"]
