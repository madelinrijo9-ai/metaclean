# Build Stage
FROM node:22-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@11

WORKDIR /app

# Copy root configs
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json tsconfig.base.json preinstall.js ./

# Copy package structures for caching
COPY desktop/package.json ./desktop/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY scripts/package.json ./scripts/

# Install dependencies (will be cached if package.json files don't change)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application files
COPY desktop ./desktop
COPY lib ./lib
COPY scripts ./scripts

# Run the build command to generate static files
RUN pnpm --filter metaclean-desktop run build

# Production Stage
FROM nginx:alpine

# Copy Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build files from builder stage
COPY --from=builder /app/desktop/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
