// VocabularyStore.ts - Single Source of Truth for all vocabulary data
// This store manages vocabulary records with SRS (Spaced Repetition System) data

export interface VocabRecord {
  // Identity
  id: string // unique: `${source}||${word}||${meaning}`
  word: string
  meaning: string
  meaningEn?: string
  meaningVi?: string
  meaningNoteVi?: string
  meaningNoteVie?: string
  meaningNoteEn?: string
  pronunciation?: string
  pos?: string // part of speech
  example?: string
  source?: string // file path or pdfId

  // Learning state
  state: 'new' | 'learning' | 'reviewing' | 'mastered'
  
  // SRS fields
  nextReviewDate: number // timestamp
  interval: number // days
  easeFactor: number // SM-2 ease factor (default 2.5)
  repetitions: number // consecutive correct answers
  
  // Session tracking
  lastReviewDate?: number
  lastLapseAt?: number
  timesReviewed: number
  timesCorrect: number
  streak: number // current correct streak
  
  // Round-based learning
  wrongInCurrentRound: boolean // marked wrong in current study round
  needsNextRound: boolean // should appear in next round
  
  // Difficulty chosen by user (1-5, where 1=easy, 5=hard)
  difficultyRating?: number
  
  // History log
  history: Array<{
    timestamp: number
    action: 'created' | 'reviewed' | 'correct' | 'incorrect' | 'difficulty_set' | 'rescheduled' | 'lapsed'
    data?: any
  }>
  
  // Metadata
  createdAt: number
  updatedAt: number
  tags?: string[]
}

export type VocabState = 'new' | 'learning' | 'reviewing' | 'mastered'

const VOCAB_STORE_KEY = 'vocab_store_v2'

// Persist only the most recent history event to keep storage small.
// Increase this if you want to retain a small tail for debugging.
const MAX_PERSISTED_HISTORY_EVENTS = 1

type HistoryEvent = VocabRecord['history'][number]

function appendHistory(prev: unknown, ...events: HistoryEvent[]): HistoryEvent[] {
  const existing = Array.isArray(prev) ? (prev as HistoryEvent[]) : []
  if (MAX_PERSISTED_HISTORY_EVENTS <= 0) return []
  return [...existing, ...events].slice(-MAX_PERSISTED_HISTORY_EVENTS)
}

// SM-2 Algorithm implementation
function calculateSM2(record: VocabRecord, quality: number): Partial<VocabRecord> {
  // quality: 0-5 (0-2 = incorrect, 3-5 = correct)
  const q = Math.max(0, Math.min(5, quality))
  
  let { interval, easeFactor, repetitions, streak, timesReviewed, timesCorrect } = record
  const now = Date.now()
  const todayStart = (() => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  
  timesReviewed += 1
  
  if (q < 3) {
    // Incorrect - reset
    repetitions = 0
    interval = 1
    streak = 0
  } else {
    // Correct
    timesCorrect += 1
    streak += 1
    
    if (repetitions === 0) {
      // First correct based on quality
      if (q === 3) interval = 1 // Hard
      else if (q === 4) interval = 3 // Good
      else if (q === 5) interval = 7 // Easy
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
  
  // Anchor scheduling to a calendar day (midnight local time) so it stays stable for date-based testing.
  const nextReviewDate = todayStart + interval * 24 * 60 * 60 * 1000
  
  // Determine state
  let state: VocabState = record.state
  if (repetitions >= 5 && streak >= 3) {
    state = 'mastered'
  } else if (repetitions >= 1) {
    state = 'reviewing'
  } else {
    state = 'learning'
  }
  
  return {
    interval,
    easeFactor,
    repetitions,
    nextReviewDate,
    lastReviewDate: now,
    timesReviewed,
    timesCorrect,
    streak,
    state,
    updatedAt: now
  }
}

class VocabularyStoreClass {
  private records: Map<string, VocabRecord> = new Map()
  private listeners: Set<() => void> = new Set()
  private initialized = false
  private _version = 0

  // Version counter - increments on any mutation, used for useMemo dependencies
  get version(): number {
    return this._version
  }

  constructor() {
    this.load()
  }

  private normalizeLoadedRecord(id: string, raw: any): { record: VocabRecord; changed: boolean } {
    const now = Date.now()

    const state: VocabState =
      raw?.state === 'new' || raw?.state === 'learning' || raw?.state === 'reviewing' || raw?.state === 'mastered'
        ? raw.state
        : 'new'

    const historyRaw = raw?.history
    const historyArr = Array.isArray(historyRaw) ? historyRaw : []
    const history = appendHistory(historyArr)

    // We persist SM-2 progress fields (easeFactor/repetitions/...) so Smart Review scheduling can resume
    // correctly after app restart. Mark as changed when older stored shapes are missing these fields.
    const missingSm2ProgressFields =
      raw == null ||
      !Object.prototype.hasOwnProperty.call(raw, 'easeFactor') ||
      !Object.prototype.hasOwnProperty.call(raw, 'repetitions') ||
      !Object.prototype.hasOwnProperty.call(raw, 'timesReviewed') ||
      !Object.prototype.hasOwnProperty.call(raw, 'timesCorrect') ||
      !Object.prototype.hasOwnProperty.call(raw, 'streak')
    const missingMeaningEn = raw == null || (!Object.prototype.hasOwnProperty.call(raw, 'meaningEn') && !Object.prototype.hasOwnProperty.call(raw, 'meaningNoteEn'))
    const missingMeaningVi = raw == null || (!Object.prototype.hasOwnProperty.call(raw, 'meaningVi') && !Object.prototype.hasOwnProperty.call(raw, 'meaningNoteVi') && !Object.prototype.hasOwnProperty.call(raw, 'meaningNoteVie'))

    const changed = !Array.isArray(historyRaw) || historyArr.length !== history.length || missingSm2ProgressFields || missingMeaningEn || missingMeaningVi

    const meaningEn = String(raw?.meaningEn ?? raw?.meaningNoteEn ?? '')
    const meaningVi = String(raw?.meaningVi ?? raw?.meaningNoteVi ?? raw?.meaningNoteVie ?? '')

    const record: VocabRecord = {
      id: String(raw?.id ?? id),
      word: String(raw?.word ?? ''),
      meaning: String(raw?.meaning ?? ''),
      meaningEn,
      meaningVi,
      meaningNoteVi: meaningVi,
      meaningNoteVie: meaningVi,
      meaningNoteEn: meaningEn,
      pronunciation: raw?.pronunciation ?? '',
      pos: raw?.pos ?? '',
      example: raw?.example ?? '',
      source: raw?.source ?? '',
      state,
      nextReviewDate: Number.isFinite(Number(raw?.nextReviewDate)) ? Number(raw.nextReviewDate) : now,
      interval: Number.isFinite(Number(raw?.interval)) ? Number(raw.interval) : 0,
      easeFactor: Number.isFinite(Number(raw?.easeFactor)) ? Number(raw.easeFactor) : 2.5,
      repetitions: Number.isFinite(Number(raw?.repetitions)) ? Number(raw.repetitions) : 0,
      lastReviewDate: typeof raw?.lastReviewDate === 'number' ? raw.lastReviewDate : undefined,
      lastLapseAt: typeof raw?.lastLapseAt === 'number' ? raw.lastLapseAt : undefined,
      timesReviewed: Number.isFinite(Number(raw?.timesReviewed)) ? Number(raw.timesReviewed) : 0,
      timesCorrect: Number.isFinite(Number(raw?.timesCorrect)) ? Number(raw.timesCorrect) : 0,
      streak: Number.isFinite(Number(raw?.streak)) ? Number(raw.streak) : 0,
      wrongInCurrentRound: Boolean(raw?.wrongInCurrentRound ?? false),
      needsNextRound: Boolean(raw?.needsNextRound ?? false),
      difficultyRating: typeof raw?.difficultyRating === 'number' ? raw.difficultyRating : undefined,
      history,
      createdAt: Number.isFinite(Number(raw?.createdAt)) ? Number(raw.createdAt) : now,
      updatedAt: Number.isFinite(Number(raw?.updatedAt)) ? Number(raw.updatedAt) : now,
      tags: Array.isArray(raw?.tags) ? raw.tags : undefined,
    }

    return { record, changed }
  }

  private load() {
    try {
      const raw = localStorage.getItem(VOCAB_STORE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as Record<string, any>
        let migrated = false
        const entries: Array<[string, VocabRecord]> = []
        for (const [id, rec] of Object.entries(data)) {
          const normalized = this.normalizeLoadedRecord(id, rec)
          migrated ||= normalized.changed
          entries.push([id, normalized.record])
        }
        this.records = new Map(entries)
        if (migrated) this.save()
      }
      this.initialized = true
    } catch (e) {
      console.error('[VocabStore] Failed to load:', e)
      this.records = new Map()
      this.initialized = true
    }
  }

  private save() {
    try {
      // Persist full SM-2 progress fields so review scheduling/state survives app restarts.
      const data: Record<string, Partial<VocabRecord>> = {}
      this.records.forEach((v, k) => {
        data[k] = {
          // Identity + content
          id: v.id,
          word: v.word,
          meaning: v.meaning,
          meaningEn: v.meaningEn,
          meaningVi: v.meaningVi,
          meaningNoteVi: v.meaningNoteVi,
          meaningNoteVie: v.meaningNoteVie,
          meaningNoteEn: v.meaningNoteEn,
          pronunciation: v.pronunciation,
          pos: v.pos,
          example: v.example,
          source: v.source,

          // Scheduling + state
          state: v.state,
          nextReviewDate: v.nextReviewDate,
          interval: v.interval,
          difficultyRating: v.difficultyRating,

          // SM-2 progress (critical for stable Smart Review scheduling)
          easeFactor: v.easeFactor,
          repetitions: v.repetitions,
          lastReviewDate: v.lastReviewDate,
          lastLapseAt: v.lastLapseAt,
          timesReviewed: v.timesReviewed,
          timesCorrect: v.timesCorrect,
          streak: v.streak,

          // Session / round-based flags (keep for resume)
          wrongInCurrentRound: v.wrongInCurrentRound,
          needsNextRound: v.needsNextRound,

          // Keep only a tiny history tail (already truncated via appendHistory)
          history: appendHistory(v.history),

          // Metadata
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          tags: v.tags,
        }
      })
      localStorage.setItem(VOCAB_STORE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('[VocabStore] Failed to save:', e)
    }
  }

  private notify() {
    this._version++
    this.listeners.forEach(fn => fn())
  }

  // Generate unique ID
  makeId(source: string | undefined, word: string, meaning: string): string {
    const s = String(source || '').trim()
    const w = String(word || '').trim().toLowerCase()
    const m = String(meaning || '').trim().toLowerCase()
    return `${s}||${w}||${m}`
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Get all records
  getAll(): VocabRecord[] {
    return Array.from(this.records.values())
  }

  // Iterate records without allocating an array (perf for large stores)
  private forEachRecord(fn: (record: VocabRecord) => void) {
    for (const record of this.records.values()) {
      fn(record)
    }
  }

  // Get record by ID
  get(id: string): VocabRecord | undefined {
    return this.records.get(id)
  }

  // Get record by word details
  getByWord(source: string | undefined, word: string, meaning: string): VocabRecord | undefined {
    return this.records.get(this.makeId(source, word, meaning))
  }

  // Check if record exists
  has(id: string): boolean {
    return this.records.has(id)
  }

  // Add or update a record
  upsert(data: Partial<VocabRecord> & { word: string; meaning: string; source?: string }): VocabRecord {
    const id = this.makeId(data.source, data.word, data.meaning)
    const existing = this.records.get(id)
    const now = Date.now()

    if (existing) {
      // Update existing
      const updated: VocabRecord = {
        ...existing,
        ...data,
        meaningEn: typeof data.meaningEn === 'string'
          ? data.meaningEn
          : (typeof data.meaningNoteEn === 'string' ? data.meaningNoteEn : existing.meaningEn),
        meaningVi: typeof data.meaningVi === 'string'
          ? data.meaningVi
          : (typeof data.meaningNoteVi === 'string'
            ? data.meaningNoteVi
            : (typeof data.meaningNoteVie === 'string' ? data.meaningNoteVie : existing.meaningVi)),
        id,
        updatedAt: now,
        history: appendHistory(existing.history, { timestamp: now, action: 'reviewed', data })
      }
      this.records.set(id, updated)
      this.save()
      this.notify()
      return updated
    } else {
      // Create new
      const newRecord: VocabRecord = {
        id,
        word: data.word,
        meaning: data.meaning,
        meaningEn: data.meaningEn || data.meaningNoteEn || '',
        meaningVi: data.meaningVi || data.meaningNoteVi || data.meaningNoteVie || '',
        meaningNoteVi: data.meaningNoteVi || data.meaningNoteVie || '',
        meaningNoteVie: data.meaningNoteVie || data.meaningNoteVi || '',
        meaningNoteEn: data.meaningNoteEn || data.meaningEn || '',
        pronunciation: data.pronunciation || '',
        pos: data.pos || '',
        example: data.example || '',
        source: data.source || '',
        state: data.state || 'new',
        nextReviewDate: data.nextReviewDate ?? now,
        interval: data.interval ?? 0,
        easeFactor: data.easeFactor ?? 2.5,
        repetitions: data.repetitions ?? 0,
        timesReviewed: data.timesReviewed ?? 0,
        timesCorrect: data.timesCorrect ?? 0,
        streak: data.streak ?? 0,
        wrongInCurrentRound: data.wrongInCurrentRound ?? false,
        needsNextRound: data.needsNextRound ?? false,
        history: appendHistory([], { timestamp: now, action: 'created' }),
        createdAt: data.createdAt ?? now,
        updatedAt: now
      }
      this.records.set(id, newRecord)
      this.save()
      this.notify()
      return newRecord
    }
  }

  update(id: string, updates: Partial<VocabRecord>): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const updated: VocabRecord = {
      ...record,
      ...updates,
      meaningNoteVi: typeof updates.meaningNoteVi === 'string'
        ? updates.meaningNoteVi
        : (typeof updates.meaningNoteVie === 'string' ? updates.meaningNoteVie : record.meaningNoteVi),
      meaningNoteVie: typeof updates.meaningNoteVie === 'string'
        ? updates.meaningNoteVie
        : (typeof updates.meaningNoteVi === 'string' ? updates.meaningNoteVi : record.meaningNoteVie),
      id,
      updatedAt: now,
    }
    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Record a review result
  recordReview(id: string, quality: number, wasCorrect: boolean): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const lapseThresholdMs = Math.max(30 * dayMs, 3 * Math.max(1, record.interval || 1) * dayMs)
    const lastReviewAt = record.lastReviewDate

    const lapsed = typeof lastReviewAt === 'number' && now - lastReviewAt >= lapseThresholdMs
    const baseRecord: VocabRecord = lapsed
      ? {
          ...record,
          // After a long gap, treat the card as lapsed: reset momentum and slightly reduce ease.
          repetitions: 0,
          streak: 0,
          easeFactor: Math.max(1.3, (record.easeFactor || 2.5) * 0.9),
          lastLapseAt: now,
        }
      : record

    const updates = calculateSM2(baseRecord, quality)

    const lapsedEvent: HistoryEvent | undefined = lapsed
      ? {
          timestamp: now,
          action: 'lapsed' as const,
          data: {
            gapDays: lastReviewAt ? Math.round((now - lastReviewAt) / dayMs) : undefined,
            prevInterval: record.interval,
            thresholdDays: Math.round(lapseThresholdMs / dayMs),
          },
        }
      : undefined

    const resultEvent: HistoryEvent = {
      timestamp: now,
      action: (wasCorrect ? 'correct' : 'incorrect') as 'correct' | 'incorrect',
      data: { quality },
    }
    
    const updated: VocabRecord = {
      ...record,
      ...updates,
      wrongInCurrentRound: !wasCorrect || record.wrongInCurrentRound,
      needsNextRound: !wasCorrect || record.needsNextRound,
      lastLapseAt: lapsed ? now : record.lastLapseAt,
      history: appendHistory(record.history, ...(lapsedEvent ? [lapsedEvent] : []), resultEvent)
    }
    
    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Record a review with a 1..4 difficulty rating (like the Custom difficulty scale)
  // This is the intended flow for Smart Review: difficulty + repetitions drive next scheduling.
  recordReviewWithDifficulty(id: string, difficulty: 1 | 2 | 3 | 4, wasCorrect: boolean): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const todayStart = (() => {
      const d0 = new Date(now)
      d0.setHours(0, 0, 0, 0)
      return d0.getTime()
    })()

    const d = Math.max(1, Math.min(4, Math.round(difficulty))) as 1 | 2 | 3 | 4

    // Base intervals matching the UI semantics
    const baseIntervalDays: Record<1 | 2 | 3 | 4, number> = {
      1: 7,
      2: 4,
      3: 2,
      4: 1,
    }

    // Multipliers used after a word has been reviewed at least once.
    // Easier ratings grow faster.
    const growth: Record<1 | 2 | 3 | 4, number> = {
      1: 1.6,
      2: 1.35,
      3: 1.15,
      4: 1.0,
    }

    // Map to a SM-2-like quality number for ease-factor updates.
    // For correct: always >=3 so it counts as a correct repetition.
    // For incorrect: force a low score to reset repetitions.
    const quality = wasCorrect ? (d === 1 ? 5 : d === 2 ? 4 : 3) : 1

    // First, update easeFactor/repetitions/times... using SM-2 mechanics.
    const sm2 = calculateSM2(record, quality)

    // Then, override interval scheduling to use the 1..4 difficulty scale explicitly.
    let interval = 1
    if (!wasCorrect) {
      interval = 1
    } else {
      const repsBefore = record.repetitions
      if (repsBefore <= 0) {
        interval = baseIntervalDays[d]
      } else {
        const prev = Math.max(1, record.interval || 1)
        interval = Math.max(1, Math.round(prev * (sm2.easeFactor || record.easeFactor || 2.5) * growth[d]))
      }
    }

    const nextReviewDate = todayStart + interval * 24 * 60 * 60 * 1000

    const updated: VocabRecord = {
      ...record,
      ...sm2,
      difficultyRating: d,
      interval,
      nextReviewDate,
      wrongInCurrentRound: !wasCorrect || record.wrongInCurrentRound,
      needsNextRound: !wasCorrect || record.needsNextRound,
      history: appendHistory(record.history, {
        timestamp: now,
        action: wasCorrect ? 'correct' : 'incorrect',
        data: { difficulty: d, quality, interval },
      })
    }

    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Smart mode: after a session, the user rates difficulty for each word.
  // This updates difficultyRating and recomputes the nextReviewDate using only:
  // - the most recent interval (record.interval)
  // - the final difficulty chosen after the session
  // It does NOT depend on correctness inside the session.
  applyDifficultyAndRecomputeSchedule(id: string, difficulty: number): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const todayStart = (() => {
      const d0 = new Date(now)
      d0.setHours(0, 0, 0, 0)
      return d0.getTime()
    })()

    const d = Math.max(1, Math.min(4, Math.round(difficulty))) as 1 | 2 | 3 | 4

    const baseIntervalDays: Record<1 | 2 | 3 | 4, number> = {
      1: 7,
      2: 4,
      3: 2,
      4: 1,
    }
    // Multipliers applied when a word has an existing interval.
    // Easier ratings grow faster; harder ratings can shrink the next interval.
    const multiplier: Record<1 | 2 | 3 | 4, number> = {
      1: 2.0,
      2: 1.6,
      3: 1.25,
      4: 0.8,
    }

    const prevInterval = Math.max(0, record.interval || 0)
    const basePredict = (dd: 1 | 2 | 3 | 4): number => {
      if (prevInterval <= 0) return baseIntervalDays[dd]
      const raw = prevInterval * multiplier[dd]
      // Rounding policy:
      // - For 1/2/3 (easier): round up so interval grows as expected.
      // - For 4 (hardest): round down so interval can shrink.
      return Math.max(1, dd === 4 ? Math.floor(raw) : Math.ceil(raw))
    }

    // Compute from hardest -> easiest, then bump easier levels by +1 day
    // if rounding causes collisions (or would otherwise make them not strictly later).
    const predicted: Record<1 | 2 | 3 | 4, number> = {
      1: basePredict(1),
      2: basePredict(2),
      3: basePredict(3),
      4: basePredict(4),
    }
    const ordered: Array<1 | 2 | 3 | 4> = [4, 3, 2, 1]
    let lastDays: number | null = null
    for (const dd of ordered) {
      let days = predicted[dd]
      if (lastDays != null && days <= lastDays) {
        days = lastDays + 1
        predicted[dd] = days
      }
      lastDays = predicted[dd]
    }

    const interval = predicted[d]

    const nextReviewDate = todayStart + interval * 24 * 60 * 60 * 1000

    const updated: VocabRecord = {
      ...record,
      difficultyRating: d,
      interval,
      nextReviewDate,
      state: record.state === 'new' ? 'reviewing' : record.state,
      updatedAt: now,
      history: appendHistory(record.history, {
        timestamp: now,
        action: 'difficulty_set',
        data: { difficulty: d, interval, recomputed: true },
      })
    }

    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Set difficulty rating
  setDifficulty(id: string, difficulty: number): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const todayStart = (() => {
      const d0 = new Date(now)
      d0.setHours(0, 0, 0, 0)
      return d0.getTime()
    })()

    // Clamp legacy/invalid values to the supported 1..4 range.
    const d = Math.max(1, Math.min(4, Math.round(difficulty)))
    
    // Map difficulty (1-4) to SM-2 quality and interval
    // 1 = Easy (long interval), 4 = Hard (short interval)
    let interval = 1
    let quality = 3

    if (d === 1) {
      interval = 7
      quality = 5
    } else if (d === 2) {
      interval = 4
      quality = 4
    } else if (d === 3) {
      interval = 2
      quality = 3
    } else {
      interval = 1
      quality = 2
    }
    
    // Anchor to calendar day.
    const nextReviewDate = todayStart + interval * 24 * 60 * 60 * 1000

    const updated: VocabRecord = {
      ...record,
      difficultyRating: d,
      nextReviewDate,
      interval,
      state: 'reviewing',
      updatedAt: now,
      history: appendHistory(record.history, {
        timestamp: now,
        action: 'difficulty_set',
        data: { difficulty: d, interval },
      })
    }
    
    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Reschedule a word to a different date
  reschedule(id: string, newDate: number): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const daysDiff = Math.ceil((newDate - now) / (24 * 60 * 60 * 1000))

    const updated: VocabRecord = {
      ...record,
      nextReviewDate: newDate,
      interval: Math.max(1, daysDiff),
      updatedAt: now,
      history: appendHistory(record.history, { timestamp: now, action: 'rescheduled', data: { newDate } })
    }
    
    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Schedule a word to be due today (used when the user did not rate difficulty).
  // Anchors to local midnight for stable day-based behavior.
  scheduleForToday(id: string, reason?: string): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const todayStart = (() => {
      const d0 = new Date(now)
      d0.setHours(0, 0, 0, 0)
      return d0.getTime()
    })()

    const updated: VocabRecord = {
      ...record,
      state: record.state === 'new' ? 'learning' : record.state,
      nextReviewDate: todayStart,
      interval: 1,
      updatedAt: now,
      history: appendHistory(record.history, {
        timestamp: now,
        action: 'rescheduled',
        data: { newDate: todayStart, scheduledForToday: true, reason },
      })
    }

    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Remove a word from the review schedule (non-destructive)
  // This does NOT delete the vocabulary record; it simply pushes the nextReviewDate far into the future.
  removeFromSchedule(id: string): VocabRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined

    const now = Date.now()
    const todayStart = (() => {
      const d0 = new Date(now)
      d0.setHours(0, 0, 0, 0)
      return d0.getTime()
    })()
    const farFutureDays = 365 * 5 // 5 years
    const newDate = todayStart + farFutureDays * 24 * 60 * 60 * 1000

    const updated: VocabRecord = {
      ...record,
      state: record.state === 'new' ? 'reviewing' : record.state,
      nextReviewDate: newDate,
      interval: farFutureDays,
      updatedAt: now,
      history: appendHistory(record.history, {
        timestamp: now,
        action: 'rescheduled',
        data: { newDate, removedFromSchedule: true },
      })
    }

    this.records.set(id, updated)
    this.save()
    this.notify()
    return updated
  }

  // Reset round tracking for a new study session
  resetRoundTracking(ids?: string[]) {
    const toReset = ids || Array.from(this.records.keys())
    const now = Date.now()

    toReset.forEach(id => {
      const record = this.records.get(id)
      if (record) {
        this.records.set(id, {
          ...record,
          wrongInCurrentRound: false,
          needsNextRound: false,
          updatedAt: now
        })
      }
    })
    
    this.save()
    this.notify()
  }

  // Get words that need next round (marked wrong)
  getWordsNeedingNextRound(): VocabRecord[] {
    return this.getAll().filter(r => r.needsNextRound)
  }

  // Get due cards for review
  getDueCards(): VocabRecord[] {
    const now = Date.now()
    const out: VocabRecord[] = []
    this.forEachRecord((r) => {
      if (r.state === 'new') return
      if ((r.nextReviewDate || 0) <= now) out.push(r)
    })
    return out
  }

  // Get cards not yet in SRS (new words from custom study)
  getNewCards(): VocabRecord[] {
    return this.getAll().filter(r => r.state === 'new')
  }

  // Get cards by state
  getByState(state: VocabState): VocabRecord[] {
    return this.getAll().filter(r => r.state === state)
  }

  // Get calendar data grouped by date (for next N days)
  getCalendarData(days: number = 30): Map<string, VocabRecord[]> {
    const result = new Map<string, VocabRecord[]>()
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    // Initialize days
    for (let i = 0; i < days; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      result.set(d.toISOString().split('T')[0], [])
    }
    
    // Assign cards
    this.getAll().forEach(record => {
      if (record.state === 'new') return // Skip new cards
      const reviewDate = new Date(record.nextReviewDate)
      const reviewDay = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate())
      const key = reviewDay.toISOString().split('T')[0]
      
      const existing = result.get(key)
      if (existing) {
        existing.push(record)
      }
    })
    
    return result
  }

  // Get overdue cards
  getOverdueCards(): VocabRecord[] {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = today.getTime()

    const out: VocabRecord[] = []
    this.forEachRecord((r) => {
      if (r.state === 'new') return
      if ((r.nextReviewDate || 0) < todayStart) out.push(r)
    })
    return out
  }

  // Delete a record
  delete(id: string): boolean {
    const existed = this.records.delete(id)
    if (existed) {
      this.save()
      this.notify()
    }
    return existed
  }

  // Clear all records
  clear() {
    this.records.clear()
    this.save()
    this.notify()
  }

  // Import from old SRS store (migration helper)
  importFromOldSRS(oldStore: Record<string, any>) {
    const now = Date.now()
    Object.values(oldStore).forEach((old: any) => {
      if (!old.word || !old.meaning) return
      
      const id = this.makeId(old.source, old.word, old.meaning)
      if (this.records.has(id)) return // Skip existing
      
      const record: VocabRecord = {
        id,
        word: old.word,
        meaning: old.meaning,
        pronunciation: old.pronunciation,
        example: old.example,
        source: old.source,
        state: old.repetitions >= 5 ? 'mastered' : old.repetitions >= 1 ? 'reviewing' : 'learning',
        nextReviewDate: old.nextReview || now,
        interval: old.interval || 1,
        easeFactor: old.easeFactor || 2.5,
        repetitions: old.repetitions || 0,
        lastReviewDate: old.lastReview,
        timesReviewed: old.repetitions || 0,
        timesCorrect: old.repetitions || 0,
        streak: old.repetitions || 0,
        wrongInCurrentRound: false,
        needsNextRound: false,
        history: [{ timestamp: now, action: 'created', data: { imported: true } }],
        createdAt: old.lastReview || now,
        updatedAt: now
      }
      
      this.records.set(id, record)
    })
    
    this.save()
    this.notify()
  }

  // Get statistics
  getStats() {
    const now = Date.now()

    const todayStart = (() => {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    })()

    let total = 0
    let countNew = 0
    let learning = 0
    let reviewing = 0
    let mastered = 0
    let dueToday = 0
    let overdue = 0

    this.forEachRecord((r) => {
      total += 1
      if (r.state === 'new') {
        countNew += 1
        return
      }
      if ((r.nextReviewDate || 0) <= now) dueToday += 1
      if ((r.nextReviewDate || 0) < todayStart) overdue += 1
      if (r.state === 'learning') learning += 1
      else if (r.state === 'reviewing') reviewing += 1
      else if (r.state === 'mastered') mastered += 1
    })

    return {
      total,
      new: countNew,
      learning,
      reviewing,
      mastered,
      dueToday,
      overdue,
    }
  }
}

// Singleton instance
export const VocabularyStore = new VocabularyStoreClass()

// React hook for subscribing to store changes
export function useVocabularyStore() {
  const [, forceUpdate] = React.useState({})
  
  React.useEffect(() => {
    const unsubscribe = VocabularyStore.subscribe(() => forceUpdate({}))

    // Time-based UI (due/overdue/calendar “today”) should update even when the store doesn't change.
    // This also makes OS date-change testing work without restarting the app.
    // NOTE: Keep this relatively infrequent to avoid UI jank when the store grows large.
    const tick = window.setInterval(() => forceUpdate({}), 30000)

    const onWake = () => forceUpdate({})
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)

    return () => {
      unsubscribe()
      window.clearInterval(tick)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [])
  
  return VocabularyStore
}

// Need to import React for the hook
import React from 'react'
