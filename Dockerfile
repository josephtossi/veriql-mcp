# Builds and runs the stdio MCP server (used by Glama and any container host).
# With no VERIQL_WALLET_PRIVATE_KEY or VERIQL_API_KEY set, the server still
# starts and lists every tool; paid tools answer with how to pay.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev
ENTRYPOINT ["node", "dist/server.js"]
