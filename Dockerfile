# One container runs everything: the API and the built website on the same https address.

# ---------- 1) Build the website ----------
FROM node:24-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
# Only needed for AWS Face Liveness (LIVENESS_MODE=aws). Render passes env vars in as build args.
ARG VITE_AWS_REGION
ARG VITE_COGNITO_IDENTITY_POOL_ID
ENV VITE_AWS_REGION=$VITE_AWS_REGION VITE_COGNITO_IDENTITY_POOL_ID=$VITE_COGNITO_IDENTITY_POOL_ID
RUN npm run build

# ---------- 2) Run the server ----------
FROM node:24-slim
ENV NODE_ENV=production
# Fonts so the photo watermark text renders
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
# Writable data folder (some free hosts run the app as a non-root user, e.g. Hugging Face uid 1000)
RUN mkdir -p /app/server/data && chown -R 1000:1000 /app/server/data
# Free defaults: photos on the server's disk + free face model. Override with env vars for AWS.
ENV STORAGE=local FACE_ENGINE=local DB_PATH=/app/server/data/dearmemory.db PORT=4000
EXPOSE 4000
CMD ["node", "src/index.js"]
