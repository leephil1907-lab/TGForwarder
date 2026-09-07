FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Persist sessions, rules, fetch jobs and downloads here.
# On Railway: attach a Volume mounted at /data and everything survives redeploys.
ENV TG_DATA_DIR=/data

# Reproducible install from the committed lockfile (tsx runs TypeScript in production).
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
