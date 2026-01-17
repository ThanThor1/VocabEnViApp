import React, { useMemo, useState } from "react";
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import ChooseFileModal from '../ChooseFileModal/ChooseFileModal'
import EditWordModal from '../EditWordModal/EditWordModal'
import {
  useReactTable,
  getCoreRowModel,
  ColumnDef,
  flexRender,
} from "@tanstack/react-table";

type VocabRow = {
  word: string;
  meaning: string;
  pronunciation: string;
  pos?: string;
  example?: string;
};

type VocabRowWithIndex = VocabRow & { __idx: number };

type Props = {
  rows: VocabRow[];
  onDelete: (rowIndex: number) => void;
  onEdit: (rowIndex: number, word: string, meaning: string, pronunciation: string, pos: string, example: string) => void;
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
            checked={!!selected[row.original.__idx]}
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
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2 items-center">
            <button
              className="px-3 py-1.5 text-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 rounded-lg transition-colors"
              onClick={() => setEditingRow({index: row.original.__idx, row: row.original})}
              type="button"
              title="Edit"
            >
              Edit
            </button>
            <button
              className="px-3 py-1.5 text-sm font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
              onClick={() => onDelete(row.original.__idx)}
              type="button"
            >
              Delete
            </button>
            <button
              onClick={() => onSpeak(row.original.word)}
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
    [selected, onDelete, onEdit, onSpeak]
  );

  // safe fallback in case HMR leaves `filteredRows` undefined for a moment
  const safeRows = typeof filteredRows !== 'undefined' ? filteredRows : (rowsWithIndex || [])

  const table = useReactTable({
    data: safeRows,
    columns: cols,
    getCoreRowModel: getCoreRowModel(),
  });

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
          example={editingRow.row.example || ''}
          pronunciation={editingRow.row.pronunciation}
          pos={(editingRow.row.pos || '')}
          onClose={() => setEditingRow(null)}
          onSave={(word, meaning, pronunciation, pos, example) => {
            onEdit(editingRow.index, word, meaning, pronunciation, pos, example);
            setEditingRow(null);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700 shadow-lg bg-white dark:bg-slate-900">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className="px-4 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
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

          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.getRowModel().rows.length === 0 ? (
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
              table.getRowModel().rows.map((row, idx) => (
                <tr 
                  key={row.id} 
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30'}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
    </ErrorBoundary>
  );
}
