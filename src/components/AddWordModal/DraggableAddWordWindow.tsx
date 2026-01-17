import React, { useEffect, useMemo, useRef, useState } from 'react'
import { POS_OPTIONS, normalizePos } from '../posOptions/posOptions'

interface Props {
  windowId: string
  selectedText: string
  contextSentenceEn: string
  onSave: (word: string, meaning: string, pronunciation: string, pos: string, example: string) => void
  onClose: () => void
  initialPosition?: { x: number; y: number }
  onDragStateChange?: (dragging: boolean) => void
}

type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] }

type AutoMeaningResponse = {
  requestId: string
  word: string
  meaningSuggested: string
  contextSentenceVi: string
  candidates: AutoMeaningCandidate[]
}

export default function DraggableAddWordWindow({
  windowId,
  selectedText,
  contextSentenceEn,
  onSave,
  onClose,
  initialPosition,
  onDragStateChange
}: Props) {
  const [word, setWord] = useState(selectedText)
  const [meaning, setMeaning] = useState('')
  const [example, setExample] = useState('')
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

  const [exampleLoading, setExampleLoading] = useState(false)
  const [exampleError, setExampleError] = useState('')
  const isExampleDirtyRef = useRef(false)
  const lastExampleKeyRef = useRef<string>('')

  const cleanWord = useMemo(() => word.trim(), [word])
  const cleanContextEn = useMemo(() => (contextSentenceEn || '').trim(), [contextSentenceEn])

  // Dragging state
  const [position, setPosition] = useState(initialPosition || { x: 100, y: 100 })
  const [isDragging, setIsDragging] = useState(false)
  const positionRef = useRef(position)
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, startX: 0, startY: 0 })
  const isDraggingRef = useRef(false)
  const windowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    positionRef.current = position
  }, [position])

  const ensureIpaSlashes = (val: string) => {
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
      // ignore
    }
  }

  // Auto-fetch meaning, IPA, example in parallel
  useEffect(() => {
    if (!cleanWord) return
    let cancelled = false

    const fetchAllInParallel = async () => {
      setIpaLoading(true)
      setMeaningLoading(true)
      setMeaningError('')

      await cancelPendingAutoMeaning()
      const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
      lastRequestIdRef.current = requestId

      const results = await Promise.allSettled([
        // 1. IPA
        (async () => {
          const suggestIpa = (window as any)?.api?.suggestIpa
          if (suggestIpa) {
            const out = await suggestIpa({ word: cleanWord, dialect: 'US' })
            if (String(out || '').trim()) return { type: 'ipa', value: ensureIpaSlashes(String(out || '')) }
          }
          const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`)
          if (resp.ok) {
            const data = await resp.json()
            if (Array.isArray(data) && data[0]?.phonetics?.length > 0) {
              const ph = data[0].phonetics.find((p: any) => p.text)
              if (ph?.text) return { type: 'ipa', value: ensureIpaSlashes(ph.text) }
            }
          }
          return { type: 'ipa', value: '' }
        })(),

        // 2. Auto meaning
        (async () => {
          if (isMeaningDirtyRef.current) return { type: 'meaning', value: null }
          if (!(window as any)?.api?.autoMeaning) return { type: 'meaning', value: null }

          const resp: AutoMeaningResponse = await (window as any).api.autoMeaning({
            requestId,
            word: cleanWord,
            contextSentenceEn: cleanContextEn,
            from: 'en',
            to: 'vi'
          })

          if (!resp || resp.requestId !== requestId) return { type: 'meaning', value: null }
          return { type: 'meaning', value: resp }
        })()
      ])

      if (cancelled) return

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const data = result.value as any

          if (data.type === 'ipa' && data.value && !cancelled) {
            setPronunciation(data.value)
          }

          if (data.type === 'meaning' && data.value && !cancelled) {
            const resp = data.value as AutoMeaningResponse
            const suggested = (resp.meaningSuggested || '').trim()
            if (suggested && !isMeaningDirtyRef.current) {
              setMeaning(suggested)

              if (!isExampleDirtyRef.current && (window as any)?.api?.suggestExampleSentence) {
                const exampleKey = `${cleanWord}__${suggested}`.toLowerCase()
                if (lastExampleKeyRef.current !== exampleKey) {
                  lastExampleKeyRef.current = exampleKey
                  setExampleError('')
                  setExampleLoading(true)
                  ;(async () => {
                    try {
                      const out = await (window as any).api.suggestExampleSentence({
                        word: cleanWord,
                        meaningVi: suggested,
                        pos,
                        contextSentenceEn: cleanContextEn
                      })
                      if (!cancelled && !isExampleDirtyRef.current && String(out || '').trim()) {
                        setExample(String(out || '').trim())
                      }
                    } catch (e) {
                      if (!cancelled) setExampleError('Failed to suggest example')
                    } finally {
                      if (!cancelled) setExampleLoading(false)
                    }
                  })()
                }
              }
            }
            setMeaningCandidates(Array.isArray(resp.candidates) ? resp.candidates : [])
            setContextVi((resp.contextSentenceVi || '').trim())

            if (!isPosDirtyRef.current) {
              const firstWithPos = (Array.isArray(resp.candidates) ? resp.candidates : []).find((c) => c && c.pos)
              const normalized = normalizePos(firstWithPos?.pos)
              if (normalized) setPos(normalized)
            }
          }
        }
      }

      if (!cancelled) {
        setIpaLoading(false)
        setMeaningLoading(false)
      }
    }

    fetchAllInParallel().catch((e) => {
      if (!cancelled) {
        setMeaningError('Failed to fetch suggestions')
        setIpaLoading(false)
        setMeaningLoading(false)
      }
    })

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
    onSave(word.trim(), meaning.trim(), ensureIpaSlashes(pronunciation), pos.trim(), example.trim())
  }

  // Dragging handlers (Pointer Events + pointer capture)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (!windowRef.current) return

    const p = positionRef.current
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: p.x,
      startY: p.y
    }
    isDraggingRef.current = true
    setIsDragging(true)

    try {
      ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
    } catch (err) {
      // ignore
    }

    onDragStateChange?.(true)
    e.preventDefault()
    e.stopPropagation()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const start = dragStartRef.current
    const dx = e.clientX - start.pointerX
    const dy = e.clientY - start.pointerY
    setPosition({ x: start.startX + dx, y: start.startY + dy })
    e.preventDefault()
    e.stopPropagation()
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)
    try {
      ;(e.currentTarget as any).releasePointerCapture?.(e.pointerId)
    } catch (err) {
      // ignore
    }
    onDragStateChange?.(false)
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    return () => {
      // safety: if the window is closed while dragging, re-enable PDF interactions
      if (isDragging) onDragStateChange?.(false)
    }
  }, [isDragging, onDragStateChange])

  return (
    <div
      ref={windowRef}
      className="fixed bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 border border-slate-200 dark:border-slate-700 z-50"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '420px',
        maxHeight: '85vh',
        overflow: 'auto',
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
      {/* Draggable Header */}
      <div
        className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none', userSelect: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-violet-600 rounded-lg flex items-center justify-center shadow-md">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Add Word</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">#{windowId.slice(-4)}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {errorMessage && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Compact Form */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Word</label>
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
            placeholder="Enter word..."
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Part of Speech <span className="text-red-500">*</span>
          </label>
          <select
            value={pos}
            onChange={(e) => {
              isPosDirtyRef.current = true
              setPos(e.target.value)
            }}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
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
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Meaning <span className="text-red-500">*</span>
            {meaningLoading && <span className="text-[9px] text-violet-500 ml-1">Suggesting...</span>}
          </label>
          <textarea
            value={meaning}
            onChange={(e) => {
              isMeaningDirtyRef.current = true
              setMeaning(e.target.value)
            }}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
            placeholder="What does it mean?"
          />

          {meaningError && !meaningLoading && (
            <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">{meaningError}</div>
          )}

          {contextVi && (
            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold">Context:</span> {contextVi}
            </div>
          )}

          {meaningCandidates.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Suggestions</div>
              <div className="flex flex-wrap gap-1">
                {meaningCandidates.slice(0, 6).map((c, idx) => (
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

                      void (async () => {
                        try {
                          if (isExampleDirtyRef.current) return
                          if (!(window as any)?.api?.suggestExampleSentence) return
                          const key = `${cleanWord}__${c.vi}`.toLowerCase()
                          if (lastExampleKeyRef.current === key) return
                          lastExampleKeyRef.current = key
                          setExampleError('')
                          setExample('')
                          setExampleLoading(true)
                          const out = await (window as any).api.suggestExampleSentence({
                            word: cleanWord,
                            meaningVi: c.vi,
                            pos: c.pos || pos,
                            contextSentenceEn: cleanContextEn
                          })
                          if (!isExampleDirtyRef.current && String(out || '').trim()) {
                            setExample(String(out || '').trim())
                          }
                        } catch {
                          setExampleError('Failed to suggest example')
                        } finally {
                          setExampleLoading(false)
                        }
                      })()
                    }}
                    className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[10px] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
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
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Example
            {exampleLoading && <span className="text-[9px] text-violet-500 ml-1">Generating…</span>}
          </label>
          <textarea
            value={example}
            onChange={(e) => {
              isExampleDirtyRef.current = true
              setExample(e.target.value)
            }}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
            placeholder="Optional example sentence"
          />
          {exampleError && <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">{exampleError}</div>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Pronunciation
            {ipaLoading && <span className="text-[9px] text-violet-500 ml-1">Fetching...</span>}
          </label>
          <input
            type="text"
            value={pronunciation}
            onChange={(e) => setPronunciation(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
            placeholder="/prəˌnʌnsiˈeɪʃən/"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 justify-end mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-slate-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Save
        </button>
      </div>
    </div>
  )
}
