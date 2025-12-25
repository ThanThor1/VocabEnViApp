import React, { useState, useEffect } from "react";

type TreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: TreeNode[];
};

export default function FolderNavigator({
  tree,
  onSelectFile,
  onCreateFolder,
  onCreateFile,
  onDeleteNode,
  selectedFile,
  onFolderChange,
  onRequestContextMenu,
  selectedItems,
  setSelectedItems,
}: {
  tree: TreeNode[];
  onSelectFile: (path: string) => void;
  onCreateFolder: (parentRel: string | null) => void;
  onCreateFile: (parentRel: string | null) => void;
  onDeleteNode: (path: string, type: "folder" | "file") => void;
  selectedFile: string | null;
  onFolderChange?: (path: string) => void;
  onRequestContextMenu?: (opts: { x: number; y: number; item?: TreeNode | null; isEmpty?: boolean; destFolder?: string }) => void;
  selectedItems?: Set<string>;
  setSelectedItems?: (items: Set<string>) => void;
}) {
  const [history, setHistory] = useState<string[]>([""]); // "" = root
  const [historyIndex, setHistoryIndex] = useState(0);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false);

  const currentPath = history[historyIndex] || "";

  // Find current folder contents
  function getFolderContents(path: string): TreeNode[] {
    if (!path || path === "") return tree;

    let current: any = { children: tree };
    const parts = path.split("/").filter(Boolean);

    for (const part of parts) {
      const found = (current.children || []).find((n: any) => n.name === part);
      if (!found) return [];
      current = found;
    }

    return current.children || [];
  }

  const contents = getFolderContents(currentPath);

  function navigateToFolder(folderPath: string) {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(folderPath);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    if (onFolderChange) onFolderChange(folderPath || "");
  }

  function goBack() {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const newPath = history[newIndex] || '';
      if (onFolderChange) onFolderChange(newPath);
    }
  }

  function goForward() {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const newPath = history[newIndex] || '';
      if (onFolderChange) onFolderChange(newPath);
    }
  }

  function goToPath(path: string) {
    const newHistory = history.slice(0, historyIndex + 1);
    if (path !== currentPath) {
      newHistory.push(path);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      if (onFolderChange) onFolderChange(path || "");
    }
  }

  // notify initial folder
  React.useEffect(() => {
    if (onFolderChange) onFolderChange(currentPath || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDoubleClickFolder(path: string) {
    navigateToFolder(path);
  }

  function getBreadcrumbs() {
    const parts = currentPath.split("/").filter(Boolean);
    const breadcrumbs = [{ name: "Data", path: "" }];

    let accumulated = "";
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      breadcrumbs.push({ name: part, path: accumulated });
    }

    return breadcrumbs;
  }

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="flex flex-col h-full">
      {/* Top Navigation Bar */}
      <div className="border-b bg-white p-3 flex items-center gap-2">
        <button
          className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={goBack}
          disabled={historyIndex === 0}
          title="Back"
        >
          ⬅️
        </button>
        <button
          className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={goForward}
          disabled={historyIndex === history.length - 1}
          title="Forward"
        >
          ➡️
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm px-2 flex-1 overflow-x-auto">
          {breadcrumbs.map((bc, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-gray-400">\</span>}
              <button
                className="px-1 py-0.5 rounded hover:bg-blue-100 text-blue-600 whitespace-nowrap"
                onClick={() => goToPath(bc.path)}
              >
                {bc.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Path Bar */}
        <div className="text-xs text-gray-500 max-w-xs truncate" title={currentPath || "root"}>
          {currentPath || "root"}
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b bg-gray-50 p-2 flex gap-2">
        <button
          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition flex items-center gap-1"
          onClick={() => onCreateFolder(currentPath)}
          title="New Folder"
        >
          📁 New Folder
        </button>
        <button
          className="px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition flex items-center gap-1"
          onClick={() => onCreateFile(currentPath)}
          title="New File"
        >
          📄 New File
        </button>
      </div>

      {/* Folder Contents */}
      <div className="flex-1 overflow-y-auto p-3 bg-white">
        {contents.length === 0 ? (
          <div
            className="text-center text-gray-500 py-8"
            onContextMenu={(e) => {
              e.preventDefault();
              if (onRequestContextMenu) onRequestContextMenu({ x: e.clientX, y: e.clientY, isEmpty: true, destFolder: currentPath });
            }}
          >
            <div className="text-4xl mb-2">📁</div>
            <p>Folder trống</p>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
            onMouseDown={(e) => {
              if (selectedItems && (e.ctrlKey || e.metaKey || e.shiftKey)) {
                setDragStart({ x: e.clientX, y: e.clientY });
                setDragSelecting(true);
              }
            }}
            onMouseMove={(e) => {
              // drag-to-select logic would go here (advanced feature)
            }}
            onMouseUp={() => {
              setDragStart(null);
              setDragSelecting(false);
            }}
          >
            {contents.map((item) => (
              <div
                key={item.path}
                className={`p-3 border rounded cursor-pointer transition flex items-center gap-2 ${
                  selectedItems?.has(item.path)
                    ? "bg-blue-100 border-blue-500 border-2"
                    : "hover:bg-gray-50 border-gray-200"
                }`}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: toggle selection
                    e.preventDefault();
                    if (setSelectedItems) {
                      const next = new Set<string>(selectedItems || new Set());
                      if (next.has(item.path)) {
                        next.delete(item.path);
                      } else {
                        next.add(item.path);
                      }
                      setSelectedItems(next);
                    }
                  } else {
                    // Normal click
                    if (item.type === "file") onSelectFile(item.path);
                  }
                }}
                onDoubleClick={() => {
                  if (item.type === "folder") handleDoubleClickFolder(item.path);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // If right-click on non-selected item, select only it
                  if (selectedItems && !selectedItems.has(item.path) && setSelectedItems) {
                    setSelectedItems(new Set([item.path]));
                  }
                  if (onRequestContextMenu) {
                    onRequestContextMenu({ x: e.clientX, y: e.clientY, item, isEmpty: false, destFolder: currentPath });
                  }
                }}
              >
                <span className="text-2xl">
                  {item.type === "folder" ? "📁" : "📄"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" title={item.name}>
                    {item.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {item.type === "folder" ? "Folder" : "CSV File"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
