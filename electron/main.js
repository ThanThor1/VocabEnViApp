const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const http = require('http')
const https = require('https')
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
  const stableUserData = path.join(app.getPath('appData'), STABLE_APP_NAME)
  app.setPath('userData', stableUserData)
  const cacheBase = path.join(app.getPath('temp'), `${STABLE_APP_NAME}-cache`)
  const cacheDir = app.isPackaged ? cacheBase : `${cacheBase}-${process.pid}`
  app.setPath('cache', cacheDir)
  // Explicitly tell Chromium where to put its disk cache.
  try { app.commandLine.appendSwitch('disk-cache-dir', cacheDir) } catch {}
  // Reduce noisy GPU cache errors without disabling GPU rendering entirely.
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-gpu-program-cache')
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
  const activeId = typeof store.activeId === 'string' ? store.activeId : null
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

  const resolvedActiveId = activeId && items.some((x) => x.id === activeId) ? activeId : null
  return { version, activeId: resolvedActiveId, items }
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
      activeId: id,
      items: [{ id, name: 'Default', key: envKey, createdAt: now, updatedAt: now }]
    })
  }

  // Do not create file eagerly if there is no key.
  return { version: 1, activeId: null, items: [] }
}

async function setActiveGoogleAiStudioKeyId(activeId) {
  const store = await ensureGoogleAiStudioKeysStore()
  const id = activeId == null ? null : String(activeId || '').trim()
  let next = { ...store, activeId: null }
  if (id) {
    const found = store.items.find((x) => x.id === id)
    if (!found) throw new Error('API key not found')
    next.activeId = found.id
    await writeGoogleAiStudioKeysStore(next)
    await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', found.key)
    return true
  }

  // Clear active (disable auto-translation), keep saved keys.
  if (fsSync.existsSync(getUserGoogleAiStudioKeysPath())) {
    await writeGoogleAiStudioKeysStore(next)
  }
  await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', null)
  return true
}

const AZURE_TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com'
const pendingAutoMeaning = new Map()

// --- Google AI Studio concurrency + caching ---
function coerceGoogleAiConcurrency(val) {
  const n = Number(val)
  if (!Number.isFinite(n)) return 4
  const i = Math.floor(n)
  if (i < 1) return 1
  if (i > 16) return 16
  return i
}

let googleAiMaxConcurrency = coerceGoogleAiConcurrency(process.env.GOOGLE_AI_STUDIO_CONCURRENCY || 4)
const GOOGLE_AI_CACHE_TTL_MS = Math.max(0, Number(process.env.GOOGLE_AI_STUDIO_CACHE_TTL_MS || 5 * 60 * 1000) || 0)
let googleAiActive = 0
const googleAiQueue = []
const googleAiCache = new Map() // key -> { t: number, v: string }

function refreshGoogleAiConcurrencyFromEnv() {
  googleAiMaxConcurrency = coerceGoogleAiConcurrency(process.env.GOOGLE_AI_STUDIO_CONCURRENCY || 4)
  return googleAiMaxConcurrency
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

function runGoogleAiTask(taskFn) {
  return new Promise((resolve, reject) => {
    googleAiQueue.push({ taskFn, resolve, reject })
    pumpGoogleAiQueue()
  })
}

function pumpGoogleAiQueue() {
  while (googleAiActive < googleAiMaxConcurrency && googleAiQueue.length > 0) {
    const job = googleAiQueue.shift()
    if (!job) return
    googleAiActive++
    Promise.resolve()
      .then(() => job.taskFn())
      .then(job.resolve, job.reject)
      .finally(() => {
        googleAiActive--
        pumpGoogleAiQueue()
      })
  }
}

function sleepMs(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    const t = setTimeout(() => resolve(true), ms)
    if (signal) {
      const onAbort = () => {
        try { clearTimeout(t) } catch {}
        signal.removeEventListener('abort', onAbort)
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      }
      signal.addEventListener('abort', onAbort)
    }
  })
}

function getGoogleAiStudioConfig(payload) {
  const key = process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GOOGLE_API_KEY
  const model = process.env.GOOGLE_AI_STUDIO_MODEL || 'gemma-3-27b-it'
  const endpoint = process.env.GOOGLE_AI_STUDIO_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta'
  if (!key) throw new Error('Missing GOOGLE_AI_STUDIO_API_KEY')
  return { key, model, endpoint }
}

async function googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal }) {
  if (typeof fetch !== 'function') throw new Error('Global fetch is not available in Electron main process')

  const base = String(endpoint || '').replace(/\/+$/, '')
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
  const promptText = String(prompt || '')
  const cacheKey = `${base}|${model}|${crypto.createHash('sha256').update(promptText).digest('hex')}`
  const cached = googleAiCacheGet(cacheKey)
  if (cached != null) return cached

  // Queue + limited parallelism, plus retry/backoff for transient rate limits.
  return await runGoogleAiTask(async () => {
    const cached2 = googleAiCacheGet(cacheKey)
    if (cached2 != null) return cached2

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
      if (!isRetryable || attempt === maxRetries) {
        throw new Error(`Google AI Studio generateContent failed: ${status} ${t}`)
      }

      const baseDelay = 400 * Math.pow(2, attempt)
      const jitter = Math.floor(Math.random() * 250)
      await sleepMs(baseDelay + jitter, signal)
    }

    // should be unreachable
    throw new Error('Google AI Studio generateContent failed after retries')
  })
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
    return { candidates: [], meaningSuggested: '', contextSentenceVi: '' }
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
    `  "candidates": [\n` +
    `    { "vi": string, "pos": one of ${JSON.stringify(allowedPos)}, "back": string[] }\n` +
    `  ]\n` +
    `}\n` +
    `Rules:\n` +
    `- Provide 3 to 7 candidates if possible.\n` +
    `- Each candidate.vi should be a short Vietnamese gloss (not a full sentence).\n` +
    `- back: short English hints/synonyms (0-5 items).\n` +
    `- meaningSuggested must exactly equal one of candidates[i].vi (best for the context).\n` +
    `- If the selected term is a multi-word expression, use pos="Phrase".\n`

  const raw = await googleAiStudioGenerateContent({ key, endpoint, model, prompt, signal })
  const obj = safeJsonParseObject(raw)
  const candidates = dedupeCandidates(obj && obj.candidates)
  let meaningSuggested = obj && obj.meaningSuggested ? String(obj.meaningSuggested || '').trim() : ''
  if (meaningSuggested) {
    const found = candidates.find((c) => normalizeMeaningForMatch(c.vi) === normalizeMeaningForMatch(meaningSuggested))
    if (found) meaningSuggested = found.vi
    else meaningSuggested = ''
  }

  // If model didn't follow the rule, pick the first candidate.
  if (!meaningSuggested && candidates.length > 0) meaningSuggested = candidates[0].vi

  return { candidates, meaningSuggested, contextSentenceVi: '' }
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

    // 1) Primary: Gemma suggests meanings + POS using context (LLM sense disambiguation).
    // If Google AI Studio key is missing, skip Gemma and rely on Azure dictionary fallback (or return empty).
    let g = null
    try {
      g = getGoogleAiStudioConfig(req)
    } catch (e) {
      g = null
    }

    if (g) {
      try {
        const gemma = await gemmaSuggestMeaningCandidates({
          key: g.key,
          endpoint: g.endpoint,
          model: g.model,
          word,
          contextSentenceEn,
          from,
          to,
          signal: controller.signal
        })
        candidates = Array.isArray(gemma.candidates) ? gemma.candidates : []
        meaningSuggested = String(gemma.meaningSuggested || '').trim()
      } catch (e) {
        // ignore Gemma errors; allow Azure fallback below
      }

      // 2) Translate context sentence for display (still Gemma).
      if (contextSentenceEn) {
        try {
          contextSentenceVi = await googleTranslatePlain({
            key: g.key,
            endpoint: g.endpoint,
            model: g.model,
            from,
            to,
            text: contextSentenceEn,
            signal: controller.signal
          })
        } catch (e) {
          // ignore context translation errors
        }
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
      meaningSuggested = candidates[0].vi
    }

    return {
      requestId,
      word,
      meaningSuggested: meaningSuggested || '',
      contextSentenceVi: contextSentenceVi || '',
      candidates
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return {
        requestId,
        word,
        meaningSuggested: '',
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
    const header = Papa.unparse([], { header: true, columns: ['word', 'meaning', 'pronunciation', 'pos', 'example'] })
    await fs.writeFile(filePath, 'word,meaning,pronunciation,pos,example\n', 'utf8')
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
    await fs.writeFile(full, 'word,meaning,pronunciation,pos,example\n', 'utf8')
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
    pronunciation: (r.pronunciation || '').replace(/"+/g, ''),
    pos: (r.pos || '').replace(/"+/g, ''),
    example: (r.example || '').replace(/"+/g, '')
  }))
  const csv = Papa.unparse(cleanRows, { 
    columns: ['word', 'meaning', 'pronunciation', 'pos', 'example'],
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
    fsSync.writeFileSync(full, 'word,meaning,pronunciation,pos,example\n', 'utf8');
  }

  const text = await fs.readFile(full, 'utf8');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data || [];
  rows.push({
    word: row && row.word ? row.word : '',
    meaning: row && row.meaning ? row.meaning : '',
    pronunciation: row && row.pronunciation ? row.pronunciation : '',
    pos: row && row.pos ? row.pos : '',
    example: row && row.example ? row.example : ''
  });

  await writeCsv(fileRelOrAbsPath, rows);
  return true;
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
      pronunciation: newData.pronunciation || rows[index].pronunciation,
      pos: newData.pos || rows[index].pos || '',
      example: (typeof newData.example !== 'undefined') ? newData.example : (rows[index].example || '')
    }
  }
  await writeCsv(relPath, rows)
  return true
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
    const { key, model, endpoint } = getGoogleAiStudioConfig(payload)
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
    const { key, model, endpoint } = getGoogleAiStudioConfig(payload)
    const word = payload && payload.word ? payload.word : ''
    const dialect = payload && payload.dialect ? payload.dialect : 'US'
    return await gemmaSuggestIpa({ key, endpoint, model, word, dialect, signal: ctrl.signal })
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
    await fs.writeFile(deckCsvPath, 'word,meaning,pronunciation,pos,example\n', 'utf8')

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

ipcMain.handle('translator:autoMeaning', async (ev, payload) => {
  return autoMeaningCore(payload)
})

ipcMain.handle('translator:translatePlain', async (ev, payload) => {
  const req = payload || {}
  const text = String(req.text || '').trim()
  const from = String(req.from || 'en')
  const to = String(req.to || 'vi')
  if (!text) return ''

  const g = getGoogleAiStudioConfig(req)
  return await googleTranslatePlain({ key: g.key, endpoint: g.endpoint, model: g.model, from, to, text })
})

ipcMain.handle('settings:getGoogleAiStudioStatus', async () => {
  const hasKey = !!(process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GOOGLE_API_KEY)
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
  // Backward-compat: also store it in the multi-key store as the active key.
  const store = await ensureGoogleAiStudioKeysStore()
  const now = new Date().toISOString()
  const id = makeId()
  const next = {
    ...store,
    activeId: id,
    items: [...store.items, { id, name: 'Key', key, createdAt: now, updatedAt: now }]
  }
  if (fsSync.existsSync(getUserGoogleAiStudioKeysPath()) || store.items.length > 0) {
    await writeGoogleAiStudioKeysStore(next)
  } else {
    await writeGoogleAiStudioKeysStore(next)
  }
  await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', key)
  return true
})

ipcMain.handle('settings:clearGoogleAiStudioApiKey', async () => {
  await setActiveGoogleAiStudioKeyId(null)
  return true
})

ipcMain.handle('settings:listGoogleAiStudioApiKeys', async () => {
  const store = await ensureGoogleAiStudioKeysStore()
  return {
    activeId: store.activeId,
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
    activeId: id,
    items: [...store.items, { id, name, key, createdAt: now, updatedAt: now }]
  }
  await writeGoogleAiStudioKeysStore(next)
  await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', key)
  return true
})

ipcMain.handle('settings:deleteGoogleAiStudioApiKey', async (ev, keyId) => {
  const id = String(keyId || '').trim()
  if (!id) throw new Error('Key id is required')

  const store = await ensureGoogleAiStudioKeysStore()
  const items = store.items.filter((x) => x.id !== id)
  const wasActive = store.activeId === id
  const nextActiveId = wasActive ? (items[0] ? items[0].id : null) : store.activeId
  const next = { ...store, items, activeId: nextActiveId }

  if (fsSync.existsSync(getUserGoogleAiStudioKeysPath())) {
    await writeGoogleAiStudioKeysStore(next)
  } else {
    await writeGoogleAiStudioKeysStore(next)
  }

  if (nextActiveId) {
    const found = items.find((x) => x.id === nextActiveId)
    await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', found ? found.key : null)
  } else {
    await setUserEnvVar('GOOGLE_AI_STUDIO_API_KEY', null)
  }
  return true
})

ipcMain.handle('settings:setActiveGoogleAiStudioApiKey', async (ev, keyId) => {
  const id = String(keyId || '').trim()
  if (!id) throw new Error('Key id is required')
  await setActiveGoogleAiStudioKeyId(id)
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
