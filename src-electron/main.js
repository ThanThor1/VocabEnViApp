const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')
const Papa = require('papaparse')
const crypto = require('crypto')

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
} catch (e) {
}

const AZURE_TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com'
const pendingAutoMeaning = new Map()

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
    const { key, region } = getTranslatorConfig(req)

    const dict = await azureDictionaryLookup({ key, region, from, to, word, signal: controller.signal })
    const translations = (Array.isArray(dict) && dict[0] && Array.isArray(dict[0].translations)) ? dict[0].translations : []
    let candidates = translations
      .map((t) => {
        const vi = String(t.displayTarget || t.normalizedTarget || '').trim()
        const pos = String(t.posTag || '').trim()
        const back = Array.isArray(t.backTranslations)
          ? t.backTranslations.map((b) => String(b.displayText || b.normalizedText || '').trim()).filter(Boolean).slice(0, 8)
          : []
        return { vi, pos, back }
      })
      .filter((c) => c.vi)

    // Azure Dictionary Lookup may not return Vietnamese for some language pairs.
    // If candidates look untranslated, fall back to translating the word itself.
    if (candidatesLookUntranslated(word, candidates)) {
      try {
        const translatedCandidates = await azureTranslateWordCandidates({
          key,
          region,
          from,
          to,
          word,
          signal: controller.signal
        })
        if (Array.isArray(translatedCandidates) && translatedCandidates.length > 0) {
          candidates = translatedCandidates
        }
      } catch (e) {
      }
    }

    let contextSentenceVi = ''
    let meaningSuggested = ''

    if (contextSentenceEn) {
      contextSentenceVi = await azureTranslatePlain({
        key,
        region,
        from,
        to,
        text: contextSentenceEn,
        signal: controller.signal
      })
      meaningSuggested = chooseMeaningByContext(candidates, contextSentenceVi)
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
    const header = Papa.unparse([], { header: true, columns: ['word', 'meaning', 'pronunciation', 'pos'] })
    await fs.writeFile(filePath, 'word,meaning,pronunciation,pos\n', 'utf8')
  }
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

  const startUrl = process.env.ELECTRON_START_URL || null
  if (startUrl) {
    win.loadURL(startUrl)
    win.webContents.openDevTools()
  } else {
    // production: load built index.html
    win.loadFile(path.join(__dirname, '..', 'index.html'))
  }
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
    await fs.writeFile(full, 'word,meaning,pronunciation,pos\n', 'utf8')
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
    pos: (row.pos || '').replace(/"+/g, '')
  }))
})

async function writeCsv(fileRelOrAbsPath, rows) {
  const root = getDataRoot()
  // Clean any accumulated quotes from pronunciation field
  const cleanRows = rows.map(r => ({
    word: (r.word || '').replace(/"+/g, ''),
    meaning: (r.meaning || '').replace(/"+/g, ''),
    pronunciation: (r.pronunciation || '').replace(/"+/g, ''),
    pos: (r.pos || '').replace(/"+/g, '')
  }))
  const csv = Papa.unparse(cleanRows, { 
    columns: ['word', 'meaning', 'pronunciation', 'pos'],
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
    fsSync.writeFileSync(full, 'word,meaning,pronunciation,pos\n', 'utf8');
  }

  const text = await fs.readFile(full, 'utf8');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data || [];
  rows.push({
    word: row && row.word ? row.word : '',
    meaning: row && row.meaning ? row.meaning : '',
    pronunciation: row && row.pronunciation ? row.pronunciation : '',
    pos: row && row.pos ? row.pos : ''
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
      pos: newData.pos || rows[index].pos || ''
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
    fsSync.writeFileSync(dstFull, 'word,meaning,pronunciation,pos\n', 'utf8')
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
    fsSync.writeFileSync(dstFull, 'word,meaning,pronunciation,pos\n', 'utf8')
  }

  const dstText = await fs.readFile(dstFull, 'utf8')
  const dstParsed = Papa.parse(dstText, { header: true, skipEmptyLines: true })
  const dstRows = dstParsed.data || []
  dstRows.push(...copied)
  await writeCsv(dstRel, dstRows)
  return true
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
    await fs.writeFile(deckCsvPath, 'word,meaning,pronunciation,pos\n', 'utf8')

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
