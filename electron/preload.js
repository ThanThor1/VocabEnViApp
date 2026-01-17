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
  enhanceWordInBackground: (relPath, word, meaning, pronunciation, pos, example) =>
    ipcRenderer.invoke('enhanceWordInBackground', relPath, word, meaning, pronunciation, pos, example),
  deleteWord: (relPath, index) => ipcRenderer.invoke('deleteWord', relPath, index),
  editWord: (relPath, index, newData) => ipcRenderer.invoke('editWord', relPath, index, newData),
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
  autoMeaning: (payload) => ipcRenderer.invoke('translator:autoMeaning', payload),
  autoMeaningCancel: (requestId) => ipcRenderer.invoke('translator:autoMeaningCancel', requestId)
  ,
  suggestExampleSentence: (payload) => ipcRenderer.invoke('translator:suggestExampleSentence', payload)
  ,
  suggestIpa: (payload) => ipcRenderer.invoke('translator:suggestIpa', payload)
  ,
  translatePlain: (payload) => ipcRenderer.invoke('translator:translatePlain', payload)
  ,
  // Per-user settings (stored in userData/.env)
  getGoogleAiStudioStatus: () => ipcRenderer.invoke('settings:getGoogleAiStudioStatus'),
  setGoogleAiStudioApiKey: (apiKey) => ipcRenderer.invoke('settings:setGoogleAiStudioApiKey', apiKey),
  clearGoogleAiStudioApiKey: () => ipcRenderer.invoke('settings:clearGoogleAiStudioApiKey'),
  getGoogleAiStudioConcurrency: () => ipcRenderer.invoke('settings:getGoogleAiStudioConcurrency'),
  setGoogleAiStudioConcurrency: (concurrency) => ipcRenderer.invoke('settings:setGoogleAiStudioConcurrency', concurrency),

  // Multi-key management (stored in userData/google-ai-studio-keys.json)
  listGoogleAiStudioApiKeys: () => ipcRenderer.invoke('settings:listGoogleAiStudioApiKeys'),
  addGoogleAiStudioApiKey: (payload) => ipcRenderer.invoke('settings:addGoogleAiStudioApiKey', payload),
  deleteGoogleAiStudioApiKey: (keyId) => ipcRenderer.invoke('settings:deleteGoogleAiStudioApiKey', keyId),
  setActiveGoogleAiStudioApiKey: (keyId) => ipcRenderer.invoke('settings:setActiveGoogleAiStudioApiKey', keyId),

  // listen for deck updates (emitted when a CSV inside a PDF folder is written)
  onDeckUpdated: (cb) => ipcRenderer.on('deck-updated', (ev, data) => cb && cb(data))
  ,
  offDeckUpdated: (cb) => ipcRenderer.removeListener('deck-updated', cb)
})
