// VocabularyStore.ts - Single Source of Truth for all vocabulary data
// This store manages vocabulary records with SRS (Spaced Repetition System) data

export interface VocabRecord {
  // Identity
  id: string // unique: `${source}||${word}||${meaning}`
  word: string
  meaning: string
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

  constructor() {
    this.load()
  }

  private load() {
    try {
      const raw = localStorage.getItem(VOCAB_STORE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as Record<string, VocabRecord>
        this.records = new Map(Object.entries(data))
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
      const data: Record<string, VocabRecord> = {}
      this.records.forEach((v, k) => { data[k] = v })
      localStorage.setItem(VOCAB_STORE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('[VocabStore] Failed to save:', e)
    }
  }

  private notify() {
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
        id,
        updatedAt: now,
        history: [
          ...existing.history,
          { timestamp: now, action: 'reviewed', data }
        ]
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
        pronunciation: data.pronunciation || '',
        pos: data.pos || '',
        example: data.example || '',
        source: data.source || '',
        state: 'new',
        nextReviewDate: now,
        interval: 0,
        easeFactor: 2.5,
        repetitions: 0,
        timesReviewed: 0,
        timesCorrect: 0,
        streak: 0,
        wrongInCurrentRound: false,
        needsNextRound: false,
        history: [{ timestamp: now, action: 'created' }],
        createdAt: now,
        updatedAt: now
      }
      this.records.set(id, newRecord)
      this.save()
      this.notify()
      return newRecord
    }
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
    
    const updated: VocabRecord = {
      ...record,
      ...updates,
      wrongInCurrentRound: !wasCorrect || record.wrongInCurrentRound,
      needsNextRound: !wasCorrect || record.needsNextRound,
      lastLapseAt: lapsed ? now : record.lastLapseAt,
      history: [
        ...record.history,
        ...(lapsed
          ? [
              {
                timestamp: now,
                action: 'lapsed' as const,
                data: {
                  gapDays: lastReviewAt ? Math.round((now - lastReviewAt) / dayMs) : undefined,
                  prevInterval: record.interval,
                  thresholdDays: Math.round(lapseThresholdMs / dayMs),
                },
              },
            ]
          : []),
        { 
          timestamp: now, 
          action: (wasCorrect ? 'correct' : 'incorrect') as 'correct' | 'incorrect',
          data: { quality }
        }
      ]
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
      history: [
        ...record.history,
        {
          timestamp: now,
          action: wasCorrect ? 'correct' : 'incorrect',
          data: { difficulty: d, quality, interval }
        }
      ]
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
    let interval = 1
    if (prevInterval <= 0) {
      interval = baseIntervalDays[d]
    } else {
      interval = Math.max(1, Math.round(prevInterval * multiplier[d]))
    }

    const nextReviewDate = todayStart + interval * 24 * 60 * 60 * 1000

    const updated: VocabRecord = {
      ...record,
      difficultyRating: d,
      interval,
      nextReviewDate,
      state: record.state === 'new' ? 'reviewing' : record.state,
      updatedAt: now,
      history: [
        ...record.history,
        { timestamp: now, action: 'difficulty_set', data: { difficulty: d, interval, recomputed: true } }
      ]
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
      history: [
        ...record.history,
        { timestamp: now, action: 'difficulty_set', data: { difficulty: d, interval } }
      ]
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
      history: [
        ...record.history,
        { timestamp: now, action: 'rescheduled', data: { newDate } }
      ]
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
      history: [
        ...record.history,
        { timestamp: now, action: 'rescheduled', data: { newDate: todayStart, scheduledForToday: true, reason } }
      ]
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
      history: [
        ...record.history,
        { timestamp: now, action: 'rescheduled', data: { newDate, removedFromSchedule: true } }
      ]
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
    return this.getAll().filter(r => 
      r.state !== 'new' && r.nextReviewDate <= now
    )
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
    const now = Date.now()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = today.getTime()
    
    return this.getAll().filter(r => 
      r.state !== 'new' && r.nextReviewDate < todayStart
    )
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
    const all = this.getAll()
    const now = Date.now()
    
    return {
      total: all.length,
      new: all.filter(r => r.state === 'new').length,
      learning: all.filter(r => r.state === 'learning').length,
      reviewing: all.filter(r => r.state === 'reviewing').length,
      mastered: all.filter(r => r.state === 'mastered').length,
      dueToday: all.filter(r => r.state !== 'new' && r.nextReviewDate <= now).length,
      overdue: this.getOverdueCards().length
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
    const tick = window.setInterval(() => forceUpdate({}), 2000)

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
