// DifficultySelector.tsx - Post-session difficulty rating for words
// Displays after Custom Study or Smart Review to let user rate word difficulty

import React, { useMemo, useState } from 'react'
import { VocabularyStore } from '../../store/VocabularyStore'
import './DifficultySelector.css'

interface DifficultySelectorProps {
  // Words to rate
  words: Array<{
    id: string
    word: string
    meaning: string
    meaningEn?: string
    meaningVi?: string
    meaningNoteEn?: string
    meaningNoteVi?: string
    pronunciation?: string
    pos?: string
    example?: string
    source?: string
    wasCorrect?: boolean
    wrongCount?: number
  }>
  
  // Mode: 'custom' for Custom Study (add to SRS), 'smart' for Smart Review (adjust difficulty)
  mode: 'custom' | 'smart'
  
  // Called when user finishes rating all words
  onComplete: () => void
  
  // Called to skip this step
  onSkip?: () => void
}

interface WordRating {
  id: string
  difficulty: number | null // 1=Easy, 2=Medium-Easy, 3=Medium, 4=Hard
}

const DIFFICULTY_OPTIONS = [
  { value: 1, label: 'Rất dễ', emoji: '😎', color: 'from-green-400 to-emerald-500', days: '7 ngày' },
  { value: 2, label: 'Dễ', emoji: '🙂', color: 'from-teal-400 to-cyan-500', days: '4 ngày' },
  { value: 3, label: 'Vừa', emoji: '😐', color: 'from-amber-400 to-orange-500', days: '2 ngày' },
  { value: 4, label: 'Khó', emoji: '😓', color: 'from-orange-400 to-red-500', days: '1 ngày' },
]

function getTodayStartMs(nowMs: number): number {
  const d0 = new Date(nowMs)
  d0.setHours(0, 0, 0, 0)
  return d0.getTime()
}

function formatDateInputValue(ms: number): string {
  const d = new Date(ms)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getTodayDateInputValue(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return formatDateInputValue(d.getTime())
}

function predictSmartIntervalDays(recordId: string, difficulty: 1 | 2 | 3 | 4): number | null {
  const record = VocabularyStore.get(recordId)
  if (!record) return null

  const baseIntervalDays: Record<1 | 2 | 3 | 4, number> = {
    1: 7,
    2: 4,
    3: 2,
    4: 1,
  }
  const multiplier: Record<1 | 2 | 3 | 4, number> = {
    1: 2.0,
    2: 1.6,
    3: 1.25,
    4: 0.8,
  }

  const prevInterval = Math.max(0, record.interval || 0)
  if (prevInterval <= 0) return baseIntervalDays[difficulty]
  const raw = prevInterval * multiplier[difficulty]
  return Math.max(1, difficulty === 4 ? Math.floor(raw) : Math.ceil(raw))
}

type Difficulty = 1 | 2 | 3 | 4

// Predict smart-mode intervals for all difficulties, ensuring they don't collide after rounding.
// Strategy (per user request): compute from hardest -> easiest, and if a later (easier) level
// would land on the same day (or earlier), bump it by +1 day until it's strictly later.
function predictSmartIntervalDaysDistinct(recordId: string): Record<Difficulty, number | null> {
  const record = VocabularyStore.get(recordId)
  if (!record) return { 1: null, 2: null, 3: null, 4: null }

  const baseIntervalDays: Record<Difficulty, number> = {
    1: 7,
    2: 4,
    3: 2,
    4: 1,
  }
  const multiplier: Record<Difficulty, number> = {
    1: 2.0,
    2: 1.6,
    3: 1.25,
    4: 0.8,
  }

  const prevInterval = Math.max(0, record.interval || 0)
  const basePredict = (d: Difficulty) => {
    if (prevInterval <= 0) return baseIntervalDays[d]
    const raw = prevInterval * multiplier[d]
    return Math.max(1, d === 4 ? Math.floor(raw) : Math.ceil(raw))
  }

  const out: Record<Difficulty, number> = {
    1: basePredict(1),
    2: basePredict(2),
    3: basePredict(3),
    4: basePredict(4),
  }

  const ordered: Difficulty[] = [4, 3, 2, 1] // hard -> easy
  let lastDay: number | null = null
  for (const d of ordered) {
    let days = out[d]
    if (lastDay != null && days <= lastDay) {
      days = lastDay + 1
      out[d] = days
    }
    lastDay = out[d]
  }

  return { 1: out[1], 2: out[2], 3: out[3], 4: out[4] }
}

function formatReviewDateFromDays(days: number): string {
  const now = Date.now()
  const todayStart = getTodayStartMs(now)
  const target = new Date(todayStart + days * 24 * 60 * 60 * 1000)
  return target.toLocaleDateString('vi-VN')
}

export default function DifficultySelector({ words, mode, onComplete, onSkip }: DifficultySelectorProps) {
  const [ratings, setRatings] = useState<Map<string, number>>(() => new Map())
  const [customDates, setCustomDates] = useState<Map<string, string>>(() => new Map())
  const [viHintWordIds, setViHintWordIds] = useState<Set<string>>(() => new Set())
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single')
  const [saving, setSaving] = useState(false)

  const toggleViHint = (wordId: string) => {
    setViHintWordIds((prev) => {
      const next = new Set(prev)
      if (next.has(wordId)) next.delete(wordId)
      else next.add(wordId)
      return next
    })
  }

  const isViHintShown = (wordId: string) => viHintWordIds.has(wordId)

  const sortedWords = useMemo(() => {
    return words
      .map((w, idx) => ({ w, idx }))
      .sort((a, b) => {
        const wa = Number(a.w.wrongCount || 0)
        const wb = Number(b.w.wrongCount || 0)
        if (wb !== wa) return wb - wa
        return a.idx - b.idx
      })
      .map(x => x.w)
  }, [words])

  const currentWord = sortedWords[currentIndex]

  const smartSelectedDays = (() => {
    if (mode !== 'smart' || !currentWord) return null
    const manual = customDates.get(currentWord.id)
    if (manual) {
      const [yy, mm, dd] = manual.split('-').map(Number)
      if (yy && mm && dd) {
        const chosen = new Date(yy, mm - 1, dd)
        chosen.setHours(0, 0, 0, 0)
        const todayStart = getTodayStartMs(Date.now())
        const diffDays = Math.ceil((chosen.getTime() - todayStart) / (24 * 60 * 60 * 1000))
        return Math.max(0, diffDays)
      }
    }
    const selected = ratings.get(currentWord.id)
    if (!selected) return null
    const distinct = predictSmartIntervalDaysDistinct(currentWord.id)
    return distinct[selected as Difficulty]
  })()

  const smartDistinctDays = (() => {
    if (mode !== 'smart' || !currentWord) return null
    return predictSmartIntervalDaysDistinct(currentWord.id)
  })()

  const smartHasManualDate = mode === 'smart' && !!currentWord && !!customDates.get(currentWord.id)
  
  const ratedCount = ratings.size
  const totalCount = sortedWords.length
  const allRated = ratedCount === totalCount

  // Set rating for a word
  const setRating = (wordId: string, difficulty: number) => {
    setRatings(prev => {
      const next = new Map(prev)
      next.set(wordId, difficulty)
      return next
    })
  }

  // Handle rating in single view mode
  const handleRateSingle = (difficulty: number) => {
    if (!currentWord) return
    setRating(currentWord.id, difficulty)
    
    // Auto advance to next word
    if (currentIndex < words.length - 1) {
      setTimeout(() => setCurrentIndex(currentIndex + 1), 200)
    }
  }

  // Save all ratings and complete
  const handleSave = async () => {
    setSaving(true)
    
    try {
      const todayStart = getTodayStartMs(Date.now())
      for (const word of words) {
        const difficulty = ratings.get(word.id)
        const manualDate = customDates.get(word.id)
        
        if (mode === 'custom') {
          // Add to SRS with difficulty rating
          const record = VocabularyStore.upsert({
            word: word.word,
            meaning: word.meaning,
            meaningEn: word.meaningEn || word.meaningNoteEn,
            meaningVi: word.meaningVi || word.meaningNoteVi,
            meaningNoteVi: word.meaningNoteVi,
            pronunciation: word.pronunciation,
            pos: word.pos,
            example: word.example,
            source: word.source,
          })
          
          if (difficulty) {
            VocabularyStore.setDifficulty(record.id, difficulty)
          } else {
            // Unrated -> must be relearned today
            VocabularyStore.scheduleForToday(record.id, 'unrated_custom')
          }
        } else {
          // Smart review: schedule depends only on the previous interval + final difficulty.
          const existingId = word.id

          // Keep metadata (pos/example/pronunciation/source) up to date when provided.
          // This is safe because upsert will resolve to the same record id for smart mode.
          try {
            VocabularyStore.upsert({
              word: word.word,
              meaning: word.meaning,
              meaningEn: word.meaningEn || word.meaningNoteEn,
              meaningVi: word.meaningVi || word.meaningNoteVi,
              meaningNoteVi: word.meaningNoteVi,
              pronunciation: word.pronunciation,
              pos: word.pos,
              example: word.example,
              source: word.source,
            })
          } catch {}

          if (difficulty) {
            VocabularyStore.applyDifficultyAndRecomputeSchedule(existingId, difficulty)
          } else if (!manualDate) {
            // Unrated -> must be relearned today
            VocabularyStore.scheduleForToday(existingId, 'unrated_smart')
          }

          // Optional: user manually chooses the next review date (override)
          if (manualDate) {
            const [yy, mm, dd] = manualDate.split('-').map(Number)
            if (yy && mm && dd) {
              const chosen = new Date(yy, mm - 1, dd)
              chosen.setHours(0, 0, 0, 0)
              VocabularyStore.reschedule(existingId, chosen.getTime())
            }
          }
        }
      }
      
      onComplete()
    } catch (error) {
      console.error('Failed to save ratings:', error)
    } finally {
      setSaving(false)
    }
  }

  // Quick actions
  const markAllAs = (difficulty: number) => {
    const newRatings = new Map(ratings)
    sortedWords.forEach(w => newRatings.set(w.id, difficulty))
    setRatings(newRatings)
  }

  return (
    <div className="difficulty-selector min-h-screen bg-gradient-to-br from-violet-50 via-purple-50/30 to-pink-50/20 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-6">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block p-4 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl shadow-xl mb-4">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">
            {mode === 'custom' ? 'Thêm vào lịch ôn tập' : 'Đánh giá độ khó'}
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            {mode === 'custom' 
              ? 'Chọn độ khó cho từng từ để hệ thống lên lịch ôn tập phù hợp'
              : 'Điều chỉnh độ khó để tối ưu lịch ôn tập cho lần sau'
            }
          </p>
          <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            Thứ tự ưu tiên: từ sai nhiều ở trên cùng
          </div>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-600 dark:text-slate-400">
              Đã đánh giá: {ratedCount}/{totalCount}
            </span>
            <span className="text-violet-600 dark:text-violet-400 font-medium">
              {Math.round((ratedCount / totalCount) * 100)}%
            </span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all duration-300"
              style={{ width: `${(ratedCount / totalCount) * 100}%` }}
            />
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex bg-white dark:bg-slate-800 rounded-xl p-1 shadow-md">
            <button
              onClick={() => setViewMode('single')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                viewMode === 'single'
                  ? 'bg-violet-500 text-white shadow-lg'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Từng từ
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                viewMode === 'grid'
                  ? 'bg-violet-500 text-white shadow-lg'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Xem tất cả
            </button>
          </div>
        </div>

        {/* Single Word View */}
        {viewMode === 'single' && currentWord && (
          <div className="card animate-fade-in mb-6">
            {/* Navigation */}
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              <div className="text-center">
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  Từ {currentIndex + 1} / {totalCount}
                </span>
              </div>
              
              <button
                onClick={() => setCurrentIndex(Math.min(totalCount - 1, currentIndex + 1))}
                disabled={currentIndex === totalCount - 1}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Word Display */}
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold text-slate-800 dark:text-white mb-2">
                {currentWord.word}
              </h2>
              {String(currentWord.pos || '').trim() && (
                <div className="text-sm text-slate-500 dark:text-slate-400 font-medium mb-2">
                  {currentWord.pos}
                </div>
              )}
              {currentWord.pronunciation && (
                <p className="text-lg text-violet-600 dark:text-violet-400 mb-2">
                  {currentWord.pronunciation}
                </p>
              )}

              <div className="mb-2">
                <button
                  onClick={() => toggleViHint(currentWord.id)}
                  className="px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-sm font-semibold"
                >
                  {isViHintShown(currentWord.id) ? 'Ẩn gợi ý Việt' : 'Gợi ý nghĩa Việt'}
                </button>
              </div>

              <p className="text-xl text-slate-600 dark:text-slate-400">
                {String(currentWord.meaningEn || currentWord.meaningNoteEn || '').trim() || 'Chưa có EN nghĩa cho từ này'}
              </p>
              {isViHintShown(currentWord.id) && (String(currentWord.meaning || '').trim() || String(currentWord.meaningVi || currentWord.meaningNoteVi || '').trim()) && (
                <div className="mt-2 text-base text-slate-700 dark:text-slate-300 leading-relaxed">
                  {String(currentWord.meaning || '').trim()}
                  {String(currentWord.meaningVi || currentWord.meaningNoteVi || '').trim() && (
                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{currentWord.meaningVi || currentWord.meaningNoteVi}</div>
                  )}
                </div>
              )}

              <div className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-sm font-semibold">
                Sai {Number(currentWord.wrongCount || 0)} lần
              </div>

              {mode === 'smart' && smartSelectedDays != null && (
                <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300">
                  <span className="text-sm font-semibold">
                    {smartHasManualDate
                      ? `Đã chọn ôn lại sau ~${smartSelectedDays} ngày (ngày ${formatReviewDateFromDays(smartSelectedDays)})`
                      : `Dự kiến ôn lại sau ~${smartSelectedDays} ngày (ngày ${formatReviewDateFromDays(smartSelectedDays)})`}
                  </span>
                </div>
              )}

              {mode === 'smart' && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  {!smartHasManualDate ? (
                    <button
                      onClick={() => {
                        // Prefill to today so the date picker opens on current month/year.
                        setCustomDates(prev => {
                          const next = new Map(prev)
                          next.set(currentWord.id, getTodayDateInputValue())
                          return next
                        })
                      }}
                      className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      Tự chọn ngày ôn lại
                    </button>
                  ) : (
                    <>
                      <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Ngày ôn lại:</label>
                      <input
                        type="date"
                        value={customDates.get(currentWord.id) || ''}
                        onChange={(e) => {
                          const v = e.target.value
                          setCustomDates(prev => {
                            const next = new Map(prev)
                            if (!v) next.delete(currentWord.id)
                            else next.set(currentWord.id, v)
                            return next
                          })
                        }}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                      />
                      <button
                        onClick={() => {
                          setCustomDates(prev => {
                            const next = new Map(prev)
                            next.delete(currentWord.id)
                            return next
                          })
                        }}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        Xoá
                      </button>
                    </>
                  )}
                </div>
              )}
              
              {currentWord.wasCorrect !== undefined && (
                <div className={`inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full ${
                  currentWord.wasCorrect 
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                    : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                }`}>
                  {currentWord.wasCorrect ? '✓ Đúng' : '✗ Sai'}
                </div>
              )}
            </div>

            {/* Difficulty Options */}
            <div className="space-y-3">
              {DIFFICULTY_OPTIONS.map(opt => {
                const isSelected = ratings.get(currentWord.id) === opt.value
                const predictedDays = mode === 'smart'
                  ? (smartDistinctDays ? smartDistinctDays[opt.value as Difficulty] : predictSmartIntervalDays(currentWord.id, opt.value as Difficulty))
                  : null
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleRateSingle(opt.value)}
                    className={`
                      w-full p-4 rounded-xl border-2 transition-all flex items-center gap-4
                      ${isSelected 
                        ? `border-transparent bg-gradient-to-r ${opt.color} text-white shadow-lg transform scale-[1.02]`
                        : 'border-slate-200 dark:border-slate-600 hover:border-violet-300 dark:hover:border-violet-600 bg-white dark:bg-slate-800'
                      }
                    `}
                  >
                    <span className="text-3xl">{opt.emoji}</span>
                    <div className="flex-1 text-left">
                      <div className={`font-bold ${isSelected ? 'text-white' : 'text-slate-800 dark:text-white'}`}>
                        {opt.label}
                      </div>
                      <div className={`text-sm ${isSelected ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                        {mode === 'smart' && predictedDays != null
                          ? `Ôn lại sau ~${predictedDays} ngày (ngày ${formatReviewDateFromDays(predictedDays)})`
                          : `Ôn lại sau ${opt.days}`}
                      </div>
                    </div>
                    <div className={`
                      w-8 h-8 rounded-full border-2 flex items-center justify-center
                      ${isSelected ? 'border-white bg-white/20' : 'border-slate-300 dark:border-slate-600'}
                    `}>
                      {isSelected && (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Grid View */}
        {viewMode === 'grid' && (
          <div className="card animate-fade-in mb-6">
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 mb-6 pb-6 border-b border-slate-200 dark:border-slate-700">
              <span className="text-sm text-slate-500 dark:text-slate-400 mr-2">Đánh dấu tất cả:</span>
              {DIFFICULTY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => markAllAs(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium bg-gradient-to-r ${opt.color} text-white hover:shadow-md transition-all`}
                >
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>

            {/* Words Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto pr-2">
              {sortedWords.map((word, idx) => {
                const rating = ratings.get(word.id)
                const ratingOption = rating ? DIFFICULTY_OPTIONS.find(o => o.value === rating) : null
                const predictedDays = mode === 'smart' && rating
                  ? predictSmartIntervalDaysDistinct(word.id)[rating as Difficulty]
                  : null
                const manualDate = mode === 'smart' ? (customDates.get(word.id) || '') : ''
                
                return (
                  <div 
                    key={word.id}
                    className={`
                      p-4 rounded-xl border-2 transition-all
                      ${rating 
                        ? `border-transparent bg-gradient-to-r ${ratingOption?.color} shadow-md`
                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800'
                      }
                    `}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <span className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                        ${rating ? 'bg-white/30 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'}
                      `}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold truncate ${rating ? 'text-white' : 'text-slate-800 dark:text-white'}`}>
                          {word.word}
                        </div>
                        {String(word.pos || '').trim() && (
                          <div className={`text-xs truncate ${rating ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                            {word.pos}
                          </div>
                        )}
                        <div className="mt-1">
                          <button
                            onClick={() => toggleViHint(word.id)}
                            className={`px-2 py-1 rounded-md text-xs font-semibold border ${rating ? 'border-white/50 bg-white/10 text-white hover:bg-white/20' : 'border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30'}`}
                          >
                            {isViHintShown(word.id) ? 'Ẩn VI' : 'Gợi ý VI'}
                          </button>
                        </div>
                        <div className={`text-sm truncate ${rating ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                          {String(word.meaningEn || word.meaningNoteEn || '').trim() || 'Chưa có EN nghĩa'}
                        </div>
                        {isViHintShown(word.id) && (String(word.meaning || '').trim() || String(word.meaningVi || word.meaningNoteVi || '').trim()) && (
                          <div className={`text-xs mt-1 ${rating ? 'text-white/85' : 'text-slate-600 dark:text-slate-300'}`}>
                            {String(word.meaning || '').trim()}
                            {String(word.meaningVi || word.meaningNoteVi || '').trim() && (
                              <div className="mt-0.5">{word.meaningVi || word.meaningNoteVi}</div>
                            )}
                          </div>
                        )}
                        <div className={`text-xs mt-1 font-semibold ${rating ? 'text-white/85' : 'text-rose-600 dark:text-rose-400'}`}>
                          Sai {Number(word.wrongCount || 0)} lần
                        </div>
                        {mode === 'smart' && rating && predictedDays != null && (
                          <div className={`text-xs mt-1 ${rating ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                            Ôn lại ~{predictedDays} ngày ({formatReviewDateFromDays(predictedDays)})
                          </div>
                        )}
                        {mode === 'smart' && (
                          <div className={`text-xs mt-2 ${rating ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                            {!manualDate ? (
                              <button
                                onClick={() => {
                                  setCustomDates(prev => {
                                    const next = new Map(prev)
                                    next.set(word.id, getTodayDateInputValue())
                                    return next
                                  })
                                }}
                                className={`px-2 py-1 rounded-md border ${rating ? 'border-white/50 bg-white/10 text-white hover:bg-white/20' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                              >
                                Tự chọn ngày (tháng/năm hiện tại)
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <input
                                  type="date"
                                  value={manualDate}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setCustomDates(prev => {
                                      const next = new Map(prev)
                                      if (!v) next.delete(word.id)
                                      else next.set(word.id, v)
                                      return next
                                    })
                                  }}
                                  className={`px-2 py-1 rounded-md border ${rating ? 'border-white/50 bg-white/10 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100'}`}
                                />
                                <button
                                  onClick={() => {
                                    setCustomDates(prev => {
                                      const next = new Map(prev)
                                      next.delete(word.id)
                                      return next
                                    })
                                  }}
                                  className={`px-2 py-1 rounded-md border ${rating ? 'border-white/50 bg-white/10 text-white hover:bg-white/20' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                                >
                                  Xoá
                                </button>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Mini difficulty selector */}
                    <div className="flex gap-1">
                      {DIFFICULTY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setRating(word.id, opt.value)}
                          title={opt.label}
                          className={`
                            flex-1 py-1.5 rounded-lg text-center text-lg transition-all
                            ${rating === opt.value
                              ? 'bg-white/40 shadow-inner'
                              : rating 
                                ? 'bg-white/10 hover:bg-white/20'
                                : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }
                          `}
                        >
                          {opt.emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          {onSkip && (
            <button
              onClick={onSkip}
              className="flex-1 py-4 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              {mode === 'smart' ? 'Học thêm' : 'Bỏ qua'}
            </button>
          )}
          
          <button
            onClick={handleSave}
            disabled={saving || totalCount === 0}
            className={`
              flex-1 py-4 font-semibold rounded-xl transition-all flex items-center justify-center gap-2
              ${allRated
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg hover:shadow-xl'
                : 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg hover:shadow-xl'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {saving ? (
              <>
                <span className="spinner-sm" />
                Đang lưu...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {allRated ? 'Hoàn thành' : `Lưu ${ratedCount} từ đã đánh giá`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
