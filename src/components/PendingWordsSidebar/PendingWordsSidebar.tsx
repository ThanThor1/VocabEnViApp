import React, { useState, useEffect, useRef, useMemo } from 'react'
import { POS_OPTIONS, normalizePos } from '../posOptions/posOptions'
import './PendingWordsSidebar.css'
import { enrichWordFamilyMembers, getWordFamily, type EnrichedWordFamilyMember } from '../../utils/wordFamily'
import { enrichSynonyms, getSynonymFamilies, getSynonyms } from '../../utils/synonyms'

interface Rect {
  xPct: number
  yPct: number
  wPct: number
  hPct: number
}

// Rect with page information for multi-page selections
export interface RectWithPage extends Rect {
  pageNumber: number
}

export interface PendingWord {
  id: string
  text: string
  pageNumber: number
  rects: Rect[]
  rectsWithPage?: RectWithPage[] // For multi-page selections
  pageNumbers?: number[] // List of pages involved in selection
  contextSentenceEn: string
  // Auto-fetched data
  word: string
  meaning: string
  meaningEn?: string
  meaningVi?: string
  meaningNoteVi: string
  meaningNoteVie?: string
  pronunciation: string
  pos: string
  example: string
  contextVi: string
  candidates: AutoMeaningCandidate[]
  // Loading states
  isApiLoading: boolean
  isApiComplete: boolean
  apiError?: string
}

type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] }

interface Props {
  pendingWords: PendingWord[]
  onSave: (
    wordId: string,
    word: string,
    meaning: string,
    meaningNoteVi: string,
    pronunciation: string,
    pos: string,
    example: string,
    extraWords?: Array<{ word: string; meaning: string; meaningNoteVi: string; pronunciation: string; pos: string; example: string }>
  ) => void
  onRemove: (wordId: string) => void
  onUpdateWord: (wordId: string, updates: Partial<PendingWord>) => void
  onSaveAll?: () => void
  saveAllDisabled?: boolean
}

// Individual word item in the sidebar list
function PendingWordItem({
  item,
  isSelected,
  onClick
}: {
  item: PendingWord
  isSelected: boolean
  onClick: () => void
}) {
  const displayText = String(item.word || item.text || '').trim() || String(item.text || '')
  return (
    <div
      className={`pending-word-item ${isSelected ? 'selected' : ''} ${item.isApiComplete ? 'api-complete' : ''}`}
      onClick={onClick}
    >
      <div className="pending-word-content">
        <div className="pending-word-text">{displayText}</div>
        {item.meaning && (
          <div className="pending-word-meaning">{item.meaning}</div>
        )}
      </div>
      <div className="pending-word-status">
        {item.isApiLoading ? (
          <div className="loading-spinner" />
        ) : item.isApiComplete ? (
          <svg className="check-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : item.apiError ? (
          <svg className="error-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        ) : (
          <div className="pending-dot" />
        )}
      </div>
    </div>
  )
}

// Edit form when a word is selected
function WordEditForm({
  item,
  onSave,
  onRemove,
  onClose,
  onUpdateWord
}: {
  item: PendingWord
  onSave: (
    word: string,
    meaning: string,
    meaningNoteVi: string,
    pronunciation: string,
    pos: string,
    example: string,
    extraWords?: Array<{ word: string; meaning: string; meaningNoteVi: string; pronunciation: string; pos: string; example: string }>
  ) => void
  onRemove: () => void
  onClose: () => void
  onUpdateWord: (updates: Partial<PendingWord>) => void
}) {
  const [word, setWord] = useState(item.word || item.text)
  const [meaning, setMeaning] = useState(item.meaning || '')
  const [pronunciation, setPronunciation] = useState(item.pronunciation || '')
  const [pos, setPos] = useState(item.pos || '')
  const [example, setExample] = useState(item.example || '')
  const [errorMessage, setErrorMessage] = useState('')

  const WORD_FAMILY_FEATURE_ENABLED = false
  const SYNONYM_FAMILIES_FEATURE_ENABLED = false

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
  const [exampleLoading, setExampleLoading] = useState(false)
  const [exampleError, setExampleError] = useState('')
  const lastExampleKeyRef = useRef<string>('')

  const [relatedEditTarget, setRelatedEditTarget] = useState<
    | { group: 'family'; word: string }
    | { group: 'synonym'; word: string }
    | { group: 'synonymFamily'; word: string }
    | null
  >(null)

  // Sync from item when API completes
  useEffect(() => {
    if (item.meaning && !meaning) setMeaning(item.meaning)
    if (item.pronunciation && !pronunciation) setPronunciation(item.pronunciation)
    if (item.pos && !pos) setPos(item.pos)
    if (item.example && !example) setExample(item.example)
  }, [item.meaning, item.pronunciation, item.pos, item.example])

  const ensureIpaSlashes = (val: string) => {
    const v = (val || '').trim().replace(/"/g, '')
    if (!v) return ''
    const core = v.replace(/^\/+|\/+$/g, '')
    return `/${core}/`
  }

  // Word Family: fetch + enrich in background when editing a word (PDF translate flow)
  const cleanWord = useMemo(() => String(word || '').trim(), [word])
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
        const enriched = await enrichWordFamilyMembers(members, { concurrency: 2, contextSentenceEn: item.contextSentenceEn || '' })
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
  }, [cleanWord, item.contextSentenceEn, wordFamilyEnabled])

  // Synonyms: fetch + enrich in background when editing a word (PDF translate flow)
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
        const enriched = await enrichSynonyms(members, { concurrency: 2, contextSentenceEn: item.contextSentenceEn || '' })
        if (synonymsReqRef.current !== rid) return
        setSynonymsMembers(enriched)
        setSynonymsSelected(new Set(enriched.map((m) => m.word)))

        if (SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies && api?.getWordFamily) {
          const fam = await getSynonymFamilies(enriched, { maxSynonyms: 3, contextSentenceEn: item.contextSentenceEn || '' })
          if (synonymsReqRef.current !== rid) return
          const famEnriched = await enrichSynonyms(fam, { concurrency: 2, contextSentenceEn: item.contextSentenceEn || '' })
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
  }, [cleanWord, item.contextSentenceEn, synonymsEnabled, synonymsIncludeFamilies])

  const handleSave = () => {
    if (!word.trim() || !meaning.trim() || !pos.trim()) {
      setErrorMessage('Cần điền: từ, nghĩa, và loại từ')
      setTimeout(() => setErrorMessage(''), 3000)
      return
    }
    const baseWord = word.trim()
    const baseMeaning = meaning.trim()
    const basePos = pos.trim()
    const basePron = ensureIpaSlashes(pronunciation)
    const baseExample = example.trim()

    const toExtraRows = (list: EnrichedWordFamilyMember[], selected: Set<string>) =>
      (Array.isArray(list) ? list : [])
        .filter((m) => {
          const mw = String(m?.word || '').trim()
          if (!mw) return false
          if (!selected.has(mw)) return false
          const mm = String(m?.meaning || '').trim()
          const mp = String(m?.pos || '').trim()
          return !!mm && !!mp
        })
        .map((m) => ({
          word: String(m.word || '').trim(),
          meaning: String(m.meaning || '').trim(),
          meaningNoteVi: '',
          pronunciation: ensureIpaSlashes(String(m.pronunciation || '')),
          pos: String(m.pos || '').trim(),
          example: String(m.example || '').trim()
        }))

    const extraWordsRaw = [
      ...(WORD_FAMILY_FEATURE_ENABLED && wordFamilyEnabled ? toExtraRows(wordFamilyMembers, wordFamilySelected) : []),
      ...(synonymsEnabled ? toExtraRows(synonymsMembers, synonymsSelected) : []),
      ...(synonymsEnabled && SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies
        ? toExtraRows(synonymFamilyMembers, synonymFamilySelected)
        : [])
    ]

    const seen = new Set<string>()
    const extraWords = extraWordsRaw.filter((r) => {
      const w = String(r.word || '').trim()
      if (!w) return false
      const key = w.toLowerCase()
      if (key === baseWord.toLowerCase()) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    onSave(baseWord, baseMeaning, '', basePron, basePos, baseExample, extraWords.length > 0 ? extraWords : undefined)
  }

  const handleSelectCandidate = (candidate: AutoMeaningCandidate) => {
    setMeaning(candidate.vi)
    onUpdateWord({ meaning: candidate.vi })
    if (candidate.pos) {
      const normalized = normalizePos(candidate.pos)
      if (normalized) {
        setPos(normalized)
        onUpdateWord({ pos: normalized })
      }
    }
    // Auto-generate example sentence after user selects meaning from API suggestions.
    void (async () => {
      try {
        if (String(example || '').trim()) return
        if (!(window as any)?.api?.suggestExampleSentence) return
        const key = `${String(word || item.text || '')}__${candidate.vi}`.toLowerCase()
        if (lastExampleKeyRef.current === key) return
        lastExampleKeyRef.current = key
        setExampleError('')
        setExample('')
        setExampleLoading(true)
        const out = await (window as any).api.suggestExampleSentence({
          word: String(word || item.text || ''),
          meaningVi: candidate.vi,
          pos: candidate.pos || pos,
          contextSentenceEn: item.contextSentenceEn || ''
        })
        if (String(out || '').trim()) {
          setExample(String(out || '').trim())
          onUpdateWord({ example: String(out || '').trim() })
        }
      } catch (e) {
        setExampleError('Failed to suggest example')
      } finally {
        setExampleLoading(false)
      }
    })()
  }

  return (
    <div className="word-edit-form">
      <div className="edit-form-header">
        <h3>Thêm từ</h3>
        <button className="close-btn" onClick={onClose} title="Đóng">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {errorMessage && (
        <div className="error-message">{errorMessage}</div>
      )}

      {/* Context sentence */}
      {item.contextSentenceEn && (
        <div className="context-section">
          <div className="context-label">Ngữ cảnh:</div>
          <div className="context-text">{item.contextSentenceEn}</div>
          {item.contextVi && (
            <div className="context-text-vi">{item.contextVi}</div>
          )}
        </div>
      )}

      {/* Word input */}
      <div className="form-group">
        <label>Từ</label>
        <input
          type="text"
          value={word}
          onChange={(e) => {
            const v = e.target.value
            setWord(v)
            onUpdateWord({ word: v })
          }}
          placeholder="Nhập từ..."
        />
      </div>

      {/* Meaning input with loading indicator */}
      <div className="form-group">
        <label>
          Nghĩa
          {item.isApiLoading && <span className="loading-text"> (đang tải...)</span>}
        </label>
        <input
          type="text"
          value={meaning}
          onChange={(e) => {
            const v = e.target.value
            setMeaning(v)
            onUpdateWord({ meaning: v })
          }}
          placeholder="Nhập nghĩa..."
        />
      </div>

      {/* Meaning candidates */}
      {item.candidates && item.candidates.length > 0 && (
        <div className="candidates-section">
          <div className="candidates-label">Gợi ý:</div>
          <div className="candidates-list">
            {item.candidates.map((c, i) => (
              <button
                key={i}
                className={`candidate-chip ${meaning === c.vi ? 'selected' : ''}`}
                onClick={() => handleSelectCandidate(c)}
              >
                {c.vi}
                {c.pos && <span className="candidate-pos">({c.pos})</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* POS select */}
      <div className="form-group">
        <label>Loại từ</label>
        <select
          value={pos}
          onChange={(e) => {
            const v = e.target.value
            setPos(v)
            onUpdateWord({ pos: v })
          }}
        >
          <option value="">-- Chọn --</option>
          {POS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Pronunciation input */}
      <div className="form-group">
        <label>Phát âm (IPA)</label>
        <input
          type="text"
          value={pronunciation}
          onChange={(e) => {
            const v = e.target.value
            setPronunciation(v)
            onUpdateWord({ pronunciation: v })
          }}
          placeholder="/ˈeksəmpəl/"
        />
      </div>

      {/* Example input */}
      <div className="form-group">
        <label>Ví dụ {exampleLoading && <span className="loading-text"> (Generating…)</span>}</label>
        <textarea
          value={example}
          onChange={(e) => {
            const v = e.target.value
            setExample(v)
            onUpdateWord({ example: v })
          }}
          placeholder="Nhập câu ví dụ..."
          rows={2}
        />
      </div>

      {(wordFamilyLoading || wordFamilyError || wordFamilyMembers.length > 0) && (
        <div className="word-family-section">
          <div className="word-family-header">
            <div className="word-family-title">Word Family</div>
            <div className="word-family-actions">
              <label className="word-family-toggle">
                <input
                  type="checkbox"
                  checked={wordFamilyEnabled}
                  onChange={(e) => setWordFamilyEnabled(e.target.checked)}
                />
                Auto-add
              </label>
            </div>
          </div>

          <div className="word-family-meta">
            {wordFamilyLoading && 'Finding related forms…'}
            {!wordFamilyLoading && wordFamilyError && wordFamilyError}
            {!wordFamilyLoading && !wordFamilyError && wordFamilyMembers.length === 0 && 'No word family found.'}
          </div>

          {wordFamilyMembers.length > 0 && (
            <div className="word-family-list">
              {wordFamilyMembers.map((m) => {
                const mw = String(m.word || '').trim()
                const selected = wordFamilySelected.has(mw)
                const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim()
                return (
                  <button
                    key={mw}
                    type="button"
                    className={`word-family-chip ${selected ? 'selected' : ''}`}
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
                    title={m.relation || ''}
                  >
                    {mw}
                    {m.pos ? <span className="word-family-pos">({m.pos})</span> : null}
                    {!ready ? <span className="word-family-pending">…</span> : null}
                  </button>
                )
              })}
            </div>
          )}

          {relatedEditTarget?.group === 'family' && (() => {
            const mw = String(relatedEditTarget?.word || '').trim()
            if (!mw) return null
            const m = (Array.isArray(wordFamilyMembers) ? wordFamilyMembers : []).find((x) => String(x?.word || '').trim() === mw)
            if (!m) return null
            return (
              <div className="word-family-editor">
                <div className="word-family-editor-row">
                  <div className="word-family-editor-title">
                    Edit: {mw}{m.relation ? <span className="word-family-editor-relation"> ({m.relation})</span> : null}
                    <button
                      type="button"
                      className="word-family-edit-btn"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={() => setRelatedEditTarget(null)}
                    >
                      Close
                    </button>
                  </div>

                  <div className="word-family-editor-grid">
                    <div className="form-group">
                      <label>Nghĩa</label>
                      <input
                        type="text"
                        value={String(m.meaning || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, meaning: v } : x)))
                        }}
                        placeholder="Nhập nghĩa..."
                      />
                    </div>

                    <div className="form-group">
                      <label>Loại từ</label>
                      <select
                        value={String(m.pos || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pos: v } : x)))
                        }}
                      >
                        <option value="">-- Chọn --</option>
                        {POS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Phát âm (IPA)</label>
                      <input
                        type="text"
                        value={String(m.pronunciation || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pronunciation: v } : x)))
                        }}
                        placeholder="/…/"
                      />
                    </div>

                    <div className="form-group">
                      <label>Ví dụ</label>
                      <textarea
                        value={String(m.example || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, example: v } : x)))
                        }}
                        placeholder="Nhập câu ví dụ..."
                        rows={2}
                      />
                    </div>
                  </div>
                </div>
                <div className="word-family-meta">Tip: Chuột phải vào chip để edit.</div>
              </div>
            )
          })()}
        </div>
      )}

      {(synonymsLoading || synonymsError || synonymsMembers.length > 0 || synonymFamilyMembers.length > 0) && (
        <div className="word-family-section">
          <div className="word-family-header">
            <div className="word-family-title">Synonyms</div>
            <div className="word-family-actions">
              <label className="word-family-toggle">
                <input
                  type="checkbox"
                  checked={synonymsEnabled}
                  onChange={(e) => setSynonymsEnabled(e.target.checked)}
                />
                Auto-add
              </label>
            </div>
          </div>

          <div className="word-family-meta">
            {synonymsLoading && 'Finding synonyms…'}
            {!synonymsLoading && synonymsError && synonymsError}
            {!synonymsLoading && !synonymsError && synonymsMembers.length === 0 && 'No synonyms found.'}
          </div>

          <div className="word-family-meta" style={{ marginTop: '0.25rem' }}>
            {SYNONYM_FAMILIES_FEATURE_ENABLED && (
              <label className="word-family-toggle">
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
            <div className="word-family-list">
              {synonymsMembers.map((m) => {
                const mw = String(m.word || '').trim()
                const selected = synonymsSelected.has(mw)
                const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim()
                return (
                  <button
                    key={`syn_${mw}`}
                    type="button"
                    className={`word-family-chip ${selected ? 'selected' : ''}`}
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
                    title={m.relation || 'synonym'}
                  >
                    {mw}
                    {m.pos ? <span className="word-family-pos">({m.pos})</span> : null}
                    {!ready ? <span className="word-family-pending">…</span> : null}
                  </button>
                )
              })}
            </div>
          )}

          {SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies && synonymFamilyMembers.length > 0 && (
            <div className="word-family-list">
              {synonymFamilyMembers.map((m) => {
                const mw = String(m.word || '').trim()
                const selected = synonymFamilySelected.has(mw)
                const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim()
                return (
                  <button
                    key={`sf_${mw}`}
                    type="button"
                    className={`word-family-chip ${selected ? 'selected' : ''}`}
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
                    title={m.relation || ''}
                  >
                    {mw}
                    {m.pos ? <span className="word-family-pos">({m.pos})</span> : null}
                    {!ready ? <span className="word-family-pending">…</span> : null}
                  </button>
                )
              })}
            </div>
          )}

          {(relatedEditTarget?.group === 'synonym' || relatedEditTarget?.group === 'synonymFamily') && (() => {
            const mw = String(relatedEditTarget?.word || '').trim()
            if (!mw) return null
            const combined = [...(Array.isArray(synonymsMembers) ? synonymsMembers : []), ...(Array.isArray(synonymFamilyMembers) ? synonymFamilyMembers : [])]
            const m = combined.find((x) => String(x?.word || '').trim() === mw)
            if (!m) return null

            const updateBoth = (patch: Partial<EnrichedWordFamilyMember>) => {
              setSynonymsMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, ...patch } : x)))
              setSynonymFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, ...patch } : x)))
            }

            return (
              <div className="word-family-editor">
                <div className="word-family-editor-row">
                  <div className="word-family-editor-title">
                    Edit: {mw}{m.relation ? <span className="word-family-editor-relation"> ({m.relation})</span> : null}
                    <button
                      type="button"
                      className="word-family-edit-btn"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={() => setRelatedEditTarget(null)}
                    >
                      Close
                    </button>
                  </div>

                  <div className="word-family-editor-grid">
                    <div className="form-group">
                      <label>Nghĩa</label>
                      <input type="text" value={String(m.meaning || '')} onChange={(e) => updateBoth({ meaning: e.target.value })} placeholder="Nhập nghĩa..." />
                    </div>

                    <div className="form-group">
                      <label>Loại từ</label>
                      <select value={String(m.pos || '')} onChange={(e) => updateBoth({ pos: e.target.value })}>
                        <option value="">-- Chọn --</option>
                        {POS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Phát âm (IPA)</label>
                      <input type="text" value={String(m.pronunciation || '')} onChange={(e) => updateBoth({ pronunciation: e.target.value })} placeholder="/…/" />
                    </div>

                    <div className="form-group">
                      <label>Ví dụ</label>
                      <textarea value={String(m.example || '')} onChange={(e) => updateBoth({ example: e.target.value })} placeholder="Nhập câu ví dụ..." rows={2} />
                    </div>
                  </div>
                </div>
                <div className="word-family-meta">Tip: Chuột phải vào chip để edit.</div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Action buttons */}
      <div className="form-actions">
        <button className="btn-remove" onClick={onRemove}>
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Xóa
        </button>
        <button className="btn-save" onClick={handleSave}>
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Lưu
        </button>
      </div>
    </div>
  )
}

export default function PendingWordsSidebar({
  pendingWords,
  onSave,
  onRemove,
  onUpdateWord,
  onSaveAll,
  saveAllDisabled
}: Props) {
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null)
  const selectedWord = pendingWords.find((w) => w.id === selectedWordId)

  const saveableCount = useMemo(() => {
    return (Array.isArray(pendingWords) ? pendingWords : []).filter((w) => {
      if (!w) return false
      if (!w.isApiComplete) return false
      if (w.isApiLoading) return false
      if (w.apiError) return false
      const word = String(w.word || w.text || '').trim()
      const meaning = String(w.meaning || '').trim()
      const pos = String(w.pos || '').trim()
      return !!word && !!meaning && !!pos
    }).length
  }, [pendingWords])

  // Auto-select the first word if none selected and there are pending words
  useEffect(() => {
    if (!selectedWordId && pendingWords.length > 0) {
      setSelectedWordId(pendingWords[0].id)
    }
    // If selected word was removed, clear selection
    if (selectedWordId && !pendingWords.find((w) => w.id === selectedWordId)) {
      setSelectedWordId(pendingWords.length > 0 ? pendingWords[0].id : null)
    }
  }, [pendingWords, selectedWordId])

  if (pendingWords.length === 0) {
    return (
      <div className="pending-words-sidebar empty">
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <p>Chọn từ trong PDF để thêm vào danh sách</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pending-words-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <h3>Từ đang xử lý ({pendingWords.length})</h3>
          {onSaveAll && (
            <button
              type="button"
              className="btn-save-all"
              onClick={onSaveAll}
              disabled={!!saveAllDisabled || saveableCount === 0}
              title={saveableCount === 0 ? 'Chưa có từ nào dịch xong đủ dữ liệu để lưu' : 'Lưu tất cả từ đã dịch xong'}
            >
              Save all ({saveableCount})
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-content">
        {/* List of pending words */}
        <div className="pending-words-list">
          {pendingWords.map((item) => (
            <PendingWordItem
              key={item.id}
              item={item}
              isSelected={selectedWordId === item.id}
              onClick={() => setSelectedWordId(item.id)}
            />
          ))}
        </div>

        {/* Edit form for selected word */}
        {selectedWord && (
          <WordEditForm
            key={selectedWord.id}
            item={selectedWord}
            onSave={(word, meaning, meaningNoteVi, pronunciation, pos, example, extraWords) => {
              onSave(selectedWord.id, word, meaning, meaningNoteVi, pronunciation, pos, example, extraWords)
            }}
            onRemove={() => onRemove(selectedWord.id)}
            onClose={() => setSelectedWordId(null)}
            onUpdateWord={(updates) => onUpdateWord(selectedWord.id, updates)}
          />
        )}
      </div>
    </div>
  )
}
