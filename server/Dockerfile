# The API and the nightly RingCentral sync, as one always-on process.
#
# A container rather than a platform-specific config so the same artifact runs on Railway or
# Render today and on Azure Container Apps later — the move becomes a deploy target change, not
# a rewrite. The sync cannot run on serverless: a full day of calls takes 30-45 minutes.
FROM node:22-slim

WORKDIR /app

# Dependencies first so a source-only change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

# Transcription streams each recording to a real file before uploading it to Supabase Storage,
# so the process needs somewhere scratch to write.
RUN mkdir -p audio data

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# tsx runs the TypeScript directly; there is no build step in this service.
CMD ["npx", "tsx", "src/index.ts"]
