export {}

export type VocabRow = {
  word: string
  meaning: string
  pronunciation?: string
  pos?: string
  example?: string
}

export type PdfMeta = {
  pdfId: string
  originalFileName?: string
  baseName: string
  createdAt: string
  sourcePdfPath: string
  deckCsvPath: string
  trashed?: boolean
}

export type TreeNode = {
  name: string
  path: string
  type: 'folder' | 'file'
  children?: TreeNode[]
}

export type HighlightRect = {
  xPct: number
  yPct: number
  wPct: number
  hPct: number
}

export type PdfHighlight = {
  id: string
  pageNumber: number
  text: string
  rects: HighlightRect[]
  wordKey: string
  meaning?: string
  pronunciation?: string
}

export type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] }

export type AutoMeaningResponse = {
  requestId: string
  word: string
  meaningSuggested: string
  contextSentenceVi: string
  candidates: AutoMeaningCandidate[]
}

export interface WindowApi {
  listTree: () => Promise<TreeNode[]>
  createFolder: (parentRelPath: string, name: string) => Promise<boolean>
  createFile: (parentRelPath: string, name: string) => Promise<boolean>
  deleteFile: (relPath: string) => Promise<boolean>
  deleteFolder: (relPath: string) => Promise<boolean>
  readCsv: (relPathOrAbsPath: string) => Promise<VocabRow[]>
  addWord: (relPathOrAbsPath: string, row: VocabRow) => Promise<boolean>
  enhanceWordInBackground: (relPathOrAbsPath: string, word: string, meaning: string, pronunciation: string, pos: string, example: string) => Promise<boolean>
  deleteWord: (relPathOrAbsPath: string, index: number) => Promise<boolean>
  editWord: (relPathOrAbsPath: string, index: number, newData: Partial<VocabRow>) => Promise<boolean>
  moveWords: (srcRelOrAbs: string, dstRelOrAbs: string, indices: number[]) => Promise<boolean>
  copyWords: (srcRelOrAbs: string, dstRelOrAbs: string, indices: number[]) => Promise<boolean>
  copyPath: (srcRel: string, dstRel: string) => Promise<boolean>
  movePath: (srcRel: string, dstRel: string) => Promise<boolean>
  renamePath: (relPath: string, newName: string) => Promise<boolean>

  pdfImport: () => Promise<{ pdfId: string; baseName: string; deckCsvPath: string; sourcePdfPath: string } | null>
  pdfList: () => Promise<PdfMeta[]>
  pdfGet: (pdfId: string) => Promise<PdfMeta & { highlights?: PdfHighlight[]; deckRowCount?: number }>
  pdfReadHighlights: (pdfId: string) => Promise<unknown>
  pdfWriteHighlights: (pdfId: string, highlights: PdfHighlight[]) => Promise<boolean>
  pdfGetSourcePath: (pdfId: string) => Promise<string>
  pdfReadBinary: (pdfId: string) => Promise<Uint8Array>
  pdfGetSourceBytes: (pdfId: string) => Promise<Uint8Array>
  pdfDelete: (pdfId: string) => Promise<boolean>
  pdfTrash: (pdfId: string) => Promise<boolean>
  pdfRestore: (pdfId: string) => Promise<boolean>
  pdfDeletePermanent: (pdfId: string) => Promise<boolean>

  autoMeaning: (payload: { requestId: string; word: string; contextSentenceEn: string; from?: string; to?: string }) => Promise<AutoMeaningResponse>
  autoMeaningCancel: (requestId: string) => Promise<boolean>

  suggestExampleSentence: (payload: { word: string; meaningVi?: string; pos?: string; contextSentenceEn?: string }) => Promise<string>

  suggestIpa: (payload: { word: string; dialect?: 'US' | 'UK' }) => Promise<string>

  translatePlain: (payload: { text: string; from?: string; to?: string; region?: string }) => Promise<string>

  getGoogleAiStudioStatus: () => Promise<{ hasKey: boolean }>
  getGoogleAiStudioConcurrency: () => Promise<{ concurrency: number }>
  setGoogleAiStudioConcurrency: (concurrency: number) => Promise<{ concurrency: number }>
  setGoogleAiStudioApiKey: (apiKey: string) => Promise<boolean>
  clearGoogleAiStudioApiKey: () => Promise<boolean>

  listGoogleAiStudioApiKeys: () => Promise<{ activeId: string | null; items: Array<{ id: string; name: string; masked: string }> }>
  addGoogleAiStudioApiKey: (payload: { name?: string; apiKey: string }) => Promise<boolean>
  deleteGoogleAiStudioApiKey: (keyId: string) => Promise<boolean>
  setActiveGoogleAiStudioApiKey: (keyId: string) => Promise<boolean>

  onDeckUpdated: (cb: (data: { pdfId?: string; deckCsvPath?: string }) => void) => void
  offDeckUpdated: (cb: (data: { pdfId?: string; deckCsvPath?: string }) => void) => void
}

declare global {
  interface Window {
    api: WindowApi
  }
}
