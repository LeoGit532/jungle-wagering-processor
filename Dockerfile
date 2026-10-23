FROM oven/bun:1.4.3
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json .prettierrc.json .prettierignore ./
COPY src ./src
COPY scripts ./scripts
EXPOSE 3000
CMD ["bun", "run", "start"]
