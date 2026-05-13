import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { VocabularyStore, useVocabularyStore } from '../../store/VocabularyStore'
import type { VocabRecord } from '../../store/VocabularyStore'
import ConfirmModal from '../ConfirmModal/ConfirmModal'
import { preloadAudio, speakWord } from '../../utils/speech'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table'

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function formatDateKey(timestamp: number): string {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatDateLabel(timestamp: number): string {
  const now = new Date()
  const d = new Date(timestamp)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  
  const dayNames = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']
  const dayOfWeek = dayNames[d.getDay()]
  const dateStr = formatDate(timestamp)
  
  if (diff < 0) return `🔴 ${dateStr} (${dayOfWeek}) - Quá hạn ${Math.abs(diff)} ngày`
  if (diff === 0) return `🟡 ${dateStr} (${dayOfWeek}) - Hôm nay`
  if (diff === 1) return `🟢 ${dateStr} (${dayOfWeek}) - Ngày mai`
  return `📅 ${dateStr} (${dayOfWeek}) - Còn ${diff} ngày`
}

// Convert input date string to timestamp (start of day)
function parseInputDate(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

// Format timestamp to input date value (yyyy-mm-dd)
function formatInputDate(timestamp: number): string {
  const d = new Date(timestamp)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

type FillMode = 'missing' | 'all' | 'selected'
type FillKind = 'en' | 'vie'

export default function SRSManagerView() {
  useVocabularyStore() // Subscribe to store changes

  const [wordFilter, setWordFilter] = useState('')
  const [meaningFilter, setMeaningFilter] = useState('')
  const [posFilter, setPosFilter] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'nextReviewDate', desc: false }])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  
  // Modal states
  const [editingRecord, setEditingRecord] = useState<VocabRecord | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<VocabRecord | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  // Add form state
  const [addWord, setAddWord] = useState('')
  const [addMeaning, setAddMeaning] = useState('')
  const [addPronunciation, setAddPronunciation] = useState('')
  const [addPos, setAddPos] = useState('')
  const [addExample, setAddExample] = useState('')
  const [addError, setAddError] = useState('')
  const [fillMeaningNoteEnLoading, setFillMeaningNoteEnLoading] = useState(false)
  const [fillMeaningNoteEnMessage, setFillMeaningNoteEnMessage] = useState('')
  const [fillMeaningNoteEnProgress, setFillMeaningNoteEnProgress] = useState<{
    processed: number
    total: number
    filled: number
    missing: number
    skipped: number
  } | null>(null)
  const [fillMeaningNoteVieLoading, setFillMeaningNoteVieLoading] = useState(false)
  const [fillMeaningNoteVieMessage, setFillMeaningNoteVieMessage] = useState('')
  const [fillMeaningNoteVieProgress, setFillMeaningNoteVieProgress] = useState<{
    processed: number
    total: number
    filled: number
    missing: number
    skipped: number
  } | null>(null)
  const [fillScopeModal, setFillScopeModal] = useState<{ kind: FillKind } | null>(null)

  // Time adjustment state
  const [adjustReviewDatesModal, setAdjustReviewDatesModal] = useState<{ direction: 'add' | 'subtract' } | null>(null)
  const [adjustDays, setAdjustDays] = useState<number>(1)
  const [adjustMessage, setAdjustMessage] = useState('')

  // Edit form state (for SRS edit modal with date)
  const [editWord, setEditWord] = useState('')
  const [editMeaning, setEditMeaning] = useState('')
  const [editMeaningNoteVie, setEditMeaningNoteVie] = useState('')
  const [editPronunciation, setEditPronunciation] = useState('')
  const [editPos, setEditPos] = useState('')
  const [editExample, setEditExample] = useState('')
  const [editNextReviewDate, setEditNextReviewDate] = useState('')
  const [editError, setEditError] = useState('')

  // Memoize records - only re-compute when store version changes (actual mutations)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const records = useMemo(() => {
    // Defensive normalization: older/corrupted localStorage entries should never crash the UI.
    return VocabularyStore.getAll().filter(Boolean).map((r: any) => {
      const word = String(r?.word ?? '').trim()
      const meaning = String(r?.meaning ?? '').trim()
      const source = typeof r?.source === 'string' ? r.source : undefined
      const id = String(r?.id ?? `${source || ''}||${word}||${meaning}`)

      return {
        ...r,
        id,
        word,
        meaning,
        pronunciation: typeof r?.pronunciation === 'string' ? r.pronunciation : '',
        pos: typeof r?.pos === 'string' ? r.pos : '',
        example: typeof r?.example === 'string' ? r.example : '',
        meaningNoteEn: typeof r?.meaningNoteEn === 'string' ? r.meaningNoteEn : '',
        meaningNoteVie: typeof r?.meaningNoteVie === 'string' ? r.meaningNoteVie : (typeof r?.meaningNoteVi === 'string' ? r.meaningNoteVi : ''),
        source,
        state: (r?.state === 'new' || r?.state === 'learning' || r?.state === 'reviewing' || r?.state === 'mastered')
          ? r.state
          : 'new',
        nextReviewDate: Number.isFinite(Number(r?.nextReviewDate)) ? Number(r.nextReviewDate) : 0,
      } as VocabRecord
    })
  }, [VocabularyStore.version])

  // Columns stable - no dependencies that change frequently
  // Selection check uses ref to avoid re-creating columns on every selection change
  const columns = useMemo<ColumnDef<VocabRecord>[]>(() => [
    {
      id: 'select',
      header: ({ table }) => {
        // Use function to get current selection from ref
        const rows = table.getRowModel().rows
        const allSelected = rows.length > 0 && rows.every((rr) => selected.has(rr.original.id))
        const someSelected = rows.some((rr) => selected.has(rr.original.id))
        return (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected
            }}
            onChange={(e) => {
              const next = new Set(selected)
              if (e.target.checked) {
                for (const rr of rows) next.add(rr.original.id)
              } else {
                for (const rr of rows) next.delete(rr.original.id)
              }
              setSelected(next)
            }}
            className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
        )
      },
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selected.has(row.original.id)}
          onChange={(e) => {
            const next = new Set(selected)
            if (e.target.checked) {
              next.add(row.original.id)
            } else {
              next.delete(row.original.id)
            }
            setSelected(next)
          }}
          className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
        />
      ),
      size: 40,
    },
    {
      accessorKey: 'word',
      header: 'Từ',
      cell: ({ row }) => (
        <div className="font-semibold text-slate-900 dark:text-white">
          {row.original.word}
        </div>
      ),
    },
    {
      accessorKey: 'meaning',
      header: 'Nghĩa',
      cell: ({ row }) => (
        <div className="text-slate-700 dark:text-slate-300 max-w-[120px] truncate" title={row.original.meaning}>
          {row.original.meaning}
        </div>
      ),
      size: 120,
    },
    {
      accessorKey: 'meaningNoteEn',
      header: 'EN nghĩa',
      cell: ({ row }) => (
        <div className="text-slate-700 dark:text-slate-300 max-w-[180px] truncate" title={row.original.meaningNoteEn || ''}>
          {row.original.meaningNoteEn || '-'}
        </div>
      ),
      size: 180,
    },
    {
      accessorKey: 'meaningNoteVie',
      header: 'VIE nghĩa',
      cell: ({ row }) => (
        <div className="text-slate-700 dark:text-slate-300 max-w-[180px] truncate" title={String(row.original.meaningNoteVie || row.original.meaningNoteVi || '')}>
          {String(row.original.meaningNoteVie || row.original.meaningNoteVi || '') || '-'}
        </div>
      ),
      size: 180,
    },
    {
      accessorKey: 'pronunciation',
      header: 'IPA',
      cell: ({ row }) => (
        <div className="text-slate-500 dark:text-slate-400 font-mono text-sm">
          {row.original.pronunciation || '-'}
        </div>
      ),
    },
    {
      accessorKey: 'pos',
      header: 'POS',
      cell: ({ row }) => (
        <div className="text-slate-600 dark:text-slate-400">
          {row.original.pos || '-'}
        </div>
      ),
    },
    {
      accessorKey: 'example',
      header: 'Ví dụ',
      cell: ({ row }) => (
        <div className="text-slate-600 dark:text-slate-400 max-w-[100px] truncate text-sm" title={row.original.example || ''}>
          {row.original.example || '-'}
        </div>
      ),
      size: 100,
    },
    {
      accessorKey: 'nextReviewDate',
      header: () => (
        <div className="flex items-center gap-1">
          <span>Ngày ôn</span>
        </div>
      ),
      cell: ({ row }) => {
        const now = Date.now()
        const reviewDate = row.original.nextReviewDate
        const isOverdue = reviewDate < now
        const isToday = reviewDate > 0 && formatDate(reviewDate) === formatDate(now)
        return (
          <div className={`text-sm font-medium ${
            isOverdue ? 'text-red-600 dark:text-red-400' :
            isToday ? 'text-amber-600 dark:text-amber-400' :
            'text-slate-600 dark:text-slate-400'
          }`}>
            {reviewDate > 0 ? formatDate(reviewDate) : '-'}
            {isOverdue && <span className="ml-1 text-xs">(quá hạn)</span>}
            {isToday && !isOverdue && <span className="ml-1 text-xs">(hôm nay)</span>}
          </div>
        )
      },
      sortingFn: 'basic',
    },
    {
      accessorKey: 'state',
      header: 'Trạng thái',
      cell: ({ row }) => {
        // Status depends on review date
        const now = Date.now()
        const reviewDate = row.original.nextReviewDate
        const originalState = row.original.state
        
        // Calculate days until review
        const today = new Date(now)
        today.setHours(0, 0, 0, 0)
        const reviewDay = new Date(reviewDate)
        reviewDay.setHours(0, 0, 0, 0)
        const diffDays = Math.floor((reviewDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        
        let label: string
        let color: string
        
        if (!reviewDate || reviewDate === 0) {
          // No review date - show as new
          label = 'Mới'
          color = 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
        } else if (diffDays < 0) {
          // Overdue
          label = 'Quá hạn'
          color = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
        } else if (diffDays === 0) {
          // Due today
          label = 'Hôm nay'
          color = 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        } else if (diffDays <= 3) {
          // Due soon (within 3 days)
          label = 'Sắp ôn'
          color = 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
        } else if (originalState === 'mastered') {
          // Mastered and scheduled far ahead
          label = 'Thuộc'
          color = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
        } else {
          // Scheduled for future
          label = 'Đã lên lịch'
          color = 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
        }
        
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${color}`}>
            {label}
          </span>
        )
      },
      minSize: 90,
    },
    {
      id: 'actions',
      header: 'Thao tác',
      cell: ({ row }) => (
        <div className="flex gap-1 items-center">
          <button
            onClick={() => speakWord(row.original.word)}
            onMouseEnter={() => preloadAudio(row.original.word)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            title="Phát âm"
          >
            🔊
          </button>
          <button
            onClick={() => setEditingRecord(row.original)}
            className="px-2 py-1 text-sm font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 rounded-lg transition-colors"
          >
            Sửa
          </button>
          <button
            onClick={() => setDeleteConfirm(row.original)}
            className="px-2 py-1 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
          >
            Xóa
          </button>
        </div>
      ),
    },
  ], [selected]) // Re-create when selection changes for checkbox states

  const filteredRecords = useMemo(() => {
    const wf = wordFilter.trim().toLowerCase()
    const mf = meaningFilter.trim().toLowerCase()
    const pf = posFilter.trim().toLowerCase()
    if (!wf && !mf && !pf) return records
    return records.filter(r => {
      if (wf && !String(r.word || '').toLowerCase().includes(wf)) return false
      if (mf && !String(r.meaning || '').toLowerCase().includes(mf)) return false
      if (pf && String(r.pos || '').toLowerCase() !== pf.toLowerCase()) return false
      return true
    })
  }, [records, wordFilter, meaningFilter, posFilter])

  const table = useReactTable({
    data: filteredRecords,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const handleDelete = useCallback((record: VocabRecord) => {
    VocabularyStore.delete(record.id)
    setDeleteConfirm(null)
  }, [])

  const handleBulkDelete = useCallback(() => {
    for (const id of selected) {
      VocabularyStore.delete(id)
    }
    setSelected(new Set())
    setBulkDeleteConfirm(false)
  }, [selected])

  const handleDedupe = useCallback(() => {
    const all = VocabularyStore.getAll()
    const seen = new Map<string, string>() // word lowercase -> first id
    let removed = 0
    for (const r of all) {
      const key = r.word.trim().toLowerCase()
      if (!key) continue
      if (seen.has(key)) {
        VocabularyStore.delete(r.id)
        removed++
      } else {
        seen.set(key, r.id)
      }
    }
    setDedupeMessage(removed > 0 ? `Đã xóa ${removed} từ trùng lặp` : 'Không có từ trùng lặp')
    setTimeout(() => setDedupeMessage(''), 3000)
  }, [])

  const handleFillMeaningNoteEn = useCallback(async (mode: FillMode) => {
    const targets = VocabularyStore.getAll().filter((record) => {
      const hasWord = String(record.word || '').trim()
      if (!hasWord) return false
      if (mode === 'all') return true
      if (mode === 'selected') return selected.has(record.id)
      return !String(record.meaningNoteEn || '').trim()
    })
    if (targets.length === 0) {
      if (mode === 'all') {
        setFillMeaningNoteEnMessage('Không có từ nào để điền lại EN nghĩa')
      } else if (mode === 'selected') {
        setFillMeaningNoteEnMessage('Không có từ nào được chọn để điền EN nghĩa')
      } else {
        setFillMeaningNoteEnMessage('Không có từ nào đang trống EN nghĩa')
      }
      setTimeout(() => setFillMeaningNoteEnMessage(''), 3000)
      return
    }

    setFillMeaningNoteEnLoading(true)
    setFillMeaningNoteEnMessage(
      mode === 'all'
        ? `Đang điền lại EN nghĩa cho ${targets.length} từ...`
        : mode === 'selected'
          ? `Đang điền EN nghĩa cho ${targets.length} từ được chọn...`
          : `Đang điền EN nghĩa cho ${targets.length} từ...`
    )
    setFillMeaningNoteEnProgress({ processed: 0, total: targets.length, filled: 0, missing: 0, skipped: 0 })

    const queue = [...targets]
    let index = 0
    let processedCount = 0
    let filledCount = 0
    let missingDefinitionCount = 0
    let skippedCount = 0
    let lastProgressUpdateAt = 0

    const publishProgress = (force: boolean = false) => {
      const now = Date.now()
      if (!force && now - lastProgressUpdateAt < 250) return
      lastProgressUpdateAt = now

      const progress = {
        processed: processedCount,
        total: targets.length,
        filled: filledCount,
        missing: missingDefinitionCount,
        skipped: skippedCount,
      }
      const percent = Math.min(100, Math.round((progress.processed / Math.max(1, progress.total)) * 100))
      setFillMeaningNoteEnProgress(progress)
      setFillMeaningNoteEnMessage(
        `Đang điền EN nghĩa: ${progress.processed}/${progress.total} (${percent}%) | điền ${progress.filled} | thiếu định nghĩa ${progress.missing}`
      )
    }

    const workers = Array.from({ length: 3 }, async () => {
      while (index < queue.length) {
        const currentIndex = index
        index += 1
        const record = queue[currentIndex]
        if (!record) continue
        const word = String(record.word || '').trim()

        try {
          const definition = await window.api.fetchEnglishMeaning(word)
          if (!definition) {
            missingDefinitionCount += 1
            console.log('[FillMeaningNoteEn] missing', {
              word,
              id: record.id,
              reason: 'empty-definition'
            })
            continue
          }
          if (mode === 'missing' && String(VocabularyStore.get(record.id)?.meaningNoteEn || '').trim()) {
            skippedCount += 1
            console.log('[FillMeaningNoteEn] skipped', {
              word,
              id: record.id,
              reason: 'already-has-meaningNoteEn'
            })
            continue
          }

          VocabularyStore.update(record.id, { meaningNoteEn: definition })
          filledCount += 1
          console.log('[FillMeaningNoteEn] filled', {
            word,
            id: record.id,
            definition
          })
        } catch (err) {
          missingDefinitionCount += 1
          console.error('[FillMeaningNoteEn] error', {
            word,
            id: record.id,
            error: err instanceof Error ? err.message : String(err)
          })
        } finally {
          processedCount += 1
          publishProgress()
        }
      }
    })

    try {
      await Promise.all(workers)
      console.log('[FillMeaningNoteEn] done', {
        mode,
        total: targets.length,
        filled: filledCount,
        missing: missingDefinitionCount,
        skipped: skippedCount
      })
      publishProgress(true)
      if (filledCount === 0) {
        if (mode === 'all') {
          setFillMeaningNoteEnMessage('Không điền lại được EN nghĩa cho từ nào')
        } else if (mode === 'selected') {
          setFillMeaningNoteEnMessage('Không điền được EN nghĩa cho từ nào trong danh sách đã chọn')
        } else {
          setFillMeaningNoteEnMessage('Không điền được EN nghĩa cho từ nào')
        }
      } else if (missingDefinitionCount > 0 || skippedCount > 0) {
        setFillMeaningNoteEnMessage(
          `${mode === 'all' ? 'Đã điền lại' : 'Đã điền'} ${filledCount}/${targets.length} từ; ${missingDefinitionCount} từ không có định nghĩa${skippedCount > 0 ? `, ${skippedCount} từ đã có sẵn` : ''}`
        )
      } else {
        if (mode === 'all') {
          setFillMeaningNoteEnMessage(`Đã điền lại EN nghĩa cho ${filledCount} từ`)
        } else if (mode === 'selected') {
          setFillMeaningNoteEnMessage(`Đã điền EN nghĩa cho ${filledCount} từ được chọn`)
        } else {
          setFillMeaningNoteEnMessage(`Đã điền EN nghĩa cho ${filledCount} từ`)
        }
      }
    } catch {
      setFillMeaningNoteEnMessage('Có lỗi khi điền EN nghĩa')
    } finally {
      setFillMeaningNoteEnLoading(false)
      setTimeout(() => {
        setFillMeaningNoteEnMessage('')
        setFillMeaningNoteEnProgress(null)
      }, 5000)
    }
  }, [selected])

  const handleFillMeaningNoteVie = useCallback(async (mode: FillMode) => {
    const targets = VocabularyStore.getAll().filter((record) => {
      const hasWord = String(record.word || '').trim()
      const hasEn = String(record.meaningNoteEn || '').trim()
      if (!hasWord || !hasEn) return false
      if (mode === 'all') return true
      if (mode === 'selected') return selected.has(record.id)
      return !String(record.meaningNoteVie || record.meaningNoteVi || '').trim()
    })
    if (targets.length === 0) {
      if (mode === 'all') {
        setFillMeaningNoteVieMessage('Không có từ nào có EN nghĩa để dịch lại VIE nghĩa')
      } else if (mode === 'selected') {
        setFillMeaningNoteVieMessage('Không có từ nào được chọn có EN nghĩa để dịch VIE nghĩa')
      } else {
        setFillMeaningNoteVieMessage('Không có từ nào vừa trống VIE nghĩa vừa có EN nghĩa sẵn')
      }
      setTimeout(() => setFillMeaningNoteVieMessage(''), 3000)
      return
    }

    setFillMeaningNoteVieLoading(true)
    setFillMeaningNoteVieMessage(
      mode === 'all'
        ? `Đang dịch lại VIE nghĩa cho ${targets.length} từ...`
        : mode === 'selected'
          ? `Đang dịch VIE nghĩa cho ${targets.length} từ được chọn...`
          : `Đang dịch VIE nghĩa cho ${targets.length} từ...`
    )
    setFillMeaningNoteVieProgress({ processed: 0, total: targets.length, filled: 0, missing: 0, skipped: 0 })

    const queue = [...targets]
    let index = 0
    let processedCount = 0
    let filledCount = 0
    let missingEnCount = 0
    let skippedCount = 0
    let lastProgressUpdateAt = 0

    const publishProgress = (force: boolean = false) => {
      const now = Date.now()
      if (!force && now - lastProgressUpdateAt < 250) return
      lastProgressUpdateAt = now

      const progress = {
        processed: processedCount,
        total: targets.length,
        filled: filledCount,
        missing: missingEnCount,
        skipped: skippedCount,
      }
      const percent = Math.min(100, Math.round((progress.processed / Math.max(1, progress.total)) * 100))
      setFillMeaningNoteVieProgress(progress)
      setFillMeaningNoteVieMessage(
        `Đang dịch VIE nghĩa: ${progress.processed}/${progress.total} (${percent}%) | điền ${progress.filled} | thiếu EN nghĩa ${progress.missing}`
      )
    }

    const workers = Array.from({ length: 3 }, async () => {
      while (index < queue.length) {
        const currentIndex = index
        index += 1
        const record = queue[currentIndex]
        if (!record) continue

        try {
          const current = VocabularyStore.get(record.id)
          if (mode === 'missing' && String(current?.meaningNoteVie || current?.meaningNoteVi || '').trim()) {
            skippedCount += 1
            continue
          }

          const meaningNoteEn = String(current?.meaningNoteEn || '').trim()
          if (!meaningNoteEn) {
            missingEnCount += 1
            continue
          }

          const translated = await window.api.translateMeaningNoteVie({
            word: String(current?.word || '').trim(),
            englishMeaning: meaningNoteEn,
          })

          const meaningNoteVie = String(translated || '').trim()

          if (!meaningNoteVie) {
            missingEnCount += 1
            continue
          }

          VocabularyStore.update(record.id, {
            meaningNoteVie,
            meaningNoteVi: meaningNoteVie,
            meaningNoteEn,
          })
          filledCount += 1
        } catch {
          missingEnCount += 1
        } finally {
          processedCount += 1
          publishProgress()
        }
      }
    })

    try {
      await Promise.all(workers)
      publishProgress(true)
      if (filledCount === 0) {
        if (mode === 'all') {
          setFillMeaningNoteVieMessage('Không dịch lại được VIE nghĩa cho từ nào')
        } else if (mode === 'selected') {
          setFillMeaningNoteVieMessage('Không dịch được VIE nghĩa cho từ nào trong danh sách đã chọn')
        } else {
          setFillMeaningNoteVieMessage('Không dịch được VIE nghĩa cho từ nào')
        }
      } else if (missingEnCount > 0 || skippedCount > 0) {
        setFillMeaningNoteVieMessage(
          `${mode === 'all' ? 'Đã dịch lại' : 'Đã dịch'} ${filledCount}/${targets.length} từ; ${missingEnCount} từ chưa có EN nghĩa${skippedCount > 0 ? `, ${skippedCount} từ đã có sẵn` : ''}`
        )
      } else {
        if (mode === 'all') {
          setFillMeaningNoteVieMessage(`Đã dịch lại VIE nghĩa cho ${filledCount} từ`)
        } else if (mode === 'selected') {
          setFillMeaningNoteVieMessage(`Đã dịch VIE nghĩa cho ${filledCount} từ được chọn`)
        } else {
          setFillMeaningNoteVieMessage(`Đã dịch VIE nghĩa cho ${filledCount} từ`)
        }
      }
    } catch {
      setFillMeaningNoteVieMessage('Có lỗi khi dịch VIE nghĩa')
    } finally {
      setFillMeaningNoteVieLoading(false)
      setTimeout(() => {
        setFillMeaningNoteVieMessage('')
        setFillMeaningNoteVieProgress(null)
      }, 5000)
    }
  }, [selected])

  const handleAdjustReviewDates = useCallback(
    (mode: 'all' | 'selected', direction: 'add' | 'subtract', days: number) => {
      if (days <= 0) {
        setAdjustMessage('Số ngày phải lớn hơn 0')
        setTimeout(() => setAdjustMessage(''), 3000)
        return
      }

      const targets = VocabularyStore.getAll().filter((record) => {
        if (mode === 'all') return true
        if (mode === 'selected') return selected.has(record.id)
        return false
      })

      if (targets.length === 0) {
        if (mode === 'selected') {
          setAdjustMessage('Không có từ nào được chọn')
        } else {
          setAdjustMessage('Không có từ nào để điều chỉnh')
        }
        setTimeout(() => setAdjustMessage(''), 3000)
        return
      }

      // Calculate days in milliseconds
      const daysMs = days * 24 * 60 * 60 * 1000
      let updatedCount = 0

      for (const record of targets) {
        const currentNextReviewDate = record.nextReviewDate || Date.now()
        const newNextReviewDate =
          direction === 'add' ? currentNextReviewDate + daysMs : currentNextReviewDate - daysMs
        VocabularyStore.update(record.id, { nextReviewDate: Math.max(0, newNextReviewDate) })
        updatedCount++
      }

      const action = direction === 'add' ? 'tăng' : 'giảm'
      const scope = mode === 'all' ? `tất cả ${updatedCount} từ` : `${updatedCount} từ được chọn`
      setAdjustMessage(`Đã ${action} hạn ${days} ngày cho ${scope}`)
      setTimeout(() => setAdjustMessage(''), 4000)
      setAdjustReviewDatesModal(null)
    },
    [selected]
  )

  const [dedupeMessage, setDedupeMessage] = useState('')

  // Sync editing record with edit form state
  useEffect(() => {
    if (editingRecord) {
      setEditWord(editingRecord.word)
      setEditMeaning(editingRecord.meaning)
      setEditMeaningNoteVie(String(editingRecord.meaningNoteVie || editingRecord.meaningNoteVi || ''))
      setEditPronunciation(editingRecord.pronunciation || '')
      setEditPos(editingRecord.pos || '')
      setEditExample(editingRecord.example || '')
      setEditNextReviewDate(editingRecord.nextReviewDate ? formatInputDate(editingRecord.nextReviewDate) : formatInputDate(Date.now()))
      setEditError('')
    }
  }, [editingRecord])

  const handleEditSave = useCallback(() => {
    if (!editingRecord) return
    if (!editWord.trim()) {
      setEditError('Từ không được để trống')
      return
    }
    if (!editMeaning.trim()) {
      setEditError('Nghĩa không được để trống')
      return
    }

    const newNextReviewDate = editNextReviewDate ? parseInputDate(editNextReviewDate) : Date.now()
    
    // Delete old record and create new one with updated data
    // IMPORTANT: Preserve SRS state and progress!
    VocabularyStore.delete(editingRecord.id)
    VocabularyStore.upsert({
      word: editWord.trim(),
      meaning: editMeaning.trim(),
      meaningNoteVie: editMeaningNoteVie.trim(),
      meaningNoteVi: editMeaningNoteVie.trim(),
      pronunciation: editPronunciation.trim(),
      pos: editPos.trim(),
      example: editExample.trim(),
      source: editingRecord.source,
      nextReviewDate: newNextReviewDate,
      // Preserve SRS progress - change 'new' to 'learning' if scheduling a date
      state: editingRecord.state === 'new' ? 'learning' : editingRecord.state,
      interval: editingRecord.interval,
      easeFactor: editingRecord.easeFactor,
      repetitions: editingRecord.repetitions,
      timesReviewed: editingRecord.timesReviewed,
      timesCorrect: editingRecord.timesCorrect,
      streak: editingRecord.streak,
      lastReviewDate: editingRecord.lastReviewDate,
      wrongInCurrentRound: editingRecord.wrongInCurrentRound,
      needsNextRound: editingRecord.needsNextRound,
      createdAt: editingRecord.createdAt,
    })
    setEditingRecord(null)
  }, [editingRecord, editWord, editMeaning, editMeaningNoteVie, editPronunciation, editPos, editExample, editNextReviewDate])

  const handleAdd = useCallback(() => {
    if (!addWord.trim()) {
      setAddError('Từ không được để trống')
      return
    }
    if (!addMeaning.trim()) {
      setAddError('Nghĩa không được để trống')
      return
    }
    VocabularyStore.upsert({
      word: addWord.trim(),
      meaning: addMeaning.trim(),
      pronunciation: addPronunciation.trim(),
      pos: addPos.trim(),
      example: addExample.trim(),
      source: 'manual',
    })
    // Reset form
    setAddWord('')
    setAddMeaning('')
    setAddPronunciation('')
    setAddPos('')
    setAddExample('')
    setAddError('')
    setAddModalOpen(false)
  }, [addWord, addMeaning, addPronunciation, addPos, addExample])

  const stats = useMemo(() => {
    const now = Date.now()
    let total = 0, due = 0, mastered = 0
    for (const r of records) {
      total++
      if (r.nextReviewDate <= now) due++
      if (r.state === 'mastered') mastered++
    }
    return { total, due, mastered }
  }, [records])

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <div className="flex-shrink-0 p-6 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Quản lý Smart Review</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Quản lý các từ trong hệ thống ôn tập</p>
            </div>
          </div>

          <button
            onClick={() => setAddModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Thêm từ
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="p-3 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-xl border border-violet-200 dark:border-violet-800">
            <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">{stats.total}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">Tổng số từ</div>
          </div>
          <div className="p-3 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 rounded-xl border border-red-200 dark:border-red-800">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.due}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">Cần ôn</div>
          </div>
          <div className="p-3 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-800">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.mastered}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">Đã thuộc</div>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[140px] relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Tìm từ tiếng Anh..."
              value={wordFilter}
              onChange={(e) => setWordFilter(e.target.value)}
              className="input-field w-full pl-9"
            />
          </div>
          <div className="flex-1 min-w-[140px] relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Tìm nghĩa tiếng Việt..."
              value={meaningFilter}
              onChange={(e) => setMeaningFilter(e.target.value)}
              className="input-field w-full pl-9"
            />
          </div>
          <div className="w-40">
            <select
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value)}
              className="input-field w-full"
            >
              <option value="">Tất cả POS</option>
              <option value="Noun">Noun</option>
              <option value="Verb">Verb</option>
              <option value="Adjective">Adjective</option>
              <option value="Adverb">Adverb</option>
              <option value="Pronoun">Pronoun</option>
              <option value="Preposition">Preposition</option>
              <option value="Conjunction">Conjunction</option>
              <option value="Determiner">Determiner</option>
              <option value="Interjection">Interjection</option>
              <option value="Phrase">Phrase</option>
              <option value="Other">Other</option>
            </select>
          </div>
          {(wordFilter || meaningFilter || posFilter) && (
            <button
              onClick={() => { setWordFilter(''); setMeaningFilter(''); setPosFilter(''); }}
              className="btn-secondary px-3 py-2 text-sm"
            >
              Xóa bộ lọc
            </button>
          )}
          <button
            onClick={handleDedupe}
            className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5"
            title="Xóa từ trùng lặp dựa trên từ tiếng Anh"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Xóa trùng lặp
          </button>
          <button
            onClick={() => setFillScopeModal({ kind: 'en' })}
            disabled={fillMeaningNoteEnLoading}
            className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5"
            title="Điền EN nghĩa"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {fillMeaningNoteEnLoading ? 'Đang điền...' : 'Điền EN nghĩa'}
          </button>
          <button
            onClick={() => setFillScopeModal({ kind: 'vie' })}
            disabled={fillMeaningNoteVieLoading}
            className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5"
            title="Điền VIE nghĩa"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            {fillMeaningNoteVieLoading ? 'Đang dịch...' : 'Điền VIE nghĩa'}
          </button>
          <button
            onClick={() => setAdjustReviewDatesModal({ direction: 'add' })}
            className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5"
            title="Tăng hạn ôn"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tăng hạn
          </button>
          <button
            onClick={() => setAdjustReviewDatesModal({ direction: 'subtract' })}
            className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5"
            title="Giảm hạn ôn"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
            Giảm hạn
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="btn-secondary text-rose-600 border-rose-300 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-700 dark:hover:bg-rose-900/30 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Xóa {selected.size} từ
            </button>
          )}
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {table.getRowModel().rows.length} từ
          </div>
          {dedupeMessage && (
            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400 animate-fade-in">
              {dedupeMessage}
            </div>
          )}
          {fillMeaningNoteEnMessage && (
            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400 animate-fade-in">
              {fillMeaningNoteEnMessage}
            </div>
          )}
          {fillMeaningNoteEnLoading && fillMeaningNoteEnProgress && (
            <div className="min-w-[240px] max-w-[360px] w-full">
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.round((fillMeaningNoteEnProgress.processed / Math.max(1, fillMeaningNoteEnProgress.total)) * 100))}%` }}
                />
              </div>
            </div>
          )}
          {fillMeaningNoteVieMessage && (
            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400 animate-fade-in">
              {fillMeaningNoteVieMessage}
            </div>
          )}
          {fillMeaningNoteVieLoading && fillMeaningNoteVieProgress && (
            <div className="min-w-[240px] max-w-[360px] w-full">
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.round((fillMeaningNoteVieProgress.processed / Math.max(1, fillMeaningNoteVieProgress.total)) * 100))}%` }}
                />
              </div>
            </div>
          )}
          {adjustMessage && (
            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400 animate-fade-in">
              {adjustMessage}
            </div>
          )}
        </div>
      </div>

      {fillScopeModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {fillScopeModal.kind === 'en' ? 'Điền EN nghĩa' : 'Điền VIE nghĩa'}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Chọn phạm vi áp dụng
              </p>
            </div>
            <div className="p-5 space-y-3">
              <button
                type="button"
                className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => {
                  if (fillScopeModal.kind === 'en') {
                    handleFillMeaningNoteEn('all')
                  } else {
                    handleFillMeaningNoteVie('all')
                  }
                  setFillScopeModal(null)
                }}
              >
                Điền lại hết
              </button>
              <button
                type="button"
                className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => {
                  if (fillScopeModal.kind === 'en') {
                    handleFillMeaningNoteEn('missing')
                  } else {
                    handleFillMeaningNoteVie('missing')
                  }
                  setFillScopeModal(null)
                }}
              >
                Điền các từ còn thiếu
              </button>
              <button
                type="button"
                className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => {
                  if (fillScopeModal.kind === 'en') {
                    handleFillMeaningNoteEn('selected')
                  } else {
                    handleFillMeaningNoteVie('selected')
                  }
                  setFillScopeModal(null)
                }}
              >
                Điền các từ được chọn ({selected.size})
              </button>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                type="button"
                onClick={() => setFillScopeModal(null)}
                className="btn-secondary"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustReviewDatesModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {adjustReviewDatesModal.direction === 'add' ? 'Tăng hạn ôn' : 'Giảm hạn ôn'}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {adjustReviewDatesModal.direction === 'add' ? 'Dịch ngày ôn tiếp theo ra phía trước' : 'Dịch ngày ôn tiếp theo ra phía sau'}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Số ngày ({adjustReviewDatesModal.direction === 'add' ? 'tăng' : 'giảm'})
                </label>
                <input
                  type="number"
                  min="1"
                  value={adjustDays}
                  onChange={(e) => setAdjustDays(Math.max(1, Number(e.target.value) || 1))}
                  className="input-field w-full"
                  placeholder="Nhập số ngày..."
                  autoFocus
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {adjustReviewDatesModal.direction === 'add' ? '(Hạn sẽ được dịch ra sau ' : '(Hạn sẽ được dịch ra trước '}
                  {adjustDays} ngày)
                </p>
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => {
                    handleAdjustReviewDates('all', adjustReviewDatesModal.direction, adjustDays)
                  }}
                >
                  <div className="font-medium text-slate-900 dark:text-white">Tất cả từ</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Áp dụng cho tất cả {VocabularyStore.getAll().length} từ</div>
                </button>
                <button
                  type="button"
                  className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => {
                    handleAdjustReviewDates('selected', adjustReviewDatesModal.direction, adjustDays)
                  }}
                  disabled={selected.size === 0}
                >
                  <div className={`font-medium ${selected.size === 0 ? 'text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                    Từ được chọn
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Áp dụng cho {selected.size} từ được chọn</div>
                </button>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                type="button"
                onClick={() => setAdjustReviewDatesModal(null)}
                className="btn-secondary"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && <span>↑</span>}
                        {header.column.getIsSorted() === 'desc' && <span>↓</span>}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center">
                    <div className="text-slate-400 dark:text-slate-500">
                      <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                      <p className="font-medium">Chưa có từ nào</p>
                      <p className="text-sm mt-1">Thêm từ mới hoặc học qua Custom Study</p>
                    </div>
                  </td>
                </tr>
              ) : (
                (() => {
                  const rows = table.getRowModel().rows
                  const isSortedByDateAsc = sorting.length === 1 && sorting[0].id === 'nextReviewDate' && !sorting[0].desc
                  let lastDateKey: string | null = null
                  const elements: React.ReactNode[] = []
                  
                  for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]
                    const reviewDate = row.original.nextReviewDate || 0
                    
                    // Insert date separator if sorted by date ascending
                    if (isSortedByDateAsc && reviewDate > 0) {
                      const dateKey = formatDateKey(reviewDate)
                      if (dateKey !== lastDateKey) {
                        elements.push(
                          <tr key={`separator-${dateKey}`} className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20">
                            <td colSpan={columns.length} className="px-4 py-2">
                              <div className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
                                {formatDateLabel(reviewDate)}
                              </div>
                            </td>
                          </tr>
                        )
                        lastDateKey = dateKey
                      }
                    }
                    
                    elements.push(
                      <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    )
                  }
                  
                  return elements
                })()
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal with Date Field */}
      {editingRecord && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-2xl">
            <div className="modal-header bg-gradient-to-r from-indigo-500 to-purple-600">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-white">Sửa từ</h2>
                </div>
                <button onClick={() => setEditingRecord(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="modal-body space-y-4">
              {editError && (
                <div className="alert-error">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span>{editError}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Từ *</label>
                <input
                  type="text"
                  value={editWord}
                  onChange={(e) => { setEditError(''); setEditWord(e.target.value) }}
                  className="input-field w-full"
                  placeholder="Nhập từ tiếng Anh..."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Nghĩa *</label>
                <textarea
                  value={editMeaning}
                  onChange={(e) => { setEditError(''); setEditMeaning(e.target.value) }}
                  className="input-field w-full resize-none"
                  rows={2}
                  placeholder="Nhập nghĩa tiếng Việt..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">EN nghĩa</label>
                <textarea
                  value={editingRecord.meaningNoteEn || ''}
                  readOnly
                  className="input-field w-full resize-none opacity-80"
                  rows={2}
                  placeholder="Tự động điền bằng nút phía trên"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">VIE nghĩa</label>
                <textarea
                  value={editMeaningNoteVie}
                  onChange={(e) => setEditMeaningNoteVie(e.target.value)}
                  className="input-field w-full resize-none"
                  rows={2}
                  placeholder="Nghĩa tiếng Việt dịch từ EN nghĩa"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Phát âm (IPA)</label>
                  <input
                    type="text"
                    value={editPronunciation}
                    onChange={(e) => setEditPronunciation(e.target.value)}
                    className="input-field w-full font-mono"
                    placeholder="/ˈeksəmpəl/"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Loại từ (POS)</label>
                  <input
                    type="text"
                    value={editPos}
                    onChange={(e) => setEditPos(e.target.value)}
                    className="input-field w-full"
                    placeholder="noun, verb, adj..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Ví dụ</label>
                <textarea
                  value={editExample}
                  onChange={(e) => setEditExample(e.target.value)}
                  className="input-field w-full resize-none"
                  rows={2}
                  placeholder="Nhập câu ví dụ..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Ngày ôn tiếp theo</label>
                <input
                  type="date"
                  value={editNextReviewDate}
                  onChange={(e) => setEditNextReviewDate(e.target.value)}
                  className="input-field w-full"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Thay đổi ngày ôn sẽ reset tiến độ học của từ này
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setEditingRecord(null)} className="btn-secondary">Hủy</button>
              <button onClick={handleEditSave} className="btn-primary">Lưu thay đổi</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <ConfirmModal
          title="Xóa từ"
          message={`Bạn có chắc muốn xóa từ "${deleteConfirm.word}" khỏi Smart Review?`}
          confirmText="Xóa"
          cancelText="Hủy"
          onConfirm={() => handleDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {/* Bulk Delete Confirm */}
      {bulkDeleteConfirm && (
        <ConfirmModal
          title="Xóa nhiều từ"
          message={`Bạn có chắc muốn xóa ${selected.size} từ đã chọn khỏi Smart Review?`}
          confirmText="Xóa tất cả"
          cancelText="Hủy"
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteConfirm(false)}
        />
      )}

      {/* Add Word Modal */}
      {addModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-2xl">
            <div className="modal-header bg-gradient-to-r from-emerald-500 to-teal-600">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-white">Thêm từ mới</h2>
                </div>
                <button onClick={() => setAddModalOpen(false)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="modal-body space-y-4">
              {addError && (
                <div className="alert-error">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span>{addError}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Từ *</label>
                <input
                  type="text"
                  value={addWord}
                  onChange={(e) => { setAddError(''); setAddWord(e.target.value) }}
                  className="input-field w-full"
                  placeholder="Nhập từ tiếng Anh..."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Nghĩa *</label>
                <textarea
                  value={addMeaning}
                  onChange={(e) => { setAddError(''); setAddMeaning(e.target.value) }}
                  className="input-field w-full resize-none"
                  rows={2}
                  placeholder="Nhập nghĩa tiếng Việt..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Phát âm (IPA)</label>
                  <input
                    type="text"
                    value={addPronunciation}
                    onChange={(e) => setAddPronunciation(e.target.value)}
                    className="input-field w-full font-mono"
                    placeholder="/ˈeksəmpəl/"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Loại từ (POS)</label>
                  <input
                    type="text"
                    value={addPos}
                    onChange={(e) => setAddPos(e.target.value)}
                    className="input-field w-full"
                    placeholder="noun, verb, adj..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Ví dụ</label>
                <textarea
                  value={addExample}
                  onChange={(e) => setAddExample(e.target.value)}
                  className="input-field w-full resize-none"
                  rows={2}
                  placeholder="Nhập câu ví dụ..."
                />
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setAddModalOpen(false)} className="btn-secondary">Hủy</button>
              <button onClick={handleAdd} className="btn-primary">Thêm từ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
