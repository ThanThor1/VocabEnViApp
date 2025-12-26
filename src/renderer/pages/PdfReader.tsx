import React, { useState, useEffect } from 'react'
import ErrorBoundary from '../shared/ErrorBoundary'
import PdfLibrary from '../shared/PdfLibrary'
import PdfViewer from '../shared/PdfViewer'
import PdfVocabPanel from '../shared/PdfVocabPanel'

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
  const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string>('')

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
      <div className="flex h-full gap-4">
      {errorMessage && (
        <div className="absolute left-0 right-0 top-0 p-2 bg-red-100 border border-red-300 rounded text-sm text-red-700 m-4 z-40">{errorMessage}</div>
      )}
      {/* Left: PDF Library */}
      <div className="w-64 border-r overflow-y-auto">
        <PdfLibrary
          pdfs={pdfs}
          selectedPdfId={selectedPdfId}
          onSelectPdf={setSelectedPdfId}
          onImport={handleImportPdf}
          onChange={() => setRefreshKey(k => k + 1)}
        />
      </div>

      {/* Center: PDF Viewer */}
      <div className="flex-1 flex flex-col">
        {selectedPdf ? (
          <PdfViewer pdfId={selectedPdf.pdfId} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg mb-4">No PDF selected</p>
              <button
                onClick={handleImportPdf}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Import PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: Vocab Panel */}
      {selectedPdf && (
        <div className="w-72 border-l overflow-y-auto">
          <PdfVocabPanel
            pdfId={selectedPdf.pdfId}
            baseName={selectedPdf.baseName}
            deckCsvPath={selectedPdf.deckCsvPath}
          />
        </div>
      )}
      </div>
    </ErrorBoundary>
  )
}
