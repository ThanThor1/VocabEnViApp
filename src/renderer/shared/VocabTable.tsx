import React, { useMemo, useState } from "react";
import ErrorBoundary from './ErrorBoundary'
import ChooseFileModal from "./ChooseFileModal";
import EditWordModal from "./EditWordModal";
import {
  useReactTable,
  getCoreRowModel,
  ColumnDef,
  flexRender,
} from "@tanstack/react-table";

declare const window: any;

type VocabRow = {
  word: string;
  meaning: string;
  pronunciation: string;
  pos?: string;
};

type VocabRowWithIndex = VocabRow & { __idx: number };

type Props = {
  rows: VocabRow[];
  onDelete: (rowIndex: number) => void;
  onEdit: (rowIndex: number, word: string, meaning: string, pronunciation: string, pos: string) => void;
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
          <div className="flex gap-2">
            <button
              className="text-blue-600 hover:text-blue-800 font-semibold"
              onClick={() => setEditingRow({index: row.original.__idx, row: row.original})}
              type="button"
              title="Edit"
            >
              Edit
            </button>
            <button
              className="text-red-600 hover:text-red-800"
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
      <div>
      <div className="mb-3 flex gap-2 items-center">
        <input
          className="border p-2 rounded text-sm flex-1"
          placeholder="Search word..."
          value={wordFilter}
          onChange={(e)=>setWordFilter(e.target.value)}
        />
        <input
          className="border p-2 rounded text-sm flex-1"
          placeholder="Search meaning..."
          value={meaningFilter}
          onChange={(e)=>setMeaningFilter(e.target.value)}
        />
        <button className="px-3 py-1 bg-gray-200 rounded" onClick={() => { setWordFilter(''); setMeaningFilter('') }}>Clear</button>
      </div>
      {errorMessage && (
        <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      <div className="mb-2 flex gap-2">
        <button
          className="px-2 py-1 bg-gray-200"
          onClick={() => moveOrCopy("move")}
          type="button"
        >
          Move selected
        </button>
        <button
          className="px-2 py-1 bg-gray-200"
          onClick={() => moveOrCopy("copy")}
          type="button"
        >
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
          pronunciation={editingRow.row.pronunciation}
          pos={(editingRow.row.pos || '')}
          onClose={() => setEditingRow(null)}
          onSave={(word, meaning, pronunciation, pos) => {
            onEdit(editingRow.index, word, meaning, pronunciation, pos);
            setEditingRow(null);
          }}
        />
      )}

      <table className="w-full border">
        <thead className="bg-gray-50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => (
                <th key={header.id} className="p-2 text-left">
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

        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="p-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </ErrorBoundary>
  );
}
