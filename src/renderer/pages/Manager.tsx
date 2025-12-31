import React, { useEffect, useRef, useState } from "react";
import ErrorBoundary from "../shared/ErrorBoundary";
import { useNavigate, useLocation } from "react-router-dom";
import VocabTable from "../shared/VocabTable";
import ChooseFileModal from "../shared/ChooseFileModal";
import InputModal from "../shared/InputModal";
import FolderNavigator from "../shared/FolderNavigator";
import { usePersistedState } from "../shared/usePersistedState";
import { POS_OPTIONS } from "../shared/posOptions";

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
  
  // Persisted state - main file/folder context
  const [currentFile, setCurrentFile] = usePersistedState<string | null>('manager_currentFile', null);
  const [currentFolder, setCurrentFolder] = usePersistedState<string>('manager_currentFolder', "");
  
  // Persisted state - VocabTable filters and selections
  const [wordFilter, setWordFilter] = usePersistedState<string>('manager_wordFilter', '');
  const [meaningFilter, setMeaningFilter] = usePersistedState<string>('manager_meaningFilter', '');
  const [vocabSelected, setVocabSelected] = usePersistedState<Record<number, boolean>>('manager_vocabSelected', {});
  
  // Persisted state - folder selection
  const [selectedItems, setSelectedItems] = usePersistedState<Set<string>>('manager_selectedItems', new Set(), {
    serialize: (set) => JSON.stringify(Array.from(set)),
    deserialize: (str) => new Set(JSON.parse(str))
  });
  
  // Non-persisted state
  const [rows, setRows] = useState<any[]>([]);
  const [showChoose, setShowChoose] = useState(false);
  const [showPdfChooser, setShowPdfChooser] = useState(false);
  const [pdfList, setPdfList] = useState<any[]>([]);
  const [word, setWord] = useState("");
  const [meaning, setMeaning] = useState("");
  const [pos, setPos] = useState("");

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

  const [errorMessage, setErrorMessage] = useState<string>('');

  const api = window.api as
    | undefined
    | {
        listTree: () => Promise<TreeNode[]>;
        readCsv: (filePath: string) => Promise<any[]>;
        deleteWord: (filePath: string, idx: number) => Promise<void>;
        editWord: (filePath: string, idx: number, data: {word: string, meaning: string, pronunciation: string, pos?: string}) => Promise<void>;
        addWord: (filePath: string, row: any) => Promise<void>;
        // parentRel can be '' for root
        createFolder: (parentRel: string, name: string) => Promise<boolean>;
        createFile: (parentRel: string, name: string) => Promise<boolean>;
        deleteFolder?: (path: string) => Promise<void>;
        deleteFile?: (path: string) => Promise<void>;
        copyPath?: (srcRel: string, dstRel: string) => Promise<void>;
        movePath?: (srcRel: string, dstRel: string) => Promise<void>;
        renamePath?: (relPath: string, newName: string) => Promise<void>;
        pdfDelete?: (pdfId: string) => Promise<void>;
        pdfTrash?: (pdfId: string) => Promise<void>;
        pdfRestore?: (pdfId: string) => Promise<void>;
      };

  async function loadTree() {
    const listTreeFn = api?.listTree;
    if (!listTreeFn) return;
    const t = await listTreeFn();
    setTree(t || []);
  }

  // If navigated here with a selected file (e.g. from PDF panel), open it
  const location = useLocation();
  useEffect(() => {
    const sel: any = (location && (location as any).state) || null;
    if (sel && sel.selectFile) {
      openFile(sel.selectFile).catch((e) => console.error(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleRowEdit(idx: number, word: string, meaning: string, pronunciation: string, pos: string) {
    if (!api?.editWord || !currentFile) return;
    try {
      await api.editWord(currentFile, idx, { word, meaning, pronunciation: ensureIpaSlashes(pronunciation), pos });
      await openFile(currentFile);
    } catch (err) {
      console.error('Edit failed', err);
      setErrorMessage(`Edit failed: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrorMessage(''), 5000);
    }
  }

  function speak(text: string) {
    try {
      const ut = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(ut);
    } catch {
      // ignore
    }
  }

  const ensureIpaSlashes = (val: string) => {
    // Trim, drop stray quotes, then wrap once with slashes for IPA
    const v = (val || "").trim().replace(/"/g, "");
    if (!v) return "";
    const core = v.replace(/^\/+|\/+$/g, "");
    return `/${core}/`;
  };

  async function lookupIPA(word: string) {
    if (!word) return "";
    try {
      const resp = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
      );
      if (!resp.ok) return "";
      const data = await resp.json();
      if (Array.isArray(data) && data[0]?.phonetics?.length > 0) {
        const ph = data[0].phonetics.find((p: any) => p.text);
        if (ph?.text) return ensureIpaSlashes(ph.text);
        if (data[0].phonetics[0]?.text) return ensureIpaSlashes(data[0].phonetics[0].text);
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
      setErrorMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrorMessage(''), 5000);
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
      // Special-case for PDF folders (virtual PDF tree under 'pdf/<pdfId>')
      if (type === 'folder' && path && path.startsWith('pdf/')) {
        const pdfId = path.split('/')[1];
        const pdfTrash = api?.pdfTrash || api?.pdfDelete;
        if (!pdfTrash) {
          setErrorMessage('API unavailable');
          setTimeout(() => setErrorMessage(''), 5000);
          return;
        }
        await pdfTrash(pdfId);
        // If currentFile pointed inside Data/pdf, clear it
        if (currentFile && currentFile.includes('/Data/pdf/')) setCurrentFile(null);
        await loadTree();
        return;
      }
      if (type === "file") {
        const deleteFileFn = api?.deleteFile;
        if (!deleteFileFn) {
          setErrorMessage('API unavailable');
          setTimeout(() => setErrorMessage(''), 5000);
          return;
        }
        await deleteFileFn(path);
        if (currentFile === path) setCurrentFile(null);
        await loadTree();
      } else {
        const deleteFolderFn = api?.deleteFolder;
        if (!deleteFolderFn) {
          setErrorMessage('API unavailable');
          setTimeout(() => setErrorMessage(''), 5000);
          return;
        }
        await deleteFolderFn(path);
        // if currentFile was inside deleted folder, clear it
        if (currentFile && currentFile.startsWith(path)) setCurrentFile(null);
        await loadTree();
      }
    } catch (err) {
      console.error("Error deleting:", err);
      setErrorMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrorMessage(''), 5000);
    }
  }

  useEffect(() => {
    loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore persisted current file on mount
  const restoredFileRef = useRef(false);
  useEffect(() => {
    if (!restoredFileRef.current && currentFile) {
      restoredFileRef.current = true;
      openFile(currentFile).catch(()=>{});
    }
  }, [currentFile]);

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
      setErrorMessage(`Paste error: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrorMessage(''), 5000);
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
      setErrorMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrorMessage(''), 5000);
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
      setErrorMessage('Please select at least one file to study');
      setTimeout(() => setErrorMessage(''), 3000);
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
    <ErrorBoundary>
      <div
      className="flex h-full bg-gradient-to-br from-gray-50 to-white"
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
      <div className="w-full md:w-1/2 lg:w-2/5 border-r border-gray-200 bg-white shadow-sm flex flex-col">
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
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Vocabulary Manager</h1>
              <p className="text-sm text-gray-600 mt-1">Manage your vocabulary files and collections</p>
            </div>
          </div>
          
          {/* Add Word Form */}
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  placeholder="Enter word..."
                  className="input-field pl-10"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                />
              </div>
              <div className="relative flex-1">
                <input
                  placeholder="Enter meaning..."
                  className="input-field pl-10"
                  value={meaning}
                  onChange={(e) => setMeaning(e.target.value)}
                />
              </div>
              <div className="relative w-44">
                <select
                  className="input-field"
                  value={pos}
                  onChange={(e) => setPos(e.target.value)}
                >
                  <option value="">POS...</option>
                  {POS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              className="btn-primary px-6 py-2.5 flex items-center gap-2 whitespace-nowrap"
              onClick={async () => {
                if (!word.trim() || !meaning.trim() || !pos.trim()) {
                  setErrorMessage("Please enter word + meaning + POS");
                  setTimeout(() => setErrorMessage(''), 3000);
                  return;
                }

                // If a CSV file is already open, add directly to it
                if (currentFile) {
                  const addWord = api?.addWord;
                  if (!addWord) {
                    setErrorMessage('API unavailable');
                    setTimeout(() => setErrorMessage(''), 5000);
                    return;
                  }
                  try {
                    const ipa = await lookupIPA(word.trim());
                    await addWord(currentFile, {
                      word: word.trim(),
                      meaning: meaning.trim(),
                      pronunciation: ipa,
                      pos: pos.trim(),
                    });
                    setWord("");
                    setMeaning("");
                    setPos("");
                    await loadTree();
                    await openFile(currentFile);
                  } catch (err) {
                    console.error('Add word error', err);
                    setErrorMessage(`Error adding word: ${err instanceof Error ? err.message : String(err)}`);
                    setTimeout(() => setErrorMessage(''), 5000);
                  }
                } else {
                  setShowChoose(true);
                }
              }}
              type="button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Word
            </button>
          </div>
          
          {errorMessage && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {errorMessage}
            </div>
          )}

          {currentFile && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Current File</p>
                <p className="text-sm font-medium text-gray-900 truncate" title={currentFile}>
                  {currentFile.split(/[/\\]/).pop()}
                </p>
              </div>
            </div>
          )}
          {!currentFile && (
            <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
              <p className="text-sm text-gray-600">Select a CSV file from the left panel to view and edit</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {currentFile ? (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
              <VocabTable
                rows={rows}
                onDelete={handleRowDelete}
                onEdit={handleRowEdit}
                onSpeak={speak}
                onRefresh={() => currentFile && openFile(currentFile)}
                currentFile={currentFile}
                selected={vocabSelected}
                setSelected={setVocabSelected}
                wordFilter={wordFilter}
                setWordFilter={setWordFilter}
                meaningFilter={meaningFilter}
                setMeaningFilter={setMeaningFilter}
              />
            </div>
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
            if (!pos.trim()) {
              setErrorMessage('Please select POS');
              setTimeout(() => setErrorMessage(''), 3000);
              return;
            }
            const ipa = await lookupIPA(word.trim());
            await addWord(filePath, {
              word: word.trim(),
              meaning: meaning.trim(),
              pronunciation: ipa,
              pos: pos.trim(),
            });

            setShowChoose(false);
            setWord("");
            setMeaning("");
            setPos("");

            await loadTree();
            if (filePath === currentFile) await openFile(filePath);
          }}
        />
      )}

      {showPdfChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded shadow-lg w-96 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Choose PDF Deck</div>
              <button className="text-sm text-gray-500" onClick={() => setShowPdfChooser(false)}>Close</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {pdfList.length === 0 && <div className="text-sm text-gray-500">No PDFs found</div>}
              {pdfList.map((p:any) => (
                <div key={p.pdfId} className="flex items-center justify-between p-2 border-b">
                  <div className="truncate mr-2">
                    <div className="text-sm font-medium">{p.baseName}</div>
                    <div className="text-xs text-gray-500">{p.deckCsvPath ? p.deckCsvPath.split(/[/\\]/).pop() : 'No deck'}</div>
                  </div>
                  <div className="flex-shrink-0 space-x-2">
                    <button
                      className="px-2 py-1 bg-blue-500 text-white text-xs rounded"
                      onClick={async () => {
                          if (!p.deckCsvPath) {
                            setErrorMessage('No deck for this PDF');
                            setTimeout(() => setErrorMessage(''), 3000);
                            return;
                          }
                          await openFile(p.deckCsvPath);
                          setShowPdfChooser(false);
                        }}
                    >Open Deck</button>
                    <button
                      className="px-2 py-1 bg-gray-200 text-xs rounded"
                      onClick={async () => {
                        // open PDF reader
                        navigate('/pdf', { state: { openPdfId: p.pdfId } });
                        setShowPdfChooser(false);
                      }}
                    >Open PDF</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
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
          className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
          onMouseLeave={() => clearContext()}
        >
          <div className="py-1">
            {selectedItems.size > 1 && (
              <>
                <div className="px-4 py-2 text-xs text-gray-500 font-bold bg-gray-50 border-b border-gray-200">
                  {selectedItems.size} items selected
                </div>
                <button className="w-full px-4 py-2.5 hover:bg-red-50 text-left text-red-600 flex items-center gap-2" onClick={() => { doBulkDelete(); clearContext(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete All
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-gray-50 text-left flex items-center gap-2" onClick={() => { doBulkCopy(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy All
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-gray-50 text-left flex items-center gap-2" onClick={() => { doBulkCut(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                  </svg>
                  Cut All
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-blue-50 text-left text-blue-600 font-semibold flex items-center gap-2 border-t border-gray-200" onClick={() => { doStudySelected(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Study Selected
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-gray-50 text-left text-xs text-gray-600 border-t border-gray-200" onClick={() => { setSelectedItems(new Set()); clearContext(); }}>
                  Clear Selection
                </button>
              </>
            )}

            {selectedItems.size <= 1 && !contextMenu.isEmpty && contextMenu.item && (
              <>
                <button className="w-full px-4 py-2.5 hover:bg-red-50 text-left text-red-600 flex items-center gap-2" onClick={() => { handleDeleteNode(contextMenu.item!.path, contextMenu.item!.type); clearContext(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-gray-50 text-left flex items-center gap-2" onClick={() => { doCopyItem(contextMenu.item!); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-gray-50 text-left flex items-center gap-2" onClick={() => { doCutItem(contextMenu.item!); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                  </svg>
                  Cut
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-gray-50 text-left flex items-center gap-2" onClick={() => { doRename(contextMenu.item!); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Rename
                </button>
              </>
            )}

            {contextMenu.isEmpty && (
              <>
                <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                  Paste to: {contextMenu.destFolder || '<root>'}
                </div>
                <button className={`w-full px-4 py-2.5 hover:bg-gray-50 text-left flex items-center gap-2 ${!clipboard ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (clipboard) doPasteTo(contextMenu.destFolder||''); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Paste
                </button>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
