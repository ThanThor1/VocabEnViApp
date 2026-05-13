export {}

export type VocabRow = {
  word: string
  meaning: string
  meaningEn?: string
  meaningVi?: string
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
  meaningNoteEn: string
  meaningNoteVi: string
  meaningNoteVie: string
  contextSentenceVi: string
  candidates: AutoMeaningCandidate[]
}

export type EnrichWordResponse = AutoMeaningResponse & {
  posSuggested: string
  ipa: string
  example: string
}

export type EnrichWordBulkItem = {
  word: string
  result?: EnrichWordResponse
  error?: string
}

export type EnrichWordBulkResponse = {
  requestId: string
  items: EnrichWordBulkItem[]
}

export type WordFamilyMember = { word: string; pos?: string; relation?: string }

export type WordFamilyResponse = {
  word: string
  family: WordFamilyMember[]
}

export type SynonymsResponse = {
  word: string
  synonyms: WordFamilyMember[]
}

export type TranslateExplainResponse = {
  translation: string
  explanation: string
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
  addWordsBulk: (relPath: string, rows: any[]) => Promise<{ added: number }>
  deleteWord: (relPathOrAbsPath: string, index: number) => Promise<boolean>
  editWord: (relPathOrAbsPath: string, index: number, newData: Partial<VocabRow>) => Promise<boolean>
  dedupeWords: (relPathOrAbsPath: string) => Promise<{ removed: number; kept: number; totalBefore: number }>
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

  enrichWord: (payload: { requestId: string; word: string; contextSentenceEn: string; from?: string; to?: string; dialect?: 'US' | 'UK' }) => Promise<EnrichWordResponse>

  enrichWordBulk: (payload: { requestId: string; words: string[]; contextSentenceEn: string; from?: string; to?: string; dialect?: 'US' | 'UK' }) => Promise<EnrichWordBulkResponse>

  suggestExampleSentence: (payload: { word: string; meaningVi?: string; pos?: string; contextSentenceEn?: string }) => Promise<string>

  suggestIpa: (payload: { word: string; dialect?: 'US' | 'UK' }) => Promise<string>

  getWordFamily: (payload: { word: string }) => Promise<WordFamilyResponse>

  getSynonyms: (payload: { word: string }) => Promise<SynonymsResponse>

  fetchEnglishMeaning: (word: string) => Promise<string>

  translateMeaningNoteVie: (payload: { englishMeaning: string; word?: string; contextSentenceEn?: string }) => Promise<string>

  translatePlain: (payload: { text: string; from?: string; to?: string; region?: string }) => Promise<string>

  translateExplain: (payload: { text: string; from?: string; to?: string; region?: string }) => Promise<TranslateExplainResponse>

  // Export Smart Review (VocabularyStore localStorage: vocab_store_v2)
  exportSmartReview: (rawJson: string) => Promise<string | null>

  getGoogleAiStudioStatus: () => Promise<{ hasKey: boolean }>
  getGoogleAiStudioConcurrency: () => Promise<{ concurrency: number }>
  setGoogleAiStudioConcurrency: (concurrency: number) => Promise<{ concurrency: number }>
  setGoogleAiStudioApiKey: (apiKey: string) => Promise<boolean>
  clearGoogleAiStudioApiKey: () => Promise<boolean>

  listGoogleAiStudioApiKeys: () => Promise<{ activeIds: string[]; activeId: string | null; items: Array<{ id: string; name: string; masked: string }> }>
  addGoogleAiStudioApiKey: (payload: { name?: string; apiKey: string }) => Promise<boolean>
  deleteGoogleAiStudioApiKey: (keyId: string) => Promise<boolean>
  setActiveGoogleAiStudioApiKey: (keyId: string) => Promise<boolean>
  toggleGoogleAiStudioApiKey: (keyId: string, enabled: boolean) => Promise<boolean>

  onDeckUpdated: (cb: (data: { pdfId?: string; deckCsvPath?: string }) => void) => void
  offDeckUpdated: (cb: (data: { pdfId?: string; deckCsvPath?: string }) => void) => void

  onGoogleAiStudioKeyInvalid: (cb: (data: { id: string; name?: string; masked: string; reason?: string }) => void) => void
  offGoogleAiStudioKeyInvalid: (cb: (data: { id: string; name?: string; masked: string; reason?: string }) => void) => void
}

declare global {
  interface Window {
    api: WindowApi
  }
}
