import React, { useEffect, useMemo, useRef, useState } from 'react'
import { POS_OPTIONS, normalizePos } from '../posOptions/posOptions'
import { countSaveableFamilyMembers, enrichWordFamilyMembers, getWordFamily, type EnrichedWordFamilyMember } from '../../utils/wordFamily'
import { enrichSynonyms, getSynonymFamilies, getSynonyms } from '../../utils/synonyms'

interface Props {
  windowId: string
  selectedText: string
  contextSentenceEn: string
  onSave: (word: string, meaning: string, meaningNoteVi: string, pronunciation: string, pos: string, example: string) => void
  onClose: () => void
  initialPosition?: { x: number; y: number }
  onDragStateChange?: (dragging: boolean) => void
}

type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] }

type AutoMeaningResponse = {
  requestId: string
  word: string
  meaningSuggested: string
  meaningNoteVi?: string
  meaningNoteVie?: string
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
  const WORD_FAMILY_FEATURE_ENABLED = false
  const SYNONYM_FAMILIES_FEATURE_ENABLED = false

  const [word, setWord] = useState(selectedText)
  const [meaning, setMeaning] = useState('')
  const [meaningNoteVi, setMeaningNoteVi] = useState('')
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

  const [wordFamilyEnabled, setWordFamilyEnabled] = useState(false)
  const [wordFamilyLoading, setWordFamilyLoading] = useState(false)
  const [wordFamilyError, setWordFamilyError] = useState('')
  const [wordFamilyMembers, setWordFamilyMembers] = useState<EnrichedWordFamilyMember[]>([])
  const [wordFamilySelected, setWordFamilySelected] = useState<Set<string>>(new Set())
  const wordFamilyReqRef = useRef<string>('')

  const [synonymsEnabled, setSynonymsEnabled] = useState(true)
  const [synonymsIncludeFamilies, setSynonymsIncludeFamilies] = useState(false)
  const [synonymsLoading, setSynonymsLoading] = useState(false)
  const [synonymsError, setSynonymsError] = useState('')
  const [synonymsMembers, setSynonymsMembers] = useState<EnrichedWordFamilyMember[]>([])
  const [synonymsSelected, setSynonymsSelected] = useState<Set<string>>(new Set())
  const [synonymFamilyMembers, setSynonymFamilyMembers] = useState<EnrichedWordFamilyMember[]>([])
  const [synonymFamilySelected, setSynonymFamilySelected] = useState<Set<string>>(new Set())
  const synonymsReqRef = useRef<string>('')

  const [relatedEditTarget, setRelatedEditTarget] = useState<
    | { group: 'family'; word: string }
    | { group: 'synonym'; word: string }
    | { group: 'synonymFamily'; word: string }
    | null
  >(null)

  const wordFamilySaveableCount = useMemo(() => countSaveableFamilyMembers(wordFamilyMembers), [wordFamilyMembers])
  const wordFamilySelectedSaveableCount = useMemo(() => {
    const sel = wordFamilySelected
    return (Array.isArray(wordFamilyMembers) ? wordFamilyMembers : []).filter((m) => {
      const w = String(m?.word || '').trim()
      if (!w || !sel.has(w)) return false
      const meaning = String(m?.meaning || '').trim()
      const pos = String(m?.pos || '').trim()
      return !!meaning && !!pos
    }).length
  }, [wordFamilyMembers, wordFamilySelected])

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
            const resp = data.value as any
            const suggested = (resp.meaningSuggested || '').trim()
            const note = String((resp as any).meaningNoteVie || (resp as any).meaningNoteVi || '').trim()
            if (suggested && !isMeaningDirtyRef.current) {
              setMeaning(suggested)
              if (note) setMeaningNoteVi(note)

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
              const firstWithPos = (Array.isArray(resp.candidates) ? resp.candidates : []).find((c: any) => c && c.pos)
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

  // Word Family: fetch + enrich in background
  useEffect(() => {
    if (!WORD_FAMILY_FEATURE_ENABLED || !wordFamilyEnabled) {
      setWordFamilyMembers([])
      setWordFamilySelected(new Set())
      setWordFamilyLoading(false)
      setWordFamilyError('')
      return
    }
    const w = cleanWord
    const api = (window as any)?.api
    if (!w || /\s/.test(w) || w.length > 40) {
      setWordFamilyMembers([])
      setWordFamilySelected(new Set())
      setWordFamilyLoading(false)
      setWordFamilyError('')
      return
    }
    if (!api?.getWordFamily) {
      setWordFamilyMembers([])
      setWordFamilySelected(new Set())
      setWordFamilyLoading(false)
      setWordFamilyError('')
      return
    }

    const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    wordFamilyReqRef.current = rid
    setWordFamilyLoading(true)
    setWordFamilyError('')
    setWordFamilyMembers([])
    setWordFamilySelected(new Set())

    ;(async () => {
      try {
        const resp = await getWordFamily(w)
        if (wordFamilyReqRef.current !== rid) return
        const members = Array.isArray(resp?.family) ? resp!.family : []
        const enriched = await enrichWordFamilyMembers(members, { concurrency: 2, contextSentenceEn: cleanContextEn })
        if (wordFamilyReqRef.current !== rid) return
        setWordFamilyMembers(enriched)
        setWordFamilySelected(new Set(enriched.map((m) => m.word)))
      } catch {
        if (wordFamilyReqRef.current !== rid) return
        setWordFamilyError('Failed to fetch word family')
        setWordFamilyMembers([])
        setWordFamilySelected(new Set())
      } finally {
        if (wordFamilyReqRef.current === rid) setWordFamilyLoading(false)
      }
    })()

    return () => {
      if (wordFamilyReqRef.current === rid) wordFamilyReqRef.current = ''
    }
  }, [cleanWord, cleanContextEn, wordFamilyEnabled])

  // Synonyms: fetch + enrich in background (and optionally fetch synonym families)
  useEffect(() => {
    const w = cleanWord
    const api = (window as any)?.api
    if (!synonymsEnabled) {
      setSynonymsMembers([])
      setSynonymsSelected(new Set())
      setSynonymFamilyMembers([])
      setSynonymFamilySelected(new Set())
      setSynonymsLoading(false)
      setSynonymsError('')
      return
    }
    if (!w || /\s/.test(w) || w.length > 40) {
      setSynonymsMembers([])
      setSynonymsSelected(new Set())
      setSynonymFamilyMembers([])
      setSynonymFamilySelected(new Set())
      setSynonymsLoading(false)
      setSynonymsError('')
      return
    }
    if (!api?.getSynonyms) {
      setSynonymsMembers([])
      setSynonymsSelected(new Set())
      setSynonymFamilyMembers([])
      setSynonymFamilySelected(new Set())
      setSynonymsLoading(false)
      setSynonymsError('')
      return
    }

    const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    synonymsReqRef.current = rid
    setSynonymsLoading(true)
    setSynonymsError('')
    setSynonymsMembers([])
    setSynonymsSelected(new Set())
    setSynonymFamilyMembers([])
    setSynonymFamilySelected(new Set())

    ;(async () => {
      try {
        const resp = await getSynonyms(w)
        if (synonymsReqRef.current !== rid) return
        const members = Array.isArray(resp?.synonyms) ? resp!.synonyms : []
        const enriched = await enrichSynonyms(members, { concurrency: 2, contextSentenceEn: cleanContextEn })
        if (synonymsReqRef.current !== rid) return
        setSynonymsMembers(enriched)
        setSynonymsSelected(new Set(enriched.map((m) => m.word)))

        if (SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies && api?.getWordFamily) {
          const fam = await getSynonymFamilies(enriched, { maxSynonyms: 3, contextSentenceEn: cleanContextEn })
          if (synonymsReqRef.current !== rid) return
          const famEnriched = await enrichSynonyms(fam, { concurrency: 2, contextSentenceEn: cleanContextEn })
          if (synonymsReqRef.current !== rid) return
          setSynonymFamilyMembers(famEnriched)
          setSynonymFamilySelected(new Set(famEnriched.map((m) => m.word)))
        }
      } catch {
        if (synonymsReqRef.current !== rid) return
        setSynonymsError('Failed to fetch synonyms')
        setSynonymsMembers([])
        setSynonymsSelected(new Set())
        setSynonymFamilyMembers([])
        setSynonymFamilySelected(new Set())
      } finally {
        if (synonymsReqRef.current === rid) setSynonymsLoading(false)
      }
    })()

    return () => {
      if (synonymsReqRef.current === rid) synonymsReqRef.current = ''
    }
  }, [cleanWord, cleanContextEn, synonymsEnabled, synonymsIncludeFamilies])

  const handleSave = () => {
    if (!word.trim() || !meaning.trim() || !pos.trim()) {
      setErrorMessage('Word, meaning, and POS are required')
      setTimeout(() => setErrorMessage(''), 3000)
      return
    }
    const baseWord = word.trim()
    const baseMeaning = meaning.trim()
    const baseMeaningNote = meaningNoteVi.trim()
    const basePos = pos.trim()
    const basePron = ensureIpaSlashes(pronunciation)
    const baseExample = example.trim()

    const saved = new Set<string>()
    saved.add(baseWord.toLowerCase())

    onSave(baseWord, baseMeaning, baseMeaningNote, basePron, basePos, baseExample)

    if (wordFamilyEnabled && wordFamilySelected.size > 0) {
      for (const m of wordFamilyMembers) {
        const mw = String(m?.word || '').trim()
        if (!mw || !wordFamilySelected.has(mw)) continue
        const key = mw.toLowerCase()
        if (saved.has(key)) continue
        const mm = String(m?.meaning || '').trim()
        const mp = String(m?.pos || '').trim()
        if (!mm || !mp) continue
        const mn = String((m as any)?.meaningNoteVi || '').trim()
        const pr = ensureIpaSlashes(String(m?.pronunciation || ''))
        const ex = String(m?.example || '').trim()
        onSave(mw, mm, mn, pr, mp, ex)
        saved.add(key)
      }
    }

    if (synonymsEnabled && synonymsSelected.size > 0) {
      for (const m of synonymsMembers) {
        const mw = String(m?.word || '').trim()
        if (!mw || !synonymsSelected.has(mw)) continue
        const key = mw.toLowerCase()
        if (saved.has(key)) continue
        const mm = String(m?.meaning || '').trim()
        const mp = String(m?.pos || '').trim()
        if (!mm || !mp) continue
        const mn = String((m as any)?.meaningNoteVi || '').trim()
        const pr = ensureIpaSlashes(String(m?.pronunciation || ''))
        const ex = String(m?.example || '').trim()
        onSave(mw, mm, mn, pr, mp, ex)
        saved.add(key)
      }
    }

    if (synonymsEnabled && synonymsIncludeFamilies && synonymFamilySelected.size > 0) {
      for (const m of synonymFamilyMembers) {
        const mw = String(m?.word || '').trim()
        if (!mw || !synonymFamilySelected.has(mw)) continue
        const key = mw.toLowerCase()
        if (saved.has(key)) continue
        const mm = String(m?.meaning || '').trim()
        const mp = String(m?.pos || '').trim()
        if (!mm || !mp) continue
        const mn = String((m as any)?.meaningNoteVi || '').trim()
        const pr = ensureIpaSlashes(String(m?.pronunciation || ''))
        const ex = String(m?.example || '').trim()
        onSave(mw, mm, mn, pr, mp, ex)
        saved.add(key)
      }
    }
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

        {(wordFamilyLoading || wordFamilyError || wordFamilyMembers.length > 0) && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Word Family</div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={wordFamilyEnabled}
                    onChange={(e) => setWordFamilyEnabled(e.target.checked)}
                  />
                  Auto-add
                </label>
              </div>
            </div>

            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
              {wordFamilyLoading && 'Finding related forms…'}
              {!wordFamilyLoading && wordFamilyError && wordFamilyError}
              {!wordFamilyLoading && !wordFamilyError && wordFamilyMembers.length === 0 && 'No word family found.'}
              {!wordFamilyLoading && !wordFamilyError && wordFamilyMembers.length > 0 && (
                <span>
                  Ready: {wordFamilySaveableCount}/{wordFamilyMembers.length} (selected: {wordFamilySelectedSaveableCount})
                </span>
              )}
            </div>

            {wordFamilyMembers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {wordFamilyMembers.map((m) => {
                  const mw = String(m.word || '').trim()
                  const selected = wordFamilySelected.has(mw)
                  const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim()
                  return (
                    <button
                      key={mw}
                      type="button"
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setWordFamilySelected((prev) => {
                          const next = new Set(prev)
                          next.add(mw)
                          return next
                        })
                        setRelatedEditTarget({ group: 'family', word: mw })
                      }}
                      onClick={() => {
                        setWordFamilySelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(mw)) next.delete(mw)
                          else next.add(mw)
                          return next
                        })
                      }}
                      className={`px-2 py-1 rounded border text-[10px] ${
                        selected
                          ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                      }`}
                      title={m.relation || ''}
                    >
                      <span className="font-semibold">{mw}</span>
                      {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                    </button>
                  )
                })}
              </div>
            )}

            {relatedEditTarget?.group === 'family' && (() => {
              const mw = relatedEditTarget.word
              const m = (Array.isArray(wordFamilyMembers) ? wordFamilyMembers : []).find((x) => String(x?.word || '').trim() === mw)
              if (!m) return null
              return (
                <div className="mt-3 rounded border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold text-slate-800 dark:text-slate-200">Edit: {mw}{m.relation ? <span className="ml-1 font-normal opacity-70">({m.relation})</span> : null}</div>
                    <button type="button" onClick={() => setRelatedEditTarget(null)} className="text-[10px] text-slate-600 dark:text-slate-300 hover:underline">
                      Close
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">Meaning</label>
                      <input
                        type="text"
                        value={String(m.meaning || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, meaning: v } : x)))
                        }}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none"
                        placeholder="Nghĩa..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">POS</label>
                        <select
                          value={String(m.pos || '')}
                          onChange={(e) => {
                            const v = e.target.value
                            setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pos: v } : x)))
                          }}
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none"
                        >
                          <option value="">--</option>
                          {POS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">IPA</label>
                        <input
                          type="text"
                          value={String(m.pronunciation || '')}
                          onChange={(e) => {
                            const v = e.target.value
                            setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pronunciation: v } : x)))
                          }}
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none"
                          placeholder="/…/"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">Example</label>
                      <textarea
                        value={String(m.example || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, example: v } : x)))
                        }}
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none resize-none"
                        placeholder="Example sentence"
                      />
                    </div>
                  </div>

                  <div className="mt-2 text-[9px] text-slate-500 dark:text-slate-400">Tip: right-click another chip to edit.</div>
                </div>
              )
            })()}
          </div>
        )}

        {(synonymsLoading || synonymsError || synonymsMembers.length > 0 || synonymFamilyMembers.length > 0) && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Synonyms</div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-300 select-none">
                  <input type="checkbox" checked={synonymsEnabled} onChange={(e) => setSynonymsEnabled(e.target.checked)} />
                  Auto-add
                </label>
              </div>
            </div>

            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
              {synonymsLoading && 'Finding synonyms…'}
              {!synonymsLoading && synonymsError && synonymsError}
              {!synonymsLoading && !synonymsError && synonymsMembers.length === 0 && 'No synonyms found.'}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{synonymsMembers.length > 0 ? `${synonymsMembers.length} items` : ''}</div>
              {SYNONYM_FAMILIES_FEATURE_ENABLED && (
                <label className="flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={synonymsIncludeFamilies}
                    onChange={(e) => setSynonymsIncludeFamilies(e.target.checked)}
                    disabled={!synonymsEnabled}
                  />
                  Families
                </label>
              )}
            </div>

            {synonymsMembers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {synonymsMembers.map((m) => {
                  const mw = String(m.word || '').trim()
                  const selected = synonymsSelected.has(mw)
                  const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim()
                  return (
                    <button
                      key={`syn_${mw}`}
                      type="button"
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setSynonymsSelected((prev) => {
                          const next = new Set(prev)
                          next.add(mw)
                          return next
                        })
                        setRelatedEditTarget({ group: 'synonym', word: mw })
                      }}
                      onClick={() => {
                        setSynonymsSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(mw)) next.delete(mw)
                          else next.add(mw)
                          return next
                        })
                      }}
                      className={`px-2 py-1 rounded border text-[10px] ${
                        selected
                          ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                      }`}
                      title={m.relation || 'synonym'}
                    >
                      <span className="font-semibold">{mw}</span>
                      {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                    </button>
                  )
                })}
              </div>
            )}

            {SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies && synonymFamilyMembers.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">Synonym families</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {synonymFamilyMembers.map((m) => {
                    const mw = String(m.word || '').trim()
                    const selected = synonymFamilySelected.has(mw)
                    const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim()
                    return (
                      <button
                        key={`sf_${mw}`}
                        type="button"
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setSynonymFamilySelected((prev) => {
                            const next = new Set(prev)
                            next.add(mw)
                            return next
                          })
                          setRelatedEditTarget({ group: 'synonymFamily', word: mw })
                        }}
                        onClick={() => {
                          setSynonymFamilySelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(mw)) next.delete(mw)
                            else next.add(mw)
                            return next
                          })
                        }}
                        className={`px-2 py-1 rounded border text-[10px] ${
                          selected
                            ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                            : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                        title={m.relation || ''}
                      >
                        <span className="font-semibold">{mw}</span>
                        {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {(relatedEditTarget?.group === 'synonym' || relatedEditTarget?.group === 'synonymFamily') && (() => {
              const mw = String(relatedEditTarget?.word || '').trim()
              if (!mw) return null
              const m = [...(Array.isArray(synonymsMembers) ? synonymsMembers : []), ...(Array.isArray(synonymFamilyMembers) ? synonymFamilyMembers : [])].find(
                (x) => String(x?.word || '').trim() === mw
              )
              if (!m) return null

              const updateBoth = (patch: Partial<EnrichedWordFamilyMember>) => {
                setSynonymsMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, ...patch } : x)))
                setSynonymFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, ...patch } : x)))
              }

              return (
                <div className="mt-3 rounded border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold text-slate-800 dark:text-slate-200">Edit: {mw}{m.relation ? <span className="ml-1 font-normal opacity-70">({m.relation})</span> : null}</div>
                    <button type="button" onClick={() => setRelatedEditTarget(null)} className="text-[10px] text-slate-600 dark:text-slate-300 hover:underline">
                      Close
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">Meaning</label>
                      <input
                        type="text"
                        value={String(m.meaning || '')}
                        onChange={(e) => updateBoth({ meaning: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">POS</label>
                        <select
                          value={String(m.pos || '')}
                          onChange={(e) => updateBoth({ pos: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none"
                        >
                          <option value="">--</option>
                          {POS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">IPA</label>
                        <input
                          type="text"
                          value={String(m.pronunciation || '')}
                          onChange={(e) => updateBoth({ pronunciation: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">Example</label>
                      <textarea
                        value={String(m.example || '')}
                        onChange={(e) => updateBoth({ example: e.target.value })}
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-white rounded-lg outline-none resize-none"
                      />
                    </div>
                  </div>

                  <div className="mt-2 text-[9px] text-slate-500 dark:text-slate-400">Tip: right-click another chip to edit.</div>
                </div>
              )
            })()}
          </div>
        )}
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
          {wordFamilyEnabled && wordFamilySelectedSaveableCount > 0 ? `Save (+${wordFamilySelectedSaveableCount})` : 'Save'}
        </button>
      </div>
    </div>
  )
}
