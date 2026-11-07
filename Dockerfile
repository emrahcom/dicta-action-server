# The server; see specs/architecture.md (Docker image).

FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ src/
USER node
EXPOSE 8741
CMD ["node", "src/index.ts"]
