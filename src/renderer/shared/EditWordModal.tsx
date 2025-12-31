import React, { useState, useEffect } from 'react';
import { POS_OPTIONS } from './posOptions';

type Props = {
  word: string;
  meaning: string;
  pronunciation: string;
  pos: string;
  onClose: () => void;
  onSave: (word: string, meaning: string, pronunciation: string, pos: string) => void;
};

export default function EditWordModal({ word, meaning, pronunciation, pos, onClose, onSave }: Props) {
  const [editWord, setEditWord] = useState(word);
  const [editMeaning, setEditMeaning] = useState(meaning);
  const [editPronunciation, setEditPronunciation] = useState(pronunciation);
  const [editPos, setEditPos] = useState(pos || '');

  useEffect(() => {
    setEditWord(word);
    setEditMeaning(meaning);
    setEditPronunciation(pronunciation);
    setEditPos(pos || '');
  }, [word, meaning, pronunciation, pos]);

  function handleSave() {
    if (!editWord.trim()) {
      alert('Word cannot be empty');
      return;
    }
    if (!editPos.trim()) {
      alert('Part of speech is required');
      return;
    }
    onSave(editWord.trim(), editMeaning.trim(), editPronunciation.trim(), editPos.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Allow Enter in textarea (meaning field)
    if (e.key === 'Enter' && e.currentTarget === e.target && e.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 animate-slideIn">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-6 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white bg-opacity-20 rounded-lg backdrop-blur-sm">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white">Edit Vocabulary</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4" onKeyDown={handleKeyDown}>
          {/* Word */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
              </svg>
              Word *
            </label>
            <input
              type="text"
              value={editWord}
              onChange={(e) => setEditWord(e.target.value)}
              className="input-field w-full"
              placeholder="Enter word..."
              autoFocus
            />
          </div>

          {/* Meaning */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Meaning
            </label>
            <textarea
              value={editMeaning}
              onChange={(e) => setEditMeaning(e.target.value)}
              className="input-field w-full"
              placeholder="Enter meaning..."
              rows={3}
            />
          </div>

          {/* POS */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h4m-4 5h10" />
              </svg>
              Part of Speech *
            </label>
            <select
              value={editPos}
              onChange={(e) => setEditPos(e.target.value)}
              className="input-field w-full"
            >
              <option value="">Select POS...</option>
              {POS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* IPA */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              IPA (Pronunciation)
            </label>
            <input
              type="text"
              value={editPronunciation}
              onChange={(e) => setEditPronunciation(e.target.value)}
              className="input-field w-full font-mono"
              placeholder="e.g. həˈloʊ"
            />
          </div>

          <div className="text-xs text-gray-500 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Press Ctrl+Enter to save, Esc to cancel
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-semibold text-gray-700 bg-white border-2 border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
