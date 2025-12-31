import React, { useState, useEffect } from 'react'
import ErrorBoundary from '../shared/ErrorBoundary'
import PdfLibrary from '../shared/PdfLibrary'
import PdfViewer from '../shared/PdfViewer'
import PdfVocabPanel from '../shared/PdfVocabPanel'
import { usePersistedState } from '../shared/usePersistedState'

declare const window: any

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
      <div className="flex h-full bg-gray-50">
      {errorMessage && (
        <div className="absolute left-0 right-0 top-0 p-4 bg-red-50 border-b-2 border-red-200 text-red-700 m-4 z-40 rounded-lg shadow-lg animate-pulse">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">{errorMessage}</span>
          </div>
        </div>
      )}
      
      {/* Left: PDF Library (collapsible) */}
      {showLibrary ? (
        <div className="w-80 border-r border-gray-200 bg-white overflow-y-auto relative shadow-sm">
          <div className="absolute top-4 right-4 z-10">
            <button
              title="Collapse library"
              onClick={() => setShowLibrary(false)}
              className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600 shadow-sm transition-colors"
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
        <div className="w-12 flex items-center justify-center border-r border-gray-200 bg-white">
          <button
            title="Expand library"
            onClick={() => setShowLibrary(true)}
            className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600 shadow-sm transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Center: PDF Viewer */}
      <div className="flex-1 flex flex-col bg-white">
        {selectedPdf ? (
          <PdfViewer pdfId={selectedPdf.pdfId} />
        ) : (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 to-white">
            <div className="text-center p-8">
              <div className="inline-block p-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-lg mb-6">
                <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">No PDF Selected</h2>
              <p className="text-gray-600 mb-6">Import a PDF to get started with your vocabulary learning</p>
              <button
                onClick={handleImportPdf}
                className="btn-primary px-8 py-3 text-lg flex items-center gap-2 mx-auto"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <div className="w-80 border-l border-gray-200 bg-white overflow-y-auto relative shadow-sm">
            <div className="absolute top-4 left-4 z-10">
              <button
                title="Collapse vocab panel"
                onClick={() => setShowVocab(false)}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600 shadow-sm transition-colors"
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
          <div className="w-12 flex items-center justify-center border-l border-gray-200 bg-white">
            <button
              title="Expand vocab panel"
              onClick={() => setShowVocab(true)}
              className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600 shadow-sm transition-colors"
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
