import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import './StudyView.css'
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import ConfirmModal from '../ConfirmModal/ConfirmModal'
import DifficultySelector from '../DifficultySelector/DifficultySelector'
import ReviewCalendar from '../ReviewCalendar/ReviewCalendar'
import { useLocation } from 'react-router-dom'
import { usePersistedState } from '../../hooks/usePersistedState'
import { VocabularyStore, useVocabularyStore } from '../../store/VocabularyStore'
import type { VocabRecord } from '../../store/VocabularyStore'
import { playSound } from '../../utils/sounds'
import { preloadAudio, speakWord } from '../../utils/speech'

function shuffle<T>(a:T[]){
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
  return a
}

type Card = {
  word: string;
  meaning: string;
  meaningEn?: string;
  meaningVi?: string;
  meaningNoteEn?: string;
  meaningNoteVi?: string;
  meaningNoteVie?: string;
  pronunciation?: string;
  pos?: string;
  example?: string;
  source?: string;
}

type LearnMode = 'all' | 'random' | 'select' | 'range' | 'unlearned'
type StudyMode = 'spelling' | 'match'
type StudyTab = 'custom' | 'smart'

// ==================== SPACED REPETITION SYSTEM (SRS) ====================
// NOTE: Smart Review uses VocabularyStore as the single source of truth.

interface SRSCardData {
  // Unique key: source||word||meaning
  key: string
  word: string
  meaning: string
  meaningEn?: string
  meaningVi?: string
  meaningNoteVi?: string
  meaningNoteVie?: string
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
    // New behavior: For the *first* correct (repetitions === 0) apply a sensible
    // initial interval based on the quality so user choice matters.
    // - q === 3 (Hard/correct with difficulty) -> 1 day
    // - q === 4 (Good) -> 3 days
    // - q === 5 (Easy/perfect) -> 7 days
    if (repetitions === 0) {
      if (q === 3) interval = 1
      else if (q === 4) interval = 3
      else if (q === 5) interval = 7
      else interval = 1
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
    meaningEn: card.meaningEn || card.meaningNoteEn || '',
    meaningVi: card.meaningVi || card.meaningNoteVi || card.meaningNoteVie || '',
    meaningNoteVi: card.meaningVi || card.meaningNoteVi || card.meaningNoteVie || '',
    meaningNoteVie: card.meaningVi || card.meaningNoteVi || card.meaningNoteVie || '',
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
  randomCount: number | string
  rangeStart: number | string
  rangeEnd: number | string
  selectedMap: Record<number, boolean>
}

type CardId = {
  source?: string
  word: string
  meaning: string
}

type StudySessionV1 = {
  v: 1
  phase: 'idle' | 'mode-select' | 'studying' | 'review-result' | 'summary' | 'difficulty-select' | 'match-game' | 'match-summary' | 'srs-studying' | 'srs-review-result' | 'srs-summary'
  studyMode: StudyMode
  studyTab: StudyTab
  round?: number
  srsRound?: number
  selectedFiles: string[]
  fileConfigs: Record<string, FileStudyConfig>
  index: number
  srsIndex?: number
  revealLevel: number
  lastAnswerCorrect: boolean | null
  stats: { correct: number; incorrect: number; hard: number; easy: number }
  srsStats?: { reviewed: number; correct: number; incorrect: number }
  difficultySelectMode?: 'custom' | 'smart'
  smartDifficultyFromCalendar?: boolean
  deck: CardId[]
  queue: CardId[]
  toReview: CardId[]
  reviewedWords?: CardId[]
  wrongInCurrentRoundKeys?: string[]
  wrongCountByCardKey?: Record<string, number>
  srsQueueIds?: string[]
  srsToReviewIds?: string[]
  srsReviewedIds?: string[]
  srsWrongInCurrentRoundIds?: string[]
  srsWrongCountById?: Record<string, number>
}

export default function Study(){
  // Tick "now" so Smart Review reacts when the system date/time changes (useful for testing by changing OS date).
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1500)
    return () => window.clearInterval(t)
  }, [])
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
  const [phase, setPhase] = useState<'idle'|'mode-select'|'studying'|'review-result'|'summary'|'difficulty-select'|'match-game'|'match-summary'|'srs-studying'|'srs-review-result'|'srs-summary'>('idle')
  const [showMeaningByDefault, setShowMeaningByDefault] = usePersistedState<boolean>('study_showMeaningByDefault', false)
  const [showViHint, setShowViHint] = useState(false)
  const [showSrsViHint, setShowSrsViHint] = useState(false)
  const [studyMode, setStudyMode] = usePersistedState<StudyMode>('study_mode', 'spelling')
  const [studyTab, setStudyTab] = usePersistedState<StudyTab>('study_tab', 'custom')
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null)
  const [toReview, setToReview] = useState<Card[]>([])
  const toReviewRef = useRef<Card[]>([])
  const [round, setRound] = useState<number>(1)
  const [stats, setStats] = usePersistedState('study_stats', { correct: 0, incorrect: 0, hard: 0, easy: 0 })
  const inputRef = useRef<HTMLInputElement|null>(null)
  
  // Prevent double-submit when UI is slow
  const submittingRef = useRef(false)
  const srsSubmittingRef = useRef(false)
  
  // Track words that were wrong in current round (for next round review)
  const [wrongInCurrentRound, setWrongInCurrentRound] = useState<Set<string>>(new Set())
  const wrongInCurrentRoundRef = useRef<Set<string>>(new Set())
  const [wrongCountByCardKey, setWrongCountByCardKey] = useState<Record<string, number>>({})
  const wrongCountByCardKeyRef = useRef<Record<string, number>>({})
  
  // Track all reviewed words for difficulty selection at end
  const [reviewedWords, setReviewedWords] = useState<Card[]>([])
  const reviewedWordsRef = useRef<Card[]>([])

  // SRS State
  useVocabularyStore()
  const [srsQueue, setSrsQueue] = useState<VocabRecord[]>([])
  const [srsIndex, setSrsIndex] = useState(0)
  const [srsRound, setSrsRound] = useState(1)
  const [srsStats, setSrsStats] = useState({ reviewed: 0, correct: 0, incorrect: 0 })
  const [difficultySelectMode, setDifficultySelectMode] = useState<'custom' | 'smart'>('custom')
  const [smartDifficultyFromCalendar, setSmartDifficultyFromCalendar] = useState(false)
  const [srsReviewedWords, setSrsReviewedWords] = useState<VocabRecord[]>([])
  const srsReviewedWordsRef = useRef<VocabRecord[]>([])

  // Smart Review round-based learning (like Custom): wrong in this round -> reviewed in next round
  const [srsToReview, setSrsToReview] = useState<VocabRecord[]>([])
  const srsToReviewRef = useRef<VocabRecord[]>([])

  const [smartSyncing, setSmartSyncing] = useState(false)

  const exportSmartReview = useCallback(async () => {
    try {
      const raw = localStorage.getItem('vocab_store_v2') || '{}'
      const savedPath = await window.api.exportSmartReview(raw)
      if (savedPath) {
        window.alert(`Đã xuất Smart Review ra file:\n${savedPath}`)
      }
    } catch (e: any) {
      const msg = e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e)
      window.alert(`Export thất bại: ${msg}`)
    }
  }, [])

  const syncSmartReviewMetadata = useCallback(async () => {
    if (smartSyncing) return
    const ok = window.confirm('Đồng bộ pos/example từ các file CSV nguồn vào Smart Review?')
    if (!ok) return

    setSmartSyncing(true)
    try {
      const records = VocabularyStore.getAll()
      const sources = Array.from(new Set(records.map(r => String(r.source || '').trim()).filter(Boolean)))

      // Load CSV rows per source and build a lookup: source -> (word||meaning) -> { pos, example, pronunciation }
      const perSourceLookup = new Map<string, Map<string, { pos: string; example: string; pronunciation: string }>>()
      const failedSources: string[] = []

      const normalizeKey = (word: string, meaning: string) => {
        const w = String(word || '').trim().toLowerCase()
        const m = String(meaning || '').trim().toLowerCase()
        return `${w}||${m}`
      }

      for (const src of sources) {
        try {
          const rows = await window.api.readCsv(src)
          const map = new Map<string, { pos: string; example: string; pronunciation: string }>()
          for (const row of rows || []) {
            const w = String((row as any)?.word || '').trim()
            const m = String((row as any)?.meaning || '').trim()
            if (!w || !m) continue
            map.set(normalizeKey(w, m), {
              pos: String((row as any)?.pos || '').trim(),
              example: String((row as any)?.example || '').trim(),
              pronunciation: String((row as any)?.pronunciation || '').trim(),
            })
          }
          perSourceLookup.set(src, map)
        } catch {
          failedSources.push(src)
        }
      }

      let updated = 0
      let scanned = 0
      for (const r of records) {
        scanned += 1
        const src = String(r.source || '').trim()
        if (!src) continue
        const map = perSourceLookup.get(src)
        if (!map) continue

        const hit = map.get(normalizeKey(r.word, r.meaning))
        if (!hit) continue

        const nextPos = String(r.pos || '').trim() ? String(r.pos || '').trim() : hit.pos
        const nextExample = String(r.example || '').trim() ? String(r.example || '').trim() : hit.example
        const nextPron = String(r.pronunciation || '').trim() ? String(r.pronunciation || '').trim() : hit.pronunciation

        const changed = nextPos !== String(r.pos || '').trim() || nextExample !== String(r.example || '').trim() || nextPron !== String(r.pronunciation || '').trim()
        if (!changed) continue

        VocabularyStore.upsert({
          word: r.word,
          meaning: r.meaning,
          source: src,
          pos: nextPos,
          example: nextExample,
          pronunciation: nextPron,
        })
        updated += 1
      }

      const failedNote = failedSources.length ? `\n(Nguồn đọc CSV lỗi: ${failedSources.length})` : ''
      window.alert(`Đồng bộ xong: cập nhật ${updated} từ (quét ${scanned} từ).${failedNote}`)
    } catch (e: any) {
      const msg = e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e)
      window.alert(`Đồng bộ thất bại: ${msg}`)
    } finally {
      setSmartSyncing(false)
    }
  }, [smartSyncing])
  const [srsWrongInCurrentRound, setSrsWrongInCurrentRound] = useState<Set<string>>(new Set())
  const srsWrongInCurrentRoundRef = useRef<Set<string>>(new Set())
  const [srsWrongCountById, setSrsWrongCountById] = useState<Record<string, number>>({})
  const srsWrongCountByIdRef = useRef<Record<string, number>>({})

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
  
  // Auto mode: when OFF, pressing Enter auto-advances (correct = pass, wrong = retry)
  const [autoModeEnabled, setAutoModeEnabled] = usePersistedState<boolean>('study_autoMode', false)
  const [smartCalendarView, setSmartCalendarView] = usePersistedState<'month' | '14days'>('smart_calendar_view', 'month')

  const [session, setSession] = usePersistedState<StudySessionV1 | null>('study_session_v1', null)
  const didInitialRestoreRef = useRef(false)
  const restoringRef = useRef(false)
  const inputPersistTimerRef = useRef<number | null>(null)

  const SESSION_INPUT_KEY = 'study_session_input_v1'

  const isNonRestorablePhase = (p: StudySessionV1['phase']) =>
    p === 'match-game' ||
    p === 'match-summary'

  const makeCardKey = (source: string | undefined, word: string, meaning: string) => {
    const s = String(source || '').trim()
    const w = String(word || '').trim().toLowerCase()
    const m = String(meaning || '').trim().toLowerCase()
    return `${s}||${w}||${m}`
  }

  const dedupeCardsByKey = (cards: Card[]): Card[] => {
    const seen = new Set<string>()
    const out: Card[] = []
    for (const c of cards || []) {
      const k = makeCardKey(c?.source, String(c?.word || ''), String(c?.meaning || ''))
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(c)
    }
    return out
  }

  const toCardId = (c: Card): CardId => ({
    source: c.source,
    word: String(c.word || ''),
    meaning: String(c.meaning || ''),
  })

  const buildSessionSnapshot = (): StudySessionV1 => ({
    v: 1,
    phase,
    studyMode,
    studyTab,
    round: Number(round) || 1,
    srsRound: Number(srsRound) || 1,
    selectedFiles: Array.isArray(selectedFiles) ? selectedFiles : [],
    fileConfigs: fileConfigs || {},
    index: Number(index) || 0,
    srsIndex: Number(srsIndex) || 0,
    revealLevel: Number(revealLevel) || 0,
    lastAnswerCorrect: lastAnswerCorrect ?? null,
    stats,
    srsStats,
    difficultySelectMode,
    smartDifficultyFromCalendar,
    deck: (deck || []).map(toCardId),
    queue: (queue || []).map(toCardId),
    toReview: (toReview || []).map(toCardId),
    reviewedWords: (reviewedWords || []).map(toCardId),
    wrongInCurrentRoundKeys: Array.from(wrongInCurrentRound || []),
    wrongCountByCardKey: { ...(wrongCountByCardKey || {}) },
    srsQueueIds: (srsQueue || []).map((x) => String(x?.id || '')).filter(Boolean),
    srsToReviewIds: (srsToReview || []).map((x) => String(x?.id || '')).filter(Boolean),
    srsReviewedIds: (srsReviewedWords || []).map((x) => String(x?.id || '')).filter(Boolean),
    srsWrongInCurrentRoundIds: Array.from(srsWrongInCurrentRound || []).map((x) => String(x || '')).filter(Boolean),
    srsWrongCountById: { ...(srsWrongCountById || {}) },
  })

  useEffect(() => {
    toReviewRef.current = toReview
  }, [toReview])

  useEffect(() => {
    wrongInCurrentRoundRef.current = wrongInCurrentRound
  }, [wrongInCurrentRound])

  useEffect(() => {
    wrongCountByCardKeyRef.current = wrongCountByCardKey
  }, [wrongCountByCardKey])

  useEffect(() => {
    reviewedWordsRef.current = reviewedWords
  }, [reviewedWords])

  // Preload pronunciation audio for current/next card to make Speak feel instant.
  useEffect(() => {
    try {
      const w0 = queue?.[index]?.word
      const w1 = queue?.[index + 1]?.word
      if (w0) preloadAudio(String(w0))
      if (w1) preloadAudio(String(w1))
    } catch (e) {}
  }, [queue, index])

  useEffect(() => {
    try {
      const w0 = srsQueue?.[srsIndex]?.word
      const w1 = srsQueue?.[srsIndex + 1]?.word
      if (w0) preloadAudio(String(w0))
      if (w1) preloadAudio(String(w1))
    } catch (e) {}
  }, [srsQueue, srsIndex])

  useEffect(() => {
    srsToReviewRef.current = srsToReview
  }, [srsToReview])

  useEffect(() => {
    srsWrongInCurrentRoundRef.current = srsWrongInCurrentRound
  }, [srsWrongInCurrentRound])

  useEffect(() => {
    srsWrongCountByIdRef.current = srsWrongCountById
  }, [srsWrongCountById])

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
        if (session.studyMode) setStudyMode(session.studyMode)
        if (session.studyTab) setStudyTab(session.studyTab)
        setDifficultySelectMode(session.difficultySelectMode || 'custom')
        setSmartDifficultyFromCalendar(Boolean(session.smartDifficultyFromCalendar))

        // Rebuild cards by reading sources and matching (source + word + meaning)
        const allIds: CardId[] = [
          ...(session.deck || []),
          ...(session.queue || []),
          ...(session.toReview || []),
          ...(session.reviewedWords || []),
        ]
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
                meaningNoteEn: '',
                meaningNoteVi: '',
                pronunciation: '',
                example: '',
                source: src,
              }
            )
          })

        const restoredDeck = rebuild(session.deck || [])
        const restoredQueue = rebuild(session.queue || [])
        const restoredToReview = rebuild(session.toReview || [])
        const restoredReviewedWords = rebuild(session.reviewedWords || [])

        setDeck(restoredDeck)
        setQueue(restoredQueue)
        setToReview(restoredToReview)
        toReviewRef.current = restoredToReview
        setReviewedWords(restoredReviewedWords)
        reviewedWordsRef.current = restoredReviewedWords
        const restoredWrongSet = new Set((session.wrongInCurrentRoundKeys || []).map((x) => String(x || '')))
        setWrongInCurrentRound(restoredWrongSet)
        wrongInCurrentRoundRef.current = restoredWrongSet
        const restoredWrongCounts = session.wrongCountByCardKey || {}
        setWrongCountByCardKey(restoredWrongCounts)
        wrongCountByCardKeyRef.current = restoredWrongCounts

        setRound(Number(session.round) || 1)

        const maxIdx = Math.max(0, restoredQueue.length - 1)
        const idx = Math.max(0, Math.min(Number(session.index) || 0, maxIdx))
        setIndex(idx)

        // Restore Smart Review state from VocabularyStore records.
        const vocabById = new Map(VocabularyStore.getAll().map((r) => [String(r.id), r] as const))
        const restoreVocabByIds = (ids: string[] | undefined) =>
          (ids || []).map((id) => vocabById.get(String(id || ''))).filter(Boolean) as VocabRecord[]

        const restoredSrsQueue = restoreVocabByIds(session.srsQueueIds)
        const restoredSrsToReview = restoreVocabByIds(session.srsToReviewIds)
        const restoredSrsReviewed = restoreVocabByIds(session.srsReviewedIds)

        setSrsQueue(restoredSrsQueue)
        setSrsToReview(restoredSrsToReview)
        srsToReviewRef.current = restoredSrsToReview
        setSrsReviewedWords(restoredSrsReviewed)
        srsReviewedWordsRef.current = restoredSrsReviewed
        const restoredSrsWrongSet = new Set((session.srsWrongInCurrentRoundIds || []).map((x) => String(x || '')))
        setSrsWrongInCurrentRound(restoredSrsWrongSet)
        srsWrongInCurrentRoundRef.current = restoredSrsWrongSet
        const restoredSrsWrongCounts = session.srsWrongCountById || {}
        setSrsWrongCountById(restoredSrsWrongCounts)
        srsWrongCountByIdRef.current = restoredSrsWrongCounts

        setSrsRound(Number(session.srsRound) || 1)
        setSrsStats(session.srsStats || { reviewed: 0, correct: 0, incorrect: 0 })
        const maxSrsIdx = Math.max(0, restoredSrsQueue.length - 1)
        const safeSrsIdx = Math.max(0, Math.min(Number(session.srsIndex) || 0, maxSrsIdx))
        setSrsIndex(safeSrsIdx)

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
    }, [phase, studyMode, studyTab, round, srsRound, selectedFiles, fileConfigs, index, srsIndex, revealLevel, lastAnswerCorrect, stats, srsStats, queue, deck, toReview, reviewedWords, wrongInCurrentRound, wrongCountByCardKey, difficultySelectMode, smartDifficultyFromCalendar, srsQueue, srsToReview, srsReviewedWords, srsWrongInCurrentRound, srsWrongCountById])

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
    randomCount: '',
    rangeStart: '',
    rangeEnd: '',
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

    // For simple A-Z words, also match word variants (liked, likes, liking for "like")
    if (/^[A-Za-z]+$/.test(word)) {
      // First try exact whole-word match
      const exactRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi')
      if (exactRe.test(example)) {
        return example.replace(exactRe, mask)
      }
      
      // Try matching word variants: word followed by common suffixes
      // Match: word + optional suffix (e.g., "like" matches "liked", "likes", "liking", "likely")
      const variantRe = new RegExp(`\\b(${escapeRegex(word)})(\\w*)\\b`, 'gi')
      return example.replace(variantRe, (match, base, suffix) => {
        // Create mask for base word, keep suffix visible
        const baseMask = base.replace(/\S/g, '_')
        return baseMask + suffix
      })
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
          meaningEn: String((r as any).meaningEn || (r as any).meaningNoteEn || ''),
          meaningVi: String((r as any).meaningVi || (r as any).meaningNoteVi || (r as any).meaningNoteVie || ''),
          meaningNoteEn: String((r as any).meaningEn || (r as any).meaningNoteEn || ''),
          meaningNoteVi: String((r as any).meaningVi || (r as any).meaningNoteVi || (r as any).meaningNoteVie || ''),
          meaningNoteVie: String((r as any).meaningVi || (r as any).meaningNoteVi || (r as any).meaningNoteVie || ''),
          pronunciation: ipaCore(r.pronunciation || ''),
          pos: String((r as any).pos || ''),
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

  useEffect(() => {
    setShowViHint(showMeaningByDefault)
  }, [queue, index, showMeaningByDefault])

  useEffect(() => {
    setShowSrsViHint(showMeaningByDefault)
  }, [srsQueue, srsIndex, showMeaningByDefault])

  function applyLearnModeForFile(allCards: Card[], cfg: FileStudyConfig): Card[] {
    const mode = cfg?.mode || 'all'
    if (mode === 'all') return allCards

    if (mode === 'unlearned') {
      // Filter words that haven't been added to SRS yet (state = 'new' or not in VocabularyStore)
      return allCards.filter(card => {
        const vocab = VocabularyStore.getAll().find(
          v => v.word.toLowerCase() === card.word.toLowerCase() && 
               v.meaning.toLowerCase() === card.meaning.toLowerCase()
        )
        // Include if not in store OR state is 'new' (never reviewed)
        return !vocab || vocab.state === 'new'
      })
    }

    if (mode === 'random') {
      const rawCount = Number(cfg.randomCount)
      const safeCount = Number.isFinite(rawCount) ? Math.floor(rawCount) : 0
      const count = Math.min(Math.max(0, safeCount), allCards.length)
      if (count <= 0) return []
      const shuffled = shuffle([...allCards])
      return shuffled.slice(0, count)
    }

    if (mode === 'range') {
      const rawStart = Number(cfg.rangeStart)
      const rawEnd = Number(cfg.rangeEnd)
      const startIndex = Number.isFinite(rawStart) ? Math.floor(rawStart) - 1 : 0
      const endIndex = Number.isFinite(rawEnd) ? Math.floor(rawEnd) : allCards.length

      const start = Math.max(0, Math.min(startIndex, allCards.length))
      const end = Math.max(0, Math.min(endIndex, allCards.length))
      if (end <= start) return []
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

    // Validate configs before starting
    for (const f of files) {
      const cfg = configs?.[f]
      const cards = fileCardsByPath[f] || []
      const totalCards = cards.length

      // Validate select mode: must pick at least 1 word
      if (cfg?.mode === 'select') {
        const hasAny = Object.values(cfg.selectedMap || {}).some(Boolean)
        if (!hasAny) {
          setUiError(`Bạn đang chọn chế độ "tự chọn" nhưng chưa chọn từ nào cho file: ${f}`)
          return
        }
      }

      // Validate random mode
      if (cfg?.mode === 'random') {
        const val = cfg.randomCount
        if (val === '' || val === null || val === undefined) {
          setUiError(`Chế độ "Random": Vui lòng nhập số lượng từ cho file: ${f}`)
          return
        }
        const num = Number(val)
        if (!Number.isFinite(num) || num < 1) {
          setUiError(`Chế độ "Random": Số lượng từ phải là số nguyên dương cho file: ${f}`)
          return
        }
        if (num > totalCards) {
          setUiError(`Chế độ "Random": Số lượng (${num}) vượt quá tổng số từ (${totalCards}) cho file: ${f}`)
          return
        }
      }

      // Validate range mode
      if (cfg?.mode === 'range') {
        const startVal = cfg.rangeStart
        const endVal = cfg.rangeEnd

        if (startVal === '' || startVal === null || startVal === undefined) {
          setUiError(`Chế độ "Range": Vui lòng nhập vị trí bắt đầu cho file: ${f}`)
          return
        }
        if (endVal === '' || endVal === null || endVal === undefined) {
          setUiError(`Chế độ "Range": Vui lòng nhập vị trí kết thúc cho file: ${f}`)
          return
        }

        const startNum = Number(startVal)
        const endNum = Number(endVal)

        if (!Number.isFinite(startNum) || startNum < 1) {
          setUiError(`Chế độ "Range": Vị trí bắt đầu phải là số nguyên dương cho file: ${f}`)
          return
        }
        if (!Number.isFinite(endNum) || endNum < 1) {
          setUiError(`Chế độ "Range": Vị trí kết thúc phải là số nguyên dương cho file: ${f}`)
          return
        }
        if (startNum > endNum) {
          setUiError(`Chế độ "Range": Vị trí bắt đầu (${startNum}) không được lớn hơn kết thúc (${endNum}) cho file: ${f}`)
          return
        }
        if (endNum > totalCards) {
          setUiError(`Chế độ "Range": Vị trí kết thúc (${endNum}) vượt quá tổng số từ (${totalCards}) cho file: ${f}`)
          return
        }
      }
    }

    // Validate passed - proceed with session
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
      // Reset reviewed words for this session (so difficulty rating matches this session only)
      setReviewedWords([])
      reviewedWordsRef.current = []
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
      setWrongCountByCardKey({})
      wrongCountByCardKeyRef.current = {}
    }
  }

  function maskWordAllUnderscore(w:string, revealCount:number){
    if (!w) return ''
    
    // Split by spaces to handle phrases (multiple words)
    const words = w.split(' ')
    
    if (words.length > 1) {
      // It's a phrase - mask each word separately
      let revealed = 0
      const maskedWords = words.map(word => {
        const chars = word.split('')
        const masked = chars.map(ch => {
          if (revealed < revealCount) {
            revealed++
            return ch
          }
          return '_'
        }).join('')  // No space between chars in same word
        return masked
      })
      return maskedWords.join('   ')  // Triple space between words for clarity
    }
    
    // Single word - chars close together
    const chars = w.split('')
    if (revealCount <= 0) return chars.map(()=> '_').join('')
    const total = chars.length
    const reveal = Math.min(total, revealCount)
    return chars.map((ch,i)=> i < reveal ? ch : '_').join('')
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
  function submitAnswer(){
    if (phase !== 'studying') return
    if (submittingRef.current) return  // Prevent double-submit
    submittingRef.current = true
    
    const card = queue[index]
    if (!card) {
      submittingRef.current = false
      return
    }
    // Normalize: trim, lowercase, collapse multiple spaces, normalize unicode whitespace
    const normalizeAnswer = (s: string) => 
      (s || '').trim().toLowerCase()
        .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ') // Convert special spaces to regular space
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .trim()
    const normalized = normalizeAnswer(input)
    const correct = normalizeAnswer(card.word)
    const isCorrect = normalized === correct
    setLastAnswerCorrect(isCorrect)
    
    // IPA lookup in background - don't block UI
    if (!ipaCore(card.pronunciation || '')) {
      lookupIPA(card.word).then(ipa => {
        if (ipa) card.pronunciation = ipaCore(ipa)
      }).catch(() => {})
    }
    
    // ✅ Track ALL reviewed words for difficulty selection (not just wrong ones)
    const cardKey = makeCardKey(card.source, card.word, card.meaning)
    const alreadyTracked = reviewedWordsRef.current.some(
      c => makeCardKey(c.source, c.word, c.meaning) === cardKey
    )
    if (!alreadyTracked) {
      const next = [...reviewedWordsRef.current, card]
      reviewedWordsRef.current = next
      setReviewedWords(next)
    }
    
    if (isCorrect) {
      setStats((s) => ({ ...s, correct: s.correct + 1 }))
      playSound('correct')
    } else {
      setStats((s) => ({ ...s, incorrect: s.incorrect + 1 }))
      playSound('incorrect')
      setWrongCountByCardKey((prev) => ({
        ...(prev || {}),
        [cardKey]: Number(prev?.[cardKey] || 0) + 1,
      }))
      // ✅ NEW: Mark as wrong in current round (will be reviewed next round)
      setWrongInCurrentRound(prev => {
        const next = new Set(prev)
        next.add(cardKey)
        return next
      })
    }
    setPhase('review-result')
    
    // Reset submitting flag after state update
    setTimeout(() => { submittingRef.current = false }, 50)
  }

  // ==================== NEW ROUND-BASED LEARNING ====================
  // Only 2 choices: "Làm lại" (retry immediately) or "Cho qua" (pass to next word)
  // Words that were wrong ALWAYS go to next round, regardless of retry result
  
  function handleRetry() {
    // User wants to retry immediately - clear input and stay on same card
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    setPhase('studying')
    // Focus input after state update
    setTimeout(() => inputRef.current?.focus(), 50)
  }
  
  function handlePass() {
    const card = queue[index]
    if (!card) return
    
    const cardKey = makeCardKey(card.source, card.word, card.meaning)
    
    // ✅ If wrong in current round, add to next round's review list
    if (wrongInCurrentRoundRef.current.has(cardKey)) {
      const prev = toReviewRef.current || []
      const exists = prev.some((c) => makeCardKey(c.source, c.word, c.meaning) === cardKey)
      if (!exists) {
        const next = [...prev, card]
        toReviewRef.current = next
        setToReview(next)
      }
    }
    
    // Advance to next word
    advanceAfterResult()
  }
  
  // Legacy function - kept for backwards compatibility with keyboard shortcuts
  function handleChoice(choice: 1|2|3){
    if (choice === 1) {
      handleRetry()
    } else {
      handlePass()
    }
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
      // ✅ Clear wrongInCurrentRound for new round
      setWrongInCurrentRound(new Set())
      wrongInCurrentRoundRef.current = new Set()
      setIndex(0)
      setRound((r) => (Number(r) || 1) + 1)
      setPhase('studying')
      return
    }

    // ✅ Done: Go to difficulty selection phase instead of summary
    setIndex(0)

    // Make sure the rating list matches the session deck (all cards in this session),
    // even if reviewedWords tracking missed some cards across rounds.
    // NOTE: Do NOT dedupe here; if the session shows 76 cards, user must be able to rate 76.
    const sessionAll = Array.isArray(deck) ? [...deck] : []
    if (sessionAll.length > 0) {
      setReviewedWords(sessionAll)
      reviewedWordsRef.current = sessionAll
    }

    setDifficultySelectMode('custom')
    setPhase('difficulty-select')
    playSound('success')
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
    // Reset round-based learning state
    setWrongInCurrentRound(new Set())
    wrongInCurrentRoundRef.current = new Set()
    setWrongCountByCardKey({})
    wrongCountByCardKeyRef.current = {}
    setReviewedWords([])
    reviewedWordsRef.current = []
    // Reset submitting flags
    submittingRef.current = false
    srsSubmittingRef.current = false
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
    setSrsRound(1)
    setSrsStats({ reviewed: 0, correct: 0, incorrect: 0 })
    setSrsReviewedWords([])
    srsReviewedWordsRef.current = []
    setSrsToReview([])
    srsToReviewRef.current = []
    setSrsWrongInCurrentRound(new Set())
    srsWrongInCurrentRoundRef.current = new Set()
    setSrsWrongCountById({})
    srsWrongCountByIdRef.current = {}
    setDifficultySelectMode('custom')
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
      playSound('correct')
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
            // Vocabulary is persisted via DifficultySelector after Custom Study.
            setPhase('match-summary')
            playSound('success')
          } else {
            setMatchRound(nextRound)
            loadMatchRound(matchCards, nextRound)
          }
        }
      }, 300)
    } else {
      setMatchIncorrect(c => c + 1)
      setLastMatchResult('incorrect')
      playSound('incorrect')
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
  
  // Calculate Smart Review stats from VocabularyStore
  // (re-evaluated on nowTick so due-today updates when you change system date)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _nowTickForRerender = nowTick
  const vocabStats = VocabularyStore.getStats()
  const srsStatsComputed = {
    due: vocabStats.dueToday,
    total: Math.max(0, vocabStats.total - vocabStats.new),
    mastered: vocabStats.mastered,
  }

  // Calendar and schedule actions are handled by ReviewCalendar via VocabularyStore

  // Start a Smart Review session from a selected calendar day, optionally limited to N words.
  function startSmartDifficultySelectByDate(dateStr: string, limit?: number) {
    const v = String(dateStr || '').trim()
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) {
      setUiError('Ngày không hợp lệ để học trước.')
      return
    }

    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    const start = new Date(y, mo - 1, d)
    start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    const endMs = startMs + 24 * 60 * 60 * 1000

    const wordsOfDay = VocabularyStore.getAll().filter((r) => {
      const nr = Number(r.nextReviewDate || 0)
      return r.state !== 'new' && nr >= startMs && nr < endMs
    })

    if (wordsOfDay.length === 0) {
      setUiError('Không có từ nào trong ngày này để học trước.')
      return
    }

    const rawLimit = Number(limit)
    const safeLimit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(wordsOfDay.length, Math.floor(rawLimit)))
      : wordsOfDay.length
    const selectedWords = shuffle([...wordsOfDay]).slice(0, safeLimit)

    setUiError('')
    setDifficultySelectMode('smart')
    setSmartDifficultyFromCalendar(false)
    setSrsQueue(selectedWords)
    setSrsIndex(0)
    setSrsRound(1)
    setSrsStats({ reviewed: 0, correct: 0, incorrect: 0 })
    setSrsReviewedWords([])
    srsReviewedWordsRef.current = []
    setSrsToReview([])
    srsToReviewRef.current = []
    setSrsWrongInCurrentRound(new Set())
    srsWrongInCurrentRoundRef.current = new Set()
    setSrsWrongCountById({})
    srsWrongCountByIdRef.current = {}
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    setPhase('srs-studying')
  }

  // Helper to get today's start timestamp
  const getTodayStart = () => {
    const d0 = new Date()
    d0.setHours(0, 0, 0, 0)
    return d0.getTime()
  }

  // Calculate overdue and today cards for display
  const srsCardBreakdown = (() => {
    const dueCards = VocabularyStore.getDueCards()
    const todayStart = getTodayStart()
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000
    
    const overdueCards = dueCards.filter(c => (c.nextReviewDate || 0) < todayStart)
    const todayCards = dueCards.filter(c => {
      const nr = c.nextReviewDate || 0
      return nr >= todayStart && nr < tomorrowStart
    })
    
    return { overdueCards, todayCards, allDue: dueCards }
  })()

  // Start SRS session with all due cards (overdue + today)
  async function startSRSSessionAll() {
    const dueCards = srsCardBreakdown.allDue
    
    if (dueCards.length === 0) {
      setUiError('Không có từ nào cần ôn!')
      return
    }

    setSrsQueue(shuffle([...dueCards]))
    setSrsIndex(0)
    setSrsRound(1)
    setSrsStats({ reviewed: 0, correct: 0, incorrect: 0 })
    setSrsReviewedWords([])
    srsReviewedWordsRef.current = []
    setSrsToReview([])
    srsToReviewRef.current = []
    setSrsWrongInCurrentRound(new Set())
    srsWrongInCurrentRoundRef.current = new Set()
    setSrsWrongCountById({})
    srsWrongCountByIdRef.current = {}
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    setPhase('srs-studying')
  }

  // Start SRS session with only today's cards (exclude overdue)
  async function startSRSSessionTodayOnly() {
    const todayCards = srsCardBreakdown.todayCards
    
    if (todayCards.length === 0) {
      setUiError('Không có từ nào đến hạn hôm nay!')
      return
    }

    setSrsQueue(shuffle([...todayCards]))
    setSrsIndex(0)
    setSrsRound(1)
    setSrsStats({ reviewed: 0, correct: 0, incorrect: 0 })
    setSrsReviewedWords([])
    srsReviewedWordsRef.current = []
    setSrsToReview([])
    srsToReviewRef.current = []
    setSrsWrongInCurrentRound(new Set())
    srsWrongInCurrentRoundRef.current = new Set()
    setSrsWrongCountById({})
    srsWrongCountByIdRef.current = {}
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    setPhase('srs-studying')
  }

  // Start SRS session - CHỈ ôn các từ đã học qua Custom Study
  async function startSRSSession() {
    const dueCards = VocabularyStore.getDueCards()
    
    if (dueCards.length === 0) {
      if (VocabularyStore.getAll().filter(r => r.state !== 'new').length === 0) {
        setUiError('Chưa có từ nào trong hệ thống ôn tập. Hãy học từ mới qua Custom Study trước!')
      } else {
        setUiError('Tuyệt vời! Bạn đã ôn tập hết tất cả từ hôm nay. Quay lại sau nhé!')
      }
      return
    }

    setSrsQueue(shuffle([...dueCards]))
    setSrsIndex(0)
    setSrsRound(1)
    setSrsStats({ reviewed: 0, correct: 0, incorrect: 0 })
    setSrsReviewedWords([])
    srsReviewedWordsRef.current = []
    setSrsToReview([])
    srsToReviewRef.current = []
    setSrsWrongInCurrentRound(new Set())
    srsWrongInCurrentRoundRef.current = new Set()
    setSrsWrongCountById({})
    srsWrongCountByIdRef.current = {}
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    setPhase('srs-studying')
  }

  // Custom Study feeds Smart Review via DifficultySelector (VocabularyStore).

  // Handle SRS answer submission
  function submitSRSAnswer() {
    if (phase !== 'srs-studying') return
    if (srsSubmittingRef.current) return  // Prevent double-submit
    srsSubmittingRef.current = true
    
    const card = srsQueue[srsIndex]
    if (!card) {
      srsSubmittingRef.current = false
      return
    }
    
    // Normalize: trim, lowercase, collapse multiple spaces, normalize unicode whitespace
    const normalizeAnswer = (s: string) => 
      (s || '').trim().toLowerCase()
        .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ') // Convert special spaces to regular space
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .trim()
    const normalized = normalizeAnswer(input)
    const correct = normalizeAnswer(card.word)
    const isCorrect = normalized === correct
    
    setLastAnswerCorrect(isCorrect)
    
    // Play sound based on result
    if (isCorrect) {
      playSound('correct')
    } else {
      playSound('incorrect')
      const idKey = String(card.id || '')
      setSrsWrongCountById((prev) => ({
        ...(prev || {}),
        [idKey]: Number(prev?.[idKey] || 0) + 1,
      }))
      // Mark wrong in current round so it must appear again next round (even if user retries later)
      const k = String(card.id)
      setSrsWrongInCurrentRound(prev => {
        const next = new Set(prev)
        next.add(k)
        return next
      })
    }
    
    // IPA lookup in background - don't block UI
    if (!ipaCore(card.pronunciation || '')) {
      lookupIPA(card.word).then(ipa => {
        if (ipa) {
          VocabularyStore.upsert({
            word: card.word,
            meaning: card.meaning,
            meaningNoteVi: (card as any).meaningNoteVi,
            meaningNoteVie: (card as any).meaningNoteVie || (card as any).meaningNoteVi,
            pronunciation: ipaCore(ipa),
            source: card.source,
          })
        }
      }).catch(() => {})
    }

    setPhase('srs-review-result')
    
    // Reset submitting flag after state update
    setTimeout(() => { srsSubmittingRef.current = false }, 50)
  }

  // Smart Review: per-card only 2 choices: Làm lại / Cho qua.
  // We record correct/incorrect on "Cho qua" and rate difficulty after the whole session.
  function handleSRSRetry() {
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    setPhase('srs-studying')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleSRSPass() {
    const card = srsQueue[srsIndex]
    if (!card) return

    const wasCorrect = !!lastAnswerCorrect

    // Update SRS stats for this reviewed card
    setSrsStats(s => ({
      reviewed: s.reviewed + 1,
      correct: s.correct + (wasCorrect ? 1 : 0),
      incorrect: s.incorrect + (wasCorrect ? 0 : 1),
    }))

    // Record review outcome (repetitions/easeFactor updates); scheduling is recomputed later
    // once the user rates overall difficulty for this session.
    // NOTE: Scheduling does NOT depend on correctness inside the session.

    // Track reviewed words for end-of-session difficulty selection
    const alreadyTracked = srsReviewedWordsRef.current.some(r => r.id === card.id)
    if (!alreadyTracked) {
      const next = [...srsReviewedWordsRef.current, card]
      srsReviewedWordsRef.current = next
      setSrsReviewedWords(next)
    }

    // Round-based behavior: wrong in this round -> queue for next round
    const k = String(card.id)
    if (srsWrongInCurrentRoundRef.current.has(k)) {
      const prev = srsToReviewRef.current || []
      const exists = prev.some((c) => c.id === card.id)
      if (!exists) {
        const next = [...prev, card]
        srsToReviewRef.current = next
        setSrsToReview(next)
      }
    }

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

    // End of round -> next round is the accumulated review list
    const reviewCards = srsToReviewRef.current || []
    if (reviewCards.length > 0) {
      setSrsQueue(shuffle([...reviewCards]))
      setSrsToReview([])
      srsToReviewRef.current = []
      setSrsWrongInCurrentRound(new Set())
      srsWrongInCurrentRoundRef.current = new Set()
      setSrsIndex(0)
      setSrsRound((r) => (Number(r) || 1) + 1)
      setPhase('srs-studying')
      return
    }
    
    // Session complete
    setDifficultySelectMode('smart')
    setPhase('difficulty-select')
    playSound('success')
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
  // When autoModeEnabled is OFF, Enter key auto-advances: correct=pass, wrong=retry
  useEffect(() => {
    if (phase !== 'review-result' && phase !== 'srs-review-result') return
    const onKey = (e: KeyboardEvent) => {
      // Auto mode OFF: Enter key triggers automatic action
      if (!autoModeEnabled && e.key === 'Enter') {
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
          // Smart Review: correct = pass, wrong = retry
          if (lastAnswerCorrect) handleSRSPass()
          else handleSRSRetry()
        } else {
          // Custom Study: correct = pass, wrong = retry
          if (lastAnswerCorrect) handlePass()
          else handleRetry()
        }
        return
      }
      
      // Manual mode: number keys 1/2
      const validKeys = phase === 'srs-review-result' 
        ? ['1', '2'] 
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
        if (e.key === '1') handleSRSRetry()
        if (e.key === '2') handleSRSPass()
      } else {
        handleChoice(Number(e.key) as 1 | 2 | 3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, autoModeEnabled, lastAnswerCorrect])

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

  // Get all PDF deck files (exclude trashed)
  function getPdfDeckFiles(): any[] {
    return (pdfList || []).filter((pdf: any) => !pdf.trashed).map((pdf) => ({ 
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
              <div className="card-header text-2xl flex items-center gap-3">
  <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  </div>

  <span className="text-slate-900 dark:text-white font-bold tracking-tight">
    Select Files to Study
  </span>
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
                          <div className="flex flex-col gap-2">
                            {/* Top row: All and Random */}
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
                                📚 All
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
                                🎲 Random
                              </button>
                            </div>
                            
                            {/* Center: Unlearned - highlighted */}
                            <button
                              type="button"
                              onClick={() => updateFileConfig(f.path, { mode: 'unlearned' })}
                              className={`p-3 rounded-lg border-2 transition-all ${
                                cfg.mode === 'unlearned'
                                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 font-semibold text-emerald-700 dark:text-emerald-300'
                                  : 'border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 dark:hover:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-900/20'
                              }`}
                            >
                              ✨ Unlearned Only
                              <span className="block text-xs font-normal opacity-75">Từ chưa học / chưa ôn tập</span>
                            </button>
                            
                            {/* Bottom row: Select and Range */}
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => updateFileConfig(f.path, { mode: 'select' })}
                                className={`p-3 rounded-lg border-2 transition-all ${
                                  cfg.mode === 'select'
                                    ? 'border-violet-500 bg-white dark:bg-slate-700 font-semibold text-violet-700 dark:text-violet-300'
                                    : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                                }`}
                              >
                                ☑️ Select
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
                                📏 Range
                              </button>
                            </div>
                          </div>

                          {cfg.mode === 'random' && (
                            <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600">
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Random Count:</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={cfg.randomCount}
                                onChange={(e) => updateFileConfig(f.path, { randomCount: e.target.value })}
                                placeholder="Nhập số lượng..."
                                className="input-field"
                              />
                            </div>
                          )}

                          {cfg.mode === 'range' && (
                            <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600 space-y-2">
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Range From:</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={cfg.rangeStart}
                                onChange={(e) => updateFileConfig(f.path, { rangeStart: e.target.value })}
                                placeholder="Từ vị trí..."
                                className="input-field"
                              />
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">Range To:</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={cfg.rangeEnd}
                                onChange={(e) => updateFileConfig(f.path, { rangeEnd: e.target.value })}
                                placeholder="Đến vị trí..."
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
                                <div className="max-h-[18rem] overflow-y-auto pr-1">
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
              <div className="card-header text-2xl flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <span>Smart Review (Spaced Repetition)</span>

                <button
                  type="button"
                  onClick={exportSmartReview}
                  className="ml-auto btn-secondary px-4 py-2 text-sm"
                >
                  Xuất dữ liệu
                </button>

                <button
                  type="button"
                  onClick={syncSmartReviewMetadata}
                  disabled={smartSyncing}
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-60"
                >
                  {smartSyncing ? 'Đang đồng bộ…' : 'Đồng bộ'}
                </button>
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
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">📅 Lịch ôn tập</h3>

                    <div className="ml-auto inline-flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                      <button
                        type="button"
                        onClick={() => setSmartCalendarView('14days')}
                        className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                          smartCalendarView === '14days'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        14 ngày
                      </button>
                      <button
                        type="button"
                        onClick={() => setSmartCalendarView('month')}
                        className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                          smartCalendarView === 'month'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        Tháng
                      </button>
                    </div>
                  </div>

                  <ReviewCalendar
                    view={smartCalendarView}
                    onStartReview={startSmartDifficultySelectByDate}
                  />
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
                <div className="flex flex-col gap-3">
                  {/* Button 1: All due (overdue + today) */}
                  <button
                    onClick={startSRSSessionAll}
                    className="w-full py-4 text-lg flex items-center justify-center gap-3 shadow-xl hover:shadow-2xl rounded-xl font-semibold transition-all bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Ôn tất cả ({srsCardBreakdown.allDue.length} từ)
                    {srsCardBreakdown.overdueCards.length > 0 && (
                      <span className="ml-1 px-2 py-0.5 bg-red-500/20 text-red-100 text-sm rounded-full">
                        {srsCardBreakdown.overdueCards.length} quá hạn
                      </span>
                    )}
                  </button>
                  
                  {/* Button 2: Today only - only show if there are today cards */}
                  {srsCardBreakdown.todayCards.length > 0 && (
                    <button
                      onClick={startSRSSessionTodayOnly}
                      className="w-full py-3 text-base flex items-center justify-center gap-2 shadow-lg hover:shadow-xl rounded-xl font-medium transition-all bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Chỉ ôn hôm nay ({srsCardBreakdown.todayCards.length} từ)
                    </button>
                  )}
                </div>
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

            {/* Auto Mode Toggle */}
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Chế độ chọn thủ công</span>
                <div className="relative group">
                  <svg className="w-4 h-4 text-slate-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                    <div className="font-semibold mb-1">Bật: Hiện 2 nút Làm lại / Cho qua</div>
                    <div>Tắt: Enter tự động (đúng→qua, sai→làm lại)</div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAutoModeEnabled(!autoModeEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  autoModeEnabled 
                    ? 'bg-violet-600' 
                    : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md ${
                    autoModeEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
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
                <span className="text-sm font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wide">Meanings</span>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowViHint((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-sm font-semibold"
                >
                  {showViHint ? 'Ẩn Nghĩa' : 'Nghĩa'}
                </button>
                <button
                  onClick={() => setShowMeaningByDefault((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-sm font-semibold"
                >
                  {showMeaningByDefault ? 'Mặc định: Hiện' : 'Mặc định: Ẩn'}
                </button>
              </div>

              <div className={phase === 'review-result' ? 'space-y-2.5 mb-2' : 'space-y-3 mb-4'}>
                {showViHint && String((queue as any)?.[index]?.meaning || '').trim() && (
                  <div className={phase === 'review-result' ? 'p-2.5 rounded-xl bg-sky-50/80 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800' : 'p-3 rounded-xl bg-sky-50/80 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800'}>
                    <div className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200 mb-1.5">Nghĩa của tôi</div>
                    <div className={phase === 'review-result' ? 'text-sm text-slate-700 dark:text-slate-200 leading-relaxed' : 'text-base text-slate-700 dark:text-slate-200 leading-relaxed'}>
                      {String((queue as any)[index].meaning || '')}
                    </div>
                  </div>
                )}

                <div className={phase === 'review-result' ? 'p-2.5 rounded-xl bg-violet-50/80 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800' : 'p-3 rounded-xl bg-violet-50/80 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800'}>
                  <div className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200 mb-1.5">EN meaning</div>
                  <div
                    className={
                      phase === 'review-result'
                        ? 'text-base font-semibold text-slate-900 dark:text-slate-100 leading-relaxed'
                        : 'text-xl font-semibold text-slate-900 dark:text-slate-100 leading-relaxed'
                    }
                  >
                    {String((queue as any)?.[index]?.meaningEn || (queue as any)?.[index]?.meaningNoteEn || '').trim() || 'Chưa có EN meaning cho từ này'}
                  </div>
                </div>

                {String((queue as any)?.[index]?.meaningVi || (queue as any)?.[index]?.meaningNoteVie || (queue as any)?.[index]?.meaningNoteVi || '').trim() && (
                  <div className={phase === 'review-result' ? 'p-2.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800' : 'p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800'}>
                    <div className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200 mb-1.5">VIE meaning</div>
                    <div className={phase === 'review-result' ? 'text-sm text-slate-700 dark:text-slate-200 leading-relaxed' : 'text-base text-slate-700 dark:text-slate-200 leading-relaxed'}>
                      {String((queue as any)[index].meaningVi || (queue as any)[index].meaningNoteVie || (queue as any)[index].meaningNoteVi || '')}
                    </div>
                  </div>
                )}
              </div>

              {String((queue as any)?.[index]?.pos || '').trim() && (
                <div
                  className={
                    phase === 'review-result'
                      ? 'text-sm text-slate-600 dark:text-slate-400 font-medium mb-2'
                      : 'text-base text-slate-600 dark:text-slate-400 font-medium mb-4'
                  }
                >
                  {String((queue as any)[index].pos)}
                </div>
              )}

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
                    onClick={() => speakWord(queue[index].word)}
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
                        e.stopPropagation()
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
                    {String((queue as any)?.[index]?.pos || '').trim() && (
                      <div className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                        {String((queue as any)[index].pos)}
                      </div>
                    )}
                    {ipaCore(queue[index].pronunciation || '') && (
                      <div className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                        /{ipaCore(queue[index].pronunciation || '')}/
                      </div>
                    )}
                    <div className="mt-3">
                      <button
                        onClick={() => speakWord(queue[index].word)}
                        className="btn-icon !w-auto px-4 py-2 flex items-center gap-2"
                        title="Speak word"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                        </svg>
                        Speak
                      </button>
                    </div>
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

                {/* Action Buttons - 2 choices: Làm lại / Cho qua (only show when autoModeEnabled) */}
                {autoModeEnabled ? (
                  <div>
                    <div className="text-center mb-4">
                      {!lastAnswerCorrect && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded-xl mb-3">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm font-semibold">Từ này sẽ được ôn lại lượt sau</span>
                        </div>
                      )}
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Bạn muốn làm gì?</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Nhấn phím 1 hoặc 2</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={handleRetry}
                        className="group relative p-4 bg-gradient-to-br from-amber-100 to-orange-200 dark:from-amber-900/50 dark:to-orange-900/50 hover:from-amber-200 hover:to-orange-300 dark:hover:from-amber-800/50 dark:hover:to-orange-800/50 rounded-2xl border-2 border-amber-400 dark:border-amber-600 hover:border-amber-500 dark:hover:border-amber-500 transition-all active:scale-95 shadow-lg hover:shadow-xl shadow-amber-500/20"
                      >
                        <div className="text-3xl mb-2">🔄</div>
                        <div className="font-bold text-base text-amber-800 dark:text-amber-300">Làm lại</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Thử lại ngay</div>
                        <div className="absolute top-2 right-2 w-7 h-7 bg-amber-600 text-white rounded-lg flex items-center justify-center font-bold text-sm shadow-md">
                          1
                        </div>
                      </button>
                      <button
                        onClick={handlePass}
                        className="group relative p-4 bg-gradient-to-br from-emerald-100 to-teal-200 dark:from-emerald-900/50 dark:to-teal-900/50 hover:from-emerald-200 hover:to-teal-300 dark:hover:from-emerald-800/50 dark:hover:to-teal-800/50 rounded-2xl border-2 border-emerald-400 dark:border-emerald-600 hover:border-emerald-500 dark:hover:border-emerald-500 transition-all active:scale-95 shadow-lg hover:shadow-xl shadow-emerald-500/20"
                      >
                        <div className="text-3xl mb-2">➡️</div>
                        <div className="font-bold text-base text-emerald-800 dark:text-emerald-300">Cho qua</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Tiếp tục từ mới</div>
                        <div className="absolute top-2 right-2 w-7 h-7 bg-emerald-600 text-white rounded-lg flex items-center justify-center font-bold text-sm shadow-md">
                          2
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    {!lastAnswerCorrect && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded-xl mb-3">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-semibold">Từ này sẽ được ôn lại lượt sau</span>
                      </div>
                    )}
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Nhấn <span className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded font-bold">Enter</span> để {lastAnswerCorrect ? 'tiếp tục' : 'làm lại'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {lastAnswerCorrect ? '✅ Đúng → Chuyển sang từ tiếp' : '❌ Sai → Thử lại từ này'}
                    </p>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* Difficulty Selection Phase - NEW */}
      {phase === 'difficulty-select' && (
        <div className="max-w-5xl mx-auto animate-fade-in">
          <DifficultySelector
            mode={difficultySelectMode}
            words={(difficultySelectMode === 'custom' ? reviewedWords : srsReviewedWords).map((card: any, idx: number) => ({
              // Custom mode doesn't have a stable record id yet; use a per-session unique id so nothing collapses.
              id: difficultySelectMode === 'custom' ? `session_${idx}` : card.id,
              word: card.word,
              meaning: card.meaning,
              meaningEn: card.meaningEn || card.meaningNoteEn,
              meaningVi: card.meaningVi || card.meaningNoteVi || card.meaningNoteVie,
              meaningNoteEn: card.meaningEn || card.meaningNoteEn,
              meaningNoteVi: card.meaningVi || card.meaningNoteVi || card.meaningNoteVie,
              pronunciation: card.pronunciation,
              pos: card.pos,
              example: card.example,
              source: card.source,
              wrongCount:
                difficultySelectMode === 'custom'
                  ? Number(wrongCountByCardKey[makeCardKey(card.source, card.word, card.meaning)] || 0)
                  : Number(srsWrongCountById[String(card.id || '')] || 0),
            }))}
            onComplete={() => {
              // DifficultySelector already saved to VocabularyStore
              if (difficultySelectMode === 'smart' && smartDifficultyFromCalendar) {
                setSmartDifficultyFromCalendar(false)
                setPhase('idle')
                return
              }
              setPhase(difficultySelectMode === 'smart' ? 'srs-summary' : 'summary')
            }}
            onSkip={() => {
              // For Smart mode: treat this session as non-existent (no scheduling saved).
              // Restart Smart Review so the user can continue learning more.
              if (difficultySelectMode === 'smart') {
                if (smartDifficultyFromCalendar) {
                  setSmartDifficultyFromCalendar(false)
                  setPhase('idle')
                  return
                }
                void startSRSSession()
                return
              }

              // Custom mode: if user skips rating, still add reviewed words to Smart Review
              // with all metadata and schedule them for today (unrated_custom).
              try {
                for (const w of reviewedWordsRef.current || []) {
                  if (!w?.word || !w?.meaning) continue
                  const record = VocabularyStore.upsert({
                    word: w.word,
                    meaning: w.meaning,
                    meaningEn: (w as any).meaningEn || (w as any).meaningNoteEn,
                    meaningVi: (w as any).meaningVi || (w as any).meaningNoteVi || (w as any).meaningNoteVie,
                    meaningNoteEn: (w as any).meaningEn || (w as any).meaningNoteEn,
                    meaningNoteVi: (w as any).meaningVi || (w as any).meaningNoteVi || (w as any).meaningNoteVie,
                    meaningNoteVie: (w as any).meaningVi || (w as any).meaningNoteVi || (w as any).meaningNoteVie,
                    pronunciation: (w as any).pronunciation,
                    pos: (w as any).pos,
                    example: (w as any).example,
                    source: (w as any).source,
                  })
                  VocabularyStore.scheduleForToday(record.id, 'unrated_custom')
                }
              } catch {}

              // Then show summary.
              setPhase('summary')
            }}
          />
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
                  {srsRound > 1 && (
                    <div className="px-3 py-1 bg-slate-900/10 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 rounded-full text-sm font-bold border border-slate-200 dark:border-slate-700">
                      Lượt {srsRound}
                    </div>
                  )}
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

            {/* Auto Mode Toggle */}
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Chế độ chọn thủ công</span>
                <div className="relative group">
                  <svg className="w-4 h-4 text-slate-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                    <div className="font-semibold mb-1">Bật: Hiện 2 nút Làm lại / Cho qua</div>
                    <div>Tắt: Enter tự động (đúng→qua, sai→làm lại)</div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAutoModeEnabled(!autoModeEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  autoModeEnabled 
                    ? 'bg-emerald-600' 
                    : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md ${
                    autoModeEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
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
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">Meanings</span>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowSrsViHint((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-sm font-semibold"
                >
                  {showSrsViHint ? 'Ẩn Nghĩa' : 'Nghĩa'}
                </button>
                <button
                  onClick={() => setShowMeaningByDefault((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-sm font-semibold"
                >
                  {showMeaningByDefault ? 'Mặc định: Hiện' : 'Mặc định: Ẩn'}
                </button>
              </div>

              <div className={phase === 'srs-review-result' ? 'space-y-2.5 mb-2' : 'space-y-3 mb-4'}>
                {showSrsViHint && String((srsQueue as any)?.[srsIndex]?.meaning || '').trim() && (
                  <div className={phase === 'srs-review-result' ? 'p-2.5 rounded-xl bg-sky-50/80 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800' : 'p-3 rounded-xl bg-sky-50/80 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800'}>
                    <div className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200 mb-1.5">Nghĩa của tôi</div>
                    <div className={phase === 'srs-review-result' ? 'text-sm text-slate-700 dark:text-slate-200 leading-relaxed' : 'text-base text-slate-700 dark:text-slate-200 leading-relaxed'}>
                      {String((srsQueue as any)[srsIndex].meaning || '')}
                    </div>
                  </div>
                )}

                <div className={phase === 'srs-review-result' ? 'p-2.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800' : 'p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800'}>
                  <div className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200 mb-1.5">EN meaning</div>
                  <div className={phase === 'srs-review-result' ? 'text-base font-semibold text-slate-900 dark:text-slate-100 leading-relaxed' : 'text-xl font-semibold text-slate-900 dark:text-slate-100 leading-relaxed'}>
                    {String((srsQueue as any)?.[srsIndex]?.meaningEn || (srsQueue as any)?.[srsIndex]?.meaningNoteEn || '').trim() || 'Chưa có EN meaning cho từ này'}
                  </div>
                </div>

                {String((srsQueue as any)?.[srsIndex]?.meaningVi || (srsQueue as any)?.[srsIndex]?.meaningNoteVie || (srsQueue as any)?.[srsIndex]?.meaningNoteVi || '').trim() && (
                  <div className={phase === 'srs-review-result' ? 'p-2.5 rounded-xl bg-teal-50/80 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800' : 'p-3 rounded-xl bg-teal-50/80 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800'}>
                    <div className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-200 mb-1.5">VIE meaning</div>
                    <div className={phase === 'srs-review-result' ? 'text-sm text-slate-700 dark:text-slate-200 leading-relaxed' : 'text-base text-slate-700 dark:text-slate-200 leading-relaxed'}>
                      {String((srsQueue as any)[srsIndex].meaningVi || (srsQueue as any)[srsIndex].meaningNoteVie || (srsQueue as any)[srsIndex].meaningNoteVi || '')}
                    </div>
                  </div>
                )}
              </div>

              {String((srsQueue as any)?.[srsIndex]?.pos || '').trim() && (
                <div
                  className={
                    phase === 'srs-review-result'
                      ? 'text-sm text-slate-600 dark:text-slate-400 font-medium mb-2'
                      : 'text-base text-slate-600 dark:text-slate-400 font-medium mb-4'
                  }
                >
                  {String((srsQueue as any)[srsIndex].pos)}
                </div>
              )}

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
                    onClick={() => speakWord(srsQueue[srsIndex]?.word || '')}
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
                        e.stopPropagation()
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
                    {String((srsQueue as any)?.[srsIndex]?.pos || '').trim() && (
                      <div className="text-sm text-slate-600 dark:text-slate-400 font-medium mt-1">
                        {String((srsQueue as any)[srsIndex].pos)}
                      </div>
                    )}
                    {srsQueue[srsIndex]?.pronunciation && (
                      <div className="text-lg text-slate-600 dark:text-slate-400 mt-1">/{srsQueue[srsIndex]?.pronunciation}/</div>
                    )}
                    <div className="mt-3 flex justify-center">
                      <button
                        onClick={() => speakWord(srsQueue[srsIndex]?.word || '')}
                        className="btn-icon !w-auto px-4 py-2 flex items-center gap-2"
                        title="Speak word"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                        </svg>
                        Speak
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action Buttons - 2 choices: Làm lại / Cho qua (only show when autoModeEnabled) */}
                {autoModeEnabled ? (
                  <div className="pt-4">
                    {!lastAnswerCorrect && (
                      <div className="text-center mb-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded-xl">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm font-semibold">Bạn có thể làm lại ngay hoặc cho qua</span>
                        </div>
                      </div>
                    )}
                    <div className="text-center text-sm font-semibold text-slate-600 dark:text-slate-400 mb-3">
                      Nhấn phím 1 hoặc 2
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={handleSRSRetry}
                        className="group relative p-4 bg-gradient-to-br from-amber-100 to-orange-200 dark:from-amber-900/50 dark:to-orange-900/50 hover:from-amber-200 hover:to-orange-300 dark:hover:from-amber-800/50 dark:hover:to-orange-800/50 rounded-2xl border-2 border-amber-400 dark:border-amber-600 hover:border-amber-500 dark:hover:border-amber-500 transition-all active:scale-95 shadow-lg hover:shadow-xl shadow-amber-500/20"
                      >
                        <div className="text-3xl mb-2">🔄</div>
                        <div className="font-bold text-base text-amber-800 dark:text-amber-300">Làm lại</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Thử lại ngay</div>
                        <div className="absolute top-2 right-2 w-7 h-7 bg-amber-600 text-white rounded-lg flex items-center justify-center font-bold text-sm shadow-md">1</div>
                      </button>
                      <button
                        onClick={handleSRSPass}
                        className="group relative p-4 bg-gradient-to-br from-emerald-100 to-teal-200 dark:from-emerald-900/50 dark:to-teal-900/50 hover:from-emerald-200 hover:to-teal-300 dark:hover:from-emerald-800/50 dark:hover:to-teal-800/50 rounded-2xl border-2 border-emerald-400 dark:border-emerald-600 hover:border-emerald-500 dark:hover:border-emerald-500 transition-all active:scale-95 shadow-lg hover:shadow-xl shadow-emerald-500/20"
                      >
                        <div className="text-3xl mb-2">➡️</div>
                        <div className="font-bold text-base text-emerald-800 dark:text-emerald-300">Cho qua</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Tới từ tiếp theo</div>
                        <div className="absolute top-2 right-2 w-7 h-7 bg-emerald-600 text-white rounded-lg flex items-center justify-center font-bold text-sm shadow-md">2</div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    {!lastAnswerCorrect && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded-xl mb-3">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-semibold">Từ này sẽ được ôn lại lượt sau</span>
                      </div>
                    )}
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Nhấn <span className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded font-bold">Enter</span> để {lastAnswerCorrect ? 'tiếp tục' : 'làm lại'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {lastAnswerCorrect ? '✅ Đúng → Chuyển sang từ tiếp' : '❌ Sai → Thử lại từ này'}
                    </p>
                  </div>
                )}
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
