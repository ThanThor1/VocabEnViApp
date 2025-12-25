import React, { useState } from "react";

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
            isSelected ? "bg-blue-100 border-l-2 border-blue-500" : "hover:bg-gray-100"
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
      <div className="border-b pb-2 mb-2 flex gap-1">
        <button
          className="px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition flex items-center gap-1"
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
          <div className="text-gray-500 p-2">No folders. Create one!</div>
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
          onDelete={() => {
            onDeleteNode(contextMenu.path, contextMenu.type);
            setContextMenu(null);
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
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  path: string;
  type: "folder" | "file";
  onDelete: () => void;
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
        className="fixed bg-white border rounded shadow-lg z-50 text-sm"
        style={{ top: `${y}px`, left: `${x}px` }}
      >
        <button
          className="block w-full text-left px-3 py-1.5 hover:bg-gray-100"
          onClick={() => {
            if (confirm(`Delete ${type} "${path.split("\\").pop()}"?`)) {
              onDelete();
            }
            onClose();
          }}
        >
          🗑 Delete
        </button>
      </div>
    </>
  );
}
