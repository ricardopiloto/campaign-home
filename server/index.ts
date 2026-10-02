import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { createSessionStore } from './auth.ts'
import { createCodexClient } from './codex.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { createCoverFetcher } from './covers.ts'
import { createFoundryStatusClient } from './foundry.ts'
import { createSafeGet } from './net-safety.ts'
import { createRepo } from './repo.ts'
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

const repo = createRepo(db)
const sessions = createSessionStore(db)
const uploads = createUploadStore(path.join(config.dataDir, 'uploads'), {
  quotaBytes: config.uploadQuotaBytes,
})
const safeGet = createSafeGet({ allowedPorts: config.foundryAllowedPorts })

const app = createApp({
  config,
  repo,
  codex: createCodexClient({ baseUrl: config.codexBaseUrl }),
  uploads,
  sessions,
  foundryStatus: createFoundryStatusClient({ safeGet }),
  covers: createCoverFetcher(createSafeGet()),
})

// Manutenção periódica: sessões expiradas/revogadas e uploads abandonados há mais de 24 h.
function maintenance() {
  sessions.purge()
  uploads.sweepOrphans(repo.referencedUploads()).catch((err) => console.error(err))
}
maintenance()
setInterval(maintenance, 60 * 60 * 1000).unref()

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`[gateway] ouvindo em http://localhost:${port}`)
  console.log(`[gateway] codex: ${config.codexBaseUrl ?? 'não configurado (apenas modo manual)'}`)
})
