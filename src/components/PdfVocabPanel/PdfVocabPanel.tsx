import React, { useState, useEffect } from 'react'
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import { useNavigate } from 'react-router-dom'

interface Props {
  pdfId: string
  baseName: string
  deckCsvPath: string
}

export default function PdfVocabPanel({ pdfId, baseName, deckCsvPath }: Props) {
  const navigate = useNavigate()
  const [rowCount, setRowCount] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    const loadRowCount = async () => {
      try {
        const rows = await window.api.readCsv(deckCsvPath)
        setRowCount(rows.length)
      } catch (err) {
        console.error('Error loading vocab count:', err)
      }
    }
    loadRowCount()
  }, [deckCsvPath, refreshTrigger])

  // Listen for new words added
  const handleRefresh = () => {
    setRefreshTrigger(t => t + 1)
  }

  const handleOpenInManager = () => {
    navigate('/manager-pdf', {
      state: { pdfId, selectFile: deckCsvPath }
    })
  }

  const handleStudyDeck = () => {
    navigate('/study', {
      state: { selectedFiles: [deckCsvPath] }
    })
  }

  return (
    <ErrorBoundary>
      <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Vocab Deck</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Your vocabulary</p>
          </div>
        </div>
      </div>

      {/* Deck Info */}
      <div className="p-6 space-y-4">
        <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/30 rounded-2xl p-6 border border-violet-100 dark:border-violet-800">
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">Deck Name</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{baseName}</p>
          </div>

          <div className="pt-4 border-t border-violet-200 dark:border-violet-700">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">Total Words</p>
            <div className="flex items-center gap-3">
              <div className="text-4xl font-bold text-violet-600 dark:text-violet-400">{rowCount}</div>
              <div className="flex-1">
                <div className="h-2 bg-violet-200 dark:bg-violet-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all duration-500"
                    style={{ width: `${Math.min(100, (rowCount / 100) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Keep building your vocabulary!</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-6 space-y-3 flex-1">
        <button
          onClick={handleOpenInManager}
          className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded-xl hover:from-purple-600 hover:to-pink-700 font-medium shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Manage Vocabulary
        </button>
        <button
          onClick={handleStudyDeck}
          className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl hover:from-green-600 hover:to-emerald-700 font-medium shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Start Studying
        </button>
      </div>

      {/* Help Text */}
      <div className="p-6 mt-auto border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-violet-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            <strong className="font-semibold">Tip:</strong> Highlight text in the PDF viewer to add new words to this deck automatically.
          </p>
        </div>
      </div>
      </div>
    </ErrorBoundary>
  )
}
