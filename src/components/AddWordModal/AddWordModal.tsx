import React, { useEffect, useMemo, useRef, useState } from 'react'
import { POS_OPTIONS, normalizePos } from '../posOptions/posOptions'
import { countSaveableFamilyMembers, enrichWordFamilyMembers, getWordFamily, type EnrichedWordFamilyMember } from '../../utils/wordFamily'
import { enrichSynonyms, getSynonymFamilies, getSynonyms } from '../../utils/synonyms'

interface Props {
  selectedText: string
  contextSentenceEn: string
  onSave: (word: string, meaning: string, meaningNoteVi: string, pronunciation: string, pos: string, example: string) => void
  onCancel: () => void
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

export default function AddWordModal({ selectedText, contextSentenceEn, onSave, onCancel }: Props) {
  const [word, setWord] = useState(selectedText)
  const [meaning, setMeaning] = useState('')
  const [meaningNoteVi, setMeaningNoteVi] = useState('')
  const WORD_FAMILY_FEATURE_ENABLED = false
  const SYNONYM_FAMILIES_FEATURE_ENABLED = false
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

  // PARALLEL API calls - fetch IPA + meaning + example simultaneously for speed
  useEffect(() => {
    if (!cleanWord) return
    let cancelled = false

    const fetchAllInParallel = async () => {
      // Show all loading states
      setIpaLoading(true)
      setMeaningLoading(true)
      setMeaningError('')

      await cancelPendingAutoMeaning()
      const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
      lastRequestIdRef.current = requestId

      // Launch all API calls in parallel using Promise.allSettled
      const results = await Promise.allSettled([
        // 1. IPA pronunciation
        (async () => {
          const suggestIpa = (window as any)?.api?.suggestIpa
          if (suggestIpa) {
            const out = await suggestIpa({ word: cleanWord, dialect: 'US' })
            if (String(out || '').trim()) return { type: 'ipa', value: ensureIpaSlashes(String(out || '')) }
          }
          // Fallback: dictionaryapi.dev
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

        // 2. Auto meaning + context
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

      // Process results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const data = result.value as any

          // Handle IPA result
          if (data.type === 'ipa' && data.value && !cancelled) {
            setPronunciation(data.value)
          }

          // Handle meaning result
          if (data.type === 'meaning' && data.value && !cancelled) {
            const resp = data.value as any
            const suggested = (resp.meaningSuggested || '').trim()
            const note = String((resp as any).meaningNoteVie || (resp as any).meaningNoteVi || '').trim()
            if (suggested && !isMeaningDirtyRef.current) {
              setMeaning(suggested)
              if (note) setMeaningNoteVi(note)

              // After meaning is set, fetch example in parallel (non-blocking)
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

            // Auto-select POS
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
    // Keep this feature lightweight: only for single words without spaces.
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

  // Word Family: fetch + enrich in background (auto-add by default)
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
    // Keep this feature lightweight: only for single words without spaces.
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
      } catch (e) {
        if (wordFamilyReqRef.current !== rid) return
        setWordFamilyError('Failed to fetch word family')
        setWordFamilyMembers([])
        setWordFamilySelected(new Set())
      } finally {
        if (wordFamilyReqRef.current === rid) setWordFamilyLoading(false)
      }
    })()

    return () => {
      // mark stale
      if (wordFamilyReqRef.current === rid) wordFamilyReqRef.current = ''
    }
  }, [cleanWord, cleanContextEn, wordFamilyEnabled])

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

  return (
    <div className="modal-backdrop">
      <div className="modal-content max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Add New Word</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Build your vocabulary</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form Fields */}
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              Word
            </label>
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              className="input-field font-medium"
              placeholder="Enter the word..."
              autoFocus
            />
          </div>

          {(wordFamilyLoading || wordFamilyError || wordFamilyMembers.length > 0) && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Word Family</div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={wordFamilyEnabled}
                      onChange={(e) => setWordFamilyEnabled(e.target.checked)}
                    />
                    Auto-add family
                  </label>
                </div>
              </div>

              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
                <div className="mt-3 flex flex-wrap gap-2">
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
                        className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                          selected
                            ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                            : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                        title={m.relation || ''}
                      >
                        <span className="font-semibold">{mw}</span>
                        {m.pos ? <span className="opacity-70"> ({m.pos})</span> : ''}
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
                  <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Edit: {mw}{m.relation ? <span className="ml-2 font-normal opacity-70">({m.relation})</span> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRelatedEditTarget(null)}
                        className="text-xs text-slate-600 dark:text-slate-300 hover:underline"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">POS</label>
                        <select
                          value={String(m.pos || '')}
                          onChange={(e) => {
                            const v = e.target.value
                            setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pos: v } : x)))
                          }}
                          className="input-field"
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
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Pronunciation (IPA)</label>
                        <input
                          type="text"
                          value={String(m.pronunciation || '')}
                          onChange={(e) => {
                            const v = e.target.value
                            setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pronunciation: v } : x)))
                          }}
                          className="input-field"
                          placeholder="/…/"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Meaning (VI)</label>
                      <textarea
                        value={String(m.meaning || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, meaning: v } : x)))
                        }}
                        rows={2}
                        className="input-field resize-none"
                      />
                    </div>

                    <div className="mt-3">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Example (EN)</label>
                      <textarea
                        value={String(m.example || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, example: v } : x)))
                        }}
                        rows={2}
                        className="input-field resize-none"
                      />
                    </div>

                    <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Right-click another chip to edit it.</div>
                  </div>
                )
              })()}
            </div>
          )}

          {(synonymsLoading || synonymsError || synonymsMembers.length > 0 || synonymFamilyMembers.length > 0) && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Synonyms</div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 select-none">
                    <input type="checkbox" checked={synonymsEnabled} onChange={(e) => setSynonymsEnabled(e.target.checked)} />
                    Auto-add synonyms
                  </label>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {synonymsLoading && 'Finding synonyms…'}
                  {!synonymsLoading && synonymsError && synonymsError}
                  {!synonymsLoading && !synonymsError && synonymsMembers.length === 0 && 'No synonyms found.'}
                </div>
                {SYNONYM_FAMILIES_FEATURE_ENABLED && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={synonymsIncludeFamilies}
                      onChange={(e) => setSynonymsIncludeFamilies(e.target.checked)}
                      disabled={!synonymsEnabled}
                    />
                    Include synonym families
                  </label>
                )}
              </div>

              {synonymsMembers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {synonymsMembers.map((m) => {
                    const mw = String(m.word || '').trim()
                    const selected = synonymsSelected.has(mw)
                    const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim()
                    return (
                      <button
                        key={mw}
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
                        className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                          selected
                            ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                            : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                        title={m.relation || 'synonym'}
                      >
                        <span className="font-semibold">{mw}</span>
                        {m.pos ? <span className="opacity-70"> ({m.pos})</span> : ''}
                        {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                      </button>
                    )
                  })}
                </div>
              )}

              {SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies && synonymFamilyMembers.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Synonym families</div>
                  <div className="mt-2 flex flex-wrap gap-2">
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
                          className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                            selected
                              ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                              : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                          title={m.relation || ''}
                        >
                          <span className="font-semibold">{mw}</span>
                          {m.pos ? <span className="opacity-70"> ({m.pos})</span> : ''}
                          {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {(relatedEditTarget?.group === 'synonym' || relatedEditTarget?.group === 'synonymFamily') && (() => {
                const group = relatedEditTarget?.group
                if (!group) return null
                const mw = relatedEditTarget!.word
                const list = group === 'synonym' ? synonymsMembers : synonymFamilyMembers
                const setList = group === 'synonym'
                  ? setSynonymsMembers
                  : setSynonymFamilyMembers
                const m = (Array.isArray(list) ? list : []).find((x) => String(x?.word || '').trim() === mw)
                if (!m) return null
                return (
                  <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Edit: {mw}{m.relation ? <span className="ml-2 font-normal opacity-70">({m.relation})</span> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRelatedEditTarget(null)}
                        className="text-xs text-slate-600 dark:text-slate-300 hover:underline"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">POS</label>
                        <select
                          value={String(m.pos || '')}
                          onChange={(e) => {
                            const v = e.target.value
                            setList((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pos: v } : x)))
                          }}
                          className="input-field"
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
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Pronunciation (IPA)</label>
                        <input
                          type="text"
                          value={String(m.pronunciation || '')}
                          onChange={(e) => {
                            const v = e.target.value
                            setList((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pronunciation: v } : x)))
                          }}
                          className="input-field"
                          placeholder="/…/"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Meaning (VI)</label>
                      <textarea
                        value={String(m.meaning || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setList((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, meaning: v } : x)))
                        }}
                        rows={2}
                        className="input-field resize-none"
                      />
                    </div>

                    <div className="mt-3">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Example (EN)</label>
                      <textarea
                        value={String(m.example || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setList((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, example: v } : x)))
                        }}
                        rows={2}
                        className="input-field resize-none"
                      />
                    </div>

                    <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Tip: Right-click a chip to edit.</div>
                  </div>
                )
              })()}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="input-field"
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
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="input-field resize-none"
              placeholder="What does it mean?"
            />

            {(meaningLoading || meaningError) && (
              <div className="mt-2 text-xs">
                {meaningLoading && <span className="text-violet-600 dark:text-violet-400">Suggesting meaning...</span>}
                {!meaningLoading && meaningError && <span className="text-red-600 dark:text-red-400">{meaningError}</span>}
              </div>
            )}

            {contextVi && (
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="font-semibold text-slate-600 dark:text-slate-300">Context (VI)</div>
                <div className="mt-1">{contextVi}</div>
              </div>
            )}

            {meaningCandidates.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Other suggestions</div>
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

                        // Auto-generate example sentence after user selects meaning from API suggestions.
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
                      className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
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
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8m-8 4h6m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h6l4 4v15a2 2 0 01-2 2z" />
              </svg>
              Example sentence
              <span className="text-xs text-slate-400 dark:text-slate-500">(optional)</span>
              {exampleLoading && <span className="text-[10px] text-violet-500 dark:text-violet-400">Generating…</span>}
            </label>
            <textarea
              value={example}
              onChange={(e) => {
                isExampleDirtyRef.current = true
                setExample(e.target.value)
              }}
              rows={2}
              className="input-field resize-none"
              placeholder="Optional: a memorable English sentence using the word"
            />
            {exampleError && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{exampleError}</div>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Pronunciation
              <span className="text-xs text-slate-400 dark:text-slate-500">(auto-fills if available)</span>
              {ipaLoading && <span className="text-[10px] text-violet-500 dark:text-violet-400">Fetching...</span>}
            </label>
            <input
              type="text"
              value={pronunciation}
              onChange={(e) => setPronunciation(e.target.value)}
              className="input-field"
              placeholder="/prəˌnʌnsiˈeɪʃən/"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end mt-8 pt-6 border-t border-slate-100 dark:border-slate-700">
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
            {wordFamilyEnabled && wordFamilySelectedSaveableCount > 0 ? `Save ${1 + wordFamilySelectedSaveableCount} Words` : 'Save Word'}
          </button>
        </div>
      </div>
    </div>
  )
}
