# Debian (glibc) base: the local visual-search model (onnxruntime-node) ships glibc
# binaries only. wget is needed by the compose healthcheck.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only onnxruntime (local visual search): never download CUDA binaries.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

# Install workspace dependencies once for backend + shared package.
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev

# Copy runtime source after dependencies are installed.
COPY apps/backend apps/backend
COPY packages/shared packages/shared

WORKDIR /app/apps/backend

EXPOSE 4000

CMD ["npm", "run", "start"]
