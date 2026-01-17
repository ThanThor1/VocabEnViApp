import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import './StudyView.css'
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import ConfirmModal from '../ConfirmModal/ConfirmModal'
import { useLocation } from 'react-router-dom'
import { usePersistedState } from '../../hooks/usePersistedState'

function shuffle<T>(a:T[]){
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
  return a
}

type Card = {
  word: string;
  meaning: string;
  pronunciation?: string;
  example?: string;
  source?: string;
}

type LearnMode = 'all' | 'random' | 'select' | 'range'
type StudyMode = 'spelling' | 'match'
type StudyTab = 'custom' | 'smart'

// ==================== SPACED REPETITION SYSTEM (SRS) ====================
// SM-2 Algorithm inspired by SuperMemo

interface SRSCardData {
  // Unique key: source||word||meaning
  key: string
  word: string
  meaning: string
  pronunciation?: string
  example?: string
  source?: string
  // SRS fields
  nextReview: number  // timestamp when card is due
  interval: number    // days until next review (starts at 1)
  easeFactor: number  // ease factor (starts at 2.5)
  repetitions: number // consecutive correct answers
  lastReview?: number // timestamp of last review
}

type SRSStore = Record<string, SRSCardData>

const SRS_STORAGE_KEY = 'srs_vocab_data'

// SM-2 quality ratings
// 0 - complete blackout
// 1 - incorrect but remembered after seeing answer
// 2 - incorrect but easy to recall
// 3 - correct with serious difficulty
// 4 - correct with some hesitation
// 5 - perfect response

function calculateSM2(item: SRSCardData, quality: number): SRSCardData {
  // quality: 0-5 (0-2 = incorrect, 3-5 = correct)
  const q = Math.max(0, Math.min(5, quality))
  
  let { interval, easeFactor, repetitions } = item
  
  if (q < 3) {
    // Incorrect - reset
    repetitions = 0
    interval = 1
  } else {
    // Correct
    if (repetitions === 0) {
      interval = 1
    } else if (repetitions === 1) {
      interval = 6
    } else {
      interval = Math.round(interval * easeFactor)
    }
    repetitions += 1
  }
  
  // Update ease factor (minimum 1.3)
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  
  const now = Date.now()
  const nextReview = now + interval * 24 * 60 * 60 * 1000
  
  return {
    ...item,
    interval,
    easeFactor,
    repetitions,
    nextReview,
    lastReview: now,
  }
}

function loadSRSStore(): SRSStore {
  try {
    const raw = localStorage.getItem(SRS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.error('Failed to load SRS store', e)
  }
  return {}
}

function saveSRSStore(store: SRSStore) {
  try {
    localStorage.setItem(SRS_STORAGE_KEY, JSON.stringify(store))
  } catch (e) {
    console.error('Failed to save SRS store', e)
  }
}

function makeSRSKey(source: string | undefined, word: string, meaning: string): string {
  const s = String(source || '').trim()
  const w = String(word || '').trim().toLowerCase()
  const m = String(meaning || '').trim().toLowerCase()
  return `${s}||${w}||${m}`
}

function cardToSRSData(card: Card): SRSCardData {
  const key = makeSRSKey(card.source, card.word, card.meaning)
  return {
    key,
    word: card.word,
    meaning: card.meaning,
    pronunciation: card.pronunciation,
    example: card.example,
    source: card.source,
    nextReview: Date.now(), // Due now for new cards
    interval: 1,
    easeFactor: 2.5,
    repetitions: 0,
  }
}

function getDueCards(store: SRSStore): SRSCardData[] {
  const now = Date.now()
  return Object.values(store).filter(c => c.nextReview <= now)
}

function getNewCardsCount(store: SRSStore, allCards: Card[]): number {
  return allCards.filter(c => !store[makeSRSKey(c.source, c.word, c.meaning)]).length
}
// ==================== END SRS ====================

type FileStudyConfig = {
  mode: LearnMode
  randomCount: number
  rangeStart: number
  rangeEnd: number
  selectedMap: Record<number, boolean>
}

type CardId = {
  source?: string
  word: string
  meaning: string
}

type StudySessionV1 = {
  v: 1
  phase: 'idle' | 'mode-select' | 'studying' | 'review-result' | 'summary' | 'match-game' | 'match-summary' | 'srs-studying' | 'srs-review-result' | 'srs-summary'
  round?: number
  selectedFiles: string[]
  fileConfigs: Record<string, FileStudyConfig>
  index: number
  revealLevel: number
  lastAnswerCorrect: boolean | null
  stats: { correct: number; incorrect: number; hard: number; easy: number }
  deck: CardId[]
  queue: CardId[]
  toReview: CardId[]
}

export default function Study(){
  const location = useLocation();
  const [tree, setTree] = useState<any[]>([])
  const [pdfList, setPdfList] = useState<any[]>([])
  const [selectedFiles, setSelectedFiles] = usePersistedState<string[]>('study_selectedFiles', [])
  // NOTE: Do NOT persist large arrays like deck/queue in localStorage.
  // JSON.stringify + localStorage.setItem is synchronous and can freeze the UI when starting a session.
  const [deck, setDeck] = useState<Card[]>([])
  const [queue, setQueue] = useState<Card[]>([])
  const [index, setIndex] = useState<number>(0)
  const [revealLevel, setRevealLevel] = useState(0) // 0 = all underscores, 1+ = reveal that many chars
  const [input, setInput] = useState("")
  const [phase, setPhase] = useState<'idle'|'mode-select'|'studying'|'review-result'|'summary'|'match-game'|'match-summary'|'srs-studying'|'srs-review-result'|'srs-summary'>('idle')
  const [studyMode, setStudyMode] = usePersistedState<StudyMode>('study_mode', 'spelling')
  const [studyTab, setStudyTab] = usePersistedState<StudyTab>('study_tab', 'custom')
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null)
  const [toReview, setToReview] = useState<Card[]>([])
  const toReviewRef = useRef<Card[]>([])
  const [round, setRound] = useState<number>(1)
  const [stats, setStats] = usePersistedState('study_stats', { correct: 0, incorrect: 0, hard: 0, easy: 0 })
  const inputRef = useRef<HTMLInputElement|null>(null)

  // SRS State
  const [srsStore, setSrsStore] = useState<SRSStore>(() => loadSRSStore())
  const [srsQueue, setSrsQueue] = useState<SRSCardData[]>([])
  const [srsIndex, setSrsIndex] = useState(0)
  const [srsStats, setSrsStats] = useState({ reviewed: 0, correct: 0, incorrect: 0 })

  // Match game state
  const [matchCards, setMatchCards] = useState<Card[]>([])
  const [matchWords, setMatchWords] = useState<{id: number; word: string; matched: boolean}[]>([])
  const [matchMeanings, setMatchMeanings] = useState<{id: number; meaning: string; matched: boolean}[]>([])
  const [selectedWord, setSelectedWord] = useState<number | null>(null)
  const [selectedMeaning, setSelectedMeaning] = useState<number | null>(null)
  const [matchCorrect, setMatchCorrect] = useState(0)
  const [matchIncorrect, setMatchIncorrect] = useState(0)
  const [matchStartTime, setMatchStartTime] = useState<number>(0)
  const [matchElapsed, setMatchElapsed] = useState(0)
  const [matchRound, setMatchRound] = useState(1)
  const [matchTotalCards, setMatchTotalCards] = useState(0)
  const [lastMatchResult, setLastMatchResult] = useState<'correct'|'incorrect'|null>(null)
  const matchTimerRef = useRef<number | null>(null)

  const [fileConfigs, setFileConfigs] = usePersistedState<Record<string, FileStudyConfig>>('study_fileConfigs', {})
  const [fileCardsByPath, setFileCardsByPath] = useState<Record<string, Card[]>>({})
  const [fileCardsLoading, setFileCardsLoading] = useState<Record<string, boolean>>({})
  const [uiError, setUiError] = useState<string>('')
  const [confirmQuitOpen, setConfirmQuitOpen] = useState(false)

  const [session, setSession] = usePersistedState<StudySessionV1 | null>('study_session_v1', null)
  const didInitialRestoreRef = useRef(false)
  const restoringRef = useRef(false)
  const inputPersistTimerRef = useRef<number | null>(null)

  const SESSION_INPUT_KEY = 'study_session_input_v1'

  const isNonRestorablePhase = (p: StudySessionV1['phase']) =>
    p === 'match-game' ||
    p === 'match-summary' ||
    p === 'srs-studying' ||
    p === 'srs-review-result' ||
    p === 'srs-summary'

  const makeCardKey = (source: string | undefined, word: string, meaning: string) => {
    const s = String(source || '').trim()
    const w = String(word || '').trim().toLowerCase()
    const m = String(meaning || '').trim().toLowerCase()
    return `${s}||${w}||${m}`
  }

  const toCardId = (c: Card): CardId => ({
    source: c.source,
    word: String(c.word || ''),
    meaning: String(c.meaning || ''),
  })

  const buildSessionSnapshot = (): StudySessionV1 => ({
    v: 1,
    phase,
    round: Number(round) || 1,
    selectedFiles: Array.isArray(selectedFiles) ? selectedFiles : [],
    fileConfigs: fileConfigs || {},
    index: Number(index) || 0,
    revealLevel: Number(revealLevel) || 0,
    lastAnswerCorrect: lastAnswerCorrect ?? null,
    stats,
    deck: (deck || []).map(toCardId),
    queue: (queue || []).map(toCardId),
    toReview: (toReview || []).map(toCardId),
  })

  useEffect(() => {
    toReviewRef.current = toReview
  }, [toReview])

  // Restore an in-progress session on initial mount
  useEffect(() => {
    if (didInitialRestoreRef.current) return
    if (!session || session.phase === 'idle') return
    if (phase !== 'idle') return

    // Some phases rely on transient in-memory state that we don't persist.
    // Restoring into them can render a blank screen (e.g., SRS queue isn't stored).
    if (isNonRestorablePhase(session.phase)) {
      didInitialRestoreRef.current = true
      setUiError('Phiên học trước không thể khôi phục. Hãy bắt đầu lại.')
      setSession(null)
      try {
        window.localStorage.removeItem(SESSION_INPUT_KEY)
      } catch {}
      return
    }

    didInitialRestoreRef.current = true
    restoringRef.current = true

    ;(async () => {
      try {
        setSelectedFiles(session.selectedFiles || [])
        setFileConfigs(session.fileConfigs || {})
        if (session.stats) setStats(session.stats)

        // Rebuild cards by reading sources and matching (source + word + meaning)
        const allIds: CardId[] = [...(session.deck || []), ...(session.queue || []), ...(session.toReview || [])]
        const sources = Array.from(new Set(allIds.map((x) => String(x?.source || '')).filter(Boolean)))

        const cardMap = new Map<string, Card>()
        for (const src of sources) {
          const cards = await fetchCsvForFile(src)
          for (const c of cards || []) {
            cardMap.set(makeCardKey(src, c.word, c.meaning), c)
          }
        }

        const rebuild = (ids: CardId[]) =>
          (ids || []).map((id) => {
            const src = String(id?.source || '')
            const w = String(id?.word || '')
            const m = String(id?.meaning || '')
            return (
              cardMap.get(makeCardKey(src, w, m)) || {
                word: w,
                meaning: m,
                pronunciation: '',
                example: '',
                source: src,
              }
            )
          })

        const restoredDeck = rebuild(session.deck || [])
        const restoredQueue = rebuild(session.queue || [])
        const restoredToReview = rebuild(session.toReview || [])

        setDeck(restoredDeck)
        setQueue(restoredQueue)
        setToReview(restoredToReview)
        toReviewRef.current = restoredToReview

        setRound(Number(session.round) || 1)

        const maxIdx = Math.max(0, restoredQueue.length - 1)
        const idx = Math.max(0, Math.min(Number(session.index) || 0, maxIdx))
        setIndex(idx)
        setRevealLevel(Number(session.revealLevel) || 0)
        setLastAnswerCorrect(session.lastAnswerCorrect ?? null)

        // Input is persisted separately to avoid heavy session writes while typing.
        try {
          const persistedInput = window.localStorage.getItem(SESSION_INPUT_KEY) || ''
          setInput(persistedInput)
        } catch {
          setInput('')
        }

        setPhase(session.phase)
      } catch (err) {
        console.error('Failed to restore study session', err)
      } finally {
        restoringRef.current = false
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Persist session snapshot (excluding typing frequency concerns)
  useEffect(() => {
    if (restoringRef.current) return

    const t = window.setTimeout(() => {
      if (restoringRef.current) return

      if (phase === 'idle') {
        setSession(null)
        try {
          window.localStorage.removeItem(SESSION_INPUT_KEY)
        } catch {}
        return
      }

      if (isNonRestorablePhase(phase)) {
        // Don't persist transient phases (prevents blank restore on reload).
        setSession(null)
        try {
          window.localStorage.removeItem(SESSION_INPUT_KEY)
        } catch {}
        return
      }

      setSession(buildSessionSnapshot())
    }, 200)

    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, round, selectedFiles, fileConfigs, index, revealLevel, lastAnswerCorrect, stats, queue, deck, toReview])

  // Persist current input with debounce (so it restores mid-typing without rewriting the whole session).
  useEffect(() => {
    if (restoringRef.current) return
    if (phase === 'idle') return
    if (inputPersistTimerRef.current != null) window.clearTimeout(inputPersistTimerRef.current)
    inputPersistTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SESSION_INPUT_KEY, String(input || ''))
      } catch {}
    }, 350)
    return () => {
      if (inputPersistTimerRef.current != null) window.clearTimeout(inputPersistTimerRef.current)
    }
  }, [input, phase])

  const defaultFileConfig = (): FileStudyConfig => ({
    mode: 'all',
    randomCount: 20,
    rangeStart: 1,
    rangeEnd: 10,
    selectedMap: {},
  })

  useEffect(()=>{ 
    window.api.listTree().then((t:any)=>setTree(t))
    window.api.pdfList?.().then((p:any)=>setPdfList(p || [])).catch(()=>{})
  }, [])

  // Auto-start if files are passed via navigation state
  useEffect(() => {
    const state = (location.state as { selectedFiles?: string[] } | null);
    if (state?.selectedFiles && state.selectedFiles.length > 0) {
      setSelectedFiles(state.selectedFiles);
      // Auto-start study with these files
      setTimeout(() => {
        handleAutoStart(state.selectedFiles!);
      }, 100);
    }
  }, [location]);

  async function handleAutoStart(files: string[]) {
    // Auto-start defaults to "all" mode for each file.
    const cfg: Record<string, FileStudyConfig> = {}
    for (const f of files) cfg[f] = defaultFileConfig()
    await startSession(files, cfg)
  }

  const ipaCore = (val: string) => {
    const v = String(val || '').trim().replace(/"/g, '')
    if (!v) return ''
    return v.replace(/^\/+|\/+$/g, '')
  }

  const escapeRegex = (s: string) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const maskTargetInExample = (exampleRaw: string, wordRaw: string) => {
    const example = String(exampleRaw || '')
    const word = String(wordRaw || '').trim()
    if (!example.trim() || !word) return example

    const mask = word.replace(/\S/g, '_')

    // Prefer whole-word matching for simple A-Z words to avoid masking substrings.
    if (/^[A-Za-z]+$/.test(word)) {
      const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi')
      return example.replace(re, mask)
    }

    // Fallback: exact substring matching (case-insensitive).
    const re = new RegExp(escapeRegex(word), 'gi')
    return example.replace(re, mask)
  }

  async function fetchCsvForFile(filePath: string): Promise<Card[]> {
    try {
      const rows = await window.api.readCsv(filePath)
      const out: Card[] = []
      for (const r of rows || []) {
        if (!r?.word || !r?.meaning) continue
        out.push({
          word: String(r.word),
          meaning: String(r.meaning),
          pronunciation: ipaCore(r.pronunciation || ''),
          example: String(r.example || ''),
          source: filePath,
        })
      }
      return out
    } catch (err) {
      console.error('readCsv error', filePath, err)
      return []
    }
  }

  function applyLearnModeForFile(allCards: Card[], cfg: FileStudyConfig): Card[] {
    const mode = cfg?.mode || 'all'
    if (mode === 'all') return allCards

    if (mode === 'random') {
      const count = Math.max(1, Math.min(Number(cfg.randomCount) || 1, allCards.length))
      const shuffled = shuffle([...allCards])
      return shuffled.slice(0, count)
    }

    if (mode === 'range') {
      const start = Math.max(0, (Number(cfg.rangeStart) || 1) - 1)
      const end = Math.min(allCards.length, Number(cfg.rangeEnd) || allCards.length)
      return allCards.slice(start, end)
    }

    if (mode === 'select') {
      const sel = cfg.selectedMap || {}
      return allCards.filter((_, idx) => !!sel[idx])
    }

    return allCards
  }

  async function startSession(files: string[], cfgByFile?: Record<string, FileStudyConfig>) {
    const configs = cfgByFile || fileConfigs

    setUiError('')

    // Validate select mode: must pick at least 1 word per select-file
    for (const f of files) {
      const cfg = configs?.[f]
      if (cfg?.mode === 'select') {
        const hasAny = Object.values(cfg.selectedMap || {}).some(Boolean)
        if (!hasAny) {
          setUiError(`Bạn đang chọn chế độ "tự chọn" nhưng chưa chọn từ nào cho file: ${f}`)
          return
        }
      }
    }

    const combined: Card[] = []
    for (const f of files) {
      const cfg = configs?.[f] || defaultFileConfig()
      const cached = fileCardsByPath[f]
      const cards = Array.isArray(cached) ? cached : await fetchCsvForFile(f)
      const subset = applyLearnModeForFile(cards, cfg)
      combined.push(...subset)
    }

    const shuffled = shuffle(combined)
    setDeck(shuffled)
    
    // Check study mode and start appropriate game
    if (studyMode === 'match') {
      startMatchGame(shuffled)
    } else {
      // Spelling mode (default)
      setQueue(shuffled.slice())
      setIndex(0)
      setRound(1)
      setPhase('studying')
      setRevealLevel(0)
      setToReview([])
      toReviewRef.current = []
      setLastAnswerCorrect(null)
      setInput('')
      setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
    }
  }

  function maskWordAllUnderscore(w:string, revealCount:number){
    if (!w) return ''
    const chars = w.split('')
    if (revealCount <= 0) return chars.map(()=> '_').join(' ')
    const total = chars.length
    const reveal = Math.min(total, revealCount)
    return chars.map((ch,i)=> i < reveal ? ch : '_').join(' ')
  }

  async function lookupIPA(word:string){
    if (!word) return ''
    try{
      if (window.api?.suggestIpa) {
        const out = await window.api.suggestIpa({ word, dialect: 'US' })
        const cleaned = String(out || '').trim()
        if (cleaned) return cleaned.replace(/\//g,'')
      }
      const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
      if (!resp.ok) return ''
      const data = await resp.json()
      if (Array.isArray(data) && data[0].phonetics && data[0].phonetics.length>0){
        const ph = data[0].phonetics.find((p:any)=>p.text && p.text.includes('/'))
        if (ph && ph.text) return ph.text.replace(/\//g,'')
        return data[0].phonetics[0].text?.replace(/\//g,'') || ''
      }
      return ''
    }catch(err){
      console.error('IPA lookup failed', err)
      return ''
    }
  }

  async function start(){
    await startSession(selectedFiles)
  }

  function updateFileConfig(filePath: string, patch: Partial<FileStudyConfig>) {
    setFileConfigs((prev) => {
      const base = prev?.[filePath] || defaultFileConfig()
      return { ...(prev || {}), [filePath]: { ...base, ...patch } }
    })
  }

  function toggleSelectedWord(filePath: string, idx: number, checked: boolean) {
    setFileConfigs((prev) => {
      const base = prev?.[filePath] || defaultFileConfig()
      return {
        ...(prev || {}),
        [filePath]: {
          ...base,
          selectedMap: {
            ...(base.selectedMap || {}),
            [idx]: checked,
          },
        },
      }
    })
  }

  // handle submit answer
  async function submitAnswer(){
    if (phase !== 'studying') return
    const card = queue[index]
    if (!card) return
    const normalized = (input||'').trim().toLowerCase()
    const correct = (card.word||'').trim().toLowerCase()
    const isCorrect = normalized === correct
    setLastAnswerCorrect(isCorrect)
    // if pronunciation missing, try lookup
    if (!ipaCore(card.pronunciation || '')) {
      const ipa = await lookupIPA(card.word)
      if (ipa) card.pronunciation = ipaCore(ipa)
    }
    if (isCorrect) {
      setStats((s) => ({ ...s, correct: s.correct + 1 }))
    } else {
      setStats((s) => ({ ...s, incorrect: s.incorrect + 1 }))
    }
    setPhase('review-result')
  }

  // user choice after reveal: 1 replay, 2 easy, 3 hard
  function handleChoice(choice: 1|2|3){
    const card = queue[index]
    if (!card) return

    // Round-based learning:
    // - Round 1: all words
    // - Round N+1: all words that were wrong OR marked Again/Hard in round N
    const shouldReviewNextRound = choice === 1 || choice === 3 || lastAnswerCorrect === false
    if (shouldReviewNextRound) {
      const k = makeCardKey(card.source, card.word, card.meaning)
      const prev = toReviewRef.current || []
      const exists = prev.some((c) => makeCardKey(c.source, c.word, c.meaning) === k)
      if (!exists) {
        const next = [...prev, card]
        toReviewRef.current = next
        setToReview(next)
      }
    }

    if (choice === 2){
      // mark easy: do nothing (card considered learned)
      setStats((s) => ({ ...s, easy: s.easy + 1 }))
      // ✅ Thêm từ vào SRS khi user đánh dấu Easy (đã thuộc)
      addCardToSRS(card)
    } else if (choice === 3){
      // mark hard: requeue
      setStats((s) => ({ ...s, hard: s.hard + 1 }))
      // ✅ Cũng thêm vào SRS nhưng với interval ngắn hơn (sẽ được xử lý trong addCardToSRS)
      addCardToSRS(card)
    }
    // choice === 1 (Again): không thêm vào SRS, để user học lại round sau

    // advance
    advanceAfterResult()
  }

  function advanceAfterResult(){
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)

    const nextIndex = index + 1
    if (nextIndex < queue.length) {
      setIndex(nextIndex)
      if (phase === 'review-result') setPhase('studying')
      return
    }

    // End of round -> next round is the accumulated review list
    const reviewCards = toReviewRef.current || []
    if (reviewCards.length > 0) {
      setQueue(shuffle([...reviewCards]))
      setToReview([])
      toReviewRef.current = []
      setIndex(0)
      setRound((r) => (Number(r) || 1) + 1)
      setPhase('studying')
      return
    }

    // Done: all words were marked easy in the last round
    setIndex(0)
    setPhase('summary')
  }

  function quitStudy(){
    setConfirmQuitOpen(true)
  }

  function doQuitStudy(){
    setPhase('idle')
    setQueue([])
    setDeck([])
    setIndex(0)
    setRevealLevel(0)
    setInput('')
    setToReview([])
    toReviewRef.current = []
    setLastAnswerCorrect(null)
    setRound(1)
    setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
    // Reset match game state
    if (matchTimerRef.current) {
      window.clearInterval(matchTimerRef.current)
      matchTimerRef.current = null
    }
    setMatchCards([])
    setMatchWords([])
    setMatchMeanings([])
    setMatchCorrect(0)
    setMatchIncorrect(0)
    setMatchElapsed(0)
    setMatchRound(1)
    setMatchTotalCards(0)
    setSelectedWord(null)
    setSelectedMeaning(null)
    setLastMatchResult(null)
    // Reset SRS state
    setSrsQueue([])
    setSrsIndex(0)
    setSrsStats({ reviewed: 0, correct: 0, incorrect: 0 })
  }

  // ==================== MATCH GAME LOGIC ====================
  const MATCH_BATCH_SIZE = 6 // Number of words per match round

  function startMatchGame(allCards: Card[]) {
    if (allCards.length === 0) return
    const shuffledCards = shuffle([...allCards])
    setMatchTotalCards(allCards.length)
    setMatchCards(shuffledCards)
    setMatchCorrect(0)
    setMatchIncorrect(0)
    setMatchRound(1)
    setMatchElapsed(0)
    const startTime = Date.now()
    setMatchStartTime(startTime)
    loadMatchRound(shuffledCards, 1)
    setPhase('match-game')
    
    // Timer will be started by useEffect when phase changes to 'match-game'
  }

  function loadMatchRound(cards: Card[], roundNum: number) {
    const startIdx = (roundNum - 1) * MATCH_BATCH_SIZE
    const batch = cards.slice(startIdx, startIdx + MATCH_BATCH_SIZE)
    
    if (batch.length === 0) {
      // Game complete
      if (matchTimerRef.current) {
        window.clearInterval(matchTimerRef.current)
        matchTimerRef.current = null
      }
      setPhase('match-summary')
      return
    }

    const words = batch.map((c, i) => ({ id: startIdx + i, word: c.word, matched: false }))
    const meanings = shuffle(batch.map((c, i) => ({ id: startIdx + i, meaning: c.meaning, matched: false })))
    
    setMatchWords(words)
    setMatchMeanings(meanings)
    setSelectedWord(null)
    setSelectedMeaning(null)
    setLastMatchResult(null)
  }

  // Update timer display
  useEffect(() => {
    if (phase !== 'match-game' || matchStartTime === 0) {
      if (matchTimerRef.current) {
        window.clearInterval(matchTimerRef.current)
        matchTimerRef.current = null
      }
      return
    }
    
    // Clear any existing timer first
    if (matchTimerRef.current) {
      window.clearInterval(matchTimerRef.current)
    }
    
    // Update immediately
    setMatchElapsed(Math.floor((Date.now() - matchStartTime) / 1000))
    
    // Then start interval
    matchTimerRef.current = window.setInterval(() => {
      setMatchElapsed(Math.floor((Date.now() - matchStartTime) / 1000))
    }, 1000) // Update every second instead of 100ms for smoother display
    
    return () => {
      if (matchTimerRef.current) {
        window.clearInterval(matchTimerRef.current)
        matchTimerRef.current = null
      }
    }
  }, [phase, matchStartTime])

  function handleWordClick(id: number) {
    if (matchWords.find(w => w.id === id)?.matched) return
    setSelectedWord(id)
    setLastMatchResult(null)
    
    if (selectedMeaning !== null) {
      checkMatch(id, selectedMeaning)
    }
  }

  function handleMeaningClick(id: number) {
    if (matchMeanings.find(m => m.id === id)?.matched) return
    setSelectedMeaning(id)
    setLastMatchResult(null)
    
    if (selectedWord !== null) {
      checkMatch(selectedWord, id)
    }
  }

  function checkMatch(wordId: number, meaningId: number) {
    const isCorrect = wordId === meaningId
    
    if (isCorrect) {
      setMatchCorrect(c => c + 1)
      setLastMatchResult('correct')
      // Mark as matched
      setMatchWords(prev => prev.map(w => w.id === wordId ? { ...w, matched: true } : w))
      setMatchMeanings(prev => prev.map(m => m.id === meaningId ? { ...m, matched: true } : m))
      
      // Check if round complete
      setTimeout(() => {
        const allMatched = matchWords.every(w => w.id === wordId || w.matched)
        if (allMatched) {
          // Move to next round
          const nextRound = matchRound + 1
          const totalRounds = Math.ceil(matchCards.length / MATCH_BATCH_SIZE)
          if (nextRound > totalRounds) {
            if (matchTimerRef.current) {
              window.clearInterval(matchTimerRef.current)
              matchTimerRef.current = null
            }
            // ✅ Thêm tất cả từ đã match vào SRS khi hoàn thành game
            matchCards.forEach(card => addCardToSRS(card))
            setPhase('match-summary')
          } else {
            setMatchRound(nextRound)
            loadMatchRound(matchCards, nextRound)
          }
        }
      }, 300)
    } else {
      setMatchIncorrect(c => c + 1)
      setLastMatchResult('incorrect')
    }
    
    setSelectedWord(null)
    setSelectedMeaning(null)
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  // ==================== END MATCH GAME ====================

  // ==================== SRS FUNCTIONS ====================
  
  // Calculate SRS stats - chỉ hiển thị từ đã học qua Custom Study
  const srsStatsComputed = useMemo(() => {
    const dueCards = getDueCards(srsStore)
    const totalInSRS = Object.keys(srsStore).length
    
    return {
      due: dueCards.length,
      total: totalInSRS,
      mastered: Object.values(srsStore).filter(c => c.repetitions >= 5).length,
    }
  }, [srsStore])

  // Calendar data for SRS - group words by scheduled review date
  const [calendarExpandedDay, setCalendarExpandedDay] = useState<string | null>(null)
  
  const srsCalendarData = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const cards = Object.values(srsStore)
    
    // Create map for next 14 days
    const dayMap: Record<string, { date: Date; dateStr: string; dayName: string; cards: SRSCardData[]; isToday: boolean; isPast: boolean }> = {}
    
    for (let i = 0; i < 14; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const key = d.toISOString().split('T')[0]
      const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
      dayMap[key] = {
        date: d,
        dateStr: `${d.getDate()}/${d.getMonth() + 1}`,
        dayName: dayNames[d.getDay()],
        cards: [],
        isToday: i === 0,
        isPast: false,
      }
    }
    
    // Also track overdue (past due)
    let overdueCards: SRSCardData[] = []
    
    // Assign cards to days
    for (const card of cards) {
      const reviewDate = new Date(card.nextReview)
      const reviewDay = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate())
      const key = reviewDay.toISOString().split('T')[0]
      
      if (reviewDay < today) {
        overdueCards.push(card)
      } else if (dayMap[key]) {
        dayMap[key].cards.push(card)
      }
      // Cards beyond 14 days are not shown in calendar
    }
    
    // Sort cards within each day by word
    for (const key of Object.keys(dayMap)) {
      dayMap[key].cards.sort((a, b) => a.word.localeCompare(b.word))
    }
    overdueCards.sort((a, b) => a.word.localeCompare(b.word))
    
    return {
      days: Object.values(dayMap),
      overdue: overdueCards,
    }
  }, [srsStore])

  // Start SRS session - CHỈ ôn các từ đã học qua Custom Study
  async function startSRSSession() {
    // Get due cards from SRS store (chỉ những từ đã học trước đó)
    const dueCards = getDueCards(srsStore)
    
    if (dueCards.length === 0) {
      if (Object.keys(srsStore).length === 0) {
        setUiError('Chưa có từ nào trong hệ thống ôn tập. Hãy học từ mới qua Custom Study trước!')
      } else {
        setUiError('Tuyệt vời! Bạn đã ôn tập hết tất cả từ hôm nay. Quay lại sau nhé!')
      }
      return
    }

    setSrsQueue(shuffle([...dueCards]))
    setSrsIndex(0)
    setSrsStats({ reviewed: 0, correct: 0, incorrect: 0 })
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    setPhase('srs-studying')
  }

  // Thêm từ vào SRS store khi học xong ở Custom Study
  function addCardToSRS(card: Card) {
    const key = makeSRSKey(card.source, card.word, card.meaning)
    if (srsStore[key]) return // Đã có rồi
    
    const srsCard = cardToSRSData(card)
    // Đặt nextReview là ngày mai (đã học xong hôm nay, ôn lại ngày mai)
    srsCard.nextReview = Date.now() + 24 * 60 * 60 * 1000
    srsCard.interval = 1
    srsCard.repetitions = 1 // Đã học 1 lần
    
    const newStore = { ...srsStore, [key]: srsCard }
    setSrsStore(newStore)
    saveSRSStore(newStore)
  }

  // Handle SRS answer submission
  async function submitSRSAnswer() {
    if (phase !== 'srs-studying') return
    const card = srsQueue[srsIndex]
    if (!card) return
    
    const normalized = (input || '').trim().toLowerCase()
    const correct = (card.word || '').trim().toLowerCase()
    const isCorrect = normalized === correct
    
    setLastAnswerCorrect(isCorrect)
    
    // Lookup IPA if missing
    if (!ipaCore(card.pronunciation || '')) {
      const ipa = await lookupIPA(card.word)
      if (ipa) card.pronunciation = ipaCore(ipa)
    }
    
    if (isCorrect) {
      setSrsStats(s => ({ ...s, correct: s.correct + 1 }))
    } else {
      setSrsStats(s => ({ ...s, incorrect: s.incorrect + 1 }))
    }
    
    setPhase('srs-review-result')
  }

  // Handle SRS quality rating (1=Again, 2=Hard, 3=Good, 4=Easy)
  function handleSRSQuality(quality: 1 | 2 | 3 | 4) {
    const card = srsQueue[srsIndex]
    if (!card) return
    
    // Map user choice to SM-2 quality (0-5)
    // 1 (Again) -> 1 (incorrect)
    // 2 (Hard)  -> 3 (correct with difficulty)  
    // 3 (Good)  -> 4 (correct with hesitation)
    // 4 (Easy)  -> 5 (perfect)
    const sm2Quality = quality === 1 ? 1 : quality === 2 ? 3 : quality === 3 ? 4 : 5
    
    // Update SRS data
    const updatedCard = calculateSM2(card, sm2Quality)
    const newStore = { ...srsStore, [updatedCard.key]: updatedCard }
    setSrsStore(newStore)
    saveSRSStore(newStore)
    
    setSrsStats(s => ({ ...s, reviewed: s.reviewed + 1 }))
    
    // Advance to next card
    advanceAfterSRSResult()
  }

  function advanceAfterSRSResult() {
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    
    const nextIndex = srsIndex + 1
    if (nextIndex < srsQueue.length) {
      setSrsIndex(nextIndex)
      setPhase('srs-studying')
      return
    }
    
    // Session complete
    setPhase('srs-summary')
  }

  // Format next review time
  function formatNextReview(timestamp: number): string {
    const now = Date.now()
    const diff = timestamp - now
    
    if (diff <= 0) return 'Now'
    
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days > 0) return `${days}d`
    if (hours > 0) return `${hours}h`
    if (minutes > 0) return `${minutes}m`
    return 'Now'
  }
  // ==================== END SRS ====================

  // Keyboard handling: only keep a global listener for result shortcuts (1/2/3/4).
  // Enter submit is handled on the input itself to avoid global listeners reacting to typing.
  useEffect(() => {
    if (phase !== 'review-result' && phase !== 'srs-review-result') return
    const onKey = (e: KeyboardEvent) => {
      const validKeys = phase === 'srs-review-result' 
        ? ['1', '2', '3', '4'] 
        : ['1', '2', '3']
      if (!validKeys.includes(e.key)) return

      // Prevent the shortcut keystroke from being "typed" into the next card's input
      // when we immediately advance and re-focus the input.
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return

      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        active.blur()
      }

      if (phase === 'srs-review-result') {
        handleSRSQuality(Number(e.key) as 1 | 2 | 3 | 4)
      } else {
        handleChoice(Number(e.key) as 1 | 2 | 3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Keep typing responsive: focus the input when starting/advancing in studying phase.
  useEffect(() => {
    if (phase !== 'studying' && phase !== 'srs-studying') return
    const t = window.setTimeout(() => {
      try {
        inputRef.current?.focus()
      } catch {}
    }, 0)
    return () => window.clearTimeout(t)
  }, [phase, index])

  // Recursively get all files from tree
  function getAllFiles(nodes: any[]): any[] {
    let files: any[] = []
    for (const node of nodes) {
      if (node.type === 'file') {
        files.push(node)
      } else if (node.children?.length > 0) {
        files = files.concat(getAllFiles(node.children))
      }
    }
    return files
  }

  // Get all PDF deck files
  function getPdfDeckFiles(): any[] {
    return (pdfList || []).map((pdf) => ({ 
      name: `${pdf.baseName} (PDF)`, 
      path: pdf.deckCsvPath 
    }))
  }

  // Ensure we have configs/cards for all selected files
  useEffect(() => {
    if (!selectedFiles || selectedFiles.length === 0) return

    // Ensure config exists
    setFileConfigs((prev) => {
      const next = { ...(prev || {}) }
      for (const f of selectedFiles) {
        if (!next[f]) next[f] = defaultFileConfig()
      }
      // prune removed
      for (const k of Object.keys(next)) {
        if (!selectedFiles.includes(k)) delete next[k]
      }
      return next
    })

    // Load missing cards
    ;(async () => {
      for (const f of selectedFiles) {
        if (fileCardsByPath[f] || fileCardsLoading[f]) continue
        try {
          setFileCardsLoading((p) => ({ ...(p || {}), [f]: true }))
          const cards = await fetchCsvForFile(f)
          setFileCardsByPath((p) => ({ ...(p || {}), [f]: cards }))
          // If range end is still default, adjust to file length
          setFileConfigs((p) => {
            const cur = p?.[f]
            if (!cur) return p
            if (cur.rangeEnd !== 10) return p
            return { ...p, [f]: { ...cur, rangeEnd: Math.min(10, cards.length || 10) } }
          })
        } finally {
          setFileCardsLoading((p) => ({ ...(p || {}), [f]: false }))
        }
      }
    })().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFiles])

  // progress counts
  const totalToLearn = queue.length
  const currentPos = Math.min(index+1, totalToLearn)
  const allFiles = useMemo(() => getAllFiles(tree), [tree])
  const pdfDeckFiles = useMemo(() => getPdfDeckFiles(), [pdfList])

  const needsQueueButEmpty =
    ((phase === 'studying' || phase === 'review-result' || phase === 'summary') && queue.length === 0) ||
    ((phase === 'srs-studying' || phase === 'srs-review-result') && srsQueue.length === 0)

  return (
    <ErrorBoundary>
      {confirmQuitOpen && (
        <ConfirmModal
          title="Quit study session?"
          message="Bạn có chắc muốn thoát trò chơi?"
          confirmText="Quit"
          cancelText="Cancel"
          danger
          onCancel={() => setConfirmQuitOpen(false)}
          onConfirm={() => {
            setConfirmQuitOpen(false)
            doQuitStudy()
          }}
        />
      )}
      <div className="study-page min-h-screen bg-gradient-to-br from-violet-50 via-purple-50/30 to-pink-50/20 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-6">

      {needsQueueButEmpty && (
        <div className="max-w-3xl mx-auto">
          <div className="card animate-scale-in">
            <div className="card-header text-2xl">
              Phiên học không còn hợp lệ
            </div>
            <div className="p-6 text-slate-700 dark:text-slate-300 space-y-4">
              <p>
                Dữ liệu phiên học trước không thể khôi phục (có thể do app vừa cập nhật hoặc danh sách từ đã thay đổi).
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setPhase('idle')
                    setDeck([])
                    setQueue([])
                    setToReview([])
                    setIndex(0)
                    setRevealLevel(0)
                    setLastAnswerCorrect(null)
                    setInput('')
                    setSrsQueue([])
                    setSrsIndex(0)
                    setUiError('')
                    setSession(null)
                    try {
                      window.localStorage.removeItem(SESSION_INPUT_KEY)
                    } catch {}
                  }}
                >
                  Quay về menu Study
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Selection Phase */}
      {phase === 'idle' && (
        <div className="max-w-5xl mx-auto animate-fade-in">
          {uiError && (
            <div className="alert alert-error mb-6 animate-slide-down">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{uiError}</span>
              <button className="ml-auto text-xs text-red-700 underline" type="button" onClick={() => setUiError('')}>Close</button>
            </div>
          )}
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-block p-5 bg-gradient-to-br from-violet-500 via-purple-500 to-pink-500 rounded-3xl shadow-2xl shadow-purple-500/30 mb-5 animate-bounce-subtle">
              <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h1 className="text-5xl font-bold gradient-text mb-3">Study Session</h1>
            <p className="text-lg text-slate-600 dark:text-slate-400">Master your vocabulary with interactive flashcards</p>
          </div>

          {/* Tab Selector */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex bg-white dark:bg-slate-800 rounded-2xl p-1.5 shadow-lg border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setStudyTab('custom')}
                className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                  studyTab === 'custom'
                    ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Custom Study
              </button>
              <button
                onClick={() => setStudyTab('smart')}
                className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                  studyTab === 'smart'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Smart Review
                {srsStatsComputed.due > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                    {srsStatsComputed.due}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Custom Study Tab */}
          {studyTab === 'custom' && (
            <div className="card animate-scale-in">
              <div className="card-header text-2xl">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                Select Files to Study
              </div>
            
              {allFiles.length === 0 && getPdfDeckFiles().length === 0 ? (
                <div className="text-center py-16">
                  <div className="inline-block p-6 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 rounded-3xl mb-6">
                    <svg className="w-20 h-20 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">No files available</p>
                  <p className="text-slate-500 dark:text-slate-400">Create some vocabulary files first in Manager</p>
                </div>
              ) : (
                <div className="study-file-list space-y-3 max-h-[55vh] mb-4">
                  {allFiles.concat(pdfDeckFiles).map((f: any, i: number) => {
                    const checked = selectedFiles.includes(f.path)
                    const cfg = fileConfigs[f.path] || defaultFileConfig()
                    const cards = fileCardsByPath[f.path] || []
                    const loading = !!fileCardsLoading[f.path]

                  return (
                    <div
                      key={i}
                      className={`p-5 rounded-2xl border-2 transition-all duration-200 ${
                        checked 
                          ? 'border-violet-400 dark:border-violet-500 bg-gradient-to-br from-violet-50 via-blue-50 to-purple-50 dark:from-violet-900/30 dark:via-blue-900/20 dark:to-purple-900/20 shadow-lg shadow-violet-500/20' 
                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const s = [...selectedFiles]
                            if (e.target.checked) {
                              s.push(f.path)
                              updateFileConfig(f.path, {})
                            } else {
                              const idx = s.indexOf(f.path)
                              if (idx >= 0) s.splice(idx, 1)
                            }
                            setSelectedFiles(s)
                          }}
                          className="w-5 h-5 text-violet-500 rounded focus:ring-2 focus:ring-violet-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 dark:text-white truncate">{f.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{f.path}</div>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {checked ? (loading ? 'Loading…' : `${cards.length} words`) : ''}
                        </div>
                      </div>

                      {checked && (
                        <div className="mt-4 pl-8">
                          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Choose Learning Mode (per file)</div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => updateFileConfig(f.path, { mode: 'all' })}
                              className={`p-3 rounded-lg border-2 transition-all ${
                                cfg.mode === 'all'
                                  ? 'border-violet-500 bg-white dark:bg-slate-700 font-semibold text-violet-700 dark:text-violet-300'
                                  : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                              }`}
                            >
                              1. All
                            </button>
                            <button
                              type="button"
                              onClick={() => updateFileConfig(f.path, { mode: 'random' })}
                              className={`p-3 rounded-lg border-2 transition-all ${
                                cfg.mode === 'random'
                                  ? 'border-violet-500 bg-white dark:bg-slate-700 font-semibold text-violet-700 dark:text-violet-300'
                                  : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                              }`}
                            >
                              2. Random
                            </button>
                            <button
                              type="button"
                              onClick={() => updateFileConfig(f.path, { mode: 'select' })}
                              className={`p-3 rounded-lg border-2 transition-all ${
                                cfg.mode === 'select'
                                  ? 'border-violet-500 bg-white dark:bg-slate-700 font-semibold text-violet-700 dark:text-violet-300'
                                  : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                              }`}
                            >
                              3. Select
                            </button>
                            <button
                              type="button"
                              onClick={() => updateFileConfig(f.path, { mode: 'range' })}
                              className={`p-3 rounded-lg border-2 transition-all ${
                                cfg.mode === 'range'
                                  ? 'border-violet-500 bg-white dark:bg-slate-700 font-semibold text-violet-700 dark:text-violet-300'
                                  : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                              }`}
                            >
                              4. Range
                            </button>
                          </div>

                          {cfg.mode === 'random' && (
                            <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600">
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Random Count:</label>
                              <input
                                type="number"
                                min={1}
                                value={cfg.randomCount}
                                onChange={(e) => updateFileConfig(f.path, { randomCount: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="input-field"
                              />
                            </div>
                          )}

                          {cfg.mode === 'range' && (
                            <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600 space-y-2">
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Range From:</label>
                              <input
                                type="number"
                                min={1}
                                value={cfg.rangeStart}
                                onChange={(e) => updateFileConfig(f.path, { rangeStart: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="input-field"
                              />
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">Range To:</label>
                              <input
                                type="number"
                                min={1}
                                value={cfg.rangeEnd}
                                onChange={(e) => updateFileConfig(f.path, { rangeEnd: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="input-field"
                              />
                              <div className="text-xs text-slate-500 dark:text-slate-400">Max: {cards.length}</div>
                            </div>
                          )}

                          {cfg.mode === 'select' && (
                            <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600">
                              <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Select Words:</div>
                              {loading ? (
                                <div className="text-sm text-slate-500 dark:text-slate-400">Loading words…</div>
                              ) : cards.length === 0 ? (
                                <div className="text-sm text-slate-500 dark:text-slate-400">No words found in this file.</div>
                              ) : (
                                <div className="max-h-56 overflow-y-auto">
                                  <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-100 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                      <tr>
                                        <th className="px-3 py-2">#</th>
                                        <th className="px-3 py-2">Word</th>
                                        <th className="px-3 py-2">Meaning</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {cards.map((card, idx) => (
                                        <tr key={idx} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                          <td className="px-3 py-2">
                                            <input
                                              type="checkbox"
                                              checked={!!cfg.selectedMap?.[idx]}
                                              onChange={(e) => toggleSelectedWord(f.path, idx, e.target.checked)}
                                              className="w-4 h-4"
                                            />
                                          </td>
                                          <td className="px-3 py-2 font-medium dark:text-slate-200">{card.word}</td>
                                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{card.meaning}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {selectedFiles.length > 0 && (
              <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-violet-500 rounded-xl flex items-center justify-center text-white font-bold shadow-md">
                      {selectedFiles.length}
                    </div>
                    <span className="font-semibold">file(s) selected</span>
                  </div>
                </div>

                {/* Study Mode Selection */}
                <div className="mb-6">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Choose Study Mode</div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setStudyMode('spelling')}
                      className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                        studyMode === 'spelling'
                          ? 'border-violet-500 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/30 shadow-lg shadow-violet-500/20'
                          : 'border-slate-200 dark:border-slate-600 hover:border-violet-300 dark:hover:border-violet-600 bg-white dark:bg-slate-800'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        studyMode === 'spelling' 
                          ? 'bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg' 
                          : 'bg-slate-100 dark:bg-slate-700'
                      }`}>
                        <svg className={`w-6 h-6 ${studyMode === 'spelling' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <div className={`font-bold ${studyMode === 'spelling' ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-300'}`}>
                        ✏️ Spelling
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
                        Type the word from meaning
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStudyMode('match')}
                      className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                        studyMode === 'match'
                          ? 'border-emerald-500 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 shadow-lg shadow-emerald-500/20'
                          : 'border-slate-200 dark:border-slate-600 hover:border-emerald-300 dark:hover:border-emerald-600 bg-white dark:bg-slate-800'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        studyMode === 'match' 
                          ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg' 
                          : 'bg-slate-100 dark:bg-slate-700'
                      }`}>
                        <svg className={`w-6 h-6 ${studyMode === 'match' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                        </svg>
                      </div>
                      <div className={`font-bold ${studyMode === 'match' ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'}`}>
                        🎯 Match
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
                        Match words with meanings
                      </div>
                    </button>
                  </div>
                </div>

                <button
                  onClick={start}
                  className="btn-primary w-full py-4 text-xl flex items-center justify-center gap-3 shadow-xl hover:shadow-2xl"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Start {studyMode === 'match' ? 'Match Game' : 'Learning'}
                </button>
              </div>
            )}
            </div>
          )}

          {/* Smart Review Tab */}
          {studyTab === 'smart' && (
            <div className="card animate-scale-in">
              <div className="card-header text-2xl">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                Smart Review (Spaced Repetition)
              </div>

              {/* SRS Info */}
              <div className="mb-6 p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-800/50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-semibold text-emerald-800 dark:text-emerald-300 mb-1">Spaced Repetition System (SRS)</h4>
                    <p className="text-sm text-emerald-700 dark:text-emerald-400/80">
                      Ôn tập các từ đã học qua Custom Study. Từ nào bạn nhớ tốt sẽ được ôn sau, từ nào khó sẽ được ôn sớm hơn.
                    </p>
                  </div>
                </div>
              </div>

              {/* SRS Stats Grid */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 rounded-xl border border-red-200 dark:border-red-800 text-center">
                  <div className="text-3xl font-bold text-red-600 dark:text-red-400 mb-1">
                    {srsStatsComputed.due}
                  </div>
                  <div className="text-sm font-medium text-slate-600 dark:text-slate-400">🔔 Cần ôn</div>
                </div>
                <div className="p-4 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-xl border border-violet-200 dark:border-violet-800 text-center">
                  <div className="text-3xl font-bold text-violet-600 dark:text-violet-400 mb-1">
                    {srsStatsComputed.total}
                  </div>
                  <div className="text-sm font-medium text-slate-600 dark:text-slate-400">📚 Đã học</div>
                </div>
                <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-800 text-center">
                  <div className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">
                    {srsStatsComputed.mastered}
                  </div>
                  <div className="text-sm font-medium text-slate-600 dark:text-slate-400">🏆 Thuộc</div>
                </div>
              </div>

              {/* SRS Calendar - Review Schedule */}
              {srsStatsComputed.total > 0 && (
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">📅 Lịch ôn tập (14 ngày tới)</h3>
                  </div>
                  
                  {/* Overdue Warning */}
                  {srsCalendarData.overdue.length > 0 && (
                    <div 
                      className="mb-4 p-3 bg-gradient-to-r from-red-100 to-orange-100 dark:from-red-900/40 dark:to-orange-900/40 rounded-xl border-2 border-red-300 dark:border-red-700 cursor-pointer hover:shadow-md transition-all"
                      onClick={() => setCalendarExpandedDay(calendarExpandedDay === 'overdue' ? null : 'overdue')}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">⚠️</span>
                          <div>
                            <div className="font-bold text-red-700 dark:text-red-300">Quá hạn!</div>
                            <div className="text-sm text-red-600 dark:text-red-400">{srsCalendarData.overdue.length} từ cần ôn ngay</div>
                          </div>
                        </div>
                        <svg className={`w-5 h-5 text-red-600 dark:text-red-400 transition-transform ${calendarExpandedDay === 'overdue' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      {calendarExpandedDay === 'overdue' && (
                        <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-700">
                          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                            {srsCalendarData.overdue.map((card, i) => (
                              <span key={i} className="px-2 py-1 bg-white/80 dark:bg-slate-800/80 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 border border-red-200 dark:border-red-700">
                                {card.word}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Calendar Grid */}
                  <div className="grid grid-cols-7 gap-2">
                    {srsCalendarData.days.map((day, idx) => {
                      const hasCards = day.cards.length > 0
                      const isExpanded = calendarExpandedDay === day.date.toISOString()
                      const intensity = Math.min(day.cards.length, 10) // Cap at 10 for color intensity
                      
                      return (
                        <div
                          key={idx}
                          className={`relative rounded-xl border-2 transition-all cursor-pointer hover:shadow-lg ${
                            day.isToday
                              ? 'border-emerald-400 dark:border-emerald-500 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 ring-2 ring-emerald-400/50'
                              : hasCards
                                ? 'border-blue-300 dark:border-blue-600 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20'
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'
                          }`}
                          onClick={() => hasCards && setCalendarExpandedDay(isExpanded ? null : day.date.toISOString())}
                        >
                          <div className="p-2 text-center">
                            <div className={`text-xs font-bold mb-1 ${
                              day.isToday ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                            }`}>
                              {day.dayName}
                            </div>
                            <div className={`text-lg font-bold ${
                              day.isToday ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'
                            }`}>
                              {day.date.getDate()}
                            </div>
                            {hasCards ? (
                              <div className={`mt-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                                day.isToday
                                  ? 'bg-emerald-500 text-white'
                                  : 'bg-blue-500 text-white'
                              }`}>
                                {day.cards.length} từ
                              </div>
                            ) : (
                              <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">—</div>
                            )}
                            {day.isToday && (
                              <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  
                  {/* Expanded Day Details */}
                  {calendarExpandedDay && calendarExpandedDay !== 'overdue' && (() => {
                    const expandedDayData = srsCalendarData.days.find(d => d.date.toISOString() === calendarExpandedDay)
                    if (!expandedDayData || expandedDayData.cards.length === 0) return null
                    
                    return (
                      <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-700 animate-scale-in">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">📖</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {expandedDayData.isToday ? 'Hôm nay' : `${expandedDayData.dayName}, ${expandedDayData.dateStr}`}
                            </span>
                            <span className="px-2 py-0.5 bg-blue-500 text-white text-xs font-bold rounded-full">
                              {expandedDayData.cards.length} từ
                            </span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setCalendarExpandedDay(null) }}
                            className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                          {expandedDayData.cards.map((card, i) => (
                            <div
                              key={i}
                              className="group relative px-3 py-2 bg-white dark:bg-slate-800 rounded-xl border border-blue-200 dark:border-blue-700 hover:shadow-md transition-all"
                            >
                              <div className="font-semibold text-slate-800 dark:text-slate-200">{card.word}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[150px]">{card.meaning}</div>
                              {/* Tooltip with more info */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 dark:bg-slate-700 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-xl">
                                <div className="font-bold">{card.word}</div>
                                <div className="text-slate-300">{card.meaning}</div>
                                <div className="mt-1 text-emerald-400">Đã ôn {card.repetitions} lần</div>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-700" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  
                  {/* Legend */}
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span>Hôm nay</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-blue-500" />
                      <span>Có từ cần ôn</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-slate-300 dark:bg-slate-600" />
                      <span>Không có từ</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <span>Quá hạn</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Start Button or Empty State */}
              {srsStatsComputed.total === 0 ? (
                <div className="text-center py-8">
                  <div className="inline-block p-4 bg-slate-100 dark:bg-slate-700 rounded-2xl mb-4">
                    <svg className="w-12 h-12 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">Chưa có từ nào để ôn tập</p>
                  <p className="text-slate-500 dark:text-slate-400 mb-4">Hãy học từ mới qua <strong>Custom Study</strong> trước!</p>
                  <button
                    onClick={() => setStudyTab('custom')}
                    className="btn-primary px-6 py-2 flex items-center gap-2 mx-auto"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Đi đến Custom Study
                  </button>
                </div>
              ) : srsStatsComputed.due === 0 ? (
                <div className="text-center py-8">
                  <div className="inline-block p-4 bg-green-100 dark:bg-green-800/30 rounded-2xl mb-4">
                    <svg className="w-12 h-12 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-green-700 dark:text-green-300 mb-2">🎉 Tuyệt vời!</p>
                  <p className="text-slate-500 dark:text-slate-400 mb-4">Bạn đã ôn tập hết tất cả từ hôm nay. Quay lại sau nhé!</p>
                  <button
                    onClick={() => setStudyTab('custom')}
                    className="btn-secondary px-6 py-2 flex items-center gap-2 mx-auto"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Học thêm từ mới
                  </button>
                </div>
              ) : (
                <button
                  onClick={startSRSSession}
                  className="w-full py-4 text-xl flex items-center justify-center gap-3 shadow-xl hover:shadow-2xl rounded-xl font-semibold transition-all bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Bắt đầu ôn tập ({srsStatsComputed.due} từ)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Study Phase (Spelling Mode) */}
      {(phase === 'studying' || phase === 'review-result') && queue.length > 0 && (
        <div className="max-w-5xl mx-auto animate-fade-in">
          {/* Progress Header */}
          <div className="card mb-4">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                    Progress
                  </div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-full px-2 py-0.5">
                    Lượt {round}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">{currentPos}</div>
                  <div className="text-2xl text-slate-400 dark:text-slate-500">/</div>
                  <div className="text-2xl font-semibold text-slate-700 dark:text-slate-300">{totalToLearn}</div>
                </div>
                {/* Progress Bar */}
                <div className="w-48 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 transition-all duration-500 ease-out shadow-glow"
                    style={{ width: `${(currentPos / totalToLearn) * 100}%` }}
                  />
                </div>
              </div>
              <button
                onClick={quitStudy}
                className="btn-danger px-4 py-2 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Quit
              </button>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <div className="text-center p-3 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-800">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400 mb-1">{stats.correct}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400 font-medium flex items-center justify-center gap-1">
                  <span>✅</span> Correct
                </div>
              </div>
              <div className="text-center p-3 bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 rounded-xl border border-red-200 dark:border-red-800">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400 mb-1">{stats.incorrect}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400 font-medium flex items-center justify-center gap-1">
                  <span>❌</span> Incorrect
                </div>
              </div>
              <div className="text-center p-3 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-xl border border-orange-200 dark:border-orange-800">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400 mb-1">{stats.hard}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400 font-medium flex items-center justify-center gap-1">
                  <span>🔄</span> Hard
                </div>
              </div>
            </div>
          </div>

          {/* Study Card - Enhanced with better design */}
          <div className={phase === 'review-result' ? 'card !p-5 shadow-2xl border-2 border-slate-200 dark:border-slate-700 animate-scale-in' : 'card !p-6 shadow-2xl border-2 border-slate-200 dark:border-slate-700 animate-scale-in'}>
            {/* Meaning Display */}
            <div
              className={
                phase === 'review-result'
                  ? 'mb-3 max-h-[18vh] overflow-y-auto pr-2'
                  : 'mb-6'
              }
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/40 dark:to-pink-900/40 rounded-xl mb-3">
                <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
                <span className="text-sm font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wide">Meaning</span>
              </div>
              <div
                className={
                  phase === 'review-result'
                    ? 'text-lg font-semibold text-slate-900 dark:text-slate-100 leading-relaxed mb-2'
                    : 'text-2xl font-semibold text-slate-900 dark:text-slate-100 leading-relaxed mb-4'
                }
              >
                {queue[index].meaning}
              </div>

              <div className={phase === 'review-result' ? 'p-3 bg-gradient-to-br from-violet-50/50 to-purple-50/50 dark:from-violet-900/30 dark:to-purple-900/30 rounded-2xl border border-violet-100 dark:border-violet-800' : 'p-4 bg-gradient-to-br from-violet-50/50 to-purple-50/50 dark:from-violet-900/30 dark:to-purple-900/30 rounded-2xl border border-violet-100 dark:border-violet-800'}>
                <div className={phase === 'review-result' ? 'flex items-center gap-2 mb-2' : 'flex items-center gap-2 mb-3'}>
                  <svg className="w-5 h-5 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                  <span className="text-sm font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wide">Example</span>
                </div>
                <div className={phase === 'review-result' ? 'text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium' : 'text-base text-slate-800 dark:text-slate-200 leading-relaxed font-medium'}>
                  {String(queue[index].example || '').trim()
                    ? maskTargetInExample(String(queue[index].example || ''), String(queue[index].word || ''))
                    : <span className="text-slate-400 dark:text-slate-500 italic">No example provided</span>}
                </div>
              </div>
            </div>

            {phase === 'studying' && (
              <div className="space-y-5">
                {/* Word Display (masked) - Enhanced with flip card effect */}
                <div className="relative">
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary-500 via-purple-500 to-accent-500 rounded-2xl opacity-20 blur-xl"></div>
                  <div className="relative p-4 bg-gradient-to-br from-primary-50 via-purple-50 to-accent-50 rounded-2xl border-2 border-primary-200 shadow-lg">
                    <div className="text-xs font-bold text-primary-600 uppercase tracking-wide mb-1 text-center">Your Answer:</div>
                    <div className="text-3xl font-mono font-bold bg-gradient-to-r from-primary-600 via-purple-600 to-accent-600 bg-clip-text text-transparent tracking-[0.16em] text-center py-3">
                      {maskWordAllUnderscore(queue[index].word, revealLevel)}
                    </div>
                  </div>
                </div>

                {/* Controls - Enhanced */}
                <div className="flex flex-wrap gap-3 justify-center">
                  <button
                    onClick={() => {
                      try {
                        const ut = new SpeechSynthesisUtterance(queue[index].word)
                        window.speechSynthesis.speak(ut)
                      } catch (err) {
                        console.error('Speech error', err)
                      }
                    }}
                    className="btn-icon !w-auto px-4 py-2.5 flex items-center gap-2"
                    title="Speak word"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                    </svg>
                    Speak
                  </button>
                  <button
                    onClick={() => setRevealLevel(Math.max(0, revealLevel - 1))}
                    className="btn-secondary px-4 py-2.5 flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Less Hint
                  </button>
                  <button
                    onClick={() => setRevealLevel(Math.min(queue[index].word.length, revealLevel + 1))}
                    className="btn-secondary px-4 py-2.5 flex items-center gap-2"
                  >
                    More Hint
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                {/* Input - Enhanced */}
                <div className="space-y-4">
                  <input
                    ref={inputRef}
                    className="input-field text-lg text-center !py-3 font-semibold"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void submitAnswer()
                      }
                    }}
                    placeholder="Type your answer and press Enter..."
                    autoFocus
                  />
                  <button onClick={submitAnswer} className="btn-primary w-full py-3 text-lg font-bold">
                    Submit Answer ✨
                  </button>
                </div>
              </div>
            )}

            {phase === 'review-result' && (
              <div className="space-y-5 animate-scale-in">
                {/* Answer Reveal - Enhanced */}
                <div className={`relative overflow-hidden p-3 rounded-2xl border-2 shadow-xl transition-all ${
                  lastAnswerCorrect
                    ? 'bg-gradient-to-br from-green-50 via-emerald-50 to-green-100 border-green-300 shadow-green-500/20'
                    : 'bg-gradient-to-br from-red-50 via-pink-50 to-red-100 border-red-300 shadow-red-500/20'
                }`}>
                  <div className="absolute top-0 right-0 w-20 h-20 opacity-10">
                    {lastAnswerCorrect ? (
                      <svg className="w-full h-full text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-full h-full text-red-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="relative">
                    <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-xl mb-2 ${
                      lastAnswerCorrect ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
                    }`}>
                      <span className="text-lg">{lastAnswerCorrect ? '✅' : '❌'}</span>
                      <span className="text-xs font-bold uppercase tracking-wide">
                        {lastAnswerCorrect ? 'Correct!' : 'Incorrect'}
                      </span>
                    </div>
                    <div className={`text-3xl font-bold mb-1 ${
                      lastAnswerCorrect ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                    }`}>
                      {queue[index].word}
                    </div>
                    {ipaCore(queue[index].pronunciation || '') && (
                      <div className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                        /{ipaCore(queue[index].pronunciation || '')}/
                      </div>
                    )}
                  </div>
                </div>

                {/* Your Answer */}
                <div className="p-3 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 rounded-2xl border-2 border-slate-300 dark:border-slate-600">
                  <div className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">Your Answer:</div>
                  <div className={`text-xl font-bold ${
                    lastAnswerCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {input || <span className="text-slate-400 dark:text-slate-500 italic">(empty)</span>}
                  </div>
                </div>

                {/* Action Buttons - Enhanced */}
                <div>
                  <div className="text-center mb-4">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">How difficult was this word?</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Use keyboard shortcuts 1, 2, or 3</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleChoice(1)}
                      className="group relative p-3 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-600 dark:to-slate-700 hover:from-slate-200 hover:to-slate-300 dark:hover:from-slate-500 dark:hover:to-slate-600 rounded-2xl border-2 border-slate-400 dark:border-slate-500 hover:border-slate-500 dark:hover:border-slate-400 transition-all active:scale-95 shadow-lg hover:shadow-xl"
                    >
                      <div className="text-2xl mb-1">🔄</div>
                      <div className="font-bold text-sm text-slate-800 dark:text-slate-200">Again (next round)</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Press 1</div>
                      <div className="absolute top-2 right-2 w-6 h-6 bg-slate-700 dark:bg-slate-500 text-white rounded-lg flex items-center justify-center font-bold text-xs">
                        1
                      </div>
                    </button>
                    <button
                      onClick={() => handleChoice(2)}
                      className="group relative p-3 bg-gradient-to-br from-green-100 to-emerald-200 dark:from-green-900/50 dark:to-emerald-900/50 hover:from-green-200 hover:to-emerald-300 dark:hover:from-green-800/50 dark:hover:to-emerald-800/50 rounded-2xl border-2 border-green-400 dark:border-green-600 hover:border-green-500 dark:hover:border-green-500 transition-all active:scale-95 shadow-lg hover:shadow-xl shadow-green-500/20"
                    >
                      <div className="text-2xl mb-1">✅</div>
                      <div className="font-bold text-sm text-green-800 dark:text-green-300">Easy</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Press 2</div>
                      <div className="absolute top-2 right-2 w-6 h-6 bg-green-700 text-white rounded-lg flex items-center justify-center font-bold text-xs">
                        2
                      </div>
                    </button>
                    <button
                      onClick={() => handleChoice(3)}
                      className="group relative p-3 bg-gradient-to-br from-red-100 to-pink-200 dark:from-red-900/50 dark:to-pink-900/50 hover:from-red-200 hover:to-pink-300 dark:hover:from-red-800/50 dark:hover:to-pink-800/50 rounded-2xl border-2 border-red-400 dark:border-red-600 hover:border-red-500 dark:hover:border-red-500 transition-all active:scale-95 shadow-lg hover:shadow-xl shadow-red-500/20"
                    >
                      <div className="text-2xl mb-1">🔥</div>
                      <div className="font-bold text-sm text-red-800 dark:text-red-300">Hard (next round)</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Press 3</div>
                      <div className="absolute top-2 right-2 w-6 h-6 bg-red-700 text-white rounded-lg flex items-center justify-center font-bold text-xs">
                        3
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Summary Phase (only show Congratulations UI) */}
      {phase === 'summary' && (
        <div className="max-w-5xl mx-auto animate-fade-in">
          <div className="card !p-6 shadow-2xl border-2 border-slate-200 dark:border-slate-700 animate-scale-in">
            <div className="text-center py-12">
              <div className="inline-block p-8 bg-gradient-to-br from-green-400 via-emerald-500 to-violet-500 rounded-full mb-8 shadow-2xl shadow-green-500/40 animate-bounce-subtle">
                <svg className="w-24 h-24 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-5xl font-bold gradient-text mb-4">🎉 Congratulations!</h2>
              <p className="text-xl text-slate-600 dark:text-slate-400 mb-10">You've completed the study session</p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto mb-12">
                <div className="p-6 bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-2xl border-2 border-green-300 dark:border-green-700 shadow-lg">
                  <div className="text-5xl font-bold text-green-600 dark:text-green-400 mb-2">{stats.correct}</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                    <span>✅</span> Correct
                  </div>
                </div>
                <div className="p-6 bg-gradient-to-br from-red-50 to-pink-100 dark:from-red-900/30 dark:to-pink-900/30 rounded-2xl border-2 border-red-300 dark:border-red-700 shadow-lg">
                  <div className="text-5xl font-bold text-red-600 dark:text-red-400 mb-2">{stats.incorrect}</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                    <span>❌</span> Incorrect
                  </div>
                </div>
                <div className="p-6 bg-gradient-to-br from-orange-50 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 rounded-2xl border-2 border-orange-300 dark:border-orange-700 shadow-lg">
                  <div className="text-5xl font-bold text-orange-600 dark:text-orange-400 mb-2">{stats.hard}</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                    <span>🔥</span> Hard
                  </div>
                </div>
                <div className="p-6 bg-gradient-to-br from-violet-50 to-cyan-100 dark:from-violet-900/30 dark:to-cyan-900/30 rounded-2xl border-2 border-violet-300 dark:border-violet-700 shadow-lg">
                  <div className="text-5xl font-bold text-violet-600 dark:text-violet-400 mb-2">{stats.easy}</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                    <span>⚡</span> Easy
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedFiles([])
                  setPhase('idle')
                  setIndex(0)
                  setInput('')
                  setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
                }}
                className="btn-primary px-12 py-4 text-xl flex items-center gap-3 mx-auto"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Back to Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MATCH GAME UI ==================== */}
      {phase === 'match-game' && (
        <div className="max-w-5xl mx-auto animate-fade-in">
          {/* Match Game Header */}
          <div className="card mb-4">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                {/* Timer */}
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
                    {formatTime(matchElapsed)}
                  </div>
                </div>

                {/* Round Info */}
                <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                  Round {matchRound} / {Math.ceil(matchCards.length / MATCH_BATCH_SIZE)}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-green-500 text-lg">✅</span>
                    <span className="font-bold text-green-600 dark:text-green-400">{matchCorrect}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 text-lg">❌</span>
                    <span className="font-bold text-red-600 dark:text-red-400">{matchIncorrect}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={quitStudy}
                className="btn-danger px-4 py-2 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Quit
              </button>
            </div>

            {/* Progress bar */}
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>Progress</span>
                <span>{matchCorrect} / {matchTotalCards} matched</span>
              </div>
              <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-500 ease-out"
                  style={{ width: `${(matchCorrect / matchTotalCards) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Match Game Board */}
          <div className="card !p-6 shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">🎯 Match the Pairs</h2>
              <p className="text-slate-500 dark:text-slate-400">Click a word, then click its matching meaning</p>
            </div>

            {/* Feedback indicator */}
            {lastMatchResult && (
              <div className={`mb-4 p-3 rounded-xl text-center font-bold animate-scale-in ${
                lastMatchResult === 'correct' 
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-2 border-green-300 dark:border-green-700' 
                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-2 border-red-300 dark:border-red-700'
              }`}>
                {lastMatchResult === 'correct' ? '✅ Correct!' : '❌ Try again!'}
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              {/* Words Column */}
              <div className="space-y-3">
                <div className="text-sm font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                  </svg>
                  Words
                </div>
                {matchWords.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleWordClick(item.id)}
                    disabled={item.matched}
                    className={`w-full p-4 rounded-xl border-2 font-semibold text-left transition-all ${
                      item.matched
                        ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 opacity-60 cursor-not-allowed'
                        : selectedWord === item.id
                        ? 'bg-violet-100 dark:bg-violet-900/30 border-violet-500 text-violet-700 dark:text-violet-300 shadow-lg shadow-violet-500/20 scale-[1.02]'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:border-violet-400 dark:hover:border-violet-500 hover:shadow-md cursor-pointer'
                    }`}
                  >
                    {item.matched && <span className="mr-2">✅</span>}
                    {item.word}
                  </button>
                ))}
              </div>

              {/* Meanings Column */}
              <div className="space-y-3">
                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Meanings
                </div>
                {matchMeanings.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleMeaningClick(item.id)}
                    disabled={item.matched}
                    className={`w-full p-4 rounded-xl border-2 font-medium text-left transition-all ${
                      item.matched
                        ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 opacity-60 cursor-not-allowed'
                        : selectedMeaning === item.id
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300 shadow-lg shadow-emerald-500/20 scale-[1.02]'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-md cursor-pointer'
                    }`}
                  >
                    {item.matched && <span className="mr-2">✅</span>}
                    {item.meaning}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Match Game Summary */}
      {phase === 'match-summary' && (
        <div className="max-w-3xl mx-auto animate-fade-in">
          <div className="card !p-8 text-center">
            <div className="inline-block p-6 bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 rounded-full mb-6 shadow-2xl shadow-emerald-500/40 animate-bounce-subtle">
              <svg className="w-20 h-20 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h2 className="text-4xl font-bold gradient-text mb-2">🎉 Match Complete!</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">Great job matching all the pairs!</p>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="p-5 bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 rounded-2xl border-2 border-amber-300 dark:border-amber-700">
                <div className="text-4xl font-bold text-amber-600 dark:text-amber-400 mb-1">{formatTime(matchElapsed)}</div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                  <span>⏱️</span> Time
                </div>
              </div>
              <div className="p-5 bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-2xl border-2 border-green-300 dark:border-green-700">
                <div className="text-4xl font-bold text-green-600 dark:text-green-400 mb-1">{matchCorrect}</div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                  <span>✅</span> Correct
                </div>
              </div>
              <div className="p-5 bg-gradient-to-br from-red-50 to-pink-100 dark:from-red-900/30 dark:to-pink-900/30 rounded-2xl border-2 border-red-300 dark:border-red-700">
                <div className="text-4xl font-bold text-red-600 dark:text-red-400 mb-1">{matchIncorrect}</div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                  <span>❌</span> Mistakes
                </div>
              </div>
            </div>

            {/* Accuracy */}
            <div className="mb-8 p-4 bg-gradient-to-r from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30 rounded-xl border-2 border-violet-300 dark:border-violet-700">
              <div className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1">Accuracy</div>
              <div className="text-3xl font-bold text-violet-600 dark:text-violet-400">
                {matchCorrect + matchIncorrect > 0 
                  ? Math.round((matchCorrect / (matchCorrect + matchIncorrect)) * 100) 
                  : 100}%
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => {
                  // Restart match game
                  startMatchGame(shuffle([...deck]))
                }}
                className="btn-secondary px-8 py-3 text-lg flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Play Again
              </button>
              <button
                onClick={() => {
                  doQuitStudy()
                  setSelectedFiles([])
                }}
                className="btn-primary px-8 py-3 text-lg flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Back to Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SRS Study Phase */}
      {(phase === 'srs-studying' || phase === 'srs-review-result') && srsQueue.length > 0 && (
        <div className="max-w-5xl mx-auto animate-fade-in">
          {/* Progress Header */}
          <div className="card mb-4">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full text-sm font-bold">
                    ⚡ Smart Review
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">{srsIndex + 1}</div>
                  <div className="text-2xl text-slate-400 dark:text-slate-500">/</div>
                  <div className="text-2xl font-semibold text-slate-700 dark:text-slate-300">{srsQueue.length}</div>
                </div>
                {/* Progress Bar */}
                <div className="w-48 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-500 ease-out"
                    style={{ width: `${((srsIndex + 1) / srsQueue.length) * 100}%` }}
                  />
                </div>
              </div>
              <button
                onClick={quitStudy}
                className="btn-danger px-4 py-2 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Quit
              </button>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-1">{srsStats.reviewed}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400 font-medium flex items-center justify-center gap-1">
                  <span>📝</span> Reviewed
                </div>
              </div>
              <div className="text-center p-3 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-800">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400 mb-1">{srsStats.correct}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400 font-medium flex items-center justify-center gap-1">
                  <span>✅</span> Correct
                </div>
              </div>
              <div className="text-center p-3 bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 rounded-xl border border-red-200 dark:border-red-800">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400 mb-1">{srsStats.incorrect}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400 font-medium flex items-center justify-center gap-1">
                  <span>❌</span> Incorrect
                </div>
              </div>
            </div>
          </div>

          {/* Study Card */}
          <div className="card !p-6 shadow-2xl border-2 border-emerald-200 dark:border-emerald-800 animate-scale-in">
            {/* Meaning Display */}
            <div className={phase === 'srs-review-result' ? 'mb-3 max-h-[18vh] overflow-y-auto pr-2' : 'mb-6'}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 rounded-xl mb-3">
                <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">Meaning</span>
              </div>
              <div className={phase === 'srs-review-result' ? 'text-lg font-semibold text-slate-900 dark:text-slate-100 leading-relaxed mb-2' : 'text-2xl font-semibold text-slate-900 dark:text-slate-100 leading-relaxed mb-4'}>
                {srsQueue[srsIndex]?.meaning}
              </div>

              {srsQueue[srsIndex]?.example && (
                <div className={phase === 'srs-review-result' ? 'p-3 bg-gradient-to-br from-emerald-50/50 to-teal-50/50 dark:from-emerald-900/30 dark:to-teal-900/30 rounded-2xl border border-emerald-100 dark:border-emerald-800' : 'p-4 bg-gradient-to-br from-emerald-50/50 to-teal-50/50 dark:from-emerald-900/30 dark:to-teal-900/30 rounded-2xl border border-emerald-100 dark:border-emerald-800'}>
                  <div className={phase === 'srs-review-result' ? 'flex items-center gap-2 mb-2' : 'flex items-center gap-2 mb-3'}>
                    <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">Example</span>
                  </div>
                  <div className={phase === 'srs-review-result' ? 'text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium' : 'text-base text-slate-800 dark:text-slate-200 leading-relaxed font-medium'}>
                    {maskTargetInExample(srsQueue[srsIndex]?.example || '', srsQueue[srsIndex]?.word || '')}
                  </div>
                </div>
              )}
            </div>

            {phase === 'srs-studying' && (
              <div className="space-y-5">
                {/* Word Display (masked) */}
                <div className="relative">
                  <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 rounded-2xl opacity-20 blur-xl"></div>
                  <div className="relative p-4 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 dark:from-emerald-900/20 dark:via-teal-900/20 dark:to-cyan-900/20 rounded-2xl border-2 border-emerald-200 dark:border-emerald-700 shadow-lg">
                    <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1 text-center">Your Answer:</div>
                    <div className="text-3xl font-mono font-bold bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent tracking-[0.16em] text-center py-3">
                      {maskWordAllUnderscore(srsQueue[srsIndex]?.word || '', revealLevel)}
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap gap-3 justify-center">
                  <button
                    onClick={() => {
                      try {
                        const ut = new SpeechSynthesisUtterance(srsQueue[srsIndex]?.word)
                        window.speechSynthesis.speak(ut)
                      } catch (err) {
                        console.error('Speech error', err)
                      }
                    }}
                    className="btn-icon !w-auto px-4 py-2.5 flex items-center gap-2"
                    title="Speak word"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                    </svg>
                    Speak
                  </button>
                  <button
                    onClick={() => setRevealLevel(Math.max(0, revealLevel - 1))}
                    className="btn-secondary px-4 py-2.5 flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Less Hint
                  </button>
                  <button
                    onClick={() => setRevealLevel(Math.min((srsQueue[srsIndex]?.word || '').length, revealLevel + 1))}
                    className="btn-secondary px-4 py-2.5 flex items-center gap-2"
                  >
                    More Hint
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                {/* Input */}
                <div className="space-y-4">
                  <input
                    ref={inputRef}
                    type="text"
                    className="input-field text-center text-2xl font-semibold tracking-wide py-4"
                    placeholder="Type the word..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        submitSRSAnswer()
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={submitSRSAnswer}
                    className="w-full py-4 text-xl font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 transition-all shadow-xl hover:shadow-2xl flex items-center justify-center gap-3"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Check Answer
                  </button>
                </div>
              </div>
            )}

            {phase === 'srs-review-result' && (
              <div className="space-y-4">
                {/* Result Display */}
                <div className={`p-4 rounded-2xl border-2 ${
                  lastAnswerCorrect 
                    ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-green-300 dark:border-green-700' 
                    : 'bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/30 dark:to-pink-900/30 border-red-300 dark:border-red-700'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`text-3xl ${lastAnswerCorrect ? 'text-green-500' : 'text-red-500'}`}>
                      {lastAnswerCorrect ? '✅' : '❌'}
                    </div>
                    <div className="flex-1">
                      <div className={`font-bold text-lg ${lastAnswerCorrect ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                        {lastAnswerCorrect ? 'Correct!' : 'Incorrect'}
                      </div>
                      {!lastAnswerCorrect && (
                        <div className="text-sm text-red-600 dark:text-red-400">
                          Your answer: <span className="font-semibold">{input}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-center py-3 bg-white/50 dark:bg-slate-800/50 rounded-xl">
                    <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Correct Answer</div>
                    <div className="text-3xl font-bold text-slate-900 dark:text-white">{srsQueue[srsIndex]?.word}</div>
                    {srsQueue[srsIndex]?.pronunciation && (
                      <div className="text-lg text-slate-600 dark:text-slate-400 mt-1">/{srsQueue[srsIndex]?.pronunciation}/</div>
                    )}
                  </div>
                </div>

                {/* Quality Rating Buttons */}
                <div className="pt-4">
                  <div className="text-center text-sm font-semibold text-slate-600 dark:text-slate-400 mb-3">
                    How well did you know this? (Press 1-4)
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => handleSRSQuality(1)}
                      className="p-3 rounded-xl border-2 border-red-300 dark:border-red-700 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 hover:border-red-500 dark:hover:border-red-500 transition-all group"
                    >
                      <div className="text-2xl mb-1">🔄</div>
                      <div className="font-bold text-red-700 dark:text-red-300 group-hover:scale-105 transition-transform">Again</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">1m</div>
                    </button>
                    <button
                      onClick={() => handleSRSQuality(2)}
                      className="p-3 rounded-xl border-2 border-orange-300 dark:border-orange-700 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/30 dark:to-amber-900/30 hover:border-orange-500 dark:hover:border-orange-500 transition-all group"
                    >
                      <div className="text-2xl mb-1">😓</div>
                      <div className="font-bold text-orange-700 dark:text-orange-300 group-hover:scale-105 transition-transform">Hard</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">~1d</div>
                    </button>
                    <button
                      onClick={() => handleSRSQuality(3)}
                      className="p-3 rounded-xl border-2 border-green-300 dark:border-green-700 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 hover:border-green-500 dark:hover:border-green-500 transition-all group"
                    >
                      <div className="text-2xl mb-1">👍</div>
                      <div className="font-bold text-green-700 dark:text-green-300 group-hover:scale-105 transition-transform">Good</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">~3d</div>
                    </button>
                    <button
                      onClick={() => handleSRSQuality(4)}
                      className="p-3 rounded-xl border-2 border-blue-300 dark:border-blue-700 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 hover:border-blue-500 dark:hover:border-blue-500 transition-all group"
                    >
                      <div className="text-2xl mb-1">🚀</div>
                      <div className="font-bold text-blue-700 dark:text-blue-300 group-hover:scale-105 transition-transform">Easy</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">~7d</div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SRS Summary */}
      {phase === 'srs-summary' && (
        <div className="max-w-3xl mx-auto animate-fade-in">
          <div className="card !p-8 text-center">
            <div className="inline-block p-6 bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 rounded-full mb-6 shadow-2xl shadow-emerald-500/40 animate-bounce-subtle">
              <svg className="w-20 h-20 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h2 className="text-4xl font-bold gradient-text mb-2">🎉 Smart Review Complete!</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">Great job! Your progress has been saved.</p>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="p-5 bg-gradient-to-br from-blue-50 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-2xl border-2 border-blue-300 dark:border-blue-700">
                <div className="text-4xl font-bold text-blue-600 dark:text-blue-400 mb-1">{srsStats.reviewed}</div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                  <span>📝</span> Reviewed
                </div>
              </div>
              <div className="p-5 bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-2xl border-2 border-green-300 dark:border-green-700">
                <div className="text-4xl font-bold text-green-600 dark:text-green-400 mb-1">{srsStats.correct}</div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                  <span>✅</span> Correct
                </div>
              </div>
              <div className="p-5 bg-gradient-to-br from-red-50 to-pink-100 dark:from-red-900/30 dark:to-pink-900/30 rounded-2xl border-2 border-red-300 dark:border-red-700">
                <div className="text-4xl font-bold text-red-600 dark:text-red-400 mb-1">{srsStats.incorrect}</div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                  <span>❌</span> Incorrect
                </div>
              </div>
            </div>

            {/* Accuracy */}
            <div className="mb-8 p-4 bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30 rounded-xl border-2 border-emerald-300 dark:border-emerald-700">
              <div className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1">Accuracy</div>
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                {srsStats.correct + srsStats.incorrect > 0 
                  ? Math.round((srsStats.correct / (srsStats.correct + srsStats.incorrect)) * 100) 
                  : 100}%
              </div>
            </div>

            {/* Next Review Info */}
            <div className="mb-8 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-center gap-2 text-slate-600 dark:text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Come back later to review more words!</span>
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => {
                  doQuitStudy()
                }}
                className="btn-primary px-8 py-3 text-lg flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Back to Menu
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </ErrorBoundary>
  )
}
