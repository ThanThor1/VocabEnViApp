import React, { useMemo, useState } from "react";
import ChooseFileModal from "./ChooseFileModal";
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
};

type Props = {
  rows: VocabRow[];
  onDelete: (rowIndex: number) => void;
  onSpeak: (word: string) => void;
  onRefresh: () => void;
  currentFile: string;
};

export default function VocabTable({
  rows,
  onDelete,
  onSpeak,
  onRefresh,
  currentFile,
}: Props) {
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [showChooser, setShowChooser] = useState(false);
  const [chooserTree, setChooserTree] = useState<any[]>([]);

  const cols = useMemo<ColumnDef<VocabRow>[]>(
    () => [
      {
        id: "select",
        header: "Select",
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={!!selected[row.index]}
            onChange={(e) => {
              const checked = e.target.checked;
              setSelected((prev) => ({ ...prev, [row.index]: checked }));
            }}
          />
        ),
      },
      { accessorKey: "word", header: "Word" },
      { accessorKey: "meaning", header: "Meaning" },
      { accessorKey: "pronunciation", header: "IPA" },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <button
              className="text-red-600"
              onClick={() => onDelete(row.index)}
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
    [selected, onDelete, onSpeak]
  );

  const table = useReactTable({
    data: rows || [],
    columns: cols,
    getCoreRowModel: getCoreRowModel(),
  });

  async function moveOrCopy(kind: "move" | "copy") {
    const indices = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));

    if (indices.length === 0) {
      alert("Select rows");
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
    <div>
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
  );
}
