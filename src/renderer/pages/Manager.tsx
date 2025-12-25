import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import VocabTable from "../shared/VocabTable";
import ChooseFileModal from "../shared/ChooseFileModal";
import InputModal from "../shared/InputModal";
import FolderNavigator from "../shared/FolderNavigator";

declare const window: any;

type TreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: TreeNode[];
};

export default function Manager() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [showChoose, setShowChoose] = useState(false);

  const [word, setWord] = useState("");
  const [meaning, setMeaning] = useState("");

  const [currentFolder, setCurrentFolder] = useState<string>("");

  const [showInputModal, setShowInputModal] = useState(false);
  const [inputModalTitle, setInputModalTitle] = useState("");
  const [inputModalPlaceholder, setInputModalPlaceholder] = useState("");
  const [inputModalType, setInputModalType] = useState<"folder" | "file" | "rename" | null>(null);
  const [inputModalParent, setInputModalParent] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x?: number;
    y?: number;
    item?: TreeNode | null;
    isEmpty?: boolean;
    destFolder?: string;
  }>({ visible: false });

  const [clipboard, setClipboard] = useState<{
    action: "copy" | "cut";
    path: string;
    type: "file" | "folder";
  } | null>(null);

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const api = window.api as
    | undefined
    | {
        listTree: () => Promise<TreeNode[]>;
        readCsv: (filePath: string) => Promise<any[]>;
        deleteWord: (filePath: string, idx: number) => Promise<void>;
        addWord: (filePath: string, row: any) => Promise<void>;
        // parentRel can be '' for root
        createFolder: (parentRel: string, name: string) => Promise<boolean>;
        createFile: (parentRel: string, name: string) => Promise<boolean>;
        deleteFolder?: (path: string) => Promise<void>;
        deleteFile?: (path: string) => Promise<void>;
        copyPath?: (srcRel: string, dstRel: string) => Promise<void>;
        movePath?: (srcRel: string, dstRel: string) => Promise<void>;
        renamePath?: (relPath: string, newName: string) => Promise<void>;
      };

  async function loadTree() {
    const listTreeFn = api?.listTree;
    if (!listTreeFn) return;
    const t = await listTreeFn();
    setTree(t || []);
  }

  async function openFile(filePath: string) {
    const readCsv = api?.readCsv;
    if (!readCsv) return;
    setCurrentFile(filePath);
    const data = await readCsv(filePath);
    setRows(data || []);
  }

  function handleRowDelete(idx: number) {
    const deleteWord = api?.deleteWord;
    if (!deleteWord) return;
    if (!currentFile) return;
    deleteWord(currentFile, idx).then(() => openFile(currentFile));
  }

  function speak(text: string) {
    try {
      const ut = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(ut);
    } catch {
      // ignore
    }
  }

  async function lookupIPA(word: string) {
    if (!word) return "";
    try {
      const resp = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
      );
      if (!resp.ok) return "";
      const data = await resp.json();
      if (Array.isArray(data) && data[0]?.phonetics?.length > 0) {
        const ph = data[0].phonetics.find((p: any) => p.text?.includes("/"));
        if (ph?.text) return ph.text.replace(/\//g, "");
        return data[0].phonetics[0].text?.replace(/\//g, "") || "";
      }
      return "";
    } catch (err) {
      console.error("IPA lookup failed", err);
      return "";
    }
  }

  // parentRel is the folder path relative to data root where new item should be created
  async function createFolder(parentRel: string | null) {
    if (!api?.createFolder) return;
    setInputModalParent(parentRel ?? "");
    setInputModalTitle("Create Folder");
    setInputModalPlaceholder("e.g. Part1");
    setInputModalType("folder");
    setShowInputModal(true);
  }

  async function createFile(parentRel: string | null) {
    if (!api?.createFile) return;
    setInputModalParent(parentRel ?? "");
    setInputModalTitle("Create CSV File");
    setInputModalPlaceholder("e.g. part1.csv");
    setInputModalType("file");
    setShowInputModal(true);
  }

  async function handleInputModalConfirm(value: string) {
    try {
      if (inputModalType === "folder") {
        // create inside inputModalParent
        const createFolderFn = api?.createFolder;
        if (!createFolderFn) throw new Error("API unavailable");
        await createFolderFn(inputModalParent ?? "", value);
        await loadTree();
      } else if (inputModalType === "file") {
        const createFileFn = api?.createFile;
        if (!createFileFn) throw new Error("API unavailable");
        let name = value;
        if (!name.toLowerCase().endsWith(".csv")) name = `${name}.csv`;
        await createFileFn(inputModalParent ?? "", name);
        await loadTree();
      } else if (inputModalType === "rename") {
        const renameFn = api?.renamePath;
        if (!renameFn) throw new Error("API unavailable");
        // inputModalParent holds the rel path to rename
        await renameFn(inputModalParent ?? "", value);
        await loadTree();
      }
    } catch (err) {
      console.error("Error:", err);
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setShowInputModal(false);
    setInputModalType(null);
    setInputModalParent(null);
  }

  function handleFolderChange(path: string) {
    setCurrentFolder(path || "");
    // when changing folder, clear current file selection
    setCurrentFile(null);
  }

  function getFolderContents(tree: TreeNode[], path: string): TreeNode[] {
    if (!path) return tree;
    let current: any = { children: tree };
    const parts = path.split("/").filter(Boolean);
    for (const part of parts) {
      const found = (current.children || []).find((n: any) => n.name === part);
      if (!found) return [];
      current = found;
    }
    return current.children || [];
  }

  function FolderContentsView({
    tree,
    currentFolder,
    onOpenFile,
    onOpenFolder,
    onDeleteNode,
  }: {
    tree: TreeNode[];
    currentFolder: string;
    onOpenFile: (path: string) => void;
    onOpenFolder: (path: string) => void;
    onDeleteNode: (path: string, type: "folder" | "file") => void;
  }) {
    const contents = getFolderContents(tree, currentFolder);

    if (!contents || contents.length === 0) {
      return (
        <div
          className="p-6 text-center text-gray-500 h-full flex flex-col items-center justify-center"
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ visible: true, x: e.clientX, y: e.clientY, isEmpty: true, destFolder: currentFolder });
          }}
        >
          <div className="text-4xl mb-2">📁</div>
          <div>Folder trống</div>
        </div>
      );
    }

    return (
      <div
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
        onContextMenu={(e) => {
          // right-click on empty area within the grid
          const target = e.target as HTMLElement
          if (target && target.classList.contains('grid')) {
            e.preventDefault();
            setContextMenu({ visible: true, x: e.clientX, y: e.clientY, isEmpty: true, destFolder: currentFolder });
          }
        }}
      >
        {contents.map((item) => (
          <div
            key={item.path}
            className={`p-3 border rounded cursor-pointer transition flex items-center gap-3 ${
              selectedItems.has(item.path)
                ? "bg-blue-100 border-blue-500 border-2"
                : "hover:bg-gray-50 border-gray-200"
            }`}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                // Ctrl+click: toggle selection
                e.preventDefault();
                setSelectedItems((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.path)) {
                    next.delete(item.path);
                  } else {
                    next.add(item.path);
                  }
                  return next;
                });
              } else {
                // Normal click
                if (item.type === "file") onOpenFile(item.path);
              }
            }}
            onDoubleClick={() => {
              if (item.type === "folder") onOpenFolder(item.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // If right-click on non-selected item, select only it
              if (!selectedItems.has(item.path)) {
                setSelectedItems(new Set([item.path]));
              }
              setContextMenu({ visible: true, x: e.clientX, y: e.clientY, item, isEmpty: false, destFolder: currentFolder });
            }}
          >
            <div className="text-2xl">{item.type === "folder" ? "📁" : "📄"}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" title={item.name}>
                {item.name}
              </div>
              <div className="text-xs text-gray-500">{item.type === "folder" ? "Folder" : "CSV File"}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  async function handleDeleteNode(path: string, type: "folder" | "file") {
    try {
      if (type === "file") {
        const deleteFileFn = api?.deleteFile;
        if (!deleteFileFn) {
          alert('API unavailable');
          return;
        }
        await deleteFileFn(path);
        if (currentFile === path) setCurrentFile(null);
        await loadTree();
      } else {
        const deleteFolderFn = api?.deleteFolder;
        if (!deleteFolderFn) {
          alert('API unavailable');
          return;
        }
        await deleteFolderFn(path);
        // if currentFile was inside deleted folder, clear it
        if (currentFile && currentFile.startsWith(path)) setCurrentFile(null);
        await loadTree();
      }
    } catch (err) {
      console.error("Error deleting:", err);
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  useEffect(() => {
    loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helper actions for context menu
  function clearContext() {
    setContextMenu({ visible: false });
  }

  function doCopyItem(item: TreeNode) {
    setClipboard({ action: 'copy', path: item.path, type: item.type });
    clearContext();
  }

  function doCutItem(item: TreeNode) {
    setClipboard({ action: 'cut', path: item.path, type: item.type });
    clearContext();
  }

  function findItemInTree(nodes: TreeNode[], path: string): TreeNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = findItemInTree(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  async function doPasteTo(destFolder: string) {
    if (!clipboard) return;
    const copyPath = api?.copyPath;
    const movePath = api?.movePath;
    const name = clipboard.path.split('/').pop() || '';
    let dstRel = destFolder ? `${destFolder}/${name}` : name;
    
    // if src and dest are the same, or if item already exists, rename dest with (1), (2), etc.
    if (dstRel === clipboard.path || findItemInTree(tree, dstRel)) {
      let counter = 1;
      let nameWithoutExt = name;
      let ext = '';
      const lastDot = name.lastIndexOf('.');
      if (lastDot > 0) {
        nameWithoutExt = name.substring(0, lastDot);
        ext = name.substring(lastDot);
      }
      while (counter <= 100) {
        const newName = `${nameWithoutExt} (${counter})${ext}`;
        dstRel = destFolder ? `${destFolder}/${newName}` : newName;
        if (!findItemInTree(tree, dstRel)) {
          break;
        }
        counter++;
      }
    }
    
    try {
      if (clipboard.action === 'copy') {
        if (!copyPath) throw new Error('API copyPath not available');
        await copyPath(clipboard.path, dstRel);
      } else {
        if (!movePath) throw new Error('API movePath not available');
        await movePath(clipboard.path, dstRel);
        setClipboard(null);
      }
      await loadTree();
    } catch (err) {
      console.error('Paste error', err);
      alert(`Paste error: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearContext();
  }

  function doRename(item: TreeNode) {
    // use input modal for rename: inputModalParent holds rel path to rename
    setInputModalType('rename');
    setInputModalTitle('Rename');
    setInputModalPlaceholder(item.name);
    setInputModalParent(item.path);
    setShowInputModal(true);
    clearContext();
  }

  async function doBulkDelete() {
    if (selectedItems.size === 0) return;
    if (!confirm(`Delete ${selectedItems.size} selected items?`)) return;
    
    try {
      const deleteFileFn = api?.deleteFile;
      const deleteFolderFn = api?.deleteFolder;
      
      for (const path of Array.from(selectedItems)) {
        const item = findItemInTree(tree, path);
        if (!item) continue;
        
        if (item.type === 'file') {
          if (!deleteFileFn) throw new Error('API unavailable');
          await deleteFileFn(path);
        } else {
          if (!deleteFolderFn) throw new Error('API unavailable');
          await deleteFolderFn(path);
        }
      }
      
      setSelectedItems(new Set());
      await loadTree();
    } catch (err) {
      console.error('Bulk delete error', err);
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function doBulkCopy() {
    if (selectedItems.size === 0) return;
    // Store first selected item as clipboard (bulk copy uses clipboard)
    const first = Array.from(selectedItems)[0];
    const item = findItemInTree(tree, first);
    if (item) {
      setClipboard({ action: 'copy', path: item.path, type: item.type });
      setSelectedItems(new Set());
      clearContext();
    }
  }

  function doBulkCut() {
    if (selectedItems.size === 0) return;
    // Store first selected item as clipboard (bulk cut uses clipboard)
    const first = Array.from(selectedItems)[0];
    const item = findItemInTree(tree, first);
    if (item) {
      setClipboard({ action: 'cut', path: item.path, type: item.type });
      setSelectedItems(new Set());
      clearContext();
    }
  }

  function doStudySelected() {
    // Collect all selected files for study
    const filesToStudy = Array.from(selectedItems).filter((path) => {
      const item = findItemInTree(tree, path);
      return item?.type === 'file';
    });
    
    if (filesToStudy.length === 0) {
      alert('Please select at least one file to study');
      return;
    }

    setSelectedItems(new Set());
    clearContext();
    
    // Navigate to Study page with selected files
    navigate('/study', { state: { selectedFiles: filesToStudy } });
  }

  const hasApi = !!api?.listTree;

  if (!hasApi) {
    return (
      <div className="p-4">
        <div className="text-lg font-semibold">Electron API not available</div>
        <div className="text-sm text-gray-600 mt-1">
          Trang này cần chạy trong cửa sổ Electron (npm run dev), không phải mở
          bằng browser.
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full bg-gray-50"
      onContextMenu={(e) => {
        e.preventDefault();
        // show paste menu for current folder (root if empty)
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, isEmpty: true, destFolder: currentFolder });
      }}
      onClick={() => {
        // hide menu on click elsewhere
        if (contextMenu.visible) clearContext();
      }}
    >
      {/* Left: Folder Navigator */}
      <div className="w-full md:w-1/2 lg:w-2/5 border-r flex flex-col">
        <FolderNavigator
          tree={tree}
          onSelectFile={openFile}
          onCreateFolder={createFolder}
          onCreateFile={createFile}
          onDeleteNode={handleDeleteNode}
          selectedFile={currentFile}
          onFolderChange={handleFolderChange}
          onRequestContextMenu={(opts) => setContextMenu({ visible: true, x: opts.x, y: opts.y, item: opts.item || null, isEmpty: !!opts.isEmpty, destFolder: opts.destFolder })}
          selectedItems={selectedItems}
          setSelectedItems={setSelectedItems}
        />
      </div>

      {/* Right: Vocab Table */}
      <div className="flex-1 hidden md:flex flex-col">
        <div className="p-3 border-b bg-white">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              placeholder="word"
              className="border p-2 rounded text-sm flex-1 min-w-32"
              value={word}
              onChange={(e) => setWord(e.target.value)}
            />
            <input
              placeholder="meaning"
              className="border p-2 rounded text-sm flex-1 min-w-32"
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
            />
            <button
              className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-600 transition whitespace-nowrap"
              onClick={async () => {
                if (!word.trim() || !meaning.trim()) {
                  alert("Please enter word + meaning");
                  return;
                }

                // If a CSV file is already open, add directly to it
                if (currentFile) {
                  const addWord = api?.addWord;
                  if (!addWord) {
                    alert('API unavailable');
                    return;
                  }
                  try {
                    const ipa = await lookupIPA(word.trim());
                    await addWord(currentFile, {
                      word: word.trim(),
                      meaning: meaning.trim(),
                      pronunciation: ipa,
                    });
                    setWord("");
                    setMeaning("");
                    await loadTree();
                    await openFile(currentFile);
                  } catch (err) {
                    console.error('Add word error', err);
                    alert(`Error adding word: ${err instanceof Error ? err.message : String(err)}`);
                  }
                } else {
                  setShowChoose(true);
                }
              }}
              type="button"
            >
              + Add
            </button>
          </div>

          {currentFile ? (
            <div className="text-xs text-gray-500 truncate mt-2" title={currentFile}>
              📄 {currentFile.split(/[/\\\\]/).pop()}
            </div>
          ) : (
            <div className="text-xs text-gray-500 mt-2">Pick a CSV file to view/edit</div>
            )}
          </div>

        <div className="flex-1 overflow-y-auto p-3 bg-white">
          {currentFile ? (
            <VocabTable
              rows={rows}
              onDelete={handleRowDelete}
              onSpeak={speak}
              onRefresh={() => currentFile && openFile(currentFile)}
              currentFile={currentFile}
            />
          ) : (
            <FolderContentsView
              tree={tree}
              currentFolder={currentFolder}
              onOpenFile={openFile}
              onOpenFolder={(p:string)=> handleFolderChange(p)}
              onDeleteNode={handleDeleteNode}
            />
          )}
        </div>
      </div>

      {showChoose && (
        <ChooseFileModal
          tree={tree}
          onClose={() => setShowChoose(false)}
          onChoose={async (filePath: string) => {
            const addWord = api?.addWord;
            if (!addWord) return;
            const ipa = await lookupIPA(word.trim());
            await addWord(filePath, {
              word: word.trim(),
              meaning: meaning.trim(),
              pronunciation: ipa,
            });

            setShowChoose(false);
            setWord("");
            setMeaning("");

            await loadTree();
            if (filePath === currentFile) await openFile(filePath);
          }}
        />
      )}

      {showInputModal && (
        <InputModal
          title={inputModalTitle}
          placeholder={inputModalPlaceholder}
          onClose={() => {
            setShowInputModal(false);
            setInputModalType(null);
          }}
          onConfirm={handleInputModalConfirm}
        />
      )}

      {contextMenu.visible && (
        <div
          style={{ left: contextMenu.x || 0, top: contextMenu.y || 0 }}
          className="fixed z-50 bg-white border rounded shadow-md text-sm"
          onMouseLeave={() => clearContext()}
        >
          <div className="flex flex-col p-1">
            {selectedItems.size > 1 && (
              <>
                <button className="px-3 py-1 hover:bg-gray-100 text-left text-xs text-gray-500 font-bold">{selectedItems.size} items selected</button>
                <div className="border-t my-1"></div>
                <button className="px-3 py-1 hover:bg-gray-100 text-left" onClick={() => { doBulkDelete(); clearContext(); }}>Delete All</button>
                <button className="px-3 py-1 hover:bg-gray-100 text-left" onClick={() => { doBulkCopy(); }}>Copy All</button>
                <button className="px-3 py-1 hover:bg-gray-100 text-left" onClick={() => { doBulkCut(); }}>Cut All</button>
                <button className="px-3 py-1 hover:bg-gray-100 text-left text-blue-600 font-semibold" onClick={() => { doStudySelected(); }}>📚 Study</button>
                <div className="border-t my-1"></div>
                <button className="px-3 py-1 hover:bg-gray-100 text-left text-xs" onClick={() => { setSelectedItems(new Set()); clearContext(); }}>Clear Selection</button>
              </>
            )}

            {selectedItems.size <= 1 && !contextMenu.isEmpty && contextMenu.item && (
              <>
                <button className="px-3 py-1 hover:bg-gray-100 text-left" onClick={() => { handleDeleteNode(contextMenu.item!.path, contextMenu.item!.type); clearContext(); }}>Delete</button>
                <button className="px-3 py-1 hover:bg-gray-100 text-left" onClick={() => { doCopyItem(contextMenu.item!); }}>Copy</button>
                <button className="px-3 py-1 hover:bg-gray-100 text-left" onClick={() => { doCutItem(contextMenu.item!); }}>Cut</button>
                <button className="px-3 py-1 hover:bg-gray-100 text-left" onClick={() => { doRename(contextMenu.item!); }}>Rename</button>
              </>
            )}

            {contextMenu.isEmpty && (
              <>
                <div className="px-3 py-1 text-xs text-gray-500">Paste target: {contextMenu.destFolder || '<root>'}</div>
                <button className={`px-3 py-1 hover:bg-gray-100 text-left ${!clipboard ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (clipboard) doPasteTo(contextMenu.destFolder||''); }}>Paste</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
