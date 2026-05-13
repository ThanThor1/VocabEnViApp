// ReviewCalendar.tsx - Monthly Calendar View for Spaced Repetition Review
// Supports drag-and-drop rescheduling and word deletion

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { VocabularyStore, useVocabularyStore } from '../../store/VocabularyStore'
import './ReviewCalendar.css'

interface ReviewCalendarProps {
  view?: 'month' | '14days'
  items?: ReviewCalendarItem[]
  onReschedule?: (id: string, newDate: number) => void
  onRemove?: (id: string) => void
  onStartReview?: (date: string, limit?: number) => void
  onClose?: () => void
}

export interface ReviewCalendarItem {
  id: string
  word: string
  meaning: string
  state?: 'new' | 'learning' | 'reviewing' | 'mastered'
  nextReviewDate: number
}

interface DayCell {
  date: Date
  dateStr: string // YYYY-MM-DD
  dayOfMonth: number
  isToday: boolean
  isCurrentMonth: boolean
  isPast: boolean
  words: ReviewCalendarItem[]
}

interface DragState {
  wordId: string | null
  fromDate: string | null
}

export default function ReviewCalendar({ view = 'month', items, onReschedule, onRemove, onStartReview, onClose }: ReviewCalendarProps) {
  // Subscribe to store changes only when using store-backed items
  useVocabularyStore()

  // Tick "now" periodically so changing system date/time updates the calendar without restart.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1500)
    return () => window.clearInterval(t)
  }, [])
  
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  
  const [dragState, setDragState] = useState<DragState>({ wordId: null, fromDate: null })
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ wordId: string; word: string } | null>(null)
  const [preLearnCount, setPreLearnCount] = useState<string>('')

  const todayStart = useMemo(() => {
    const t = new Date(nowMs)
    t.setHours(0, 0, 0, 0)
    return t.getTime()
  }, [nowMs])

  const formatDaysUntil = (nextReviewDate: number) => {
    const d = new Date(nextReviewDate)
    d.setHours(0, 0, 0, 0)
    const diffDays = Math.ceil((d.getTime() - todayStart) / (24 * 60 * 60 * 1000))
    if (diffDays <= 0) return 'Hôm nay'
    if (diffDays === 1) return 'Sau 1 ngày'
    return `Sau ${diffDays} ngày`
  }

  const effectiveItems: ReviewCalendarItem[] = items
    ? items
    : VocabularyStore.getAll()
        .filter(r => r.state !== 'new')
        .map(r => ({
          id: r.id,
          word: r.word,
          meaning: r.meaning,
          state: r.state,
          nextReviewDate: r.nextReviewDate,
        }))

  const doReschedule = useCallback((id: string, newDate: number) => {
    if (onReschedule) {
      onReschedule(id, newDate)
      return
    }
    VocabularyStore.reschedule(id, newDate)
  }, [onReschedule])

  const doRemove = useCallback((id: string) => {
    if (onRemove) {
      onRemove(id)
      return
    }
    // Default behavior: remove from schedule (not hard-delete)
    VocabularyStore.removeFromSchedule(id)
  }, [onRemove])

  // Generate calendar grid for current month
  const calendarGrid = useMemo(() => {
    if (view !== 'month') return [] as DayCell[]

    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    const firstDay = new Date(year, month, 1)
    const today = new Date(nowMs)
    today.setHours(0, 0, 0, 0)

    // Build word map by date
    const wordsByDate = new Map<string, ReviewCalendarItem[]>()
    effectiveItems.forEach(record => {
      const reviewDate = new Date(record.nextReviewDate)
      const key = `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}-${String(reviewDate.getDate()).padStart(2, '0')}`
      const existing = wordsByDate.get(key) || []
      existing.push(record)
      wordsByDate.set(key, existing)
    })

    // Start from Sunday of the week containing the first day
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - startDate.getDay())

    // Generate 6 weeks (42 days)
    const days: DayCell[] = []
    const current = new Date(startDate)

    for (let i = 0; i < 42; i++) {
      const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`

      days.push({
        date: new Date(current),
        dateStr,
        dayOfMonth: current.getDate(),
        isToday: current.getTime() === today.getTime(),
        isCurrentMonth: current.getMonth() === month,
        isPast: current < today,
        words: wordsByDate.get(dateStr) || []
      })

      current.setDate(current.getDate() + 1)
    }

    return days
  }, [view, currentMonth, effectiveItems, nowMs])

  // Generate 14-day grid (2 weeks)
  const twoWeekGrid = useMemo(() => {
    if (view !== '14days') return [] as DayCell[]

    const now = new Date(nowMs)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    today.setHours(0, 0, 0, 0)

    const wordsByDate = new Map<string, ReviewCalendarItem[]>()
    effectiveItems.forEach(record => {
      const reviewDate = new Date(record.nextReviewDate)
      const key = `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}-${String(reviewDate.getDate()).padStart(2, '0')}`
      const existing = wordsByDate.get(key) || []
      existing.push(record)
      wordsByDate.set(key, existing)
    })

    const days: DayCell[] = []
    for (let i = 0; i < 14; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      days.push({
        date: d,
        dateStr,
        dayOfMonth: d.getDate(),
        isToday: i === 0,
        isCurrentMonth: true,
        isPast: false,
        words: wordsByDate.get(dateStr) || [],
      })
    }
    return days
  }, [view, effectiveItems, nowMs])

  // Overdue words
  const overdueWords = useMemo(() => {
    return effectiveItems
      .filter(r => r.nextReviewDate < todayStart)
      .sort((a, b) => a.word.localeCompare(b.word))
  }, [effectiveItems, todayStart])

  // Navigation
  const goToPrevMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }
  
  const goToNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }
  
  const goToToday = () => {
    const now = new Date()
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, wordId: string, fromDate: string) => {
    e.dataTransfer.setData('text/plain', wordId)
    e.dataTransfer.effectAllowed = 'move'
    setDragState({ wordId, fromDate })
  }

  const handleDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, toDateStr: string) => {
    e.preventDefault()
    const wordId = e.dataTransfer.getData('text/plain')
    
    if (wordId && dragState.fromDate !== toDateStr) {
      // Parse target date
      const [year, month, day] = toDateStr.split('-').map(Number)
      const targetDate = new Date(year, month - 1, day)
      targetDate.setHours(12, 0, 0, 0) // Set to noon

      doReschedule(wordId, targetDate.getTime())
    }
    
    setDragState({ wordId: null, fromDate: null })
  }

  const handleDragEnd = () => {
    setDragState({ wordId: null, fromDate: null })
  }

  // Remove word from schedule
  const handleDeleteWord = (wordId: string) => {
    doRemove(wordId)
    setConfirmDelete(null)
  }

  const expandedDayWords = expandedDay
    ? (view === 'month' ? calendarGrid : twoWeekGrid).find(d => d.dateStr === expandedDay)?.words || []
    : []

  useEffect(() => {
    if (!expandedDay) {
      setPreLearnCount('')
      return
    }
    const total = expandedDayWords.length
    if (total <= 0) {
      setPreLearnCount('')
      return
    }
    setPreLearnCount(String(Math.min(10, total)))
  }, [expandedDay, expandedDayWords.length])

  // Format month name
  const monthName = currentMonth.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

  // Get color based on word count
  const getHeatColor = (count: number) => {
    if (count === 0) return ''
    if (count <= 2) return 'bg-emerald-100 dark:bg-emerald-900/40'
    if (count <= 5) return 'bg-amber-100 dark:bg-amber-900/40'
    if (count <= 10) return 'bg-orange-100 dark:bg-orange-900/40'
    return 'bg-red-100 dark:bg-red-900/40'
  }

  return (
    <div className="review-calendar bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold">Lịch Ôn Tập</h2>
            <p className="text-sm text-white/80">Kéo thả từ để đổi ngày ôn</p>
          </div>
        </div>
        
        {onClose && (
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Month Navigation */}
      {view === 'month' && (
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <button 
            onClick={goToPrevMonth}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white capitalize">
              {monthName}
            </h3>
            <button 
              onClick={goToToday}
              className="px-3 py-1 text-sm bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 rounded-full hover:bg-violet-200 dark:hover:bg-violet-900/60 transition-colors"
            >
              Hôm nay
            </button>
          </div>
          
          <button 
            onClick={goToNextMonth}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {view === '14days' && (
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">
              14 ngày tới
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Kéo thả để đổi ngày, bấm để xem chi tiết
            </p>
          </div>
          <button 
            onClick={goToToday}
            className="px-3 py-1 text-sm bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 rounded-full hover:bg-violet-200 dark:hover:bg-violet-900/60 transition-colors"
          >
            Hôm nay
          </button>
        </div>
      )}

      {/* Overdue Warning */}
      {overdueWords.length > 0 && (
        <div className="mx-4 mt-4 p-3 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 rounded-xl border-2 border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <span className="text-xl">⚠️</span>
            <div>
              <span className="font-bold">{overdueWords.length} từ quá hạn</span>
              <span className="text-sm ml-2 text-red-600 dark:text-red-400">
                - Kéo thả vào ngày khác để lên lịch lại
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2 max-h-24 overflow-y-auto">
            {overdueWords.slice(0, 20).map(word => (
              <div
                key={word.id}
                draggable
                onDragStart={(e) => handleDragStart(e, word.id, 'overdue')}
                onDragEnd={handleDragEnd}
                className="px-2 py-1 bg-white dark:bg-slate-800 rounded-lg text-sm font-medium cursor-move hover:shadow-md transition-shadow border border-red-200 dark:border-red-700"
              >
                {word.word}
              </div>
            ))}
            {overdueWords.length > 20 && (
              <span className="text-sm text-red-600 dark:text-red-400">
                +{overdueWords.length - 20} từ khác
              </span>
            )}
          </div>
        </div>
      )}

      {/* Day Names Header */}
      <div className="grid grid-cols-7 p-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
        {dayNames.map((day, i) => (
          <div 
            key={day} 
            className={`text-center text-sm font-semibold py-2 ${
              i === 0 ? 'text-red-500' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 dark:bg-slate-700">
        {(view === 'month' ? calendarGrid : twoWeekGrid).map((day, i) => (
          <div
            key={day.dateStr}
            onDragOver={(e) => handleDragOver(e, day.dateStr)}
            onDrop={(e) => handleDrop(e, day.dateStr)}
            onClick={() => day.words.length > 0 && setExpandedDay(expandedDay === day.dateStr ? null : day.dateStr)}
            className={`
              min-h-[100px] p-2 bg-white dark:bg-slate-800 transition-colors cursor-pointer
              ${!day.isCurrentMonth ? 'opacity-40' : ''}
              ${day.isToday ? 'ring-2 ring-violet-500 ring-inset' : ''}
              ${day.isPast && !day.isToday ? 'bg-slate-50 dark:bg-slate-850' : ''}
              ${getHeatColor(day.words.length)}
              ${dragState.wordId ? 'hover:bg-violet-50 dark:hover:bg-violet-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-750'}
            `}
          >
            {/* Day Number */}
            <div className={`
              text-sm font-bold mb-1
              ${day.isToday ? 'w-7 h-7 bg-violet-500 text-white rounded-full flex items-center justify-center' : ''}
              ${i % 7 === 0 && !day.isToday ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}
            `}>
              {day.dayOfMonth}
            </div>

            {/* Word Count Badge */}
            {day.words.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {day.words.length <= 3 ? (
                  day.words.map(word => (
                    <div
                      key={word.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation()
                        handleDragStart(e, word.id, day.dateStr)
                      }}
                      onDragEnd={handleDragEnd}
                      className={`
                        px-2 py-0.5 text-xs rounded-md cursor-move truncate max-w-full
                        ${word.state === 'mastered' 
                          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' 
                          : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        }
                        hover:shadow-md transition-shadow
                      `}
                    >
                      {word.word}
                    </div>
                  ))
                ) : (
                  <div className="px-2 py-1 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 rounded-lg text-sm font-medium">
                    📚 {day.words.length} từ
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Expanded Day Modal */}
      {expandedDay && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden animate-scale-in flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                  {new Date(expandedDay).toLocaleDateString('vi-VN', { 
                    weekday: 'long', 
                    day: 'numeric', 
                    month: 'long' 
                  })}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {expandedDayWords.length || 0} từ cần ôn
                </p>
              </div>
              <button 
                onClick={() => setExpandedDay(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              <div className="space-y-2">
                {expandedDayWords.map(word => (
                  <div 
                    key={word.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, word.id, expandedDay)}
                    onDragEnd={handleDragEnd}
                    className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl hover:shadow-md transition-all cursor-move group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 dark:text-white truncate">
                        {word.word}
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                        {word.meaning}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        ⏳ {formatDaysUntil(word.nextReviewDate)}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className={`
                        px-2 py-0.5 text-xs rounded-full
                        ${word.state === 'mastered' ? 'bg-green-100 text-green-700' : ''}
                        ${word.state === 'reviewing' ? 'bg-blue-100 text-blue-700' : ''}
                        ${word.state === 'learning' ? 'bg-amber-100 text-amber-700' : ''}
                      `}>
                        {word.state === 'mastered' ? 'Thuộc' : word.state === 'reviewing' ? 'Ôn' : 'Học'}
                      </span>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDelete({ wordId: word.id, word: word.word })
                        }}
                        className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 rounded-lg transition-colors"
                        title="Xóa khỏi lịch"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {onStartReview && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <div className="mb-3">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Học trước bao nhiêu từ của ngày này?
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, expandedDayWords.length)}
                    value={preLearnCount}
                    onChange={(e) => setPreLearnCount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    placeholder="Nhập số lượng từ"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Tối đa {expandedDayWords.length} từ trong ngày đã chọn.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const total = expandedDayWords.length
                    const parsed = Number(preLearnCount)
                    const safeLimit = Number.isFinite(parsed)
                      ? Math.max(1, Math.min(total, Math.floor(parsed)))
                      : total
                    onStartReview(expandedDay, safeLimit)
                    setExpandedDay(null)
                  }}
                  disabled={expandedDayWords.length === 0}
                  className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-xl hover:shadow-lg transition-all"
                >
                  Học trước từ ngày này
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-scale-in">
            <div className="text-center mb-4">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">
                Bỏ từ khỏi lịch ôn?
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Từ <strong>"{confirmDelete.word}"</strong> sẽ không còn xuất hiện trong lịch ôn tập (bạn vẫn giữ dữ liệu từ vựng).
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={() => handleDeleteWord(confirmDelete.wordId)}
                className="flex-1 py-2.5 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors"
              >
                Bỏ ôn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-900/40"></div>
            <span className="text-slate-600 dark:text-slate-400">1-2 từ</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-amber-100 dark:bg-amber-900/40"></div>
            <span className="text-slate-600 dark:text-slate-400">3-5 từ</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-orange-100 dark:bg-orange-900/40"></div>
            <span className="text-slate-600 dark:text-slate-400">6-10 từ</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/40"></div>
            <span className="text-slate-600 dark:text-slate-400">10+ từ</span>
          </div>
        </div>
      </div>
    </div>
  )
}
