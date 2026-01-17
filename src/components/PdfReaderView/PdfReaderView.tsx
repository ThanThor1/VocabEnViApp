import React, { useState, useEffect } from 'react'
import './PdfReaderView.css'
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import PdfLibrary from '../PdfLibrary/PdfLibrary'
import PdfViewer from '../PdfViewer/PdfViewer'
import PdfVocabPanel from '../PdfVocabPanel/PdfVocabPanel'
import { usePersistedState } from '../../hooks/usePersistedState'

type PdfItem = {
  pdfId: string
  baseName: string
  deckCsvPath: string
  sourcePdfPath: string
  createdAt: string
}

export default function PdfReader() {
  const [pdfs, setPdfs] = useState<PdfItem[]>([])
  const [selectedPdfId, setSelectedPdfId] = usePersistedState<string | null>('pdfReader_selectedPdfId', null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [showLibrary, setShowLibrary] = usePersistedState('pdfReader_showLibrary', true)
  const [showVocab, setShowVocab] = usePersistedState('pdfReader_showVocab', true)

  useEffect(() => {
    loadPdfs()
  }, [refreshKey])

  async function loadPdfs() {
    try {
      const list = await window.api.pdfList()
      setPdfs(list)
      if (list.length > 0 && !selectedPdfId) {
        setSelectedPdfId(list[0].pdfId)
      }
    } catch (err) {
      console.error('Error loading PDFs:', err)
    }
  }

  async function handleImportPdf() {
    try {
      const result = await window.api.pdfImport()
      if (result) {
        setRefreshKey(k => k + 1)
        setSelectedPdfId(result.pdfId)
      }
    } catch (err: any) {
      console.error('Error importing PDF:', err)
      setErrorMessage(`Error importing PDF: ${(err as Error).message}`)
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const selectedPdf = pdfs.find(p => p.pdfId === selectedPdfId)

  return (
    <ErrorBoundary>
      <div className="flex h-full bg-gradient-to-br from-slate-50 via-white to-purple-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
      {errorMessage && (
        <div className="alert alert-error absolute left-4 right-4 top-4 z-50 animate-slide-down">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span className="font-medium">{errorMessage}</span>
        </div>
      )}
      
      {/* Left: PDF Library (collapsible) */}
      {showLibrary ? (
        <div className="w-80 border-r border-slate-200/60 dark:border-slate-700/60 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm overflow-y-auto relative shadow-xl">
          <div className="absolute top-4 right-4 z-10">
            <button
              title="Collapse library"
              onClick={() => setShowLibrary(false)}
              className="btn-icon !w-9 !h-9"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <PdfLibrary
            pdfs={pdfs}
            selectedPdfId={selectedPdfId}
            onSelectPdf={setSelectedPdfId}
            onImport={handleImportPdf}
            onChange={() => setRefreshKey(k => k + 1)}
          />
        </div>
      ) : (
        <div className="w-14 flex items-center justify-center border-r border-slate-200/60 dark:border-slate-700/60 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm">
          <button
            title="Expand library"
            onClick={() => setShowLibrary(true)}
            className="btn-icon !w-10 !h-10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Center: PDF Viewer */}
      <div className="flex-1 flex flex-col bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm">
        {selectedPdf ? (
          <PdfViewer pdfId={selectedPdf.pdfId} />
        ) : (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 via-violet-50/30 to-purple-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
            <div className="text-center p-12 animate-fade-in">
              <div className="inline-block p-8 bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 rounded-3xl shadow-2xl shadow-violet-500/30 mb-8 animate-bounce-subtle">
                <svg className="w-20 h-20 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold gradient-text mb-4">No PDF Selected</h2>
              <p className="text-lg text-slate-600 dark:text-slate-400 mb-8 max-w-md mx-auto">Import a PDF to get started with your vocabulary learning journey</p>
              <button
                onClick={handleImportPdf}
                className="btn-primary px-10 py-4 text-lg flex items-center gap-3 mx-auto shadow-xl hover:shadow-2xl"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Import PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: Vocab Panel (collapsible) */}
      {selectedPdf && (
        showVocab ? (
          <div className="w-80 border-l border-slate-200/60 dark:border-slate-700/60 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm overflow-y-auto relative shadow-xl">
            <div className="absolute top-4 left-4 z-10">
              <button
                title="Collapse vocab panel"
                onClick={() => setShowVocab(false)}
                className="btn-icon !w-9 !h-9"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <PdfVocabPanel
              pdfId={selectedPdf.pdfId}
              baseName={selectedPdf.baseName}
              deckCsvPath={selectedPdf.deckCsvPath}
            />
          </div>
        ) : (
          <div className="w-14 flex items-center justify-center border-l border-slate-200/60 dark:border-slate-700/60 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm">
            <button
              title="Expand vocab panel"
              onClick={() => setShowVocab(true)}
              className="btn-icon !w-10 !h-10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )
      )}
      </div>
    </ErrorBoundary>
  )
}
