import React, { useState } from "react";
import ConfirmModal from '../ConfirmModal/ConfirmModal'

type TreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: TreeNode[];
};

export default function FolderTree({
  tree,
  onSelectFile,
  onCreateFolder,
  onCreateFile,
  onDeleteNode,
  selectedFile,
  onRequestContextMenu,
}: {
  tree: TreeNode[];
  onSelectFile: (path: string) => void;
  onCreateFolder: () => void;
  onCreateFile: () => void;
  onDeleteNode: (path: string, type: "folder" | "file") => void;
  selectedFile: string | null;
  onRequestContextMenu?: (opts: { x: number; y: number; item?: TreeNode | null; isEmpty?: boolean; destFolder?: string }) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    type: "folder" | "file";
  } | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<{ path: string; type: "folder" | "file" } | null>(null)

  function toggleExpanded(path: string) {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function renderNode(node: TreeNode, level: number = 0): JSX.Element {
    const isFolder = node.type === "folder";
    const isExpanded = expanded[node.path];
    const hasChildren = isFolder && node.children && node.children.length > 0;
    const isSelected = selectedFile === node.path;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer user-select-none ${
            isSelected ? "bg-violet-100 dark:bg-violet-900/30 border-l-2 border-violet-500" : "hover:bg-slate-100 dark:hover:bg-slate-700"
          }`}
          style={{ paddingLeft: `${level * 20 + 8}px` }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onRequestContextMenu) {
              onRequestContextMenu({ x: e.clientX, y: e.clientY, item: node, isEmpty: false, destFolder: '' });
            } else {
              setContextMenu({ x: e.clientX, y: e.clientY, path: node.path, type: node.type });
            }
          }}
          onClick={() => {
            if (isFolder) {
              if (hasChildren) toggleExpanded(node.path);
            } else {
              onSelectFile(node.path);
            }
          }}
          onDoubleClick={() => {
            if (isFolder && hasChildren) toggleExpanded(node.path);
          }}
        >
          {isFolder && hasChildren && (
            <span
              className="w-4 text-center"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(node.path);
              }}
            >
              {isExpanded ? "▼" : "▶"}
            </span>
          )}
          {isFolder && !hasChildren && <span className="w-4"></span>}

          {isFolder ? (
            <span className="text-lg">📁</span>
          ) : (
            <span className="text-lg">📄</span>
          )}

          <span className="text-sm flex-1 truncate">{node.name}</span>
        </div>

        {isFolder && isExpanded && hasChildren && (
          <div>
            {node.children!.map((child) => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {confirmDelete && (
        <ConfirmModal
          title="Delete?"
          message={`Delete ${confirmDelete.type} "${confirmDelete.path.split("\\").pop()}"?`}
          confirmText="Delete"
          cancelText="Cancel"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            onDeleteNode(confirmDelete.path, confirmDelete.type)
            setConfirmDelete(null)
          }}
        />
      )}
      <div className="border-b pb-2 mb-2 flex gap-1">
        <button
          className="px-2 py-1 text-sm bg-violet-500 text-white rounded hover:bg-violet-600 transition flex items-center gap-1"
          onClick={onCreateFolder}
          title="New Folder"
        >
          + Folder
        </button>
        <button
          className="px-2 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition flex items-center gap-1"
          onClick={onCreateFile}
          title="New File"
        >
          + File
        </button>
      </div>

      <div className="space-y-0 text-sm overflow-y-auto h-[calc(100vh-250px)]">
        {tree.length === 0 ? (
          <div className="text-slate-500 dark:text-slate-400 p-2">No folders. Create one!</div>
        ) : (
          tree.map((node) => renderNode(node))
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          type={contextMenu.type}
          onRequestDelete={() => {
            setConfirmDelete({ path: contextMenu.path, type: contextMenu.type })
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

function ContextMenu({
  x,
  y,
  path,
  type,
  onRequestDelete,
  onClose,
}: {
  x: number;
  y: number;
  path: string;
  type: "folder" | "file";
  onRequestDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        className="fixed bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-lg z-50 text-sm"
        style={{ top: `${y}px`, left: `${x}px` }}
      >
        <button
          className="block w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 dark:text-slate-200"
          onClick={() => {
            onRequestDelete();
            onClose();
          }}
        >
          🗑 Delete
        </button>
      </div>
    </>
  );
}
