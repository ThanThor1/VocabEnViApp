import React, { useState, useEffect } from 'react';
import { POS_OPTIONS } from '../posOptions/posOptions'

type Props = {
  word: string;
  meaning: string;
  pronunciation: string;
  pos: string;
  onClose: () => void;
  example?: string;
  onSave: (word: string, meaning: string, pronunciation: string, pos: string, example: string) => void;
};

export default function EditWordModal({ word, meaning, pronunciation, pos, example, onClose, onSave }: Props) {
  const [editWord, setEditWord] = useState(word);
  const [editMeaning, setEditMeaning] = useState(meaning);
  const [editExample, setEditExample] = useState(example || '');
  const [editPronunciation, setEditPronunciation] = useState(pronunciation);
  const [editPos, setEditPos] = useState(pos || '');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setEditWord(word);
    setEditMeaning(meaning);
    setEditExample(example || '');
    setEditPronunciation(pronunciation);
    setEditPos(pos || '');
    setErrorMessage('');
  }, [word, meaning, pronunciation, pos, example]);

  function handleSave() {
    if (!editWord.trim()) {
      setErrorMessage('Word cannot be empty');
      return;
    }
    if (!editPos.trim()) {
      setErrorMessage('Part of speech is required');
      return;
    }
    onSave(editWord.trim(), editMeaning.trim(), editPronunciation.trim(), editPos.trim(), editExample.trim());
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
    <div className="modal-backdrop">
      <div className="modal-content max-w-2xl">
        {/* Header */}
        <div className="modal-header bg-gradient-to-r from-violet-500 to-purple-600 dark:from-violet-600 dark:to-purple-700">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white">Edit Vocabulary</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4" onKeyDown={handleKeyDown}>
          {errorMessage && (
            <div className="alert-error animate-slide-up">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}
          {/* Word */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
              </svg>
              Word *
            </label>
            <input
              type="text"
              value={editWord}
              onChange={(e) => {
                setErrorMessage('');
                setEditWord(e.target.value);
              }}
              className="input-field w-full"
              placeholder="Enter word..."
              autoFocus
            />
          </div>

          {/* Meaning */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
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

          {/* Example */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8m-8 4h6m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h6l4 4v15a2 2 0 01-2 2z" />
              </svg>
              Example sentence
              <span className="text-xs text-slate-400 dark:text-slate-500">(optional)</span>
            </label>
            <textarea
              value={editExample}
              onChange={(e) => setEditExample(e.target.value)}
              className="input-field w-full"
              placeholder="Optional: a memorable English sentence using the word"
              rows={2}
            />
          </div>

          {/* POS */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h4m-4 5h10" />
              </svg>
              Part of Speech *
            </label>
            <select
              value={editPos}
              onChange={(e) => {
                setErrorMessage('');
                setEditPos(e.target.value);
              }}
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
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Press Ctrl+Enter to save, Esc to cancel
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn-primary"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
