import React, { useState, useEffect } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { useNavigate } from 'react-router-dom'

declare const window: any

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
      <div className="h-full flex flex-col p-4">
      <h3 className="text-lg font-bold mb-4">PDF Vocab Deck</h3>

      <div className="mb-6 p-4 bg-blue-50 rounded">
        <p className="text-sm font-semibold mb-2">Deck Name:</p>
        <p className="text-base">{baseName} vocab</p>

        <p className="text-sm font-semibold mt-4 mb-2">Total Words:</p>
        <p className="text-2xl font-bold text-blue-600">{rowCount}</p>
      </div>

      <div className="space-y-3 flex-1">
        <button
          onClick={handleOpenInManager}
          className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm"
        >
          Open in Manager PDF
        </button>
        <button
          onClick={handleStudyDeck}
          className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
        >
          Study this Deck
        </button>
      </div>

      <p className="text-xs text-gray-600 mt-4">
        Click on highlighted words in the PDF to add more words to this deck.
      </p>
      </div>
    </ErrorBoundary>
  )
}
