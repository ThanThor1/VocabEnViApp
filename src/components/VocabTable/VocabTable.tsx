import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import ChooseFileModal from '../ChooseFileModal/ChooseFileModal'
import EditWordModal from '../EditWordModal/EditWordModal'
import { preloadAudio } from '../../utils/speech'
import {
  useReactTable,
  getCoreRowModel,
  ColumnDef,
  flexRender,
} from "@tanstack/react-table";

type VocabRow = {
  word: string;
  meaning: string;
  meaningEn?: string;
  meaningVi?: string;
  pronunciation: string;
  pos?: string;
  example?: string;
};

type VocabRowWithIndex = VocabRow & { __idx: number };

type Props = {
  rows: VocabRow[];
  onDelete: (rowIndex: number) => Promise<void>;
  onEdit: (rowIndex: number, word: string, meaning: string, meaningEn: string, meaningVi: string, pronunciation: string, pos: string, example: string) => void;
  onSpeak: (word: string) => void;
  onRefresh: () => void;
  currentFile: string;
  // External state control for persistence
  selected: Record<number, boolean>;
  setSelected: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  wordFilter: string;
  setWordFilter: React.Dispatch<React.SetStateAction<string>>;
  meaningFilter: string;
  setMeaningFilter: React.Dispatch<React.SetStateAction<string>>;
};

const tableScrollByFile = new Map<string, number>()

export default function VocabTable({
  rows,
  onDelete,
  onEdit,
  onSpeak,
  onRefresh,
  currentFile,
  selected,
  setSelected,
  wordFilter,
  setWordFilter,
  meaningFilter,
  setMeaningFilter,
}: Props) {
  const [showChooser, setShowChooser] = useState(false);
  const [chooserTree, setChooserTree] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [editingRow, setEditingRow] = useState<{index: number, row: VocabRow} | null>(null)

  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  const ROW_HEIGHT = 44
  const OVERSCAN = 10
  const scrollKey = currentFile || '__no_file__'
  const bodyScrollRef = useRef<HTMLDivElement | null>(null)
  const rafScrollRef = useRef<number | null>(null)
  const lastScrollTopRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const rememberScrollPosition = () => {
    const el = bodyScrollRef.current
    const nextTop = el?.scrollTop || 0
    lastScrollTopRef.current = nextTop
    tableScrollByFile.set(scrollKey, nextTop)
  }

  // Keep the original index to avoid mismatches when filtering
  const rowsWithIndex = useMemo<VocabRowWithIndex[]>(
    () => rows.map((r, idx) => ({ ...r, __idx: idx })),
    [rows]
  )

  const filteredRows = useMemo(() => {
    if (!rowsWithIndex || rowsWithIndex.length === 0) return []
    const wf = (wordFilter || '').trim().toLowerCase()
    const mf = (meaningFilter || '').trim().toLowerCase()
    return rowsWithIndex.filter(r => {
      const w = (r.word || '').toString().toLowerCase()
      const m = (r.meaning || '').toString().toLowerCase()
      if (wf && !w.includes(wf)) return false
      if (mf && !m.includes(mf)) return false
      return true
    })
  }, [rowsWithIndex, wordFilter, meaningFilter])

  const cols = useMemo<ColumnDef<VocabRowWithIndex>[]>(
    () => [
      {
        id: "index",
        header: "#",
        cell: ({ row }) => (
          <span className="font-medium text-slate-500 dark:text-slate-400">{row.original.__idx + 1}</span>
        ),
        size: 50,
      },
      {
        id: "select",
        header: "Select",
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={!!selectedRef.current[row.original.__idx]}
            onChange={(e) => {
              const checked = e.target.checked;
              setSelected((prev) => ({ ...prev, [row.original.__idx]: checked }));
            }}
          />
        ),
      },
      { accessorKey: "word", header: "Word" },
      { accessorKey: "meaning", header: "Meaning" },
      { accessorKey: "pronunciation", header: "IPA" },
      { accessorKey: "pos", header: "POS" },
      { accessorKey: "example", header: "Example" },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2 items-center">
            <button
              className="px-3 py-1.5 text-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 rounded-lg transition-colors"
              onClick={() => {
                rememberScrollPosition()
                setEditingRow({index: row.original.__idx, row: row.original})
              }}
              type="button"
              title="Edit"
            >
              Edit
            </button>
            <button
              className="px-3 py-1.5 text-sm font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
              onClick={async () => {
                rememberScrollPosition()
                await onDelete(row.original.__idx)
              }}
              type="button"
            >
              Delete
            </button>
            <button
              onClick={() => onSpeak(row.original.word)}
              onMouseEnter={() => preloadAudio(row.original.word)}
              onFocus={() => preloadAudio(row.original.word)}
              type="button"
              aria-label="Speak"
              title="Speak"
              className="w-8 h-8 flex items-center justify-center text-lg hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              🔊
            </button>
          </div>
        ),
      },
    ],
    [onDelete, onSpeak, setSelected]
  );

  // safe fallback in case HMR leaves `filteredRows` undefined for a moment
  const safeRows = typeof filteredRows !== 'undefined' ? filteredRows : (rowsWithIndex || [])

  const table = useReactTable({
    data: safeRows,
    columns: cols,
    getCoreRowModel: getCoreRowModel(),
  });

  const allTableRows = table.getRowModel().rows
  const shouldVirtualize = allTableRows.length > 200

  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return
    const measure = () => {
      try {
        setViewportHeight(el.clientHeight || 0)
      } catch {}
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [])

  const onBodyScroll = () => {
    const el = bodyScrollRef.current
    if (!el) return
    let nextTop = el.scrollTop || 0
    const maxScrollableTop = Math.max(0, el.scrollHeight - el.clientHeight)
    if (nextTop > maxScrollableTop) {
      nextTop = maxScrollableTop
      el.scrollTop = maxScrollableTop
    }
    lastScrollTopRef.current = nextTop
    tableScrollByFile.set(scrollKey, nextTop)
    if (!shouldVirtualize) return
    if (rafScrollRef.current != null) cancelAnimationFrame(rafScrollRef.current)
    rafScrollRef.current = requestAnimationFrame(() => {
      try {
        setScrollTop(el.scrollTop || 0)
      } catch {}
    })
  }

  useEffect(() => {
    return () => {
      if (rafScrollRef.current != null) {
        try {
          cancelAnimationFrame(rafScrollRef.current)
        } catch {}
        rafScrollRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    lastScrollTopRef.current = tableScrollByFile.get(scrollKey) || 0
  }, [scrollKey])

  useLayoutEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return
    const rememberedTop = tableScrollByFile.get(scrollKey) || 0
    if (rememberedTop > 0 && el.scrollTop !== rememberedTop) {
      el.scrollTop = rememberedTop
    }
  }, [scrollKey])

  // Restore scroll position after rows data changes (edit/delete/refresh)
  useLayoutEffect(() => {
    const el = bodyScrollRef.current
    const rememberedTop = tableScrollByFile.get(scrollKey) || lastScrollTopRef.current || 0
    if (el && rememberedTop > 0) {
      el.scrollTop = rememberedTop
    }
  }, [rows, scrollKey])

  const virtual = useMemo(() => {
    const total = allTableRows.length
    if (!shouldVirtualize || total === 0) {
      return {
        start: 0,
        end: total,
        topPad: 0,
        bottomPad: 0,
        slice: allTableRows,
      }
    }
    const vh = Math.max(0, viewportHeight || 0)
    const visibleCount = Math.max(1, Math.ceil(vh / ROW_HEIGHT))
    const rawStart = Math.floor((scrollTop || 0) / ROW_HEIGHT)
    const maxStart = Math.max(0, total - (visibleCount + OVERSCAN * 2))
    const start = Math.min(Math.max(0, rawStart - OVERSCAN), maxStart)
    const end = Math.min(total, start + visibleCount + OVERSCAN * 2)
    const topPad = start * ROW_HEIGHT
    const bottomPad = (total - end) * ROW_HEIGHT
    return {
      start,
      end,
      topPad,
      bottomPad,
      slice: allTableRows.slice(start, end),
    }
  }, [allTableRows, shouldVirtualize, viewportHeight, scrollTop])

  async function moveOrCopy(kind: "move" | "copy") {
    const indices = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));

    if (indices.length === 0) {
      setErrorMessage('Select rows')
      setTimeout(() => setErrorMessage(''), 3000)
      return;
    }

    setChooserTree(await window.api.listTree());
    setShowChooser(true);
    const doAction = async (filePath: string) => {
      if (kind === "move") {
        await window.api.moveWords(currentFile, filePath, indices);
      } else {
        await window.api.copyWords(currentFile, filePath, indices);
      }
      setSelected({});
      setShowChooser(false);
      onRefresh();
    };
    // store callback on window for modal to call (simple bridge)
    (window as any)._vocab_move_copy_cb = doAction;
  }

  async function deleteSelected() {
    const indices = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));

    if (indices.length === 0) {
      setErrorMessage('Select rows')
      setTimeout(() => setErrorMessage(''), 3000)
      return;
    }

    // Delete from highest index first to avoid index shift
    indices.sort((a, b) => b - a);
    for (const idx of indices) {
      await onDelete(idx)
    }
    setSelected({});
    setErrorMessage(`Đã xóa ${indices.length} từ`);
    setTimeout(() => setErrorMessage(''), 3000);
    onRefresh();
  }

  async function dedupeCurrentFile() {
    try {
      const fn = window.api && (window.api as any).dedupeWords
      if (typeof fn !== 'function') {
        setErrorMessage('API unavailable')
        setTimeout(() => setErrorMessage(''), 3000)
        return
      }
      const out = await fn(currentFile)
      const removed = Number(out && out.removed ? out.removed : 0)
      setErrorMessage(removed > 0 ? `Đã xóa ${removed} từ trùng lặp` : 'Không có từ trùng lặp')
      setTimeout(() => setErrorMessage(''), 3000)
      onRefresh()
      // If selection contains indices, it may no longer match after dedupe.
      setSelected({})
    } catch (e: any) {
      setErrorMessage(e?.message ? String(e.message) : 'Dedupe failed')
      setTimeout(() => setErrorMessage(''), 3500)
    }
  }

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        {/* Search filters - Enhanced */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <input
              className="input-field pl-11 !py-2.5"
              placeholder="Search word..."
              value={wordFilter}
              onChange={(e)=>setWordFilter(e.target.value)}
            />
          </div>
          <div className="flex-1 relative">
            <input
              className="input-field pl-11 !py-2.5"
              placeholder="Search meaning..."
              value={meaningFilter}
              onChange={(e)=>setMeaningFilter(e.target.value)}
            />
          </div>
          <button 
            className="btn-secondary !px-6 whitespace-nowrap" 
            onClick={() => { setWordFilter(''); setMeaningFilter('') }}
          >
            Clear
          </button>
        </div>

        {errorMessage && (
          <div className="alert alert-error animate-slide-down">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {errorMessage}
          </div>
        )}

        {/* Action buttons - Enhanced */}
        <div className="flex gap-3 flex-wrap">
          <button
            className="btn-secondary flex items-center gap-2"
            onClick={() => moveOrCopy("move")}
            type="button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            Move selected
          </button>
          <button
            className="btn-secondary flex items-center gap-2"
            onClick={() => moveOrCopy("copy")}
            type="button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy selected
          </button>

          <button
            className="btn-secondary flex items-center gap-2"
            onClick={deleteSelected}
            type="button"
            title="Xóa những từ được chọn"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete selected
          </button>

          <button
            className="btn-secondary flex items-center gap-2"
            onClick={dedupeCurrentFile}
            type="button"
            title="Xóa các từ bị trùng theo cột Word"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M8 7h8M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
            </svg>
            Xóa trùng lặp
          </button>
        </div>

      {showChooser && (
        <ChooseFileModal
          tree={chooserTree}
          onClose={() => setShowChooser(false)}
          onChoose={(p:string)=>{
            const cb = (window as any)._vocab_move_copy_cb;
            if (cb) cb(p);
            (window as any)._vocab_move_copy_cb = undefined;
          }}
        />
      )}

      {editingRow && (
        <EditWordModal
          word={editingRow.row.word}
          meaning={editingRow.row.meaning}
          meaningEn={editingRow.row.meaningEn || ''}
          meaningVi={editingRow.row.meaningVi || ''}
          example={editingRow.row.example || ''}
          pronunciation={editingRow.row.pronunciation}
          pos={(editingRow.row.pos || '')}
          onClose={() => setEditingRow(null)}
          onSave={(word, meaning, meaningEn, meaningVi, pronunciation, pos, example) => {
            rememberScrollPosition();
            onEdit(editingRow.index, word, meaning, meaningEn, meaningVi, pronunciation, pos, example);
            setEditingRow(null);
          }}
        />
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 shadow-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id} className="px-4 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-800/50">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
          </table>
        </div>
        <div
          ref={bodyScrollRef}
          onScroll={onBodyScroll}
          className="overflow-x-auto overflow-y-auto max-h-[21rem]"
        >
          <table className="w-full">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {allTableRows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
                    <svg className="w-16 h-16 text-slate-300 dark:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>
                      <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">No words found</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Try adjusting your filters or add some words</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {shouldVirtualize && virtual.topPad > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={cols.length} style={{ height: virtual.topPad, padding: 0 }} />
                  </tr>
                ) : null}

                {virtual.slice.map((row, idx) => (
                <tr 
                  key={row.id} 
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${((idx + virtual.start) % 2) === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30'}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                ))}

                {shouldVirtualize && virtual.bottomPad > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={cols.length} style={{ height: virtual.bottomPad, padding: 0 }} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
      </div>
    </ErrorBoundary>
  );
}
