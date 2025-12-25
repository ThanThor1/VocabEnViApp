const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')
const Papa = require('papaparse')

// (data dir, getDataRoot and listTree are declared once below)

async function ensureCsvHasHeader(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  if (!text.trim()) {
    const header = Papa.unparse([], { header: true, columns: ['word', 'meaning', 'pronunciation'] })
    await fs.writeFile(filePath, 'word,meaning,pronunciation\n', 'utf8')
  }
}

const DATA_DIR_NAME = 'vocab-data'

function getDataRoot() {
  const root = path.join(app.getPath('userData'), DATA_DIR_NAME)
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
  const root = getDataRoot()
  return listTree(root, root)
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
    await fs.writeFile(full, 'word,meaning,pronunciation\n', 'utf8')
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

ipcMain.handle('readCsv', async (ev, relPath) => {
  const root = getDataRoot()
  const full = path.join(root, normalizeRel(relPath))
  const text = await fs.readFile(full, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  return parsed.data
})

async function writeCsv(fileRelPath, rows) {
  const root = getDataRoot()
  const csv = Papa.unparse(rows, { columns: ['word', 'meaning', 'pronunciation'] })
  const full = path.join(root, normalizeRel(fileRelPath))
  await fs.writeFile(full, csv + '\n', 'utf8')
}

ipcMain.handle('addWord', async (ev, relPath, row) => {
  const root = getDataRoot()
  const full = path.join(root, normalizeRel(relPath))
  const text = await fs.readFile(full, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  const rows = parsed.data || []
  rows.push(row)
  await writeCsv(relPath, rows)
  return true
})

ipcMain.handle('deleteWord', async (ev, relPath, index) => {
  const root = getDataRoot()
  const full = path.join(root, normalizeRel(relPath))
  const text = await fs.readFile(full, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  const rows = parsed.data || []
  rows.splice(index, 1)
  await writeCsv(relPath, rows)
  return true
})

ipcMain.handle('moveWords', async (ev, srcRel, dstRel, indices) => {
  const root = getDataRoot()
  const srcFull = path.join(root, normalizeRel(srcRel))
  const dstFull = path.join(root, normalizeRel(dstRel))
  const srcText = await fs.readFile(srcFull, 'utf8')
  const srcParsed = Papa.parse(srcText, { header: true, skipEmptyLines: true })
  const srcRows = srcParsed.data || []
  const moved = []
  const sorted = [...indices].sort((a, b) => b - a)
  for (const i of sorted) {
    const [r] = srcRows.splice(i, 1)
    if (r) moved.unshift(r)
  }
  const dstText = await fs.readFile(dstFull, 'utf8')
  const dstParsed = Papa.parse(dstText, { header: true, skipEmptyLines: true })
  const dstRows = dstParsed.data || []
  dstRows.push(...moved)
  await writeCsv(srcRel, srcRows)
  await writeCsv(dstRel, dstRows)
  return true
})

ipcMain.handle('copyWords', async (ev, srcRel, dstRel, indices) => {
  const root = getDataRoot()
  const srcFull = path.join(root, normalizeRel(srcRel))
  const dstFull = path.join(root, normalizeRel(dstRel))
  const srcText = await fs.readFile(srcFull, 'utf8')
  const srcParsed = Papa.parse(srcText, { header: true, skipEmptyLines: true })
  const srcRows = srcParsed.data || []
  const copied = indices.map((i) => srcRows[i]).filter(Boolean)
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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
