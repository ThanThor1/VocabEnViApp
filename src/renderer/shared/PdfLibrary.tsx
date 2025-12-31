import React from 'react'
import ErrorBoundary from './ErrorBoundary'

type PdfItem = {
  pdfId: string
  baseName: string
  deckCsvPath: string
  sourcePdfPath: string
  createdAt: string
  trashed?: boolean
}

interface Props {
  pdfs: PdfItem[]
  selectedPdfId: string | null
  onSelectPdf: (pdfId: string) => void
  onImport: () => void
  onChange?: () => void
}

export default function PdfLibrary({ pdfs, selectedPdfId, onSelectPdf, onImport, onChange }: Props) {
  const [mode, setMode] = React.useState<'library' | 'trash'>('library')
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; pdfId: string } | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string>('')

  const handleTrash = async (pdfId: string) => {
    try {
      const api: any = (window as any).api || {}
      const fn = api.pdfTrash || api.pdfDelete
      if (typeof fn !== 'function') throw new Error('pdfTrash API not available')
      await fn(pdfId)
      if (typeof onChange === 'function') onChange()
      setContextMenu(null)
    } catch (err) {
      console.error('Trash failed', err)
      setErrorMessage('Failed to move to trash')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const handleRestore = async (pdfId: string) => {
    try {
      const api: any = (window as any).api || {}
      const fn = api.pdfRestore
      if (typeof fn !== 'function') throw new Error('pdfRestore API not available')
      await fn(pdfId)
      if (typeof onChange === 'function') onChange()
      setContextMenu(null)
    } catch (err) {
      console.error('Restore failed', err)
      setErrorMessage('Failed to restore')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const handleDeletePermanent = async (pdfId: string) => {
    if (!confirm('Permanently delete this PDF? This cannot be undone.')) return
    try {
      const api: any = (window as any).api || {}
      const fn = api.pdfDeletePermanent
      if (typeof fn !== 'function') throw new Error('pdfDeletePermanent API not available')
      await fn(pdfId)
      if (typeof onChange === 'function') onChange()
      setContextMenu(null)
    } catch (err) {
      console.error('Permanent delete failed', err)
      setErrorMessage('Failed to delete permanently')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }
  return (
    <ErrorBoundary>
      <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">PDF Library</h3>
            <p className="text-xs text-gray-500">Your collection</p>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {errorMessage}
          </div>
        )}
      </div>

      {/* Mode Switcher */}
      <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('library')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mode === 'library'
                ? 'bg-gradient-to-r from-blue-500 to-cyan-600 text-white shadow-md'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              Library
            </div>
          </button>
          <button
            onClick={() => setMode('trash')}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mode === 'trash'
                ? 'bg-gradient-to-r from-red-500 to-pink-600 text-white shadow-md'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Trash
            </div>
          </button>
        </div>
      </div>

      {/* Import Button */}
      <div className="px-6 py-4 border-b border-gray-200">
        <button
          onClick={onImport}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Import PDF
        </button>
      </div>

      {/* PDF List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {pdfs.filter((p) => (mode === 'trash') === !!(p as any).trashed).length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium">No PDFs</p>
            <p className="text-xs mt-1">Import a PDF to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pdfs
              .filter((p) => (mode === 'trash') === !!(p as any).trashed)
              .map((pdf) => (
                <div
                  key={pdf.pdfId}
                  onClick={() => {
                    if (mode === 'library') onSelectPdf(pdf.pdfId)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, pdfId: pdf.pdfId })
                  }}
                  className={`p-4 rounded-xl cursor-pointer transition-all ${
                    selectedPdfId === pdf.pdfId && mode === 'library'
                      ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg transform scale-[1.02]'
                      : 'bg-gray-50 hover:bg-gray-100 border border-gray-200'
                  }`}
                  title={pdf.baseName}
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-5 h-5 flex-shrink-0 ${
                        selectedPdfId === pdf.pdfId && mode === 'library' ? 'text-white' : 'text-gray-600'
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{pdf.baseName}</div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-2xl text-sm overflow-hidden"
            onMouseLeave={() => setContextMenu(null)}
          >
            <div className="py-1">
              {mode === 'library' ? (
                <button
                  className="w-full px-4 py-2.5 hover:bg-red-50 text-left text-red-600 font-semibold flex items-center gap-2"
                  onClick={() => handleTrash(contextMenu.pdfId)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Move to Trash
                </button>
              ) : (
                <>
                  <button
                    className="w-full px-4 py-2.5 hover:bg-green-50 text-left text-green-600 font-semibold flex items-center gap-2"
                    onClick={() => handleRestore(contextMenu.pdfId)}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                    Restore
                  </button>
                  <button
                    className="w-full px-4 py-2.5 hover:bg-red-50 text-left text-red-600 font-semibold flex items-center gap-2 border-t border-gray-200"
                    onClick={() => handleDeletePermanent(contextMenu.pdfId)}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Delete Permanently
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
    </ErrorBoundary>
  )
}
