import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { createCodexClient } from './codex.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { createRepo } from './repo.ts'
import { createSessionStore } from './sessions.ts'
import { createUploadStore } from './uploads.ts'

let config
try {
  config = loadConfig()
} catch (err) {
  console.error(`[gateway] ${(err as Error).message}`)
  process.exit(1)
}

mkdirSync(config.dataDir, { recursive: true })
const db = openDb(path.join(config.dataDir, 'gateway.db'))

const app = createApp({
  config,
  repo: createRepo(db),
  sessions: createSessionStore(db, { idleTimeoutSeconds: config.adminSessionIdleTimeoutSeconds }),
  codex: createCodexClient({ baseUrl: config.codexBaseUrl }),
  uploads: createUploadStore(path.join(config.dataDir, 'uploads')),
})

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`[gateway] ouvindo em http://localhost:${port}`)
  console.log(`[gateway] codex: ${config.codexBaseUrl ?? 'não configurado (apenas modo manual)'}`)
})
