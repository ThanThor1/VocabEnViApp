import React, { useState, useEffect } from "react";
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'

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
  currentFolder,
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
  currentFolder?: string;
  onFolderChange?: (path: string) => void;
  onRequestContextMenu?: (opts: { x: number; y: number; item?: TreeNode | null; isEmpty?: boolean; destFolder?: string }) => void;
  selectedItems?: Set<string>;
  setSelectedItems?: (items: Set<string>) => void;
}) {
  const [history, setHistory] = useState<string[]>(() => [currentFolder || ""]); // "" = root
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

  // notify initial folder only if parent doesn't control folder state
  React.useEffect(() => {
    if (typeof currentFolder === 'undefined') {
      if (onFolderChange) onFolderChange(currentPath || "");
    }
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
    <ErrorBoundary>
      <div className="flex flex-col h-full">
      {/* Top Navigation Bar */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 flex items-center gap-2">
        <button
          className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center group"
          onClick={goBack}
          disabled={historyIndex === 0}
          title="Back"
        >
          <svg className="w-5 h-5 text-slate-600 dark:text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center group"
          onClick={goForward}
          disabled={historyIndex === history.length - 1}
          title="Forward"
        >
          <svg className="w-5 h-5 text-slate-600 dark:text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm px-2 flex-1 overflow-x-auto">
          {breadcrumbs.map((bc, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <svg className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              <button
                className="px-2 py-1 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/30 hover:text-violet-700 dark:hover:text-violet-300 text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap transition-colors"
                onClick={() => goToPath(bc.path)}
              >
                {bc.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Path indicator */}
        <div className="text-xs text-slate-400 dark:text-slate-500 max-w-xs truncate bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700" title={currentPath || "root"}>
          {currentPath || "root"}
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 flex gap-2">
        <button
          className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
          onClick={() => onCreateFolder(currentPath)}
          title="New Folder"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          New Folder
        </button>
        <button
          className="btn-success px-4 py-2 text-sm flex items-center gap-2"
          onClick={() => onCreateFile(currentPath)}
          title="New File"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          New File
        </button>
      </div>

      {/* Folder Contents */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 dark:bg-slate-900">
        {contents.length === 0 ? (
          <div
            className="text-center text-slate-400 dark:text-slate-500 py-16 animate-fade-in"
            onContextMenu={(e) => {
              e.preventDefault();
              if (onRequestContextMenu) onRequestContextMenu({ x: e.clientX, y: e.clientY, isEmpty: true, destFolder: currentPath });
            }}
          >
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <svg className="w-10 h-10 text-slate-400 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </div>
            <p className="text-sm font-medium">Empty folder</p>
            <p className="text-xs mt-1">Right-click to add items</p>
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
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
                className={`p-4 border-2 rounded-xl cursor-pointer transition-all group min-w-[180px] ${
                  selectedItems?.has(item.path)
                    ? "bg-violet-50 dark:bg-violet-900/30 border-violet-500 dark:border-violet-400 shadow-md"
                    : selectedFile === item.path
                    ? "bg-violet-50/50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-600"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-md"
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
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow ${
                    item.type === "folder" 
                      ? "bg-gradient-to-br from-amber-400 to-orange-500" 
                      : "bg-gradient-to-br from-violet-500 to-purple-600"
                  }`}>
                    {item.type === "folder" ? (
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors" title={item.name}>
                      {item.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate whitespace-nowrap">
                      {item.type === "folder" ? "Folder" : "CSV File"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </ErrorBoundary>
  );
}
