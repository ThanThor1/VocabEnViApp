import React, { useEffect, useRef, useState } from 'react'
import ErrorBoundary from '../shared/ErrorBoundary'
import { useNavigate, useLocation } from 'react-router-dom'
import VocabTable from '../shared/VocabTable'
import { usePersistedState } from '../shared/usePersistedState'

declare const window: any

export default function ManagerPdf() {
  const navigate = useNavigate()
  const location = useLocation()
  
  // Persisted state - PDF selection
  const [selectedPdf, setSelectedPdf] = usePersistedState<any | null>('managerPdf_selectedPdf', null)
  
  // Persisted state - VocabTable filters and selections
  const [wordFilter, setWordFilter] = usePersistedState<string>('managerPdf_wordFilter', '');
  const [meaningFilter, setMeaningFilter] = usePersistedState<string>('managerPdf_meaningFilter', '');
  const [vocabSelected, setVocabSelected] = usePersistedState<Record<number, boolean>>('managerPdf_vocabSelected', {});
  
  // Non-persisted state
  const [pdfs, setPdfs] = useState<any[]>([])
  const [rows, setRows] = useState<any[]>([])

  const restoredPdfRef = useRef(false)

  useEffect(() => {
    loadPdfs()
    // open from navigation state
    const st: any = (location && (location as any).state) || null
    if (st && st.pdfId) {
      // will select after list loaded
      (async () => {
        await loadPdfs()
        const p = (await window.api.pdfList()).find((x:any)=>x.pdfId===st.pdfId)
        if (p) selectPdf(p)
      })().catch(()=>{})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restore last selected pdf on mount
  useEffect(() => {
    if (!restoredPdfRef.current && selectedPdf) {
      restoredPdfRef.current = true
      selectPdf(selectedPdf).catch(()=>{})
    }
  }, [selectedPdf])

  async function loadPdfs() {
    try {
      const list = await window.api.pdfList()
      setPdfs(list || [])
    } catch (err) {
      console.error('Error loading pdfs', err)
      setPdfs([])
    }
  }

  async function selectPdf(p:any) {
    setSelectedPdf(p)
    if (p && p.deckCsvPath) {
      try {
        const data = await window.api.readCsv(p.deckCsvPath)
        setRows(data || [])
      } catch (err) {
        console.error('readCsv error', err)
        setRows([])
      }
    } else {
      setRows([])
    }
  }

  function handleDeleteRow(idx:number) {
    if (!selectedPdf || !selectedPdf.deckCsvPath) return
    window.api.deleteWord(selectedPdf.deckCsvPath, idx).then(()=> selectPdf(selectedPdf))
  }

  const ensureIpaSlashes = (val: string) => {
    const v = (val || '').trim().replace(/"/g, '')
    if (!v) return ''
    const core = v.replace(/^\/+|\/+$/g, '')
    return `/${core}/`
  }

  async function handleEditRow(idx:number, word:string, meaning:string, pronunciation:string, pos:string) {
    if (!selectedPdf || !selectedPdf.deckCsvPath) return
    try {
      await window.api.editWord(selectedPdf.deckCsvPath, idx, { word, meaning, pronunciation: ensureIpaSlashes(pronunciation), pos })
      await selectPdf(selectedPdf)
    } catch (err) {
      console.error('Edit failed', err)
    }
  }

  function speak(t:string){
    try{ const ut = new SpeechSynthesisUtterance(t); window.speechSynthesis.speak(ut) }catch{}
  }

  return (
    <ErrorBoundary>
      <div className="flex h-full bg-gradient-to-br from-gray-50 to-white">
      {/* Left Sidebar */}
      <div className="w-80 border-r border-gray-200 bg-white shadow-sm overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">PDF Decks</h2>
              <p className="text-xs text-gray-500">Manage vocabularies</p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-2">
          {pdfs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">No PDFs available</p>
            </div>
          ) : (
            pdfs.map((p: any) => (
              <div
                key={p.pdfId}
                className={`p-4 rounded-xl cursor-pointer transition-all ${
                  selectedPdf?.pdfId === p.pdfId
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg transform scale-[1.02]'
                    : 'bg-gray-50 hover:bg-gray-100 border border-gray-200'
                }`}
                onClick={() => selectPdf(p)}
              >
                <div className="flex items-center gap-3">
                  <svg className={`w-5 h-5 flex-shrink-0 ${
                    selectedPdf?.pdfId === p.pdfId ? 'text-white' : 'text-gray-600'
                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{p.baseName}</div>
                    <div className={`text-xs truncate ${
                      selectedPdf?.pdfId === p.pdfId ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {p.deckCsvPath ? p.deckCsvPath.split(/[/\\]/).pop() : 'No deck'}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Manage PDF Vocabulary</h1>
              <p className="text-sm text-gray-600 mt-1">View and edit words from your PDF decks</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={loadPdfs}
                className="btn-secondary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              <button
                onClick={() => navigate('/pdf')}
                className="btn-primary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Open PDF Reader
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-auto">
          {selectedPdf ? (
            <div className="max-w-7xl mx-auto">
              {/* Deck Info Card */}
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-4 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{selectedPdf.baseName}</h3>
                      <p className="text-sm text-gray-500 mt-1">{selectedPdf.deckCsvPath}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                          {rows.length} words
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedPdf && selectedPdf.deckCsvPath)
                        navigate('/study', { state: { selectedFiles: [selectedPdf.deckCsvPath] } })
                    }}
                    className="btn-success px-6 py-3 text-lg flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Study Deck
                  </button>
                </div>
              </div>

              {/* Vocab Table */}
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <VocabTable
                  rows={rows}
                  onDelete={handleDeleteRow}
                  onEdit={handleEditRow}
                  onSpeak={speak}
                  onRefresh={() => selectPdf(selectedPdf)}
                  currentFile={selectedPdf.deckCsvPath}
                  selected={vocabSelected}
                  setSelected={setVocabSelected}
                  wordFilter={wordFilter}
                  setWordFilter={setWordFilter}
                  meaningFilter={meaningFilter}
                  setMeaningFilter={setMeaningFilter}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="inline-block p-6 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl mb-6">
                  <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">No PDF Selected</h3>
                <p className="text-gray-600">Select a PDF from the sidebar to view its vocabulary deck</p>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </ErrorBoundary>
  )
}
