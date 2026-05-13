const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')
const fs = require('fs').promises
const fsSync = require('fs')
const Papa = require('papaparse')
const crypto = require('crypto')

// Chromium disk cache can occasionally fail to migrate/create on Windows (Access denied).
// Common causes: multiple app instances fighting over the same cache dir, or localhost resolving
// to IPv6 (::1) while the dev server listens on IPv4 only.
// Set stable, writable paths as early as possible and reduce noisy GPU cache errors.
try {
  const STABLE_APP_NAME = app.isPackaged ? 'FunnyApp' : 'FunnyApp-dev'
  const baseUserData = path.join(app.getPath('appData'), STABLE_APP_NAME)
  // Keep userData stable so local app data (vocabulary, settings) is persistent.
  try { fsSync.mkdirSync(baseUserData, { recursive: true }) } catch {}
  app.setPath('userData', baseUserData)
  const cacheBase = path.join(app.getPath('temp'), `${STABLE_APP_NAME}-cache`)
  const cacheDir = app.isPackaged ? cacheBase : `${cacheBase}-${process.pid}`
  try { fsSync.mkdirSync(cacheDir, { recursive: true }) } catch {}
  app.setPath('cache', cacheDir)
  // Explicitly tell Chromium where to put its disk cache.
  try { app.commandLine.appendSwitch('disk-cache-dir', cacheDir) } catch {}
  if (!app.isPackaged) {
    // Dev-only: avoid noisy cache write failures for Vite module URLs.
    app.commandLine.appendSwitch('disable-http-cache')
  }
  // Reduce noisy GPU cache errors without disabling GPU rendering entirely.
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-gpu-program-cache')
  // Fix SharedImageManager errors (Skia representation from non-existent mailbox)
  app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer')
  app.commandLine.appendSwitch('disable-accelerated-2d-canvas')
  app.commandLine.appendSwitch('disable-gpu-compositing')
} catch (e) {
}

try {
  const dotenv = require('dotenv')
  const candidates = []

  // Dev: repo root
  candidates.push(path.join(__dirname, '..', '.env'))

  // If started from project root (or user launched from some working dir)
  try {
    candidates.push(path.join(process.cwd(), '.env'))
  } catch (e) {
  }

  // Portable/installed: next to the executable
  try {
    if (process.execPath) candidates.push(path.join(path.dirname(process.execPath), '.env'))
  } catch (e) {
  }

  // Packaged resources folder
  try {
    if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, '.env'))
  } catch (e) {
  }

  // User-specific location (recommended for end users)
  try {
    candidates.push(path.join(app.getPath('userData'), '.env'))
  } catch (e) {
  }

  for (const p of candidates) {
    try {
      if (p && fsSync.existsSync(p)) {
        dotenv.config({ path: p })
        break
      }
    } catch (e) {
    }
  }
} catch (e) {
}

function getUserEnvPath() {
  return path.join(app.getPath('userData'), '.env')
}

function upsertEnvLine(text, key, value) {
  const k = String(key || '').trim()
  if (!k) return String(text || '')
  const lines = String(text || '').split(/\r?\n/)
  let found = false
  const out = lines
    .map((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) return line
      if (m[1] !== k) return line
      found = true
      if (value == null) return ''
      const v = String(value)
      // Quote only if needed
      const needsQuotes = /\s|#|"|'/g.test(v)
      return `${k}=${needsQuotes ? JSON.stringify(v) : v}`
    })
    .filter((l) => l !== '')

  if (!found && value != null) {
    const v = String(value)
    const needsQuotes = /\s|#|"|'/g.test(v)
    out.push(`${k}=${needsQuotes ? JSON.stringify(v) : v}`)
  }

  return out.join('\n') + '\n'
}

async function setUserEnvVar(key, value) {
  const envPath = getUserEnvPath()
  let current = ''
  try {
    if (fsSync.existsSync(envPath)) current = fsSync.readFileSync(envPath, 'utf8')
  } catch (e) {
  }
  const next = upsertEnvLine(current, key, value)
  await fs.writeFile(envPath, next, 'utf8')
  if (value == null) {
    delete process.env[key]
  } else {
    process.env[key] = String(value)
  }
  return true
}

function getUserGoogleAiStudioKeysPath() {
  return path.join(app.getPath('userData'), 'google-ai-studio-keys.json')
}

function getUserGoogleAiStudioQuotaPath() {
  return path.join(app.getPath('userData'), 'google-ai-studio-quota.json')
}

function keyIdForQuota(apiKey) {
  const k = String(apiKey || '').trim()
  if (!k) return ''
  return crypto.createHash('sha256').update(k).digest('hex').slice(0, 24)
}

function getLocalDayKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function endOfLocalDayMs(d = new Date()) {
  const eod = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
  return eod.getTime()
}

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || ''))
  } catch {
    return null
  }
}

// --- Google AI Studio quota tracking (persistent) ---
// Tracks *requests* (not tokens). Enforces:
// - RPM: per minute window, per key+model
// - RPD: per local-day, per key+model
// If RPD is unknown, you can set it via env:
//   GOOGLE_AI_STUDIO_QUOTA_LIMITS_JSON='{"models":{"gemini-2.5-flash-lite-preview":{"rpm":10,"rpd":200}}}'
// Quota state is stored under userData/google-ai-studio-quota.json so app restart keeps state.
const GOOGLE_AI_QUOTA_VERSION = 1
let googleAiQuotaState = null
let googleAiQuotaFlushTimer = null

function getDefaultGoogleAiQuotaLimits() {
  return {
    models: {
      // Defaults based on AI Studio free-tier limits (requests, not tokens).
      // NOTE: If your account tier differs, override via GOOGLE_AI_STUDIO_QUOTA_LIMITS_JSON.
      'gemini-2.5-flash-lite-preview': { rpm: 10, rpd: 20 },
      'gemini-2.5-flash-preview-05-20': { rpm: 5, rpd: 20 },
      'gemini-3.0-flash-preview': { rpm: 5, rpd: 20 },
      // Not used in our text generation flow, but included for completeness.
      'gemini-2.5-flash-tts': { rpm: 3, rpd: 10 },
      'gemma-3-27b-it': { rpm: null, rpd: null }
    }
  }
}

function readQuotaLimitsFromEnv() {
  const raw = String(process.env.GOOGLE_AI_STUDIO_QUOTA_LIMITS_JSON || '').trim()
  if (!raw) return null
  const obj = safeJsonParse(raw)
  if (!obj || typeof obj !== 'object') return null
  if (!obj.models || typeof obj.models !== 'object') return null
  return obj
}

async function loadGoogleAiQuotaState() {
  if (googleAiQuotaState) return googleAiQuotaState
  const p = getUserGoogleAiStudioQuotaPath()
  let existing = null
  try {
    if (fsSync.existsSync(p)) {
      const txt = fsSync.readFileSync(p, 'utf8')
      existing = safeJsonParse(txt)
    }
  } catch {
    existing = null
  }

  const defaults = getDefaultGoogleAiQuotaLimits()
  const fromEnv = readQuotaLimitsFromEnv()

  googleAiQuotaState = {
    version: GOOGLE_AI_QUOTA_VERSION,
    dayKey: getLocalDayKey(),
    limits: {
      models: {
        ...(defaults.models || {}),
        ...((existing && existing.limits && existing.limits.models) ? existing.limits.models : {}),
        ...((fromEnv && fromEnv.models) ? fromEnv.models : {})
      }
    },
    perKey: (existing && existing.perKey && typeof existing.perKey === 'object') ? existing.perKey : {}
  }

  return googleAiQuotaState
}

function scheduleGoogleAiQuotaFlush() {
  if (googleAiQuotaFlushTimer) return
  googleAiQuotaFlushTimer = setTimeout(() => {
    googleAiQuotaFlushTimer = null
    try {
      flushGoogleAiQuotaStateSync()
    } catch {}
  }, 250)
}

function flushGoogleAiQuotaStateSync() {
  if (!googleAiQuotaState) return
  try {
    const p = getUserGoogleAiStudioQuotaPath()
    fsSync.writeFileSync(p, JSON.stringify(googleAiQuotaState, null, 2), 'utf8')
  } catch (e) {
    // ignore
  }
}

function coerceLimitNumber(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  const i = Math.floor(v)
  if (i <= 0) return null
  return i
}

function getModelQuotaLimits(model) {
  const m = String(model || '').trim()
  if (!googleAiQuotaState) {
    const defaults = getDefaultGoogleAiQuotaLimits()
    return defaults.models[m] || { rpm: null, rpd: null }
  }
  const entry = googleAiQuotaState.limits && googleAiQuotaState.limits.models ? googleAiQuotaState.limits.models[m] : null
  return {
    rpm: entry ? coerceLimitNumber(entry.rpm) : null,
    rpd: entry ? coerceLimitNumber(entry.rpd) : null
  }
}

function ensureQuotaEntryForKeyModel(state, keyStr, model, nowMs) {
  const keyId = keyIdForQuota(keyStr)
  if (!keyId) return null
  if (!state.perKey[keyId]) state.perKey[keyId] = { models: {} }
  if (!state.perKey[keyId].models) state.perKey[keyId].models = {}
  if (!state.perKey[keyId].models[model]) {
    state.perKey[keyId].models[model] = {
      minuteKey: Math.floor(nowMs / 60000),
      rpmUsed: 0,
      dayKey: state.dayKey,
      rpdUsed: 0,
      blockedUntilMs: 0,
      blockedDayKey: ''
    }
  }
  return state.perKey[keyId].models[model]
}

function normalizeQuotaEntryForNow(state, entry, nowMs) {
  const curDay = getLocalDayKey(new Date(nowMs))
  if (state.dayKey !== curDay) {
    state.dayKey = curDay
  }
  if (entry.dayKey !== state.dayKey) {
    entry.dayKey = state.dayKey
    entry.rpdUsed = 0
    entry.blockedDayKey = ''
    // Keep blockedUntilMs for minute-level blocks (it will expire).
    // If a prior day-level block set blockedUntilMs, it should already be in the past.
    if (entry.blockedUntilMs && entry.blockedUntilMs < nowMs) entry.blockedUntilMs = 0
  }
  const curMinute = Math.floor(nowMs / 60000)
  if (entry.minuteKey !== curMinute) {
    entry.minuteKey = curMinute
    entry.rpmUsed = 0
  }
}

function quotaIsBlocked(entry, state) {
  if (!entry) return false
  const nowMs = Date.now()
  if (entry.blockedUntilMs && nowMs < entry.blockedUntilMs) return true
  if (entry.blockedDayKey && entry.blockedDayKey === state.dayKey) return true
  return false
}

function quotaCanStart({ key, model }) {
  if (!googleAiQuotaState) return true
  const state = googleAiQuotaState
  const nowMs = Date.now()
  const m = String(model || '').trim()
  const entry = ensureQuotaEntryForKeyModel(state, key, m, nowMs)
  if (!entry) return true
  normalizeQuotaEntryForNow(state, entry, nowMs)
  if (quotaIsBlocked(entry, state)) return false
  const lim = getModelQuotaLimits(m)
  if (lim.rpm && entry.rpmUsed >= lim.rpm) return false
  if (lim.rpd && entry.rpdUsed >= lim.rpd) return false
  return true
}

function quotaReserveRequest({ key, model }) {
  if (!googleAiQuotaState) return { ok: true }
  const state = googleAiQuotaState
  const nowMs = Date.now()
  const m = String(model || '').trim()
  const entry = ensureQuotaEntryForKeyModel(state, key, m, nowMs)
  if (!entry) return { ok: true }
  normalizeQuotaEntryForNow(state, entry, nowMs)
  if (quotaIsBlocked(entry, state)) return { ok: false, reason: 'blocked' }
  const lim = getModelQuotaLimits(m)
  if (lim.rpm && entry.rpmUsed >= lim.rpm) return { ok: false, reason: 'rpm' }
  if (lim.rpd && entry.rpdUsed >= lim.rpd) return { ok: false, reason: 'rpd' }
  entry.rpmUsed += 1
  entry.rpdUsed += 1
  scheduleGoogleAiQuotaFlush()
  return { ok: true }
}

function quotaMarkModelKeyExhausted({ key, model, kind }) {
  if (!googleAiQuotaState) return
  const state = googleAiQuotaState
  const nowMs = Date.now()
  const m = String(model || '').trim()
  const entry = ensureQuotaEntryForKeyModel(state, key, m, nowMs)
  if (!entry) return
  normalizeQuotaEntryForNow(state, entry, nowMs)
  // RPM: block briefly (until next minute boundary)
  if (kind === 'rpm') {
    const nextMinuteMs = (Math.floor(nowMs / 60000) + 1) * 60000
    entry.blockedUntilMs = Math.max(entry.blockedUntilMs || 0, nextMinuteMs)
  } else if (kind === 'rpd') {
    // Daily quota exhausted: block for rest of local day
    entry.blockedDayKey = state.dayKey
    entry.blockedUntilMs = Math.max(entry.blockedUntilMs || 0, endOfLocalDayMs(new Date(nowMs)))
  } else if (kind === 'model') {
    // Model unavailable / not found: block for a while to avoid spamming
    entry.blockedUntilMs = Math.max(entry.blockedUntilMs || 0, nowMs + 30 * 60 * 1000)
  }
  scheduleGoogleAiQuotaFlush()
}

function maskApiKey(key) {
  const k = String(key || '').trim()
  if (!k) return ''
  if (k.length <= 8) return `${k.slice(0, 2)}…${k.slice(-2)}`
  return `${k.slice(0, 4)}…${k.slice(-4)}`
}

function makeId() {
  try {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch (e) {
  }
  return crypto.randomBytes(16).toString('hex')
}

function normalizeKeysStore(obj) {
  const now = new Date().toISOString()
  const store = obj && typeof obj === 'object' ? obj : {}
  const version = 1
  // Support both legacy activeId (string) and new activeIds (array)
  let activeIds = []
  if (Array.isArray(store.activeIds)) {
    activeIds = store.activeIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
  } else if (typeof store.activeId === 'string' && store.activeId.trim()) {
    // Migrate from single activeId to activeIds array
    activeIds = [store.activeId.trim()]
  }
  const itemsRaw = Array.isArray(store.items) ? store.items : []
  const items = itemsRaw
    .map((it) => {
      const id = typeof it.id === 'string' && it.id.trim() ? it.id.trim() : makeId()
      const name = typeof it.name === 'string' && it.name.trim() ? it.name.trim() : 'API Key'
      const key = typeof it.key === 'string' ? it.key.trim() : ''
      if (!key) return null
      return {
        id,
        name,
        key,
        createdAt: typeof it.createdAt === 'string' ? it.createdAt : now,
        updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : now
      }
    })
    .filter(Boolean)

  // Filter activeIds to only include valid item ids
  const validActiveIds = activeIds.filter(id => items.some(x => x.id === id))
  return { version, activeIds: validActiveIds, items }
}

async function readGoogleAiStudioKeysStore() {
  const p = getUserGoogleAiStudioKeysPath()
  try {
    if (!fsSync.existsSync(p)) return null
    const txt = await fs.readFile(p, 'utf8')
    const obj = JSON.parse(txt)
    return normalizeKeysStore(obj)
  } catch (e) {
    return null
  }
}

async function writeGoogleAiStudioKeysStore(store) {
  const p = getUserGoogleAiStudioKeysPath()
  const normalized = normalizeKeysStore(store)
  await fs.writeFile(p, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

async function ensureGoogleAiStudioKeysStore() {
  const existing = await readGoogleAiStudioKeysStore()
  if (existing) return existing

  const envKey = String(process.env.GOOGLE_AI_STUDIO_API_KEY || '').trim()
  if (envKey) {
    const now = new Date().toISOString()
    const id = makeId()
    return await writeGoogleAiStudioKeysStore({
      version: 1,
      activeIds: [id],
      items: [{ id, name: 'Default', key: envKey, createdAt: now, updatedAt: now }]
    })
  }

  // Do not create file eagerly if there is no key.
  return { version: 1, activeIds: [], items: [] }
}

// Toggle a key on/off in activeIds
async function toggleActiveGoogleAiStudioKeyId(keyId, enabled) {
  const store = await ensureGoogleAiStudioKeysStore()
  const id = String(keyId || '').trim()
  if (!id) throw new Error('Key id is required')
  
  const found = store.items.find((x) => x.id === id)
  if (!found) throw new Error('API key not found')
  
  let newActiveIds = [...(store.activeIds || [])]
  if (enabled) {
    if (!newActiveIds.includes(id)) {
      newActiveIds.push(id)
    }
  } else {
    newActiveIds = newActiveIds.filter(x => x !== id)
  }
  
  const next = { ...store, activeIds: newActiveIds }
  await writeGoogleAiStudioKeysStore(next)
  
  // Update env var with first active key for backward compat
  if (newActiveIds.length > 0) {
    const firstActive = store.items.find(x => x.id === newActiveIds[0])
    await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', firstActive ? firstActive.key : null)
  } else {
    await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', null)
  }
  return true
}

// Clear all active keys
async function clearAllActiveGoogleAiStudioKeys() {
  const store = await ensureGoogleAiStudioKeysStore()
  const next = { ...store, activeIds: [] }
  if (fsSync.existsSync(getUserGoogleAiStudioKeysPath())) {
    await writeGoogleAiStudioKeysStore(next)
  }
  await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', null)
  return true
}

const AZURE_TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com'
const pendingAutoMeaning = new Map()

// --- Google AI Studio concurrency + caching ---
// Concurrency is now PER-KEY: if concurrency=2 and you have 4 keys, total parallel requests = 2*4 = 8
function coerceGoogleAiConcurrency(val) {
  const n = Number(val)
  if (!Number.isFinite(n)) return 2
  const i = Math.floor(n)
  if (i < 1) return 1
  if (i > 8) return 8  // per-key limit, reasonable for most APIs
  return i
}

let googleAiPerKeyConcurrency = coerceGoogleAiConcurrency(process.env.GOOGLE_AI_STUDIO_CONCURRENCY || 2)
const GOOGLE_AI_CACHE_TTL_MS = Math.max(0, Number(process.env.GOOGLE_AI_STUDIO_CACHE_TTL_MS || 5 * 60 * 1000) || 0)
// Per-key active counters: Map<keyString, number>
const googleAiActivePerKey = new Map()
// Global queue - jobs include the key they want to use
const googleAiQueue = []
const googleAiCache = new Map() // key -> { t: number, v: string }

function refreshGoogleAiConcurrencyFromEnv() {
  googleAiPerKeyConcurrency = coerceGoogleAiConcurrency(process.env.GOOGLE_AI_STUDIO_CONCURRENCY || 2)
  return googleAiPerKeyConcurrency
}

function googleAiCacheGet(key) {
  if (!GOOGLE_AI_CACHE_TTL_MS) return null
  const hit = googleAiCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.t > GOOGLE_AI_CACHE_TTL_MS) {
    googleAiCache.delete(key)
    return null
  }
  return hit.v
}

function googleAiCacheSet(key, value) {
  if (!GOOGLE_AI_CACHE_TTL_MS) return
  // Very small LRU-ish cap to avoid unbounded memory
  const MAX = 1000
  if (googleAiCache.size >= MAX) {
    const firstKey = googleAiCache.keys().next().value
    if (firstKey) googleAiCache.delete(firstKey)
  }
  googleAiCache.set(key, { t: Date.now(), v: String(value || '') })
}

// Run a task with per-key concurrency limiting
// taskFn receives the apiKey to use
function runGoogleAiTaskWithKey(apiKey, taskFn) {
  return new Promise((resolve, reject) => {
    googleAiQueue.push({ apiKey, taskFn, resolve, reject })
    pumpGoogleAiQueue()
  })
}

function pumpGoogleAiQueue() {
  // Try to find jobs that can run (their key hasn't hit concurrency limit)
  let i = 0
  while (i < googleAiQueue.length) {
    const job = googleAiQueue[i]
    const keyStr = job.apiKey || '__default__'
    const active = googleAiActivePerKey.get(keyStr) || 0
    
    if (active < googleAiPerKeyConcurrency) {
      // Can run this job
      googleAiQueue.splice(i, 1)
      googleAiActivePerKey.set(keyStr, active + 1)
      
      Promise.resolve()
        .then(() => job.taskFn())
        .then(job.resolve, job.reject)
        .finally(() => {
          const curr = googleAiActivePerKey.get(keyStr) || 1
          googleAiActivePerKey.set(keyStr, Math.max(0, curr - 1))
          pumpGoogleAiQueue()
        })
    } else {
      // This key is at capacity, try next job
      i++
    }
  }
}

function sleepMs(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    const t = setTimeout(() => {
      try {
        if (signal && typeof onAbort === 'function') {
          try { signal.removeEventListener('abort', onAbort) } catch {}
        }
      } catch (e) {}
      resolve(true)
    }, ms)
    let onAbort
    if (signal) {
      onAbort = () => {
        try { clearTimeout(t) } catch {}
        try { signal.removeEventListener('abort', onAbort) } catch {}
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      }
      signal.addEventListener('abort', onAbort)
    }
  })
}

// Multi-key rotation state
let activeKeysCache = null
let activeKeyIndex = 0

async function getActiveApiKeys() {
  // Cache for performance, refresh periodically
  if (!activeKeysCache) {
    const store = await readGoogleAiStudioKeysStore()
    if (store && store.activeIds && store.activeIds.length > 0) {
      activeKeysCache = store.items.filter(item => store.activeIds.includes(item.id))
    } else {
      activeKeysCache = []
    }
    // Clear cache after 10 seconds to pick up changes
    setTimeout(() => { activeKeysCache = null }, 10000)
  }
  return activeKeysCache
}

function getNextApiKey(keys) {
  if (!keys || keys.length === 0) return null
  const key = keys[activeKeyIndex % keys.length]
  activeKeyIndex = (activeKeyIndex + 1) % keys.length
  return key
}

// Model priority list - try free-tier models first, then fallback to paid/larger models
const GOOGLE_AI_MODEL_PRIORITY = [
  'gemini-2.5-flash-lite-preview',    // Gemini 2.5 Flash Lite (free tier, 10 RPM)
  'gemini-2.5-flash-preview-05-20',   // Gemini 2.5 Flash (free tier, 5 RPM)
  'gemini-3.0-flash-preview',         // Gemini 3 Flash (free tier, 5 RPM)
  'gemma-3-27b-it',                   // Fallback: Gemma 3 27B
]

const GOOGLE_AI_FALLBACK_MODEL = 'gemma-3-27b-it'

async function getGoogleAiStudioConfig(payload) {
  // First try multi-key rotation
  const keys = await getActiveApiKeys()
  if (keys && keys.length > 0) {
    const keyItem = getNextApiKey(keys)
    if (keyItem) {
      const model = process.env.GOOGLE_AI_STUDIO_MODEL || GOOGLE_AI_MODEL_PRIORITY[0]
      const endpoint = process.env.GOOGLE_AI_STUDIO_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta'
      return { key: keyItem.key, model, endpoint }
    }
  }
  
  // Fallback to env var
  const key = process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GOOGLE_API_KEY
  const model = process.env.GOOGLE_AI_STUDIO_MODEL || GOOGLE_AI_MODEL_PRIORITY[0]
  const endpoint = process.env.GOOGLE_AI_STUDIO_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta'
  if (!key) throw new Error('Missing GOOGLE_AI_STUDIO_API_KEY')
  return { key, model, endpoint }
}

async function getAllGoogleAiStudioKeys() {
  const keys = await getActiveApiKeys()
  if (keys && keys.length > 0) return keys.map((k) => k.key).filter(Boolean)
  const envKey = process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GOOGLE_API_KEY
  return envKey ? [envKey] : []
}

// Single model generation
async function googleAiStudioGenerateContentSingle({ key, endpoint, model, prompt, signal }) {
  if (typeof fetch !== 'function') throw new Error('Global fetch is not available in Electron main process')

  const base = String(endpoint || '').replace(/\/+$/, '')
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
  const promptText = String(prompt || '')
  const cacheKey = `${base}|${model}|${crypto.createHash('sha256').update(promptText).digest('hex')}`
  const cached = googleAiCacheGet(cacheKey)
  if (cached != null) return cached

  // Queue + per-key limited parallelism, plus retry/backoff for transient rate limits.
  // The key is used to limit concurrency per-key, so multiple keys can run in parallel.
  return await runGoogleAiTaskWithKey(key, async () => {
    // Ensure quota state is loaded (persisted across restarts)
    await loadGoogleAiQuotaState()
    const cached2 = googleAiCacheGet(cacheKey)
    if (cached2 != null) return cached2

    // Proactive quota gating: if local quota says no, fail fast so caller can choose another key/model.
    const reservation = quotaReserveRequest({ key, model })
    if (!reservation.ok) {
      const e = new Error(`LocalQuotaExceeded: ${reservation.reason}`)
      e.name = 'LocalQuotaError'
      e.quotaReason = reservation.reason
      throw e
    }

    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: { temperature: 0.2, topP: 0.95 }
    })

    const maxRetries = 3
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal
      })

      if (resp.ok) {
        const data = await resp.json()
        const text =
          data &&
          data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          Array.isArray(data.candidates[0].content.parts) &&
          data.candidates[0].content.parts[0] &&
          data.candidates[0].content.parts[0].text
            ? data.candidates[0].content.parts[0].text
            : ''
        const out = String(text || '')
        googleAiCacheSet(cacheKey, out)
        return out
      }

      const status = resp.status
      const t = await resp.text().catch(() => '')
      const isRetryable = status === 429 || status === 503 || status === 500
      // Try to extract server-provided retry info (RetryInfo) if present
      let retryDelayMs = null
      try {
        const parsed = JSON.parse(t)
        const details = parsed && parsed.error && Array.isArray(parsed.error.details) ? parsed.error.details : []
        for (const d of details) {
          if (d && d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && d.retryDelay) {
            const rd = d.retryDelay
            if (typeof rd === 'string') {
              // e.g. "22.183372971s"
              const m = rd.match(/([0-9]+)(?:\.([0-9]+))?s/)
              if (m) {
                const secs = Number(m[1] || 0)
                const frac = m[2] ? Number('0.' + m[2]) : 0
                retryDelayMs = Math.ceil((secs + frac) * 1000)
                break
              }
            } else if (typeof rd === 'object' && (rd.seconds || rd.nanos)) {
              const secs = Number(rd.seconds || 0)
              const nanos = Number(rd.nanos || 0)
              retryDelayMs = secs * 1000 + Math.floor(nanos / 1e6)
              break
            }
          }
        }
      } catch (e) {}

      if (!isRetryable || attempt === maxRetries) {
        if (isLikelyInvalidApiKeyError(status, t)) {
          const e = new Error(`Invalid Google AI Studio API key: ${maskApiKey(key)}`)
          e.name = 'InvalidApiKeyError'
          e.status = status
          e.bodyText = t
          e.apiKey = key
          throw e
        }

        const e = new Error(`Google AI Studio generateContent failed: ${status} ${t}`)
        e.status = status
        e.bodyText = t
        throw e
      }

      if (retryDelayMs && retryDelayMs > 0) {
        await sleepMs(retryDelayMs, signal)
      } else {
        const baseDelay = 400 * Math.pow(2, attempt)
        const jitter = Math.floor(Math.random() * 250)
        await sleepMs(baseDelay + jitter, signal)
      }
    }

    // should be unreachable
    throw new Error('Google AI Studio generateContent failed after retries')
  })
}

function classifyGoogleAiError(err) {
  const status = Number(err && err.status ? err.status : NaN)
  const msg = String(err && err.message ? err.message : err || '')
  const lower = msg.toLowerCase()
  // local quota gate
  if (err && err.name === 'LocalQuotaError') {
    const r = String(err.quotaReason || '').toLowerCase()
    if (r === 'rpd') return { type: 'rpd' }
    if (r === 'rpm') return { type: 'rpm' }
    if (r === 'blocked') return { type: 'blocked' }
    return { type: 'quota' }
  }

  // Treat these as quota/rate related
  const isRate =
    status === 429 ||
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('ratelimit')

  const isDaily =
    lower.includes('daily limit') ||
    lower.includes('per day') ||
    lower.includes('requests per') ||
    lower.includes('rpd')

  const isQuota = lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('resourceexhausted') || lower.includes('exceeded')
  const isModelMissing = (lower.includes('model') && lower.includes('not found')) || (lower.includes('model') && lower.includes('not available'))
  const isServer = status === 503 || lower.includes('503')
  const isPermission =
    (status === 401 || status === 403) &&
    (
      lower.includes('permission_denied') ||
      lower.includes('denied access') ||
      lower.includes('project has been denied access') ||
      lower.includes('forbidden') ||
      lower.includes('access denied')
    )

  if (isModelMissing) return { type: 'model' }
  if (isPermission) return { type: 'permission' }
  if (isDaily) return { type: 'rpd' }
  if (isRate) return { type: 'rpm' }
  if (isQuota) return { type: 'quota' }
  if (isServer) return { type: 'server' }
  return { type: 'other' }
}

function rotateKeysFromIndex(keys, startIndex) {
  if (!Array.isArray(keys) || keys.length === 0) return []
  const s = Math.max(0, Math.floor(startIndex || 0)) % keys.length
  return keys.slice(s).concat(keys.slice(0, s))
}

function isLikelyInvalidApiKeyError(status, bodyText) {
  const st = Number(status)
  const t = String(bodyText || '')
  const lower = t.toLowerCase()
  if (!(st === 400 || st === 401 || st === 403)) return false
  return (
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid api-key') ||
    lower.includes('api_key_invalid') ||
    (lower.includes('permission_denied') && lower.includes('api key')) ||
    (lower.includes('invalid_argument') && lower.includes('api key')) ||
    lower.includes('key is invalid') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  )
}

async function disableActiveGoogleAiStudioKeyByValue(keyValue, reason) {
  const keyStr = String(keyValue || '').trim()
  if (!keyStr) return null
  try {
    const store = await ensureGoogleAiStudioKeysStore()
    const found = store.items.find((x) => String(x && x.key ? x.key : '').trim() === keyStr)
    if (!found) return null

    try {
      await toggleActiveGoogleAiStudioKeyId(found.id, false)
    } catch {
      // ignore
    }

    // Clear cache so rotation picks up changes quickly
    activeKeysCache = null

    const payload = {
      id: found.id,
      name: found.name,
      masked: maskApiKey(found.key),
      reason: String(reason || 'invalid')
    }

    try {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('google-ai-studio:key-invalid', payload)
        } catch {}
      }
    } catch {}

    return payload
  } catch {
    return null
  }
}

async function googleAiStudioGenerateContentPrimaryThenFallback({ endpoint, prompt, signal, requestedModel }) {
  await loadGoogleAiQuotaState()
  const keys = await getAllGoogleAiStudioKeys()
  if (!keys || keys.length === 0) throw new Error('Missing GOOGLE_AI_STUDIO_API_KEY')

  // Models to use per-key: requestedModel (if not 27B) + priority list excluding 27B, then 27B last.
  const primaryModels = []
  const rm = String(requestedModel || '').trim()
  if (rm && rm !== GOOGLE_AI_FALLBACK_MODEL) primaryModels.push(rm)
  for (const m of GOOGLE_AI_MODEL_PRIORITY) {
    if (m === GOOGLE_AI_FALLBACK_MODEL) continue
    if (!primaryModels.includes(m)) primaryModels.push(m)
  }
  const modelsPerKey = [...primaryModels, GOOGLE_AI_FALLBACK_MODEL]

  // Rotate keys for fairness (keeps multi-key parallelism; per-key concurrency queue still applies).
  const keyOrder = rotateKeysFromIndex(keys, activeKeyIndex)
  activeKeyIndex = (activeKeyIndex + 1) % keys.length

  let lastErr = null
  // Per-key fallback: for each key, try models from top->down, with 27B as the last option.
  // This matches your requirement: only drop to 27B when THAT KEY has exhausted the models above.
  for (let keyAttempt = 0; keyAttempt < keyOrder.length; keyAttempt++) {
    const key = keyOrder[keyAttempt]
    const keyNumber = ((activeKeyIndex + keyAttempt - 1 + keys.length) % keys.length) + 1
    const keyMasked = maskApiKey(key)
    for (const model of modelsPerKey) {
      // Proactive local quota check
      if (!quotaCanStart({ key, model })) continue
      try {
        const out = await googleAiStudioGenerateContentSingle({ key, endpoint, model, prompt, signal })
        return out
      } catch (err) {
        lastErr = err
        try {
          err.apiKeyIndex = keyNumber
          err.apiKeyMasked = keyMasked
        } catch {}

        // Invalid API key: disable it and move on to next key.
        if (err && err.name === 'InvalidApiKeyError') {
          try {
            await disableActiveGoogleAiStudioKeyByValue(err.apiKey || key, 'invalid')
          } catch {}
          // Do not try other models for this key.
          break
        }

        const cls = classifyGoogleAiError(err)

        if (cls.type === 'permission') {
          // Key/project-level access denied (401/403): skip this key and try next key.
          // Mark current model briefly unavailable for this key to reduce immediate retries.
          quotaMarkModelKeyExhausted({ key, model, kind: 'model' })
          break
        }

        if (cls.type === 'rpm') quotaMarkModelKeyExhausted({ key, model, kind: 'rpm' })
        else if (cls.type === 'rpd') quotaMarkModelKeyExhausted({ key, model, kind: 'rpd' })
        else if (cls.type === 'model') quotaMarkModelKeyExhausted({ key, model, kind: 'model' })
        else if (cls.type === 'quota') {
          // Unknown quota shape; be conservative and block until next minute.
          quotaMarkModelKeyExhausted({ key, model, kind: 'rpm' })
        }

        const shouldContinue =
          cls.type === 'rpm' ||
          cls.type === 'rpd' ||
          cls.type === 'quota' ||
          cls.type === 'server' ||
          cls.type === 'model' ||
          cls.type === 'blocked'

        if (!shouldContinue) {
          // Non-quota errors should surface immediately (prompt issues, invalid request, etc.)
          const e = new Error(`${err && err.message ? err.message : String(err || 'Google AI Studio error')} [API key #${keyNumber}: ${keyMasked}]`)
          e.name = err && err.name ? err.name : 'GoogleAiError'
          e.status = err && err.status ? err.status : undefined
          e.bodyText = err && err.bodyText ? err.bodyText : undefined
          e.apiKeyIndex = keyNumber
          e.apiKeyMasked = keyMasked
          throw e
        }
        // continue to next model for same key
      }
    }
    // continue to next key
  }

  if (lastErr && lastErr.apiKeyIndex) {
    const e = new Error(`${lastErr && lastErr.message ? lastErr.message : 'All keys/models exhausted'} [Last API key #${lastErr.apiKeyIndex}: ${lastErr.apiKeyMasked || ''}]`)
    e.name = lastErr && lastErr.name ? lastErr.name : 'GoogleAiError'
    e.status = lastErr && lastErr.status ? lastErr.status : undefined
    e.bodyText = lastErr && lastErr.bodyText ? lastErr.bodyText : undefined
    e.apiKeyIndex = lastErr.apiKeyIndex
    e.apiKeyMasked = lastErr.apiKeyMasked
    throw e
  }

  throw (lastErr || new Error('All keys/models exhausted'))
}

// Main entry point
async function googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal }) {
  // `key` is kept for backward compatibility, but selection is now across ALL active keys.
  // `model` is treated as a requested preference; 27B is only used after exhausting all primary models across all keys.
  return googleAiStudioGenerateContentPrimaryThenFallback({ endpoint, prompt, signal, requestedModel: model })
}

function stripCodeFences(s) {
  const t = String(s || '').trim()
  if (!t) return ''
  // Remove ```json ... ``` and ``` ... ``` wrappers.
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function sanitizeIpaOutput(s) {
  let out = String(s || '').trim()
  if (!out) return ''
  out = out.replace(/^"+|"+$/g, '').trim()
  // First non-empty line
  if (out.includes('\n')) {
    out = out
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)[0] || ''
  }
  // Remove any prefixes like "IPA:" or bullets
  out = out.replace(/^\s*(IPA\s*[:\-]|\/IPA\/\s*[:\-])\s*/i, '')
  out = out.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+\s*[\).]\s+/, '').trim()

  // If model returned slashes, keep them; else try to extract the first /.../.
  const m = out.match(/\/[^\/\r\n]{1,64}\//)
  if (m && m[0]) return m[0]

  // Otherwise, keep only plausible IPA chars/spaces/stress marks.
  out = out.replace(/[^\p{L}\p{M}\sˈˌːɪʊʌəɛæɑɔɒʃʒθðŋʧʤː\.\-\(\)\[\]\{\}\/]/gu, '').trim()
  if (!out) return ''
  // Wrap in slashes for consistency.
  const core = out.replace(/^\/+|\/+$/g, '').trim()
  return core ? `/${core}/` : ''
}

async function gemmaSuggestIpa({ key, endpoint, model, word, dialect, signal }) {
  const w = String(word || '').trim()
  if (!w) return ''
  const d = (dialect === 'UK' ? 'British English (UK)' : 'American English (US)')

  const prompt =
    `You are a pronunciation helper.\n` +
    `Task: Provide the IPA pronunciation for the English word: "${w}" in ${d}.\n` +
    `Rules:\n` +
    `- Output ONLY the IPA in slashes, e.g. /həˈloʊ/.\n` +
    `- One line only. No extra text.\n` +
    `- If multiple variants exist, choose the most common one.\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  return sanitizeIpaOutput(raw)
}

async function gemmaGetWordFamily({ key, endpoint, model, word, signal }) {
  const wRaw = String(word || '').trim()
  if (!wRaw) return { word: '', family: [] }
  const w = wRaw

  const isLikelyInflectedVerbForm = (s) => {
    const t = String(s || '').trim().toLowerCase()
    if (!t || t.length < 4) return false
    if (t.includes(' ')) return false
    // Extra safety: if Gemini returns inflected surface forms, drop them.
    // (User requirement) If POS is Verb and ends with -ing/-ed => drop.
    if (t.endsWith('ing') && t.length >= 5) return true
    if (t.endsWith('ed') && t.length >= 4) return true
    return false
  }

  const isInflectionRelation = (rel) => {
    const r = String(rel || '').toLowerCase()
    return (
      r.includes('past') ||
      r.includes('present') ||
      r.includes('participle') ||
      r.includes('gerund') ||
      r.includes('3rd') ||
      r.includes('third person') ||
      r.includes('plural') ||
      r.includes('inflection')
    )
  }

  const normalizeFamilyWord = (wordOut, posOut) => {
    let s = String(wordOut || '').trim()
    s = s.replace(/^"+|"+$/g, '').replace(/\s+/g, ' ').trim()
    const pos = normalizeGemmaPos(posOut || '') || ''
    if (pos === 'Verb') {
      // If model outputs "to X", keep the lemma only.
      s = s.replace(/^to\s+/i, '').trim()
    }
    return s
  }

  const allowedPos = [
    'Noun',
    'Verb',
    'Adjective',
    'Adverb',
    'Pronoun',
    'Preposition',
    'Conjunction',
    'Determiner',
    'Interjection',
    'Phrase',
    'Other'
  ]

  const prompt =
    `You are an English morphology expert.\n` +
    `Task: Given an English headword, list its common word-family members (DERIVATIONAL lemmas learners should study).\n` +
    `Headword: "${w}"\n` +
    `\n` +
    `Output MUST be valid JSON only (no markdown, no commentary).\n` +
    `Schema:\n` +
    `{\n` +
    `  "word": string,\n` +
    `  "family": [\n` +
    `    { "word": string, "pos": one of ${JSON.stringify(allowedPos)}, "relation": string }\n` +
    `  ]\n` +
    `}\n` +
    `Rules:\n` +
    `- Include 0 to 8 items.\n` +
    `- Exclude the headword itself.\n` +
    `- Prefer the most common forms learners should study.\n` +
    `- IMPORTANT: Do NOT include inflected forms (NO past tense, NO -ing, NO 3rd person -s, NO plural nouns).\n` +
    `- If a family member is a VERB: output the BASE FORM/LEMMA only (e.g., "address", not "addresses", "addressed", "addressing").\n` +
    `- If a family member is a NOUN: output the SINGULAR form only (e.g., "address", not "addresses").\n` +
    `- relation should be short (e.g., "noun form", "verb form", "adjective form", "adverb form").\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  const obj = safeJsonParseObject(raw)
  const list = Array.isArray(obj && obj.family) ? obj.family : []

  const baseKey = String(w).toLowerCase()
  const out = []
  const seen = new Set()

  for (const item of list) {
    const ww = String(item && item.word ? item.word : '').trim()
    if (!ww) continue
    const pos = normalizeGemmaPos(item && item.pos ? item.pos : '') || ''
    const relationRaw = String(item && item.relation ? item.relation : '').trim().slice(0, 64)
    if (isInflectionRelation(relationRaw)) continue

    const normalizedWord = normalizeFamilyWord(ww, pos)
    if (!normalizedWord) continue
    if (pos === 'Verb' && isLikelyInflectedVerbForm(normalizedWord)) continue
    const keyWord = normalizedWord.toLowerCase()
    if (keyWord === baseKey) continue
    if (seen.has(keyWord)) continue
    seen.add(keyWord)

    out.push({ word: normalizedWord, pos, relation: relationRaw })
    if (out.length >= 8) break
  }

  return { word: w, family: out }
}

async function gemmaGetSynonyms({ key, endpoint, model, word, signal }) {
  const wRaw = String(word || '').trim()
  if (!wRaw) return { word: '', synonyms: [] }
  const w = wRaw

  const allowedPos = [
    'Noun',
    'Verb',
    'Adjective',
    'Adverb',
    'Pronoun',
    'Preposition',
    'Conjunction',
    'Determiner',
    'Interjection',
    'Phrase',
    'Other'
  ]

  const prompt =
    `You are an English vocabulary teacher.\n` +
    `Task: Given an English headword, list its 5 closest synonyms (words with the most similar meaning).\n` +
    `Headword: "${w}"\n` +
    `\n` +
    `Output MUST be valid JSON only (no markdown, no commentary).\n` +
    `Schema:\n` +
    `{\n` +
    `  "word": string,\n` +
    `  "synonyms": [\n` +
    `    { "word": string, "pos": one of ${JSON.stringify(allowedPos)}, "relation": string }\n` +
    `  ]\n` +
    `}\n` +
    `Rules:\n` +
    `- Include exactly 5 synonyms (or fewer only if not enough exist).\n` +
    `- Rank by semantic closeness; put the most similar synonyms first.\n` +
    `- Exclude the headword itself.\n` +
    `- Prefer single words (avoid multi-word phrases unless truly common).\n` +
    `- For verbs: ALWAYS use the infinitive/base form (e.g., "run" not "running", "ran", "runs").\n` +
    `- For nouns: use singular form unless the word is typically plural.\n` +
    `- relation should be short (e.g., "synonym").\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  const obj = safeJsonParseObject(raw)
  const list = Array.isArray(obj && obj.synonyms) ? obj.synonyms : []

  const baseKey = String(w).toLowerCase()
  const out = []
  const seen = new Set()

  for (const item of list) {
    const ww = String(item && item.word ? item.word : '').trim()
    if (!ww) continue
    const normalizedWord = ww
      .replace(/^"+|"+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!normalizedWord) continue
    const keyWord = normalizedWord.toLowerCase()
    if (keyWord === baseKey) continue
    if (seen.has(keyWord)) continue
    seen.add(keyWord)

    const pos = normalizeGemmaPos(item && item.pos ? item.pos : '') || ''
    const relation = String(item && item.relation ? item.relation : 'synonym').trim().slice(0, 64) || 'synonym'
    out.push({ word: normalizedWord, pos, relation })
    if (out.length >= 5) break
  }

  return { word: w, synonyms: out }
}

async function gemmaEnrichWord({ key, endpoint, model, word, contextSentenceEn, from, to, dialect, signal }) {
  const w = String(word || '').trim()
  const ctx = String(contextSentenceEn || '').trim()
  if (!w) {
    return {
      meaningSuggested: '',
      meaningNoteVi: '',
      candidates: [],
      posSuggested: '',
      ipa: '',
      example: '',
      contextSentenceVi: ''
    }
  }

  const allowedPos = [
    'Noun',
    'Verb',
    'Adjective',
    'Adverb',
    'Pronoun',
    'Preposition',
    'Conjunction',
    'Determiner',
    'Interjection',
    'Phrase',
    'Other'
  ]

  const d = (dialect === 'UK' ? 'British English (UK)' : 'American English (US)')
  const src = String(from || 'en')
  const dst = String(to || 'vi')

  const hasContext = !!ctx

  const prompt =
    `You are a bilingual English→Vietnamese dictionary assistant.\n` +
    `Given a selected term and an optional English context sentence, produce a compact word card: Vietnamese meanings + POS + IPA + one example sentence, and translate the context sentence to Vietnamese if provided.\n` +
    `\n` +
    `Selected term: "${w}"\n` +
    (ctx ? `Context sentence (English): "${ctx}"\n` : '') +
    `\n` +
    `Output MUST be valid JSON only (no markdown, no commentary).\n` +
    `Schema:\n` +
    `{\n` +
    `  "meaningSuggested": string,\n` +
    `  "meaningNoteVi": string,\n` +
    `  "posSuggested": one of ${JSON.stringify(allowedPos)},\n` +
    `  "ipa": string,\n` +
    `  "example": string,\n` +
    `  "contextSentenceVi": string,\n` +
    `  "candidates": [\n` +
    `    { "vi": string, "pos": one of ${JSON.stringify(allowedPos)}, "back": string[] }\n` +
    `  ]\n` +
    `}\n` +
    `Rules:\n` +
    `- Provide 3 to 7 candidates if possible.\n` +
    `- Candidates should represent DISTINCT senses. Do NOT list minor synonym variations as separate candidates; merge them.\n` +
    `- Each candidate.vi is a short Vietnamese gloss (not a full sentence).\n` +
    `- back: short English hints/synonyms (0-5 items).\n` +
    (hasContext
      ? `- meaningSuggested must exactly equal one of candidates[i].vi (best for the context).\n`
      : `- If NO context sentence is provided: meaningSuggested should be a semicolon-separated list of 1 to 3 DISTINCT senses, and each sense must exactly equal one of candidates[i].vi.\n`) +
    `- posSuggested should match the POS of meaningSuggested.\n` +
    `- meaningNoteVi: 1-2 concise Vietnamese sentences explaining the core sense/usage nuance of meaningSuggested.\n` +
    `- meaningNoteVi MUST focus only on this term; do NOT compare or mention other terms.\n` +
    `- ipa: IPA for "${w}" in ${d}, wrapped in slashes like /həˈloʊ/. If the term is a multi-word expression, set ipa to empty string.\n` +
    `- example: ONE short English sentence (<= 25 words) using the term in the SAME meaning as meaningSuggested.\n` +
    `- contextSentenceVi: translate the context sentence from ${src} to ${dst} if context is provided, else empty string.\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  const obj = safeJsonParseObject(raw) || {}

  const candidates = dedupeCandidates(obj.candidates)
  const meaningSuggestedRaw = obj.meaningSuggested ? String(obj.meaningSuggested || '').trim() : ''
  let meaningSuggested = ''

  if (meaningSuggestedRaw) {
    const exact = candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(meaningSuggestedRaw))
    if (exact) {
      meaningSuggested = exact.vi
    } else if (!hasContext) {
      const parts = splitMeaningList(meaningSuggestedRaw)
      const picked = []
      for (const p of parts) {
        const found = candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(p))
        if (!found) continue
        if (picked.some((x) => meaningsTooClose(x, found.vi))) continue
        picked.push(found.vi)
        if (picked.length >= 3) break
      }
      if (picked.length > 0) meaningSuggested = picked.join('; ')
    }
  }

  if (!meaningSuggested && candidates.length > 0) {
    if (!hasContext) {
      const picked = selectDistinctMeaningsFromCandidates(candidates, 3)
      meaningSuggested = picked.join('; ')
    } else {
      meaningSuggested = candidates[0].vi
    }
  }

  let posSuggested = normalizeGemmaPos(obj.posSuggested)
  if (!posSuggested) {
    const primaryMeaning = splitMeaningList(meaningSuggested)[0] || meaningSuggested
    const byMeaning = primaryMeaning
      ? candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(primaryMeaning))
      : null
    posSuggested = normalizeGemmaPos(byMeaning && byMeaning.pos ? byMeaning.pos : '')
  }

  // IPA is empty for phrases.
  let ipa = ''
  if (!/\s/.test(w)) {
    ipa = sanitizeIpaOutput(obj.ipa)
  }

  let example = obj.example ? String(obj.example || '').trim() : ''
  if (example.includes('\n')) {
    example = example
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)[0] || ''
  }
  // Strip surrounding quotes.
  example = example.replace(/^"+|"+$/g, '').trim()

  const meaningNoteVi = obj.meaningNoteVi ? String(obj.meaningNoteVi || '').trim() : ''

  const contextSentenceVi = obj.contextSentenceVi ? String(obj.contextSentenceVi || '').trim() : ''

  return {
    meaningSuggested: meaningSuggested || '',
    meaningNoteVi: meaningNoteVi || '',
    candidates,
    posSuggested: posSuggested || '',
    ipa: ipa || '',
    example: example || '',
    contextSentenceVi: contextSentenceVi || ''
  }
}

async function gemmaEnrichWordsBulk({ key, endpoint, model, words, contextSentenceEn, from, to, dialect, signal }) {
  const listRaw = Array.isArray(words) ? words : []
  const list = listRaw
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 3)

  const ctx = String(contextSentenceEn || '').trim()
  if (list.length === 0) return []

  const allowedPos = [
    'Noun',
    'Verb',
    'Adjective',
    'Adverb',
    'Pronoun',
    'Preposition',
    'Conjunction',
    'Determiner',
    'Interjection',
    'Phrase',
    'Other'
  ]

  const d = (dialect === 'UK' ? 'British English (UK)' : 'American English (US)')
  const src = String(from || 'en')
  const dst = String(to || 'vi')
  const hasContext = !!ctx

  const prompt =
    `You are a bilingual English→Vietnamese dictionary assistant.\n` +
    `Task: For each provided English term, produce a compact word card: Vietnamese meanings + POS + IPA + one example sentence, and translate the shared context sentence to Vietnamese if provided.\n` +
    `\n` +
    `Terms: ${JSON.stringify(list)}\n` +
    (ctx ? `Context sentence (English): "${ctx}"\n` : '') +
    `\n` +
    `Output MUST be valid JSON only (no markdown, no commentary).\n` +
    `Schema:\n` +
    `{\n` +
    `  "items": [\n` +
    `    {\n` +
    `      "word": string,\n` +
    `      "meaningSuggested": string,\n` +
    `      "meaningNoteVi": string,\n` +
    `      "posSuggested": one of ${JSON.stringify(allowedPos)},\n` +
    `      "ipa": string,\n` +
    `      "example": string,\n` +
    `      "contextSentenceVi": string,\n` +
    `      "candidates": [ { "vi": string, "pos": one of ${JSON.stringify(allowedPos)}, "back": string[] } ]\n` +
    `    }\n` +
    `  ]\n` +
    `}\n` +
    `Rules (apply to EACH item):\n` +
    `- Provide 3 to 7 candidates if possible.\n` +
    `- Candidates should represent DISTINCT senses. Do NOT list minor synonym variations as separate candidates; merge them.\n` +
    `- Each candidate.vi is a short Vietnamese gloss (not a full sentence).\n` +
    `- back: short English hints/synonyms (0-5 items).\n` +
    (hasContext
      ? `- meaningSuggested must exactly equal one of candidates[i].vi (best for the context).\n`
      : `- If NO context sentence is provided: meaningSuggested should be a semicolon-separated list of 1 to 3 DISTINCT senses, and each sense must exactly equal one of candidates[i].vi.\n`) +
    `- posSuggested should match the POS of meaningSuggested.\n` +
    `- meaningNoteVi: 1-2 concise Vietnamese sentences explaining the core sense/usage nuance of meaningSuggested.\n` +
    `- meaningNoteVi MUST focus only on this term; do NOT compare or mention other terms.\n` +
    `- ipa: IPA for the word in ${d}, wrapped in slashes like /həˈloʊ/. If the term is a multi-word expression, set ipa to empty string.\n` +
    `- example: ONE short English sentence (<= 25 words) using the term in the SAME meaning as meaningSuggested.\n` +
    `- contextSentenceVi: translate the shared context sentence from ${src} to ${dst} if context is provided, else empty string.\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  const obj = safeJsonParseObject(raw) || {}
  const items = Array.isArray(obj && obj.items) ? obj.items : (Array.isArray(obj && obj.results) ? obj.results : [])

  const byKey = new Map(list.map((w) => [String(w).toLowerCase(), w]))
  const outByKey = new Map()

  for (const item of items) {
    const wRaw = String(item && item.word ? item.word : '').trim()
    if (!wRaw) continue
    const keyWord = wRaw.toLowerCase()
    if (!byKey.has(keyWord)) continue

    const candidates = dedupeCandidates(item && item.candidates ? item.candidates : [])
    const meaningSuggestedRaw = item && item.meaningSuggested ? String(item.meaningSuggested || '').trim() : ''
    let meaningSuggested = ''

    if (meaningSuggestedRaw) {
      const exact = candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(meaningSuggestedRaw))
      if (exact) {
        meaningSuggested = exact.vi
      } else if (!hasContext) {
        const parts = splitMeaningList(meaningSuggestedRaw)
        const picked = []
        for (const p of parts) {
          const found = candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(p))
          if (!found) continue
          if (picked.some((x) => meaningsTooClose(x, found.vi))) continue
          picked.push(found.vi)
          if (picked.length >= 3) break
        }
        if (picked.length > 0) meaningSuggested = picked.join('; ')
      }
    }

    if (!meaningSuggested && candidates.length > 0) {
      if (!hasContext) {
        const picked = selectDistinctMeaningsFromCandidates(candidates, 3)
        meaningSuggested = picked.join('; ')
      } else {
        meaningSuggested = candidates[0].vi
      }
    }

    let posSuggested = normalizeGemmaPos(item && item.posSuggested ? item.posSuggested : '')
    if (!posSuggested) {
      const primaryMeaning = splitMeaningList(meaningSuggested)[0] || meaningSuggested
      const byMeaning = primaryMeaning
        ? candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(primaryMeaning))
        : null
      posSuggested = normalizeGemmaPos(byMeaning && byMeaning.pos ? byMeaning.pos : '')
    }

    let ipa = ''
    if (!/\s/.test(wRaw)) {
      ipa = sanitizeIpaOutput(item && item.ipa ? item.ipa : '')
    }

    let example = item && item.example ? String(item.example || '').trim() : ''
    if (example.includes('\n')) {
      example = example
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)[0] || ''
    }
    example = example.replace(/^"+|"+$/g, '').trim()

    const contextSentenceVi = item && item.contextSentenceVi ? String(item.contextSentenceVi || '').trim() : ''
    const meaningNoteVi = item && item.meaningNoteVi ? String(item.meaningNoteVi || '').trim() : ''

    outByKey.set(keyWord, {
      word: byKey.get(keyWord) || wRaw,
      meaningSuggested: meaningSuggested || '',
      meaningNoteVi: meaningNoteVi || '',
      candidates,
      posSuggested: posSuggested || '',
      ipa: ipa || '',
      example: example || '',
      contextSentenceVi: contextSentenceVi || ''
    })
  }

  return list.map((w) => {
    const keyWord = String(w).toLowerCase()
    return outByKey.get(keyWord) || {
      word: w,
      meaningSuggested: '',
      meaningNoteVi: '',
      candidates: [],
      posSuggested: '',
      ipa: '',
      example: '',
      contextSentenceVi: ''
    }
  })
}

function extractFirstJsonObject(s) {
  const t = stripCodeFences(s)
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return t.slice(start, end + 1)
  return ''
}

function safeJsonParseObject(s) {
  const raw = extractFirstJsonObject(s)
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : null
  } catch (e) {
    return null
  }
}

function normalizeGemmaPos(pos) {
  const raw = String(pos || '').trim()
  if (!raw) return ''
  // Keep compatibility with renderer normalizePos().
  const upper = raw.toUpperCase()
  const map = {
    NOUN: 'Noun',
    VERB: 'Verb',
    ADJECTIVE: 'Adjective',
    ADJ: 'Adjective',
    ADVERB: 'Adverb',
    ADV: 'Adverb',
    PRONOUN: 'Pronoun',
    PRON: 'Pronoun',
    PREPOSITION: 'Preposition',
    PREP: 'Preposition',
    CONJUNCTION: 'Conjunction',
    CONJ: 'Conjunction',
    DETERMINER: 'Determiner',
    DET: 'Determiner',
    INTERJECTION: 'Interjection',
    INT: 'Interjection',
    PHRASE: 'Phrase',
    OTHER: 'Other'
  }
  if (map[upper]) return map[upper]
  // Accept already-normalized UI values.
  const allowed = new Set([
    'Noun',
    'Verb',
    'Adjective',
    'Adverb',
    'Pronoun',
    'Preposition',
    'Conjunction',
    'Determiner',
    'Interjection',
    'Phrase',
    'Other'
  ])
  return allowed.has(raw) ? raw : ''
}

function dedupeCandidates(cands) {
  const list = Array.isArray(cands) ? cands : []
  const out = []
  const seen = new Set()
  for (const c of list) {
    const vi = String(c && c.vi ? c.vi : '').trim()
    if (!vi) continue
    const key = normalizeMeaningForMatch(vi)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({
      vi,
      pos: normalizeGemmaPos(c && c.pos ? c.pos : '') || (c && c.pos ? String(c.pos).trim() : ''),
      back: Array.isArray(c && c.back)
        ? c.back.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8)
        : []
    })
  }
  return out
}

async function gemmaSuggestMeaningCandidates({ key, endpoint, model, word, contextSentenceEn, from, to, signal }) {
  const w = String(word || '').trim()
  const ctx = String(contextSentenceEn || '').trim()
  if (!w) {
    return { candidates: [], meaningSuggested: '', meaningNoteVi: '', contextSentenceVi: '' }
  }

  const allowedPos = [
    'Noun',
    'Verb',
    'Adjective',
    'Adverb',
    'Pronoun',
    'Preposition',
    'Conjunction',
    'Determiner',
    'Interjection',
    'Phrase',
    'Other'
  ]

  const prompt =
    `You are a bilingual English→Vietnamese dictionary assistant.\n` +
    `Task: Given a selected term and an optional English context sentence, propose multiple Vietnamese meanings (glosses) and a part-of-speech for each meaning.\n` +
    `Important: The meanings must be appropriate for the given context when context is provided.\n` +
    `\n` +
    `Selected term: "${w}"\n` +
    (ctx ? `Context sentence (English): "${ctx}"\n` : '') +
    `\n` +
    `Output MUST be valid JSON only (no markdown, no commentary).\n` +
    `Schema:\n` +
    `{\n` +
    `  "meaningSuggested": string,\n` +
    `  "meaningNoteVi": string,\n` +
    `  "candidates": [\n` +
    `    { "vi": string, "pos": one of ${JSON.stringify(allowedPos)}, "back": string[] }\n` +
    `  ]\n` +
    `}\n` +
    `Rules:\n` +
    `- Provide 3 to 7 candidates if possible.\n` +
    `- Candidates should represent DISTINCT senses. Do NOT list minor synonym variations as separate candidates; merge them.\n` +
    `- Each candidate.vi should be a short Vietnamese gloss (not a full sentence).\n` +
    `- back: short English hints/synonyms (0-5 items).\n` +
    `- meaningNoteVi: 1-2 concise Vietnamese sentences explaining the core sense/usage nuance of meaningSuggested.\n` +
    `- meaningNoteVi MUST focus only on this term; do NOT compare or mention other terms.\n` +
    (ctx
      ? `- meaningSuggested must exactly equal one of candidates[i].vi (best for the context).\n`
      : `- If NO context sentence is provided: meaningSuggested should be a semicolon-separated list of 1 to 3 DISTINCT senses, and each sense must exactly equal one of candidates[i].vi.\n`) +
    `- If the selected term is a multi-word expression, use pos="Phrase".\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  const obj = safeJsonParseObject(raw)
  const candidates = dedupeCandidates(obj && obj.candidates)
  const hasContext = !!ctx
  const meaningSuggestedRaw = obj && obj.meaningSuggested ? String(obj.meaningSuggested || '').trim() : ''
  let meaningSuggested = ''

  if (meaningSuggestedRaw) {
    const exact = candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(meaningSuggestedRaw))
    if (exact) {
      meaningSuggested = exact.vi
    } else if (!hasContext) {
      const parts = splitMeaningList(meaningSuggestedRaw)
      const picked = []
      for (const p of parts) {
        const found = candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(p))
        if (!found) continue
        if (picked.some((x) => meaningsTooClose(x, found.vi))) continue
        picked.push(found.vi)
        if (picked.length >= 3) break
      }
      if (picked.length > 0) meaningSuggested = picked.join('; ')
    }
  }

  if (!meaningSuggested && candidates.length > 0) {
    if (!hasContext) {
      const picked = selectDistinctMeaningsFromCandidates(candidates, 3)
      meaningSuggested = picked.join('; ')
    } else {
      meaningSuggested = candidates[0].vi
    }
  }

  const meaningNoteVi = obj && obj.meaningNoteVi ? String(obj.meaningNoteVi || '').trim() : ''

  return { candidates, meaningSuggested, meaningNoteVi, contextSentenceVi: '' }
}

async function gemmaGenerateMeaningNoteVi({ key, endpoint, model, word, meaningSuggested, contextSentenceEn, signal }) {
  const w = String(word || '').trim()
  const m = String(meaningSuggested || '').trim()
  const ctx = String(contextSentenceEn || '').trim()
  if (!w || !m) return ''

  const prompt =
    `You are a Vietnamese lexicography assistant.\n` +
    `Write 1-2 concise Vietnamese sentences explaining the usage nuance of the target English term in the given meaning.\n` +
    `Output ONLY plain Vietnamese text (no markdown, no bullets, no labels).\n` +
    `Rules:\n` +
    `- Focus only on the target term and this meaning.\n` +
    `- Do NOT compare with or mention any other terms.\n` +
    `- Keep it concise and practical for learners.\n` +
    `\n` +
    `Target term: "${w}"\n` +
    `Chosen Vietnamese meaning: "${m}"\n` +
    (ctx ? `Context sentence (English): "${ctx}"\n` : '')

  const out = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  return String(out || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\s*[-*\u2022]\s*/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
}

function buildMeaningNoteViFallback(word, meaningSuggested, contextSentenceEn) {
  const w = String(word || '').trim()
  const m = String(meaningSuggested || '').trim()
  const ctx = String(contextSentenceEn || '').trim()
  if (!w || !m) return ''
  if (ctx) {
    return `Trong ngữ cảnh này, "${w}" được dùng với nghĩa "${m}". Hãy bám vào sắc thái này để hiểu và dùng từ đúng.`
  }
  return `"${w}" thường được hiểu là "${m}". Ghi nhớ nghĩa trọng tâm này để áp dụng chính xác khi gặp từ trong câu.`
}

async function googleTranslatePlain({ key, endpoint, model, from, to, text, signal }) {
  const src = String(from || 'en')
  const dst = String(to || 'vi')
  const body = String(text || '').trim()
  if (!body) return ''

  const prompt =
    `Translate the following text from ${src} to ${dst}.\n` +
    `Rules:\n` +
    `- Output ONLY the translation, no extra commentary.\n` +
    `- Preserve paragraph breaks and punctuation.\n` +
    `- Keep names, numbers, and symbols unchanged unless they must be localized.\n` +
    `\nTEXT:\n<<<\n${body}\n>>>`

  const out = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  return String(out || '').trim()
}

function normalizeLookupWord(word) {
  return String(word || '')
    .trim()
    .replace(/^\s+|\s+$/g, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
}

function uniqueWords(words) {
  const seen = new Set()
  const result = []
  for (const item of words) {
    const clean = normalizeLookupWord(item)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

function buildLookupCandidates(word) {
  const cleanWord = normalizeLookupWord(word)
  if (!cleanWord) return []

  const lower = cleanWord.toLowerCase()
  const candidates = [cleanWord, lower, lower.replace(/[’']s$/i, '')]

  if (lower.endsWith('ies') && lower.length > 3) candidates.push(lower.slice(0, -3) + 'y')
  if (lower.endsWith('ves') && lower.length > 3) {
    candidates.push(lower.slice(0, -3) + 'f')
    candidates.push(lower.slice(0, -3) + 'fe')
  }
  if (lower.endsWith('ing') && lower.length > 4) {
    candidates.push(lower.slice(0, -3))
    candidates.push(lower.slice(0, -3).replace(/([a-z])\1$/i, '$1'))
  }
  if (lower.endsWith('ed') && lower.length > 3) {
    candidates.push(lower.slice(0, -2))
    candidates.push(lower.slice(0, -1))
  }
  if (lower.endsWith('es') && lower.length > 3) candidates.push(lower.slice(0, -2))
  if (lower.endsWith('s') && lower.length > 2) candidates.push(lower.slice(0, -1))

  return uniqueWords(candidates)
}

function normalizeDefinition(definition) {
  return String(definition || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function stripHtml(input) {
  return String(input || '').replace(/<[^>]+>/g, ' ')
}

function cleanDefinitionText(input) {
  return normalizeDefinition(decodeHtmlEntities(stripHtml(input)))
}

function clipDefinition(text, maxLength = 320) {
  const clean = normalizeDefinition(text)
  if (!clean) return ''
  if (clean.length <= maxLength) return clean

  const sentence = clean.match(/^(.{1,260}?\.[\s"')\]]|.{1,260}?$)/)
  const clipped = sentence ? sentence[1].replace(/[\s"')\]]+$/g, '') : clean.slice(0, maxLength - 3)
  return clipped.length > maxLength ? `${clipped.slice(0, maxLength - 3)}...` : clipped
}

function normalizeBingDefinition(definition) {
  const raw = String(definition || '').replace(/\r/g, '').trim()
  if (!raw) return ''

  const looksStructured = /\[[A-Z]+\]/.test(raw) || /\n\s*\d+\.\s+/.test(raw)
  if (!looksStructured) return clipDefinition(raw)

  const lines = raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !!line.trim())

  if (lines.length === 0) return ''

  const limited = lines.slice(0, 16)
  return limited.join('\n').trim()
}

function pickDefinitionFromEntry(entry) {
  const meanings = Array.isArray(entry?.meanings) ? entry.meanings : []
  for (const meaning of meanings) {
    const definitions = Array.isArray(meaning?.definitions) ? meaning.definitions : []
    for (const item of definitions) {
      const definition = normalizeDefinition(item?.definition)
      if (definition) return definition
    }
  }
  return ''
}

async function fetchDictionaryApiDefinition(word) {
  const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
  if (!resp.ok) return ''
  const data = await resp.json()
  if (!Array.isArray(data) || data.length === 0) return ''

  for (const entry of data) {
    const definition = pickDefinitionFromEntry(entry)
    if (definition) return definition
  }

  return ''
}

function pickWiktionaryDefinition(item) {
  const defs = Array.isArray(item?.definitions) ? item.definitions : []
  let formOfCandidate = ''

  for (const def of defs) {
    const text = cleanDefinitionText(def?.definition)
    if (!text) continue

    if (!/\b(form of|inflection of|plural of|past tense of|participle of)\b/i.test(text)) {
      return text
    }
    if (!formOfCandidate) formOfCandidate = text
  }

  return formOfCandidate
}

async function fetchWiktionaryDefinition(word) {
  const resp = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`)
  if (!resp.ok) return ''

  const data = await resp.json()
  const enEntries = Array.isArray(data?.en) ? data.en : []
  for (const entry of enEntries) {
    const definition = pickWiktionaryDefinition(entry)
    if (definition) return clipDefinition(definition)
  }

  return ''
}

async function fetchWikipediaSummaryDefinition(word) {
  const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`)
  if (!resp.ok) return ''

  const data = await resp.json()
  const extract = cleanDefinitionText(data?.extract)
  if (!extract) return ''
  if (/\bmay refer to\b/i.test(extract)) return ''

  return clipDefinition(extract)
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}


const definitionCache = new Map()

function resolveBingPythonScriptPath() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'bing_definition.py'),
    path.join(process.cwd(), 'scripts', 'bing_definition.py')
  ]
  for (const p of candidates) {
    try {
      if (p && fsSync.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return ''
}

async function runPythonOnce(command, args, timeoutMs = 15000) {
  return await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null

    let child
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      reject(e)
      return
    }

    const doneResolve = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }

    const doneReject = (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(err)
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk || '')
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '')
      })
    }

    child.on('error', doneReject)
    child.on('close', (code) => {
      if (code === 0) {
        doneResolve(stdout)
      } else {
        doneReject(new Error(`python exited ${code}: ${String(stderr || '').trim()}`))
      }
    })

    timer = setTimeout(() => {
      try { child.kill() } catch {}
      doneReject(new Error(`python timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}

async function fetchBingDefinitionViaPython(word) {
  const scriptPath = resolveBingPythonScriptPath()
  const w = String(word || '').trim()
  if (!w) return ''
  if (!scriptPath) {
    console.warn('[bing-python] script not found; skip', { word: w })
    return ''
  }

  const cmdCandidates = []
  const explicitPython = String(process.env.PYTHON || '').trim()
  if (explicitPython) {
    cmdCandidates.push({ command: explicitPython, args: [scriptPath, w] })
  }
  cmdCandidates.push({ command: 'python', args: [scriptPath, w] })
  cmdCandidates.push({ command: 'py', args: ['-3', scriptPath, w] })

  let lastError = ''

  for (const item of cmdCandidates) {
    try {
      const out = await runPythonOnce(item.command, item.args, 15000)
      const obj = safeJsonParse(String(out || '').trim())
      const definition = String((obj && obj.definition) || '').trim()
      if (definition) return definition
      if (obj && Object.prototype.hasOwnProperty.call(obj, 'definition')) return ''
    } catch (e) {
      lastError = e && e.message ? e.message : String(e)
    }
  }

  if (lastError) {
    console.warn('[bing-python] all python commands failed; fallback to non-bing sources', {
      word: w,
      error: lastError
    })
  }

  return ''
}

function cleanHtmlText(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function extractClassBlocks(html, className) {
  const source = String(html || '')
  if (!source || !className) return []
  const cls = escapeRegex(className)
  const regex = new RegExp(`<([a-z0-9-]+)[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi')
  const out = []
  let match
  while ((match = regex.exec(source))) {
    out.push(match[2] || '')
  }
  return out
}

function extractFirstClassText(html, className) {
  const blocks = extractClassBlocks(html, className)
  if (blocks.length === 0) return ''
  return cleanHtmlText(blocks[0])
}

function parseBingDefinitionText(html) {
  const source = String(html || '')
  if (!source) return ''

  const rootMatch = source.match(/<dict-common-module[\s\S]*?<\/dict-common-module>/i)
  const root = rootMatch ? rootMatch[0] : source
  const groups = extractClassBlocks(root, 'common-module-group')
  const lines = []

  for (const group of groups) {
    const pos = extractFirstClassText(group, 'common-definitions-pos-inner') || 'other'
    const itemBlocks = extractClassBlocks(group, 'common-definition-content')
    const defs = []

    for (const item of itemBlocks) {
      const mainDef = extractFirstClassText(item, 'common-module-maindef') || cleanHtmlText(item)
      if (!mainDef) continue
      defs.push(mainDef)
      if (defs.length >= 3) break
    }

    if (defs.length === 0) continue
    lines.push(`[${pos}]`)
    defs.forEach((def, idx) => {
      lines.push(`  ${idx + 1}. ${def}`)
    })
  }

  return lines.join('\n').trim()
}

let bingLookupWindow = null
let bingLookupQueue = Promise.resolve()

function queueBingLookup(task) {
  const run = () => Promise.resolve().then(task)
  const next = bingLookupQueue.then(run, run)
  bingLookupQueue = next.catch(() => {})
  return next
}

function getBingLookupWindow() {
  if (bingLookupWindow && !bingLookupWindow.isDestroyed()) return bingLookupWindow
  bingLookupWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
    },
  })
  bingLookupWindow.on('closed', () => {
    bingLookupWindow = null
  })
  return bingLookupWindow
}

async function waitForBingDictCard(win, timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const exists = await win.webContents.executeJavaScript(
        "Boolean(document.querySelector('dict-common-module'))",
        true
      )
      if (exists) return true
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function extractBingDefinitionFromRenderedDom(win) {
  return await win.webContents.executeJavaScript(
    `(() => {
      const card = document.querySelector('dict-common-module')
      if (!card) return ''

      const lines = []
      const groups = card.querySelectorAll('.common-module-group')
      for (const group of groups) {
        const pos = (group.querySelector('.common-definitions-pos-inner')?.textContent || 'UNKNOWN').trim().toUpperCase()
        const defs = []
        const items = Array.from(group.querySelectorAll('li.common-definition-content')).slice(0, 2)
        for (const item of items) {
          const text = (item.querySelector('.common-module-maindef')?.textContent || '').trim()
          if (text) defs.push(text)
        }

        if (defs.length === 0) continue
        lines.push('[' + pos + ']')
        defs.forEach((def, idx) => {
          lines.push('  ' + (idx + 1) + '. ' + def)
        })
      }

      return lines.join('\\n').trim()
    })()`,
    true
  )
}

async function fetchEnglishDefinition(word) {
  const cleanWord = String(word || '').trim()
  if (!cleanWord) return ''

  const cacheKey = cleanWord.toLowerCase()
  const cached = definitionCache.get(cacheKey)
  if (cached) return cached

  const pending = (async () => {
    try {
      const candidates = buildLookupCandidates(cleanWord)

      for (const candidate of candidates) {
        try {
          const bingDefinition = await fetchBingDefinitionViaPython(candidate)
          if (bingDefinition) return normalizeBingDefinition(bingDefinition)
        } catch {
          // try next candidate
        }
      }
    } catch {
      // ignore network and parsing errors
    }
    return ''
  })()

  definitionCache.set(cacheKey, pending)
  const result = await pending
  if (result) {
    definitionCache.set(cacheKey, Promise.resolve(result))
  } else {
    definitionCache.delete(cacheKey)
  }
  return result
}

async function gemmaTranslateMeaningNoteVie({ key, endpoint, model, word, englishMeaning, contextSentenceEn, signal }) {
  const source = String(englishMeaning || '').trim()
  if (!source) return ''
  const ctx = String(contextSentenceEn || '').trim()
  const targetWord = String(word || '').trim()

  const prompt =
    `You are a professional English→Vietnamese dictionary translator.\n` +
    `Task: Translate the following English dictionary definition into Vietnamese that corresponds exactly to the same meaning.\n` +
    `Rules:\n` +
    `- Output ONLY Vietnamese text, no commentary, no markdown.\n` +
    `- Keep it faithful to the source definition and concise.\n` +
    `- Do not add, remove, or infer extra senses.\n` +
    `- If the source contains POS tags (e.g. [NOUN], [VERB]), numbering, or multiple lines, preserve the same structure and line breaks in Vietnamese.\n` +
    `- Keep dictionary style (plain definition text), do not turn it into explanation or example.\n` +
    (targetWord ? `- Target word: "${targetWord}"\n` : '') +
    (ctx ? `- Context sentence: "${ctx}"\n` : '') +
    `\nENGLISH DEFINITION:\n<<<\n${source}\n>>>`

  const out = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  return String(out || '').replace(/\r/g, '').trim()
}

async function googleTranslateExplain({ key, endpoint, model, from, to, text, signal }) {
  const src = String(from || 'en')
  const dst = String(to || 'vi')
  const body = String(text || '').trim()
  if (!body) return { translation: '', explanation: '' }

  const prompt =
    `You are a professional translator.\n` +
    `Task: Translate the following text from ${src} to ${dst}, and also provide an explanation.\n` +
    `Output MUST be valid JSON only (no markdown).\n` +
    `Schema:\n` +
    `{\n` +
    `  "translation": string,\n` +
    `  "explanation": string\n` +
    `}\n` +
    `Rules:\n` +
    `- translation: only the translation, preserve paragraph breaks.\n` +
    `- explanation: write in ${dst}. Include BOTH parts:\n` +
    `  (A) "Ý nghĩa chung": 2-4 sentences summarizing what the passage means in plain language.\n` +
    `  (B) "Giải thích chi tiết": 3-7 bullet points focusing on tricky phrases/idioms/grammar or key vocabulary.\n` +
    `- Do NOT repeat the entire translation inside explanation.\n` +
    `\nTEXT:\n<<<\n${body}\n>>>`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  const obj = safeJsonParseObject(raw) || {}
  const translation = String(obj.translation || '').trim()
  let explanation = String(obj.explanation || '').trim()

  // If model didn't follow JSON rules, fall back gracefully.
  if (!translation && raw) {
    return { translation: String(raw || '').trim(), explanation: '' }
  }

  explanation = explanation.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return { translation, explanation }
}

function normalizeMeaningForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, '"')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function chooseMeaningByContext(candidates, contextSentenceVi) {
  const ctx = normalizeMeaningForMatch(contextSentenceVi)
  if (!ctx) return ''

  const matches = []
  for (const c of candidates) {
    const vi = String(c.vi || '').trim()
    const n = normalizeMeaningForMatch(vi)
    if (!n) continue
    if (ctx.includes(n)) {
      const tokenCount = n.split(' ').filter(Boolean).length
      matches.push({ vi, tokenCount, len: n.length })
    }
  }

  if (matches.length === 0) return ''

  matches.sort((a, b) => {
    if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount
    if (b.len !== a.len) return b.len - a.len
    return 0
  })

  return matches[0].vi
}

function splitMeaningList(s) {
  const raw = String(s || '').trim()
  if (!raw) return []
  const cleaned = raw
    .replace(/[\r\n]+/g, ';')
    .replace(/\u2022/g, ';')
    .replace(/^\s*[-*]\s+/gm, '')
  return cleaned
    .split(/\s*(?:;|\/|\||,)+\s*/g)
    .map((p) => String(p || '').trim())
    .filter(Boolean)
}

function meaningsTooClose(a, b) {
  const na = normalizeMeaningForMatch(a)
  const nb = normalizeMeaningForMatch(b)
  if (!na || !nb) return true
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true

  const ta = na.split(' ').filter(Boolean)
  const tb = nb.split(' ').filter(Boolean)
  if (ta.length === 0 || tb.length === 0) return false

  const setA = new Set(ta)
  const setB = new Set(tb)
  let inter = 0
  for (const t of setA) {
    if (setB.has(t)) inter++
  }
  const minSize = Math.min(setA.size, setB.size)
  if (minSize <= 0) return false
  const overlap = inter / minSize
  return overlap >= 0.8
}

function selectDistinctMeaningsFromCandidates(candidates, maxCount) {
  const list = Array.isArray(candidates) ? candidates : []
  const out = []
  const tryAdd = (c) => {
    if (!c) return
    const vi = String(c.vi || '').trim()
    if (!vi) return
    if (out.some((x) => meaningsTooClose(x, vi))) return
    out.push(vi)
  }

  if (list.length === 0) return out

  tryAdd(list[0])
  const firstPos = normalizeGemmaPos(list[0] && list[0].pos ? list[0].pos : '') || String(list[0] && list[0].pos ? list[0].pos : '').trim()

  // Prefer adding a meaning with a different POS when available.
  if (out.length < maxCount && firstPos) {
    for (const c of list) {
      const pos = normalizeGemmaPos(c && c.pos ? c.pos : '') || String(c && c.pos ? c.pos : '').trim()
      if (pos && pos !== firstPos) {
        tryAdd(c)
        if (out.length >= maxCount) break
      }
    }
  }

  if (out.length < maxCount) {
    for (const c of list) {
      tryAdd(c)
      if (out.length >= maxCount) break
    }
  }

  return out
}

function splitVietnameseCandidates(s) {
  const raw = String(s || '').trim()
  if (!raw) return []
  // Split common separators if API returns multiple options.
  const parts = raw.split(/\s*[;\/|,]\s*/g).map(p => p.trim()).filter(Boolean)
  const uniq = []
  const seen = new Set()
  for (const p of parts.length > 0 ? parts : [raw]) {
    const key = normalizeMeaningForMatch(p)
    if (!key || seen.has(key)) continue
    seen.add(key)
    uniq.push(p)
  }
  return uniq
}

function candidatesLookUntranslated(word, candidates) {
  const w = normalizeMeaningForMatch(word)
  const list = Array.isArray(candidates) ? candidates : []
  if (list.length === 0) return true
  // If every candidate normalizes to the same as the source word, treat as untranslated.
  return list.every((c) => normalizeMeaningForMatch(c.vi) === w)
}

function getTranslatorConfig(payload) {
  const key = process.env.AZURE_TRANSLATOR_KEY
  const region = (payload && payload.region) ? payload.region : process.env.AZURE_TRANSLATOR_REGION
  if (!key) throw new Error('Missing AZURE_TRANSLATOR_KEY')
  if (!region) throw new Error('Missing AZURE_TRANSLATOR_REGION')
  return { key, region }
}

async function azureTranslatePlain({ key, region, from, to, text, signal }) {
  const url = `${AZURE_TRANSLATOR_ENDPOINT}/translate?api-version=3.0&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{ Text: text }]),
    signal
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Azure translate failed: ${resp.status} ${t}`)
  }
  const data = await resp.json()
  const translatedText = data && data[0] && data[0].translations && data[0].translations[0] ? data[0].translations[0].text : ''
  return String(translatedText || '')
}

async function azureTranslateWordCandidates({ key, region, from, to, word, signal }) {
  const translated = await azureTranslatePlain({ key, region, from, to, text: word, signal })
  const parts = splitVietnameseCandidates(translated)
  return parts.map((vi) => ({ vi, pos: '', back: [word] }))
}

async function autoMeaningCore(payload) {
  const req = payload || {}
  const requestId = String(req.requestId || generateUUID())
  const word = String(req.word || '').trim()
  const contextSentenceEn = String(req.contextSentenceEn || '').trim()
  const from = String(req.from || 'en')
  const to = String(req.to || 'vi')

  if (!word) {
    return {
      requestId,
      word: '',
      meaningSuggested: '',
      meaningNoteEn: '',
      meaningNoteVi: '',
      meaningNoteVie: '',
      contextSentenceVi: '',
      candidates: []
    }
  }

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in Electron main process')
  }

  const controller = new AbortController()
  pendingAutoMeaning.set(requestId, controller)

  try {
    let candidates = []
    let contextSentenceVi = ''
    let meaningSuggested = ''
    let meaningNoteVi = ''
    let meaningNoteEn = ''

    // 1) Primary: Gemma suggests meanings + POS using context (LLM sense disambiguation).
    // If Google AI Studio key is missing, skip Gemma and rely on Azure dictionary fallback (or return empty).
    let g = null
    try {
      g = await getGoogleAiStudioConfig(req)
    } catch (e) {
      g = null
    }

    if (g) {
      // Run meaning-candidates + optional context translation concurrently to reduce single-word latency.
      const jobs = []
      jobs.push(
        gemmaSuggestMeaningCandidates({
          key: g.key,
          endpoint: g.endpoint,
          model: g.model,
          word,
          contextSentenceEn,
          from,
          to,
          signal: controller.signal
        })
      )
      jobs.push(
        contextSentenceEn
          ? googleTranslatePlain({
              key: g.key,
              endpoint: g.endpoint,
              model: g.model,
              from,
              to,
              text: contextSentenceEn,
              signal: controller.signal
            })
          : Promise.resolve('')
      )

      const [meaningRes, ctxRes] = await Promise.allSettled(jobs)

      if (meaningRes.status === 'fulfilled') {
        const gemma = meaningRes.value
        candidates = Array.isArray(gemma.candidates) ? gemma.candidates : []
        meaningSuggested = String(gemma.meaningSuggested || '').trim()
        meaningNoteVi = String(gemma.meaningNoteVi || '').trim()
      }

      if (ctxRes.status === 'fulfilled') {
        contextSentenceVi = String(ctxRes.value || '').trim()
      }
    }

    try {
      meaningNoteEn = await fetchEnglishDefinition(word)
    } catch (e) {
      meaningNoteEn = ''
    }

    if (meaningNoteEn && g) {
      try {
        const translatedNote = await gemmaTranslateMeaningNoteVie({
          key: g.key,
          endpoint: g.endpoint,
          model: g.model,
          word,
          englishMeaning: meaningNoteEn,
          contextSentenceEn,
          signal: controller.signal
        })
        if (translatedNote) meaningNoteVi = translatedNote
      } catch (e) {
        // keep fallback note below
      }
    }

    // 3) Optional fallback: Azure Dictionary Lookup if Gemma returns nothing.
    if (candidates.length === 0) {
      try {
        const { key, region } = getTranslatorConfig(req)
        const dict = await azureDictionaryLookup({ key, region, from, to, word, signal: controller.signal })
        const translations = (Array.isArray(dict) && dict[0] && Array.isArray(dict[0].translations)) ? dict[0].translations : []
        candidates = translations
          .map((t) => {
            const vi = String(t.displayTarget || t.normalizedTarget || '').trim()
            const pos = String(t.posTag || '').trim()
            const back = Array.isArray(t.backTranslations)
              ? t.backTranslations.map((b) => String(b.displayText || b.normalizedText || '').trim()).filter(Boolean).slice(0, 8)
              : []
            return { vi, pos, back }
          })
          .filter((c) => c.vi)

        if (!meaningSuggested && contextSentenceVi) {
          meaningSuggested = chooseMeaningByContext(candidates, contextSentenceVi)
        }
      } catch (e) {
        // ignore fallback errors (missing Azure config, request errors, etc.)
      }
    }

    if (!meaningSuggested && candidates.length > 0) {
      if (!contextSentenceEn) {
        const picked = selectDistinctMeaningsFromCandidates(candidates, 3)
        meaningSuggested = (picked && picked.length > 0 ? picked.join('; ') : candidates[0].vi)
      } else {
        meaningSuggested = candidates[0].vi
      }
    }

    if (!meaningNoteVi && meaningSuggested) {
      if (g) {
        try {
          meaningNoteVi = await gemmaGenerateMeaningNoteVi({
            key: g.key,
            endpoint: g.endpoint,
            model: g.model,
            word,
            meaningSuggested,
            contextSentenceEn,
            signal: controller.signal
          })
        } catch (e) {
          // ignore and fallback to deterministic text below
        }
      }
      if (!meaningNoteVi) {
        meaningNoteVi = buildMeaningNoteViFallback(word, meaningSuggested, contextSentenceEn)
      }
    }

    if (!meaningSuggested && meaningNoteVi) {
      meaningSuggested = meaningNoteVi
    }

    return {
      requestId,
      word,
      meaningSuggested: meaningSuggested || '',
      meaningNoteEn: meaningNoteEn || '',
      meaningNoteVi: meaningNoteVi || '',
      meaningNoteVie: meaningNoteVi || '',
      contextSentenceVi: contextSentenceVi || '',
      candidates
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return {
        requestId,
        word,
        meaningSuggested: '',
        meaningNoteEn: '',
        meaningNoteVi: '',
        meaningNoteVie: '',
        contextSentenceVi: '',
        candidates: []
      }
    }
    console.error('autoMeaning error:', e && e.message ? e.message : e)
    throw e
  } finally {
    pendingAutoMeaning.delete(requestId)
  }
}

async function enrichWordCore(payload) {
  const req = payload || {}
  const requestId = String(req.requestId || generateUUID())
  const word = String(req.word || '').trim()
  const contextSentenceEn = String(req.contextSentenceEn || '').trim()
  const from = String(req.from || 'en')
  const to = String(req.to || 'vi')
  const dialect = (req.dialect === 'UK' ? 'UK' : 'US')

  if (!word) {
    return {
      requestId,
      word: '',
      meaningSuggested: '',
      meaningNoteEn: '',
      meaningNoteVi: '',
      meaningNoteVie: '',
      contextSentenceVi: '',
      candidates: [],
      posSuggested: '',
      ipa: '',
      example: ''
    }
  }

  const controller = new AbortController()
  // Reuse the existing cancel mechanism (autoMeaningCancel) by storing the controller under the same map.
  pendingAutoMeaning.set(requestId, controller)

  try {
    let g = null
    try {
      g = await getGoogleAiStudioConfig(req)
    } catch (e) {
      g = null
    }

    const base = await autoMeaningCore({
      requestId,
      word,
      contextSentenceEn,
      from,
      to
    })

    if (g) {
      const enriched = await gemmaEnrichWord({
        key: g.key,
        endpoint: g.endpoint,
        model: g.model,
        word,
        contextSentenceEn,
        from,
        to,
        dialect,
        signal: controller.signal
      })

      return {
        requestId,
        word,
        meaningSuggested: String(base.meaningSuggested || enriched.meaningSuggested || '').trim(),
        meaningNoteEn: String(base.meaningNoteEn || '').trim(),
        meaningNoteVi: String(base.meaningNoteVi || enriched.meaningNoteVi || '').trim(),
        meaningNoteVie: String(base.meaningNoteVie || base.meaningNoteVi || enriched.meaningNoteVi || '').trim(),
        contextSentenceVi: String(base.contextSentenceVi || enriched.contextSentenceVi || '').trim(),
        candidates: Array.isArray(enriched.candidates) ? enriched.candidates : [],
        posSuggested: enriched.posSuggested || '',
        ipa: enriched.ipa || '',
        example: enriched.example || ''
      }
    }

    // Fallback: reuse autoMeaningCore results and leave ipa/example empty.
    return {
      requestId,
      word,
      meaningSuggested: String(base && base.meaningSuggested ? base.meaningSuggested : '').trim(),
      meaningNoteEn: String(base && base.meaningNoteEn ? base.meaningNoteEn : '').trim(),
      meaningNoteVi: String(base && base.meaningNoteVi ? base.meaningNoteVi : '').trim(),
      meaningNoteVie: String(base && (base.meaningNoteVie || base.meaningNoteVi) ? (base.meaningNoteVie || base.meaningNoteVi) : '').trim(),
      contextSentenceVi: String(base && base.contextSentenceVi ? base.contextSentenceVi : '').trim(),
      candidates: Array.isArray(base && base.candidates) ? base.candidates : [],
      posSuggested: '',
      ipa: '',
      example: ''
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return {
        requestId,
        word,
        meaningSuggested: '',
        meaningNoteEn: '',
        meaningNoteVi: '',
        meaningNoteVie: '',
        contextSentenceVi: '',
        candidates: [],
        posSuggested: '',
        ipa: '',
        example: ''
      }
    }
    console.error('enrichWord error:', e && e.message ? e.message : e)
    throw e
  } finally {
    pendingAutoMeaning.delete(requestId)
  }
}

async function enrichWordBulkCore(payload) {
  const req = payload || {}
  const requestId = String(req.requestId || generateUUID())
  const wordsRaw = Array.isArray(req.words) ? req.words : []
  const words = wordsRaw
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 3)
  const contextSentenceEn = String(req.contextSentenceEn || '').trim()
  const from = String(req.from || 'en')
  const to = String(req.to || 'vi')
  const dialect = (req.dialect === 'UK' ? 'UK' : 'US')

  if (words.length === 0) {
    return { requestId, items: [] }
  }

  const controller = new AbortController()
  pendingAutoMeaning.set(requestId, controller)

  try {
    let g = null
    try {
      g = await getGoogleAiStudioConfig(req)
    } catch (e) {
      g = null
    }

    if (g) {
      const enrichedList = await gemmaEnrichWordsBulk({
        key: g.key,
        endpoint: g.endpoint,
        model: g.model,
        words,
        contextSentenceEn,
        from,
        to,
        dialect,
        signal: controller.signal
      })

      const byKey = new Map(enrichedList.map((x) => [String(x.word).toLowerCase(), x]))

      const base = words.map((w) => {
        const x = byKey.get(String(w).toLowerCase())
        if (!x) return { word: w, error: 'No result', _needsFallback: true }

        const meaningSuggested = String(x.meaningSuggested || '').trim()
        const posSuggested = String(x.posSuggested || '').trim()
        const candidates = Array.isArray(x.candidates) ? x.candidates : []

        // Treat empty meaning/POS as an error so the UI doesn't show "done" for unusable rows.
        if (!meaningSuggested || !posSuggested) {
          return {
            word: w,
            error: 'Missing meaning/POS from bulk result',
            partial: {
              requestId,
              word: w,
              meaningSuggested,
              meaningNoteVi: String(x.meaningNoteVi || '').trim(),
              contextSentenceVi: String(x.contextSentenceVi || '').trim(),
              candidates,
              posSuggested,
              ipa: String(x.ipa || '').trim(),
              example: String(x.example || '').trim()
            },
            _needsFallback: true
          }
        }

        return {
          word: w,
          result: {
            requestId,
            word: w,
            meaningSuggested,
            meaningNoteVi: String(x.meaningNoteVi || '').trim(),
            contextSentenceVi: String(x.contextSentenceVi || '').trim(),
            candidates,
            posSuggested,
            ipa: String(x.ipa || '').trim(),
            example: String(x.example || '').trim()
          }
        }
      })

      const needsFallback = base.filter((it) => it && it._needsFallback).map((it) => it.word)
      if (needsFallback.length > 0) {
        const fallbackResults = await Promise.allSettled(
          needsFallback.map((w, idx) =>
            enrichWordCore({
              requestId: `${requestId}__fallback__${idx}`,
              word: w,
              contextSentenceEn,
              from,
              to,
              dialect
            })
          )
        )

        const fallbackByKey = new Map()
        for (let i = 0; i < needsFallback.length; i++) {
          const w = needsFallback[i]
          const r = fallbackResults[i]
          if (r && r.status === 'fulfilled') fallbackByKey.set(String(w).toLowerCase(), r.value)
        }

        return {
          requestId,
          items: base.map((it) => {
            if (!it || !it._needsFallback) {
              // Strip private fields if present.
              const { _needsFallback, partial, ...rest } = it || {}
              return rest
            }

            const fb = fallbackByKey.get(String(it.word).toLowerCase())
            if (fb) {
              const meaning = String(fb.meaningSuggested || '').trim()
              const posOut = String(fb.posSuggested || '').trim()
              if (meaning && posOut) return { word: it.word, result: fb }
            }

            const partial = it.partial ? it.partial : null
            return {
              word: it.word,
              error: it.error || 'Failed to enrich',
              partial
            }
          })
        }
      }

      return {
        requestId,
        items: base.map((it) => {
          const { _needsFallback, partial, ...rest } = it || {}
          return rest
        })
      }
    }

    // Fallback: call single-word enrichWordCore per item.
    const results = await Promise.allSettled(
      words.map((w, idx) =>
        enrichWordCore({
          requestId: `${requestId}__${idx}`,
          word: w,
          contextSentenceEn,
          from,
          to,
          dialect
        })
      )
    )

    return {
      requestId,
      items: words.map((w, idx) => {
        const r = results[idx]
        if (r && r.status === 'fulfilled') {
          return { word: w, result: r.value }
        }
        const msg = r && r.status === 'rejected' ? (r.reason && r.reason.message ? r.reason.message : String(r.reason || 'Failed')) : 'Failed'
        return { word: w, error: msg }
      })
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { requestId, items: words.map((w) => ({ word: w, error: 'aborted' })) }
    }
    console.error('enrichWordBulk error:', e && e.message ? e.message : e)
    throw e
  } finally {
    pendingAutoMeaning.delete(requestId)
  }
}

async function azureDictionaryLookup({ key, region, from, to, word, signal }) {
  const url = `${AZURE_TRANSLATOR_ENDPOINT}/dictionary/lookup?api-version=3.0&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{ Text: word }]),
    signal
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Azure dictionary lookup failed: ${resp.status} ${t}`)
  }
  return await resp.json()
}

// Simple UUID v4 implementation
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// (data dir, getDataRoot and listTree are declared once below)

async function ensureCsvHasHeader(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  if (!text.trim()) {
    const header = Papa.unparse([], { header: true, columns: ['word', 'meaning', 'meaningNoteVi', 'pronunciation', 'pos', 'example'] })
    await fs.writeFile(filePath, 'word,meaning,meaningNoteVi,pronunciation,pos,example\n', 'utf8')
  }
}

async function gemmaSuggestExampleSentence({ key, endpoint, model, word, meaningVi, pos, contextSentenceEn, signal }) {
  const w = String(word || '').trim()
  const m = String(meaningVi || '').trim()
  const p = String(pos || '').trim()
  const ctx = String(contextSentenceEn || '').trim()
  if (!w) return ''

  const prompt =
    `You are an English teacher writing a memorable example sentence for a vocabulary flashcard.\n` +
    `Task: Write exactly ONE natural English sentence that uses the word "${w}" correctly.\n` +
    (m ? `Meaning (Vietnamese gloss): "${m}"\n` : '') +
    (p ? `Part of speech: "${p}"\n` : '') +
    (ctx ? `Optional context (English): "${ctx}"\n` : '') +
    `Rules:\n` +
    `- Output ONLY the single sentence (no quotes, no numbering, no explanation).\n` +
    `- Keep it short, vivid, and easy to remember.\n` +
    `- It MUST contain the exact word "${w}" (case-insensitive is ok).\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  let out = String(raw || '').trim()
  out = out.replace(/^"+|"+$/g, '').trim()
  // Remove accidental bullet/numbering.
  out = out.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+\s*[\).]\s+/, '').trim()
  // If model returned multiple lines, keep the first non-empty.
  if (out.includes('\n')) {
    out = out
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)[0] || ''
  }
  return out
}

const DATA_DIR_NAME = 'vocab-data'

function getDataRoot() {
  const root = path.join(app.getPath('userData'), DATA_DIR_NAME)
  if (!fsSync.existsSync(root)) fsSync.mkdirSync(root, { recursive: true })
  return root
}

function getDataPdfRoot() {
  const root = path.join(app.getPath('userData'), 'Data', 'pdf')
  if (!fsSync.existsSync(root)) fsSync.mkdirSync(root, { recursive: true })
  return root
}

function normalizeRel(p) {
  if (!p) return ''
  // use forward slashes
  return p.replace(/\\/g, '/').replace(/^\//, '')
}

function listTree(dir, root) {
  const items = fsSync.readdirSync(dir, { withFileTypes: true })
  return items.map((it) => {
    const full = path.join(dir, it.name)
    const rel = normalizeRel(path.relative(root, full))
    if (it.isDirectory()) return { name: it.name, path: rel, type: 'folder', children: listTree(full, root) }
    return { name: it.name, path: rel, type: 'file' }
  })
}

function listTreeWithPdf() {
  const root = getDataRoot()
  const tree = listTree(root, root)
  // Note: Previously we added a virtual "PDF" folder into the tree. That
  // behaviour was removed — PDFs are managed separately under Data/pdf.

  return tree
}

// Export Smart Review (VocabularyStore localStorage payload) to a JSON file
ipcMain.handle('exportSmartReview', async (ev, rawJson) => {
  try {
    const win = BrowserWindow.fromWebContents(ev.sender)
    const ymd = new Date().toISOString().slice(0, 10)
    const defaultName = `smart-review-${ymd}.json`
    const defaultPath = path.join(app.getPath('downloads'), defaultName)

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Smart Review',
      defaultPath,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (canceled || !filePath) return null

    let out = String(rawJson ?? '')
    // Pretty print if possible
    try {
      const parsed = JSON.parse(out || '{}')
      out = JSON.stringify(parsed, null, 2)
    } catch {
      // keep raw
    }

    await fs.writeFile(filePath, out, 'utf8')
    return filePath
  } catch (err) {
    console.error('Error exporting Smart Review:', err)
    throw err
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const startUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL || null
  if (startUrl) {
    win.webContents.openDevTools()
    ;(async () => {
      const url = await resolveDevServerUrl(startUrl)
      await win.loadURL(url)
    })().catch((e) => {
      console.error('Failed to load dev URL:', e && e.message ? e.message : e)
      // Fallback to the original URL (may show an error page, but keeps window usable).
      try {
        win.loadURL(startUrl)
      } catch {
        // ignore
      }
    })
  } else {
    // production: load built index.html (Vite output)
    // In packaged builds, __dirname is inside app.asar/src-electron.
    // Vite output is bundled into app.asar/dist.
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    win.loadFile(indexPath)
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function canFetch(url, timeoutMs) {
  const ms = Math.max(50, timeoutMs || 400)
  return await new Promise((resolve) => {
    let u
    try {
      u = new URL(url)
    } catch {
      resolve(false)
      return
    }

    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname || '/',
        timeout: ms
      },
      (res) => {
        try { res.resume() } catch {}
        resolve(true)
      }
    )
    req.on('timeout', () => {
      try { req.destroy() } catch {}
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

async function resolveDevServerUrl(startUrl) {
  const raw = String(startUrl || '').trim()
  if (!raw) return raw

  let u
  try {
    u = new URL(raw)
  } catch {
    return raw
  }

  const rawHost = u.hostname || 'localhost'
  // Windows sometimes resolves localhost to IPv6 (::1) while Vite listens on IPv4.
  const hostCandidates = Array.from(
    new Set(
      rawHost === 'localhost'
        ? ['127.0.0.1', 'localhost']
        : rawHost === '::1'
          ? ['127.0.0.1', 'localhost', '::1']
          : [rawHost, '127.0.0.1', 'localhost']
    )
  )
  const basePort = u.port ? Number(u.port) : 5173
  const pathAndQuery = `${u.pathname || '/'}${u.search || ''}${u.hash || ''}`

  // Try a small port range for ~20s, to handle Vite picking 5174/5175 etc.
  const portRange = 10
  const rounds = 40
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i <= portRange; i++) {
      const p = basePort + i
      for (const host of hostCandidates) {
        const candidate = `${u.protocol}//${host}:${p}${pathAndQuery}`
        const probe = `${u.protocol}//${host}:${p}/`
        if (await canFetch(probe, 600)) return candidate
      }
    }
    await sleep(500)
  }

  return raw
}

ipcMain.handle('listTree', async () => {
  return listTreeWithPdf()
})

ipcMain.handle('createFolder', async (ev, parentRel, name) => {
  try {
    const root = getDataRoot()
    const rel = normalizeRel(parentRel)
    const full = rel ? path.join(root, rel, name) : path.join(root, name)
    await fs.mkdir(full, { recursive: true })
    return true
  } catch (err) {
    console.error('Error creating folder:', err)
    throw new Error(`Failed to create folder: ${err.message}`)
  }
})

ipcMain.handle('createFile', async (ev, parentRel, name) => {
  try {
    const root = getDataRoot()
    const rel = normalizeRel(parentRel)
    const full = rel ? path.join(root, rel, name) : path.join(root, name)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, 'word,meaning,meaningNoteVi,pronunciation,pos,example\n', 'utf8')
    return true
  } catch (err) {
    console.error('Error creating file:', err)
    throw new Error(`Failed to create file: ${err.message}`)
  }
})

ipcMain.handle('deleteFile', async (ev, relPath) => {
  try {
    const root = getDataRoot()
    const full = path.join(root, normalizeRel(relPath))
    await fs.unlink(full)
    return true
  } catch (err) {
    console.error('Error deleting file:', err)
    throw err
  }
})

ipcMain.handle('deleteFolder', async (ev, relPath) => {
  try {
    const root = getDataRoot()
    const full = path.join(root, normalizeRel(relPath))
    // recursive remove
    await fs.rm(full, { recursive: true, force: true })
    return true
  } catch (err) {
    console.error('Error deleting folder:', err)
    throw err
  }
})

ipcMain.handle('readCsv', async (ev, filePath) => {
  const root = getDataRoot()
  // Support both relative paths and absolute paths
  const full = path.isAbsolute(filePath) ? filePath : path.join(root, normalizeRel(filePath))
  const text = await fs.readFile(full, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  // Strip accumulated quotes from all fields
  return (parsed.data || []).map(row => ({
    word: (row.word || '').replace(/"+/g, ''),
    meaning: (row.meaning || '').replace(/"+/g, ''),
    meaningEn: (row.meaningEn || row.meaningNoteEn || '').replace(/"+/g, ''),
    meaningVi: (row.meaningVi || row.meaningNoteVi || row.meaningNoteVie || '').replace(/"+/g, ''),
    pronunciation: (row.pronunciation || '').replace(/"+/g, ''),
    pos: (row.pos || '').replace(/"+/g, ''),
    example: (row.example || '').replace(/"+/g, '')
  }))
})

async function writeCsv(fileRelOrAbsPath, rows) {
  const root = getDataRoot()
  // Clean any accumulated quotes from pronunciation field
  const cleanRows = rows.map(r => ({
    word: (r.word || '').replace(/"+/g, ''),
    meaning: (r.meaning || '').replace(/"+/g, ''),
    meaningEn: (r.meaningEn || r.meaningNoteEn || '').replace(/"+/g, ''),
    meaningVi: (r.meaningVi || r.meaningNoteVi || r.meaningNoteVie || '').replace(/"+/g, ''),
    pronunciation: (r.pronunciation || '').replace(/"+/g, ''),
    pos: (r.pos || '').replace(/"+/g, ''),
    example: (r.example || '').replace(/"+/g, '')
  }))
  const csv = Papa.unparse(cleanRows, { 
    columns: ['word', 'meaning', 'meaningEn', 'meaningVi', 'pronunciation', 'pos', 'example'],
    quotes: false  // Prevent auto-quoting
  })
  // Support both relative paths and absolute paths
  const full = path.isAbsolute(fileRelOrAbsPath) ? fileRelOrAbsPath : path.join(root, normalizeRel(fileRelOrAbsPath))
  await fs.writeFile(full, csv + '\n', 'utf8')
  // Notify renderer if this CSV belongs to a PDF deck
  try {
    const pdfRoot = getDataPdfRoot()
    const rel = path.relative(pdfRoot, full)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      const pdfId = rel.split(path.sep)[0]
      try {
        BrowserWindow.getAllWindows().forEach((w) => {
          try {
            w.webContents.send('deck-updated', { pdfId, deckCsvPath: full })
          } catch (e) {}
        })
      } catch (e) {}
    }
  } catch (e) {
    // ignore notification errors
  }
}

ipcMain.handle('addWord', async (ev, fileRelOrAbsPath, row) => {
  const root = getDataRoot();
  const full = path.isAbsolute(fileRelOrAbsPath)
    ? fileRelOrAbsPath
    : path.join(root, normalizeRel(fileRelOrAbsPath));

  // auto create file if missing
  if (!fsSync.existsSync(full)) {
    fsSync.mkdirSync(path.dirname(full), { recursive: true });
    fsSync.writeFileSync(full, 'word,meaning,meaningEn,meaningVi,pronunciation,pos,example\n', 'utf8');
  }

  const text = await fs.readFile(full, 'utf8');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data || [];
  rows.push({
    word: row && row.word ? row.word : '',
    meaning: row && row.meaning ? row.meaning : '',
    meaningEn: row && row.meaningEn ? row.meaningEn : row && row.meaningNoteEn ? row.meaningNoteEn : '',
    meaningVi: row && row.meaningVi ? row.meaningVi : row && row.meaningNoteVi ? row.meaningNoteVi : row && row.meaningNoteVie ? row.meaningNoteVie : '',
    pronunciation: row && row.pronunciation ? row.pronunciation : '',
    pos: row && row.pos ? row.pos : '',
    example: row && row.example ? row.example : ''
  });

  await writeCsv(fileRelOrAbsPath, rows);
  return true;
});

ipcMain.handle('addWordsBulk', async (ev, fileRelOrAbsPath, rowsToAdd) => {
  const root = getDataRoot();
  const full = path.isAbsolute(fileRelOrAbsPath)
    ? fileRelOrAbsPath
    : path.join(root, normalizeRel(fileRelOrAbsPath));

  const list = Array.isArray(rowsToAdd) ? rowsToAdd : [];
  const normalized = list
    .map((row) => ({
      word: row && row.word ? String(row.word) : '',
      meaning: row && row.meaning ? String(row.meaning) : '',
      meaningEn: row && row.meaningEn ? String(row.meaningEn) : row && row.meaningNoteEn ? String(row.meaningNoteEn) : '',
      meaningVi: row && row.meaningVi ? String(row.meaningVi) : row && row.meaningNoteVi ? String(row.meaningNoteVi) : row && row.meaningNoteVie ? String(row.meaningNoteVie) : '',
      pronunciation: row && row.pronunciation ? String(row.pronunciation) : '',
      pos: row && row.pos ? String(row.pos) : '',
      example: row && row.example ? String(row.example) : ''
    }))
    .filter((r) => String(r.word || '').trim());

  if (normalized.length === 0) return { added: 0 };

  // auto create file if missing
  if (!fsSync.existsSync(full)) {
    fsSync.mkdirSync(path.dirname(full), { recursive: true });
    fsSync.writeFileSync(full, 'word,meaning,meaningEn,meaningVi,pronunciation,pos,example\n', 'utf8');
  }

  const text = await fs.readFile(full, 'utf8');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data || [];

  for (const r of normalized) {
    rows.push({
      word: r.word,
      meaning: r.meaning,
      meaningEn: r.meaningEn,
      meaningVi: r.meaningVi,
      pronunciation: r.pronunciation,
      pos: r.pos,
      example: r.example
    });
  }

  await writeCsv(fileRelOrAbsPath, rows);
  return { added: normalized.length };
});

// Background enhancement: improve word data if fields are missing
ipcMain.handle('enhanceWordInBackground', async (ev, fileRelOrAbsPath, word, meaning, pronunciation, pos, example) => {
  try {
    const root = getDataRoot();
    const full = path.isAbsolute(fileRelOrAbsPath)
      ? fileRelOrAbsPath
      : path.join(root, normalizeRel(fileRelOrAbsPath));

    if (!fsSync.existsSync(full)) return false;

    const text = await fs.readFile(full, 'utf8');
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data || [];

    const targetIndex = rows.findIndex(
      (r) => String(r.word || '').trim() === word.trim() && String(r.meaning || '').trim() === meaning.trim()
    );
    
    if (targetIndex === -1) return false;

    let needsUpdate = false;
    const updatedRow = { ...rows[targetIndex] };

    // Reuse one config read per background enhancement.
    let g = null
    try {
      g = await getGoogleAiStudioConfig()
    } catch (e) {
      g = null
    }

    const shouldIpa = !pronunciation || !pronunciation.trim() || pronunciation === '//'
    const shouldExample = !example || !example.trim()

    // If we have an LLM key and multiple fields are missing, run them concurrently.
    if (g && (shouldIpa || shouldExample)) {
      const jobs = []
      jobs.push(
        shouldIpa
          ? gemmaSuggestIpa({
              key: g.key,
              endpoint: g.endpoint,
              model: g.model,
              word: word.trim(),
              dialect: 'US',
              signal: null
            })
          : Promise.resolve(null)
      )
      jobs.push(
        shouldExample
          ? gemmaSuggestExampleSentence({
              key: g.key,
              endpoint: g.endpoint,
              model: g.model,
              word: word.trim(),
              meaningVi: meaning.trim(),
              pos: pos.trim(),
              contextSentenceEn: '',
              signal: null
            })
          : Promise.resolve(null)
      )

      const [ipaRes, exRes] = await Promise.allSettled(jobs)

      if (ipaRes.status === 'fulfilled' && ipaRes.value && String(ipaRes.value).trim()) {
        const core = String(ipaRes.value).trim().replace(/^\/+|\/+$/g, '')
        updatedRow.pronunciation = core ? `/${core}/` : ''
        needsUpdate = true
      }

      if (exRes.status === 'fulfilled' && exRes.value && String(exRes.value).trim()) {
        updatedRow.example = String(exRes.value).trim()
        needsUpdate = true
      }
    }

    // Enhance pronunciation if missing
    if (!g && (!pronunciation || !pronunciation.trim() || pronunciation === '//')) {
      try {
        // LLM unavailable; fallback to dictionaryapi.dev
      } catch (e) {
        try {
          const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`);
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data) && data[0]?.phonetics?.length > 0) {
              const ph = data[0].phonetics.find((p) => p.text);
              if (ph?.text) {
                const core = String(ph.text).trim().replace(/^\/+|\/+$/g, '');
                updatedRow.pronunciation = core ? `/${core}/` : '';
                needsUpdate = true;
              }
            }
          }
        } catch (e2) {
          // Silent fail
        }
      }
    }

    // Enhance example if missing
    if (!g && (!example || !example.trim())) {
      try {
        // LLM unavailable; skip example enhancement.
      } catch (e) {
        // Silent fail
      }
    }

    // Save if we enhanced anything
    if (needsUpdate) {
      rows[targetIndex] = updatedRow;
      await writeCsv(fileRelOrAbsPath, rows);
    }

    return needsUpdate;
  } catch (err) {
    console.error('Background enhancement error:', err);
    return false;
  }
});


ipcMain.handle('deleteWord', async (ev, relPath, index) => {
  const root = getDataRoot()
  const full = path.isAbsolute(relPath) ? relPath : path.join(root, normalizeRel(relPath))
  const text = await fs.readFile(full, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  const rows = parsed.data || []
  rows.splice(index, 1)
  await writeCsv(relPath, rows)
  return true
})

ipcMain.handle('editWord', async (ev, relPath, index, newData) => {
  const root = getDataRoot()
  const full = path.isAbsolute(relPath) ? relPath : path.join(root, normalizeRel(relPath))
  const text = await fs.readFile(full, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  const rows = parsed.data || []
  if (index >= 0 && index < rows.length) {
    rows[index] = {
      ...rows[index],
      word: newData.word || rows[index].word,
      meaning: newData.meaning || rows[index].meaning,
      meaningEn: (typeof newData.meaningEn !== 'undefined') ? newData.meaningEn : (rows[index].meaningEn || rows[index].meaningNoteEn || ''),
      meaningVi: (typeof newData.meaningVi !== 'undefined') ? newData.meaningVi : (rows[index].meaningVi || rows[index].meaningNoteVi || rows[index].meaningNoteVie || ''),
      pronunciation: newData.pronunciation || rows[index].pronunciation,
      pos: newData.pos || rows[index].pos || '',
      example: (typeof newData.example !== 'undefined') ? newData.example : (rows[index].example || '')
    }
  }
  await writeCsv(relPath, rows)
  return true
})

ipcMain.handle('dedupeWords', async (ev, relPathOrAbsPath) => {
  const root = getDataRoot()
  const full = path.isAbsolute(relPathOrAbsPath) ? relPathOrAbsPath : path.join(root, normalizeRel(relPathOrAbsPath))
  const text = await fs.readFile(full, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  const rows = parsed.data || []

  const normalizeKey = (s) => String(s || '').trim().toLowerCase()
  const scoreRow = (r) => {
    const hasMeaning = !!String(r && r.meaning ? r.meaning : '').trim()
    const hasPos = !!String(r && r.pos ? r.pos : '').trim()
    const hasIpa = !!String(r && r.pronunciation ? r.pronunciation : '').trim()
    const hasExample = !!String(r && r.example ? r.example : '').trim()
    // Prefer rows that have meaning+pos; then ipa/example.
    return (hasMeaning ? 3 : 0) + (hasPos ? 3 : 0) + (hasIpa ? 1 : 0) + (hasExample ? 1 : 0)
  }

  const bestByKey = new Map()
  const order = []
  let removed = 0

  for (const r of rows) {
    const key = normalizeKey(r && r.word ? r.word : '')
    if (!key) {
      // Keep empty-word rows as-is (shouldn't normally happen)
      order.push(r)
      continue
    }

    if (!bestByKey.has(key)) {
      bestByKey.set(key, r)
      order.push(r)
      continue
    }

    removed++
    const current = bestByKey.get(key)
    const nextBest = scoreRow(r) > scoreRow(current) ? r : current
    bestByKey.set(key, nextBest)
  }

  // Rebuild rows preserving the first appearance order of each unique word,
  // but with the best-scoring row for that word.
  const seen = new Set()
  const deduped = []
  for (const r of order) {
    const key = normalizeKey(r && r.word ? r.word : '')
    if (!key) {
      deduped.push(r)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(bestByKey.get(key) || r)
  }

  await writeCsv(relPathOrAbsPath, deduped)
  return { removed, kept: deduped.length, totalBefore: rows.length }
})

ipcMain.handle('moveWords', async (ev, srcRel, dstRel, indices) => {
  const root = getDataRoot()
  // support both absolute and relative paths
  const srcFull = path.isAbsolute(srcRel) ? srcRel : path.join(root, normalizeRel(srcRel))
  const dstFull = path.isAbsolute(dstRel) ? dstRel : path.join(root, normalizeRel(dstRel))

  const srcText = await fs.readFile(srcFull, 'utf8')
  const srcParsed = Papa.parse(srcText, { header: true, skipEmptyLines: true })
  const srcRows = srcParsed.data || []
  const moved = []
  const sorted = [...indices].sort((a, b) => b - a)
  for (const i of sorted) {
    const [r] = srcRows.splice(i, 1)
    if (r) moved.unshift(r)
  }

  // ensure destination file exists (create if missing)
  if (!fsSync.existsSync(dstFull)) {
    fsSync.mkdirSync(path.dirname(dstFull), { recursive: true })
    fsSync.writeFileSync(dstFull, 'word,meaning,pronunciation,pos,example\n', 'utf8')
  }

  const dstText = await fs.readFile(dstFull, 'utf8')
  const dstParsed = Papa.parse(dstText, { header: true, skipEmptyLines: true })
  const dstRows = dstParsed.data || []
  dstRows.push(...moved)

  // write back using writeCsv which supports absolute paths as well
  await writeCsv(srcRel, srcRows)
  await writeCsv(dstRel, dstRows)
  return true
})

ipcMain.handle('copyWords', async (ev, srcRel, dstRel, indices) => {
  const root = getDataRoot()
  const srcFull = path.isAbsolute(srcRel) ? srcRel : path.join(root, normalizeRel(srcRel))
  const dstFull = path.isAbsolute(dstRel) ? dstRel : path.join(root, normalizeRel(dstRel))

  const srcText = await fs.readFile(srcFull, 'utf8')
  const srcParsed = Papa.parse(srcText, { header: true, skipEmptyLines: true })
  const srcRows = srcParsed.data || []
  const copied = indices.map((i) => srcRows[i]).filter(Boolean)

  if (!fsSync.existsSync(dstFull)) {
    fsSync.mkdirSync(path.dirname(dstFull), { recursive: true })
    fsSync.writeFileSync(dstFull, 'word,meaning,pronunciation,pos,example\n', 'utf8')
  }

  const dstText = await fs.readFile(dstFull, 'utf8')
  const dstParsed = Papa.parse(dstText, { header: true, skipEmptyLines: true })
  const dstRows = dstParsed.data || []
  dstRows.push(...copied)
  await writeCsv(dstRel, dstRows)
  return true
})

ipcMain.handle('translator:suggestExampleSentence', async (ev, payload) => {
  const ctrl = new AbortController()
  try {
    const { key, model, endpoint } = await getGoogleAiStudioConfig(payload)
    const word = payload && payload.word ? payload.word : ''
    const meaningVi = payload && payload.meaningVi ? payload.meaningVi : ''
    const pos = payload && payload.pos ? payload.pos : ''
    const contextSentenceEn = payload && payload.contextSentenceEn ? payload.contextSentenceEn : ''
    return await gemmaSuggestExampleSentence({ key, endpoint, model, word, meaningVi, pos, contextSentenceEn, signal: ctrl.signal })
  } finally {
    try { ctrl.abort() } catch {}
  }
})

ipcMain.handle('translator:suggestIpa', async (ev, payload) => {
  const ctrl = new AbortController()
  try {
    const { key, model, endpoint } = await getGoogleAiStudioConfig(payload)
    const word = payload && payload.word ? payload.word : ''
    const dialect = payload && payload.dialect ? payload.dialect : 'US'
    return await gemmaSuggestIpa({ key, endpoint, model, word, dialect, signal: ctrl.signal })
  } finally {
    try { ctrl.abort() } catch {}
  }
})

ipcMain.handle('translator:getWordFamily', async (ev, payload) => {
  const ctrl = new AbortController()
  try {
    const { key, model, endpoint } = await getGoogleAiStudioConfig(payload)
    const word = payload && payload.word ? payload.word : ''
    return await gemmaGetWordFamily({ key, endpoint, model, word, signal: ctrl.signal })
  } finally {
    try { ctrl.abort() } catch {}
  }
})

ipcMain.handle('translator:getSynonyms', async (ev, payload) => {
  const ctrl = new AbortController()
  try {
    const { key, model, endpoint } = await getGoogleAiStudioConfig(payload)
    const word = payload && payload.word ? payload.word : ''
    return await gemmaGetSynonyms({ key, endpoint, model, word, signal: ctrl.signal })
  } finally {
    try { ctrl.abort() } catch {}
  }
})

// Copy a file or folder (relative paths)
ipcMain.handle('copyPath', async (ev, srcRel, dstRel) => {
  try {
    const root = getDataRoot()
    const srcFull = path.join(root, normalizeRel(srcRel))
    const dstFull = path.join(root, normalizeRel(dstRel))
    const stat = fsSync.statSync(srcFull)
    if (stat.isDirectory()) {
      fsSync.cpSync(srcFull, dstFull, { recursive: true })
    } else {
      // ensure parent exists
      fsSync.mkdirSync(path.dirname(dstFull), { recursive: true })
      fsSync.copyFileSync(srcFull, dstFull)
    }
    return true
  } catch (err) {
    console.error('Error copying path:', err)
    throw err
  }
})

// Move (or rename) a file or folder
ipcMain.handle('movePath', async (ev, srcRel, dstRel) => {
  try {
    const root = getDataRoot()
    const srcFull = path.join(root, normalizeRel(srcRel))
    const dstFull = path.join(root, normalizeRel(dstRel))
    // ensure parent exists
    fsSync.mkdirSync(path.dirname(dstFull), { recursive: true })
    await fs.rename(srcFull, dstFull)
    return true
  } catch (err) {
    console.error('Error moving path:', err)
    throw err
  }
})

// Rename a file/folder (relPath -> newName within same parent)
ipcMain.handle('renamePath', async (ev, relPath, newName) => {
  try {
    const root = getDataRoot()
    const full = path.join(root, normalizeRel(relPath))
    const parent = path.dirname(full)
    const dest = path.join(parent, newName)
    await fs.rename(full, dest)
    return true
  } catch (err) {
    console.error('Error renaming path:', err)
    throw err
  }
})

// ===== PDF HANDLERS =====

ipcMain.handle('pdfImport', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (canceled || !filePaths.length) return null

    const pdfPath = filePaths[0]
    const pdfId = generateUUID()
    const baseName = path.basename(pdfPath, '.pdf')
    const pdfRoot = getDataPdfRoot()
    const pdfDir = path.join(pdfRoot, pdfId)

    // Create directory
    await fs.mkdir(pdfDir, { recursive: true })

    // Copy PDF
    const sourcePdfPath = path.join(pdfDir, 'source.pdf')
    await fs.copyFile(pdfPath, sourcePdfPath)

    // Create meta.json
    const deckCsvPath = path.join(pdfDir, `${baseName} vocab.csv`)
    const metaData = {
      pdfId,
      originalFileName: path.basename(pdfPath),
      baseName,
      createdAt: new Date().toISOString(),
      sourcePdfPath,
      deckCsvPath,
      trashed: false
    }
    await fs.writeFile(path.join(pdfDir, 'meta.json'), JSON.stringify(metaData, null, 2), 'utf8')

    // Create vocab CSV
    await fs.writeFile(deckCsvPath, 'word,meaning,meaningNoteVi,pronunciation,pos,example\n', 'utf8')

    // Create highlights.json (store as an array)
    const highlightsPath = path.join(pdfDir, 'highlights.json')
    await fs.writeFile(highlightsPath, JSON.stringify([], null, 2), 'utf8')

    return {
      pdfId,
      baseName,
      deckCsvPath,
      sourcePdfPath
    }
  } catch (err) {
    console.error('Error importing PDF:', err)
    throw err
  }
})

ipcMain.handle('pdfList', async () => {
  try {
    const pdfRoot = getDataPdfRoot()
    const items = await fs.readdir(pdfRoot, { withFileTypes: true })
    const pdfs = []

    for (const item of items) {
      if (!item.isDirectory()) continue
      // Skip old 'trash' folder and other non-PDF directories
      if (item.name === 'trash') continue
      const metaPath = path.join(pdfRoot, item.name, 'meta.json')
      try {
        const metaText = await fs.readFile(metaPath, 'utf8')
        const meta = JSON.parse(metaText)
        // meta may contain trashed flag already
        pdfs.push({ ...meta, trashed: !!meta.trashed })
      } catch (e) {
        console.warn(`Failed to read meta.json for ${item.name}:`, e)
      }
    }

    return pdfs
  } catch (err) {
    console.error('Error listing PDFs:', err)
    return []
  }
})

ipcMain.handle('pdfGet', async (ev, pdfId) => {
  try {
    const pdfRoot = getDataPdfRoot()
    const metaPath = path.join(pdfRoot, pdfId, 'meta.json')
    const metaText = await fs.readFile(metaPath, 'utf8')
    const meta = JSON.parse(metaText)

    const highlightsPath = path.join(pdfRoot, pdfId, 'highlights.json')
    const highlightsText = await fs.readFile(highlightsPath, 'utf8')
    let highlights = JSON.parse(highlightsText)
    // Support both array and { highlights: [] } legacy format
    if (highlights && typeof highlights === 'object' && Array.isArray(highlights.highlights)) {
      highlights = highlights.highlights
    }

    // Read CSV to get row count
    const csvText = await fs.readFile(meta.deckCsvPath, 'utf8')
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true })
    const deckRowCount = (parsed.data || []).length

    return {
      ...meta,
      highlights,
      deckRowCount
    }
  } catch (err) {
    console.error('Error getting PDF:', err)
    throw err
  }
})

ipcMain.handle('pdfReadHighlights', async (ev, pdfId) => {
  try {
    const pdfRoot = getDataPdfRoot()
    const highlightsPath = path.join(pdfRoot, pdfId, 'highlights.json')
    const text = await fs.readFile(highlightsPath, 'utf8')
    return JSON.parse(text)
  } catch (err) {
    console.error('Error reading highlights:', err)
    throw err
  }
})

ipcMain.handle('pdfWriteHighlights', async (ev, pdfId, highlights) => {
  try {
    const pdfRoot = getDataPdfRoot()
    const highlightsPath = path.join(pdfRoot, pdfId, 'highlights.json')
    await fs.writeFile(highlightsPath, JSON.stringify(highlights, null, 2), 'utf8')
    return true
  } catch (err) {
    console.error('Error writing highlights:', err)
    throw err
  }
})

ipcMain.handle('pdfGetSourcePath', async (ev, pdfId) => {
  const pdfRoot = getDataPdfRoot()
  const metaPath = path.join(pdfRoot, pdfId, 'meta.json')
  const metaText = await fs.readFile(metaPath, 'utf8')
  const meta = JSON.parse(metaText)
  return meta.sourcePdfPath
})

ipcMain.handle('pdfReadBinary', async (ev, pdfId) => {
  const pdfRoot = getDataPdfRoot()
  const metaPath = path.join(pdfRoot, pdfId, 'meta.json')
  const metaText = await fs.readFile(metaPath, 'utf8')
  const meta = JSON.parse(metaText)
  const pdfData = await fs.readFile(meta.sourcePdfPath)
  // Convert to Uint8Array for PDF.js
  return new Uint8Array(pdfData)
})

ipcMain.handle('pdfGetSourceBytes', async (ev, pdfId) => {
  const pdfRoot = getDataPdfRoot()
  const metaPath = path.join(pdfRoot, pdfId, 'meta.json')
  const metaText = await fs.readFile(metaPath, 'utf8')
  const meta = JSON.parse(metaText)
  const pdfData = await fs.readFile(meta.sourcePdfPath)
  // Return as ArrayBuffer so it can be transferred to iframe
  return pdfData.buffer.slice(pdfData.byteOffset, pdfData.byteOffset + pdfData.byteLength)
})

ipcMain.handle('autoMeaningCancel', async (ev, requestId) => {
  try {
    const rid = String(requestId || '')
    const ctrl = pendingAutoMeaning.get(rid)
    if (ctrl) {
      try { ctrl.abort() } catch (e) {}
      pendingAutoMeaning.delete(rid)
      return true
    }
    return false
  } catch (e) {
    return false
  }
})

ipcMain.handle('translator:autoMeaningCancel', async (ev, requestId) => {
  try {
    const rid = String(requestId || '')
    const ctrl = pendingAutoMeaning.get(rid)
    if (ctrl) {
      try { ctrl.abort() } catch (e) {}
      pendingAutoMeaning.delete(rid)
      return true
    }
    return false
  } catch (e) {
    return false
  }
})

ipcMain.handle('autoMeaning', async (ev, payload) => {
  return autoMeaningCore(payload)
})

ipcMain.handle('enrichWord', async (ev, payload) => {
  return enrichWordCore(payload)
})

ipcMain.handle('translator:autoMeaning', async (ev, payload) => {
  return autoMeaningCore(payload)
})

ipcMain.handle('translator:enrichWord', async (ev, payload) => {
  return enrichWordCore(payload)
})

ipcMain.handle('translator:enrichWordBulk', async (ev, payload) => {
  return enrichWordBulkCore(payload)
})

ipcMain.handle('translator:translatePlain', async (ev, payload) => {
  const req = payload || {}
  const text = String(req.text || '').trim()
  const from = String(req.from || 'en')
  const to = String(req.to || 'vi')
  if (!text) return ''

  const g = await getGoogleAiStudioConfig(req)
  return await googleTranslatePlain({ key: g.key, endpoint: g.endpoint, model: g.model, from, to, text })
})

ipcMain.handle('translator:translateMeaningNoteVie', async (ev, payload) => {
  const req = payload || {}
  const englishMeaning = String(req.englishMeaning || '').trim()
  if (!englishMeaning) return ''

  const g = await getGoogleAiStudioConfig(req)

  try {
    const translated = await gemmaTranslateMeaningNoteVie({
      key: g.key,
      endpoint: g.endpoint,
      model: g.model,
      word: String(req.word || '').trim(),
      englishMeaning,
      contextSentenceEn: String(req.contextSentenceEn || '').trim(),
    })
    if (translated) return translated
  } catch {
    // fallback below
  }

  return await googleTranslatePlain({
    key: g.key,
    endpoint: g.endpoint,
    model: g.model,
    from: 'en',
    to: 'vi',
    text: englishMeaning,
  })
})

ipcMain.handle('translator:fetchEnglishMeaning', async (ev, word) => {
  const target = String(word || '').trim()
  if (!target) {
    console.log('[translator:fetchEnglishMeaning] skip empty word')
    return ''
  }

  try {
    const definition = await fetchEnglishDefinition(target)
    if (definition) {
      console.log('[translator:fetchEnglishMeaning] filled', {
        word: target,
        definition
      })
    } else {
      console.log('[translator:fetchEnglishMeaning] missing', {
        word: target,
        reason: 'empty-definition'
      })
    }
    return definition
  } catch (err) {
    console.error('[translator:fetchEnglishMeaning] error', {
      word: target,
      error: err && err.message ? err.message : String(err)
    })
    throw err
  }
})

ipcMain.handle('translator:translateExplain', async (ev, payload) => {
  const req = payload || {}
  const text = String(req.text || '').trim()
  const from = String(req.from || 'en')
  const to = String(req.to || 'vi')
  if (!text) return { translation: '', explanation: '' }

  const g = await getGoogleAiStudioConfig(req)
  return await googleTranslateExplain({ key: g.key, endpoint: g.endpoint, model: g.model, from, to, text })
})

ipcMain.handle('settings:getGoogleAiStudioStatus', async () => {
  const store = await readGoogleAiStudioKeysStore()
  const hasKey = (store && store.activeIds && store.activeIds.length > 0) || !!(process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GOOGLE_API_KEY)
  return { hasKey }
})

ipcMain.handle('settings:getGoogleAiStudioConcurrency', async () => {
  return { concurrency: refreshGoogleAiConcurrencyFromEnv() }
})

ipcMain.handle('settings:setGoogleAiStudioConcurrency', async (ev, concurrency) => {
  const c = coerceGoogleAiConcurrency(concurrency)
  await setUserEnvVar('GOOGLE_AI_STUDIO_CONCURRENCY', String(c))
  refreshGoogleAiConcurrencyFromEnv()
  // Apply immediately for already-queued jobs.
  try { pumpGoogleAiQueue() } catch {}
  return { concurrency: c }
})

ipcMain.handle('settings:setGoogleAiStudioApiKey', async (ev, apiKey) => {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('API key is required')
  // Backward-compat: also store it in the multi-key store as active
  const store = await ensureGoogleAiStudioKeysStore()
  const now = new Date().toISOString()
  const id = makeId()
  const next = {
    ...store,
    activeIds: [...(store.activeIds || []), id],
    items: [...store.items, { id, name: 'Key', key, createdAt: now, updatedAt: now }]
  }
  await writeGoogleAiStudioKeysStore(next)
  activeKeysCache = null // Clear cache
  await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', key)
  return true
})

ipcMain.handle('settings:clearGoogleAiStudioApiKey', async () => {
  await clearAllActiveGoogleAiStudioKeys()
  activeKeysCache = null // Clear cache
  return true
})

ipcMain.handle('settings:listGoogleAiStudioApiKeys', async () => {
  const store = await ensureGoogleAiStudioKeysStore()
  return {
    activeIds: store.activeIds || [],
    // For backward compat, also return activeId as first active
    activeId: store.activeIds && store.activeIds.length > 0 ? store.activeIds[0] : null,
    items: store.items.map((it) => ({
      id: it.id,
      name: it.name,
      masked: maskApiKey(it.key)
    }))
  }
})

ipcMain.handle('settings:addGoogleAiStudioApiKey', async (ev, payload) => {
  const req = payload || {}
  const name = String(req.name || '').trim() || 'API Key'
  const key = String(req.apiKey || '').trim()
  if (!key) throw new Error('API key is required')

  const store = await ensureGoogleAiStudioKeysStore()
  const now = new Date().toISOString()
  const id = makeId()
  const next = {
    ...store,
    activeIds: [...(store.activeIds || []), id], // Auto-enable new key
    items: [...store.items, { id, name, key, createdAt: now, updatedAt: now }]
  }
  await writeGoogleAiStudioKeysStore(next)
  activeKeysCache = null // Clear cache
  // Set first key as env var for backward compat
  const firstActiveKey = next.items.find(x => next.activeIds.includes(x.id))
  await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', firstActiveKey ? firstActiveKey.key : null)
  return true
})

ipcMain.handle('settings:deleteGoogleAiStudioApiKey', async (ev, keyId) => {
  const id = String(keyId || '').trim()
  if (!id) throw new Error('Key id is required')

  const store = await ensureGoogleAiStudioKeysStore()
  const items = store.items.filter((x) => x.id !== id)
  // Remove from activeIds if present
  const newActiveIds = (store.activeIds || []).filter(x => x !== id)
  const next = { ...store, items, activeIds: newActiveIds }

  await writeGoogleAiStudioKeysStore(next)
  activeKeysCache = null // Clear cache

  // Update env var with first active key
  if (newActiveIds.length > 0) {
    const firstActive = items.find((x) => x.id === newActiveIds[0])
    await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', firstActive ? firstActive.key : null)
  } else {
    await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', null)
  }
  return true
})

// Toggle a key on/off (for multi-select)
ipcMain.handle('settings:toggleGoogleAiStudioApiKey', async (ev, keyId, enabled) => {
  await toggleActiveGoogleAiStudioKeyId(keyId, enabled)
  activeKeysCache = null // Clear cache
  return true
})

ipcMain.handle('settings:setActiveGoogleAiStudioApiKey', async (ev, keyId) => {
  // For backward compat - toggle the key on
  const id = String(keyId || '').trim()
  if (!id) throw new Error('Key id is required')
  await toggleActiveGoogleAiStudioKeyId(id, true)
  activeKeysCache = null // Clear cache
  return true
})

// Move a PDF to trash (soft-delete) - just set meta.trashed flag
ipcMain.handle('pdfTrash', async (ev, pdfId) => {
  try {
    const pdfRoot = getDataPdfRoot()
    const pdfDir = path.join(pdfRoot, pdfId)
    const metaPath = path.join(pdfDir, 'meta.json')
    if (!fsSync.existsSync(metaPath)) throw new Error('PDF meta not found')
    const metaText = await fs.readFile(metaPath, 'utf8')
    const meta = JSON.parse(metaText)
    meta.trashed = true
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
    return true
  } catch (err) {
    console.error('Error trashing PDF:', err)
    throw err
  }
})

// Restore a PDF from trash (undo) - just unset meta.trashed flag
ipcMain.handle('pdfRestore', async (ev, pdfId) => {
  try {
    const pdfRoot = getDataPdfRoot()
    const pdfDir = path.join(pdfRoot, pdfId)
    const metaPath = path.join(pdfDir, 'meta.json')
    if (!fsSync.existsSync(metaPath)) throw new Error('PDF meta not found')
    const metaText = await fs.readFile(metaPath, 'utf8')
    const meta = JSON.parse(metaText)
    meta.trashed = false
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
    return true
  } catch (err) {
    console.error('Error restoring PDF:', err)
    throw err
  }
})

// Permanently delete a PDF folder
ipcMain.handle('pdfDeletePermanent', async (ev, pdfId) => {
  try {
    const pdfRoot = getDataPdfRoot()
    const pdfDir = path.join(pdfRoot, pdfId)
    if (!fsSync.existsSync(pdfDir)) return false
    await fs.rm(pdfDir, { recursive: true, force: true })
    return true
  } catch (err) {
    console.error('Error permanently deleting PDF:', err)
    throw err
  }
})

// Delete a PDF (remove pdf folder but preserve/move the deck CSV into data root)
ipcMain.handle('pdfDelete', async (ev, pdfId) => {
  try {
    const pdfRoot = getDataPdfRoot()
    const pdfDir = path.join(pdfRoot, pdfId)
    const metaPath = path.join(pdfDir, 'meta.json')
    if (!fsSync.existsSync(metaPath)) {
      // nothing to do
      await fs.rm(pdfDir, { recursive: true, force: true })
      return true
    }

    const metaText = await fs.readFile(metaPath, 'utf8')
    const meta = JSON.parse(metaText)

    const deckPath = meta.deckCsvPath
    const root = getDataRoot()

    // If deck file exists inside the pdf dir, move it to data root to preserve vocab
    if (deckPath && fsSync.existsSync(deckPath)) {
      let destName = path.basename(deckPath)
      let dest = path.join(root, destName)
      let counter = 1
      while (fsSync.existsSync(dest)) {
        const ext = path.extname(destName)
        const nameNoExt = path.basename(destName, ext)
        destName = `${nameNoExt} (${counter})${ext}`
        dest = path.join(root, destName)
        counter++
      }
      // ensure parent exists then move
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.rename(deckPath, dest)
    }

    // remove the pdf directory entirely
    await fs.rm(pdfDir, { recursive: true, force: true })
    return true
  } catch (err) {
    console.error('Error deleting PDF:', err)
    throw err
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
