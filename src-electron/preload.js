const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  listTree: () => ipcRenderer.invoke('listTree'),
  // createFolder/createFile now accept (parentRelPath, name)
  createFolder: (parentRelPath, name) => ipcRenderer.invoke('createFolder', parentRelPath, name),
  createFile: (parentRelPath, name) => ipcRenderer.invoke('createFile', parentRelPath, name),
  deleteFile: (relPath) => ipcRenderer.invoke('deleteFile', relPath),
  deleteFolder: (relPath) => ipcRenderer.invoke('deleteFolder', relPath),
  readCsv: (relPath) => ipcRenderer.invoke('readCsv', relPath),
  addWord: (relPath, row) => ipcRenderer.invoke('addWord', relPath, row),
  deleteWord: (relPath, index) => ipcRenderer.invoke('deleteWord', relPath, index),
  moveWords: (srcRel, dstRel, indices) => ipcRenderer.invoke('moveWords', srcRel, dstRel, indices),
  copyWords: (srcRel, dstRel, indices) => ipcRenderer.invoke('copyWords', srcRel, dstRel, indices),
  // file/folder operations
  copyPath: (srcRel, dstRel) => ipcRenderer.invoke('copyPath', srcRel, dstRel),
  movePath: (srcRel, dstRel) => ipcRenderer.invoke('movePath', srcRel, dstRel),
  renamePath: (relPath, newName) => ipcRenderer.invoke('renamePath', relPath, newName),
  // PDF operations
  pdfImport: () => ipcRenderer.invoke('pdfImport'),
  pdfList: () => ipcRenderer.invoke('pdfList'),
  pdfGet: (pdfId) => ipcRenderer.invoke('pdfGet', pdfId),
  pdfReadHighlights: (pdfId) => ipcRenderer.invoke('pdfReadHighlights', pdfId),
  pdfWriteHighlights: (pdfId, highlights) => ipcRenderer.invoke('pdfWriteHighlights', pdfId, highlights),
  pdfGetSourcePath: (pdfId) => ipcRenderer.invoke('pdfGetSourcePath', pdfId),
  pdfReadBinary: (pdfId) => ipcRenderer.invoke('pdfReadBinary', pdfId),
  pdfGetSourceBytes: (pdfId) => ipcRenderer.invoke('pdfGetSourceBytes', pdfId)
  ,
  pdfDelete: (pdfId) => ipcRenderer.invoke('pdfDelete', pdfId)
  ,
  pdfTrash: (pdfId) => ipcRenderer.invoke('pdfTrash', pdfId),
  pdfRestore: (pdfId) => ipcRenderer.invoke('pdfRestore', pdfId)
  ,
  pdfDeletePermanent: (pdfId) => ipcRenderer.invoke('pdfDeletePermanent', pdfId)
  ,
  // listen for deck updates (emitted when a CSV inside a PDF folder is written)
  onDeckUpdated: (cb) => ipcRenderer.on('deck-updated', (ev, data) => cb && cb(data))
  ,
  offDeckUpdated: (cb) => ipcRenderer.removeListener('deck-updated', cb)
})
