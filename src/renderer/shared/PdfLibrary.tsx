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
      <div className="h-full flex flex-col p-4">
      <h3 className="text-lg font-bold mb-4">PDF Library</h3>
      {errorMessage && (
        <div className="mb-2 p-2 bg-red-100 border border-red-300 rounded text-sm text-red-700">{errorMessage}</div>
      )}

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setMode('library')}
          className={`flex-1 px-3 py-2 rounded text-sm ${mode === 'library' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>
          Library
        </button>
        <button
          onClick={() => setMode('trash')}
          className={`px-3 py-2 rounded text-sm ${mode === 'trash' ? 'bg-red-500 text-white' : 'bg-gray-200'}`}>
          Trash
        </button>
      </div>

      <button
        onClick={onImport}
        className="mb-4 w-full px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
      >
        Import PDF
      </button>

      <div className="flex-1 overflow-y-auto">
        {pdfs.filter(p => (mode === 'trash') === !!(p as any).trashed).length === 0 ? (
          <p className="text-sm text-gray-500">No PDFs</p>
        ) : (
          <div className="space-y-2">
            {pdfs.filter(p => (mode === 'trash') === !!(p as any).trashed).map(pdf => (
              <div
                key={pdf.pdfId}
                onClick={() => { if (mode === 'library') onSelectPdf(pdf.pdfId) }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, pdfId: pdf.pdfId })
                }}
                className={`p-3 rounded text-sm cursor-pointer truncate ${
                  selectedPdfId === pdf.pdfId ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300'
                }`}
                title={pdf.baseName}
              >
                {pdf.baseName}
              </div>
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <>
          <div
            className="fixed inset-0"
            onClick={() => setContextMenu(null)}
          />
          <div
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="fixed z-50 bg-white border rounded shadow-lg text-sm"
            onMouseLeave={() => setContextMenu(null)}
          >
            <div className="flex flex-col p-1">
              {mode === 'library' ? (
                <button
                  className="px-3 py-2 hover:bg-gray-100 text-left text-red-600 font-semibold"
                  onClick={() => handleTrash(contextMenu.pdfId)}
                >
                  Move to Trash
                </button>
              ) : (
                <>
                  <button
                    className="px-3 py-2 hover:bg-gray-100 text-left text-green-600"
                    onClick={() => handleRestore(contextMenu.pdfId)}
                  >
                    Undo (Restore)
                  </button>
                  <button
                    className="px-3 py-2 hover:bg-gray-100 text-left text-red-600"
                    onClick={() => handleDeletePermanent(contextMenu.pdfId)}
                  >
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
