import React, { useState } from 'react'

interface Props {
  selectedText: string
  onSave: (word: string, meaning: string, pronunciation: string) => void
  onCancel: () => void
}

export default function AddWordModal({ selectedText, onSave, onCancel }: Props) {
  const [word, setWord] = useState(selectedText)
  const [meaning, setMeaning] = useState('')
  const [pronunciation, setPronunciation] = useState('')
  const [errorMessage, setErrorMessage] = useState<string>('')

  const handleSave = () => {
    if (!word.trim() || !meaning.trim()) {
      setErrorMessage('Word and meaning are required')
      setTimeout(() => setErrorMessage(''), 3000)
      return
    }
    onSave(word.trim(), meaning.trim(), pronunciation.trim())
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg p-6 max-w-sm w-full">
        <h2 className="text-lg font-bold mb-4">Add Word</h2>
        {errorMessage && (
          <div className="mb-2 p-2 bg-red-100 border border-red-300 rounded text-sm text-red-700">{errorMessage}</div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">Word</label>
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">Meaning *</label>
          <textarea
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-semibold mb-2">Pronunciation (optional)</label>
          <input
            type="text"
            value={pronunciation}
            onChange={(e) => setPronunciation(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
