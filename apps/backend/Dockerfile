FROM node:20-alpine

WORKDIR /app

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
