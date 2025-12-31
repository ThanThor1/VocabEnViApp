import React, { useEffect, useMemo, useRef, useState } from 'react'
import { POS_OPTIONS, normalizePos } from './posOptions'

interface Props {
  selectedText: string
  contextSentenceEn: string
  onSave: (word: string, meaning: string, pronunciation: string, pos: string) => void
  onCancel: () => void
}

type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] }

type AutoMeaningResponse = {
  requestId: string
  word: string
  meaningSuggested: string
  contextSentenceVi: string
  candidates: AutoMeaningCandidate[]
}

export default function AddWordModal({ selectedText, contextSentenceEn, onSave, onCancel }: Props) {
  const [word, setWord] = useState(selectedText)
  const [meaning, setMeaning] = useState('')
  const [pronunciation, setPronunciation] = useState('')
  const [pos, setPos] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [ipaLoading, setIpaLoading] = useState(false)

  const [meaningLoading, setMeaningLoading] = useState(false)
  const [meaningError, setMeaningError] = useState<string>('')
  const [meaningCandidates, setMeaningCandidates] = useState<AutoMeaningCandidate[]>([])
  const [contextVi, setContextVi] = useState('')
  const isMeaningDirtyRef = useRef(false)
  const isPosDirtyRef = useRef(false)
  const lastRequestIdRef = useRef<string | null>(null)

  const cleanWord = useMemo(() => word.trim(), [word])
  const cleanContextEn = useMemo(() => (contextSentenceEn || '').trim(), [contextSentenceEn])

  const ensureIpaSlashes = (val: string) => {
    // Trim, drop stray quotes, then wrap once with slashes for IPA
    const v = (val || '').trim().replace(/"/g, '')
    if (!v) return ''
    const core = v.replace(/^\/+|\/+$/g, '')
    return `/${core}/`
  }

  const cancelPendingAutoMeaning = async () => {
    const rid = lastRequestIdRef.current
    if (!rid) return
    lastRequestIdRef.current = null
    try {
      if ((window as any)?.api?.autoMeaningCancel) {
        await (window as any).api.autoMeaningCancel(rid)
      }
    } catch (e) {
    }
  }

  // auto-fetch IPA when word changes
  useEffect(() => {
    const w = word.trim()
    if (!w) return
    let cancelled = false
    const fetchIPA = async () => {
      try {
        setIpaLoading(true)
        const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)
        if (!resp.ok) return
        const data = await resp.json()
        if (!Array.isArray(data) || data.length === 0) return
        const entry = data[0]
        const ph = entry.phonetics?.find((p: any) => p.text)
        if (ph?.text && !cancelled) {
          setPronunciation(ensureIpaSlashes(ph.text))
        }
      } catch (e) {
        // silent
      } finally {
        if (!cancelled) setIpaLoading(false)
      }
    }
    fetchIPA()
    return () => { cancelled = true }
  }, [word])

  // auto meaning suggestion (context-aware)
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        setMeaningError('')
        if (!cleanWord) return
        if (isMeaningDirtyRef.current) return
        if (!(window as any)?.api?.autoMeaning) return

        await cancelPendingAutoMeaning()

        const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
        lastRequestIdRef.current = requestId
        setMeaningLoading(true)

        const resp: AutoMeaningResponse = await (window as any).api.autoMeaning({
          requestId,
          word: cleanWord,
          contextSentenceEn: cleanContextEn,
          from: 'en',
          to: 'vi'
        })

        if (cancelled) return
        if (!resp || resp.requestId !== requestId) return
        if (isMeaningDirtyRef.current) return

        const suggested = (resp.meaningSuggested || '').trim()
        if (suggested) setMeaning(suggested)
        setMeaningCandidates(Array.isArray(resp.candidates) ? resp.candidates : [])
        setContextVi((resp.contextSentenceVi || '').trim())

        // Try to auto-select POS if API provides it, without overriding user selection.
        if (!isPosDirtyRef.current) {
          const firstWithPos = (Array.isArray(resp.candidates) ? resp.candidates : []).find((c) => c && c.pos)
          const normalized = normalizePos(firstWithPos?.pos)
          if (normalized) setPos(normalized)
        }
      } catch (e: any) {
        if (cancelled) return
        if (e && e.name === 'AbortError') return
        setMeaningError('Failed to auto-suggest meaning')
      } finally {
        if (!cancelled) setMeaningLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
      cancelPendingAutoMeaning()
    }
  }, [cleanWord, cleanContextEn])

  const handleSave = () => {
    if (!word.trim() || !meaning.trim() || !pos.trim()) {
      setErrorMessage('Word, meaning, and POS are required')
      setTimeout(() => setErrorMessage(''), 3000)
      return
    }
    onSave(word.trim(), meaning.trim(), ensureIpaSlashes(pronunciation), pos.trim())
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full modal-content border border-gray-100">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Add New Word</h2>
              <p className="text-xs text-gray-500">Build your vocabulary</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form Fields */}
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              Word
            </label>
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              className="input-field bg-gray-50 font-medium text-gray-900"
              placeholder="Enter the word..."
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h4m-4 5h10" />
              </svg>
              Part of Speech
              <span className="text-red-500">*</span>
            </label>
            <select
              value={pos}
              onChange={(e) => {
                isPosDirtyRef.current = true
                setPos(e.target.value)
              }}
              className="input-field bg-gray-50"
            >
              <option value="">Select POS...</option>
              {POS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Meaning
              <span className="text-red-500">*</span>
            </label>
            <textarea
              value={meaning}
              onChange={(e) => {
                isMeaningDirtyRef.current = true
                setMeaning(e.target.value)
              }}
              rows={3}
              className="input-field bg-gray-50 resize-none"
              placeholder="What does it mean?"
            />

            {(meaningLoading || meaningError) && (
              <div className="mt-2 text-xs">
                {meaningLoading && <span className="text-blue-600">Suggesting meaning...</span>}
                {!meaningLoading && meaningError && <span className="text-red-600">{meaningError}</span>}
              </div>
            )}

            {contextVi && (
              <div className="mt-2 text-xs text-gray-500">
                <div className="font-semibold text-gray-600">Context (VI)</div>
                <div className="mt-1">{contextVi}</div>
              </div>
            )}

            {meaningCandidates.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-600 mb-2">Other suggestions</div>
                <div className="flex flex-wrap gap-2">
                  {meaningCandidates.slice(0, 8).map((c, idx) => (
                    <button
                      key={`${c.vi}_${idx}`}
                      type="button"
                      onClick={() => {
                        isMeaningDirtyRef.current = true
                        setMeaning(c.vi)
                        if (!isPosDirtyRef.current) {
                          const normalized = normalizePos(c.pos)
                          if (normalized) setPos(normalized)
                        }
                      }}
                      className="px-3 py-1 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 hover:bg-gray-50"
                      title={(c.back && c.back.length > 0) ? c.back.join(', ') : ''}
                    >
                      {c.vi}{c.pos ? ` (${c.pos})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Pronunciation
              <span className="text-xs text-gray-400">(auto-fills if available)</span>
              {ipaLoading && <span className="text-[10px] text-blue-500">Fetching...</span>}
            </label>
            <input
              type="text"
              value={pronunciation}
              onChange={(e) => setPronunciation(e.target.value)}
              className="input-field bg-gray-50"
              placeholder="/prəˌnʌnsiˈeɪʃən/"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end mt-8 pt-6 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="btn-secondary px-6"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn-primary px-6 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Save Word
          </button>
        </div>
      </div>
    </div>
  )
}
