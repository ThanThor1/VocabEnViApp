import React, { useEffect, useMemo, useRef, useState } from "react";
import './ManagerView.css'
import ErrorBoundary from "../ErrorBoundary/ErrorBoundary";
import { useNavigate, useLocation } from "react-router-dom";
import VocabTable from "../VocabTable/VocabTable";
import ChooseFileModal from "../ChooseFileModal/ChooseFileModal";
import InputModal from "../InputModal/InputModal";
import FolderNavigator from "../FolderNavigator/FolderNavigator";
import { usePersistedState } from "../../hooks/usePersistedState"
import { POS_OPTIONS, normalizePos } from "../posOptions/posOptions";
import ConfirmModal from "../ConfirmModal/ConfirmModal";
import { speakWord } from '../../utils/speech'
import { countSaveableFamilyMembers, enrichWordFamilyMembers, getWordFamily, type EnrichedWordFamilyMember } from '../../utils/wordFamily'
import { enrichSynonyms, getSynonymFamilies, getSynonyms } from '../../utils/synonyms'

type TreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: TreeNode[];
};

type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] };

type AutoMeaningResponse = {
  requestId: string;
  word: string;
  meaningSuggested: string;
  meaningNoteVi: string;
  contextSentenceVi: string;
  candidates: AutoMeaningCandidate[];
};

type BulkSynonymMember = { word: string; pos?: string; relation?: string };

type BulkSuggestStatus = "idle" | "loading" | "done" | "error";
type BulkSuggestItem = {
  word: string;
  selected: boolean;
  status: BulkSuggestStatus;
  meaning: string;
  meaningNoteVi: string;
  pos: string;
  pronunciation: string;
  example: string;
  error?: string;

  synonymsExpanded: boolean;
  synonymsLoading: boolean;
  synonymsError: string;
  synonyms: BulkSynonymMember[];
  synonymsSelected: string[];
};

type AddUiMode = 'single' | 'bulk';

export default function Manager() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<TreeNode[]>([]);
  
  // Persisted state - main file/folder context
  const [currentFile, setCurrentFile] = usePersistedState<string | null>('manager_currentFile', null);
  const [currentFolder, setCurrentFolder] = usePersistedState<string>('manager_currentFolder', "");

  // Persisted state - split between folder panel and vocab panel (percentage of total width)
  const [splitPct, setSplitPct] = usePersistedState<number>('manager_splitPct', 20);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDraggingRef = useRef(false);
  const splitRafRef = useRef<number | null>(null);
  
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
  const [showChoose, setShowChoose] = usePersistedState<boolean>('manager_showChoose', false);
  const [showPdfChooser, setShowPdfChooser] = usePersistedState<boolean>('manager_showPdfChooser', false);
  const [pdfList, setPdfList] = useState<any[]>([]);
  const [word, setWord] = usePersistedState<string>('manager_wordInput', "");
  const [meaning, setMeaning] = usePersistedState<string>('manager_meaningInput', "");
  const [meaningNoteVi, setMeaningNoteVi] = usePersistedState<string>('manager_meaningNoteViInput', "");
  const [pos, setPos] = usePersistedState<string>('manager_posInput', "");
  const [example, setExample] = usePersistedState<string>('manager_exampleInput', "");

  const [addUiMode, setAddUiMode] = usePersistedState<AddUiMode>('manager_addUiMode', 'single');

  const [bulkInput, setBulkInput] = usePersistedState<string>('manager_bulkInput', "");
  const [bulkItems, setBulkItems] = useState<BulkSuggestItem[]>([]);
  const [bulkSuggestLoading, setBulkSuggestLoading] = useState(false);
  const [bulkSuggestError, setBulkSuggestError] = useState("");
  const [bulkAddMessage, setBulkAddMessage] = useState("");
  const [bulkAddLoading, setBulkAddLoading] = useState(false);
  const bulkSuggestReqRef = useRef<string>("");

  const [exampleLoading, setExampleLoading] = useState(false);
  const [exampleError, setExampleError] = useState<string>("");
  const isExampleDirtyRef = useRef(false);
  const lastExampleKeyRef = useRef<string>("");
  const exampleValueRef = useRef<string>("");

  // Prefetch IPA for current word to reduce perceived latency on Add.
  const lastIpaKeyRef = useRef<string>("");
  const ipaValueRef = useRef<string>("");
  const ipaPromiseRef = useRef<Promise<string> | null>(null);
  const ipaDebounceTimerRef = useRef<number | null>(null);

  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = usePersistedState<string>('manager_suggestError', "");
  const [suggestCandidates, setSuggestCandidates] = usePersistedState<AutoMeaningCandidate[]>('manager_suggestCandidates', []);
  const lastSuggestRequestIdRef = useRef<string | null>(null);

  const WORD_FAMILY_FEATURE_ENABLED = false;
  const SYNONYM_FAMILIES_FEATURE_ENABLED = false;

  const [wordFamilyEnabled, setWordFamilyEnabled] = usePersistedState<boolean>('manager_wordFamilyEnabled', false);
  const [wordFamilyLoading, setWordFamilyLoading] = useState(false);
  const [wordFamilyError, setWordFamilyError] = useState('');
  const [wordFamilyMembers, setWordFamilyMembers] = useState<EnrichedWordFamilyMember[]>([]);
  const [wordFamilySelected, setWordFamilySelected] = useState<Set<string>>(new Set());
  const [wordFamilyFor, setWordFamilyFor] = useState('');
  const wordFamilyReqRef = useRef<string>('');

  const [synonymsEnabled, setSynonymsEnabled] = usePersistedState<boolean>('manager_synonymsEnabled', true);
  const [synonymsIncludeFamilies, setSynonymsIncludeFamilies] = usePersistedState<boolean>('manager_synonymsIncludeFamilies', false);
  const [synonymsLoading, setSynonymsLoading] = useState(false);
  const [synonymsError, setSynonymsError] = useState('');
  const [synonymsMembers, setSynonymsMembers] = useState<EnrichedWordFamilyMember[]>([]);
  const [synonymsSelected, setSynonymsSelected] = useState<Set<string>>(new Set());
  const [synonymFamilyMembers, setSynonymFamilyMembers] = useState<EnrichedWordFamilyMember[]>([]);
  const [synonymFamilySelected, setSynonymFamilySelected] = useState<Set<string>>(new Set());
  const [synonymsFor, setSynonymsFor] = useState('');
  const synonymsReqRef = useRef<string>('');

  const wordFamilyEnabledEffective = WORD_FAMILY_FEATURE_ENABLED && wordFamilyEnabled;
  const synonymsIncludeFamiliesEffective = SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies;

  useEffect(() => {
    if (!WORD_FAMILY_FEATURE_ENABLED && wordFamilyEnabled) setWordFamilyEnabled(false);
  }, [WORD_FAMILY_FEATURE_ENABLED, wordFamilyEnabled, setWordFamilyEnabled]);

  useEffect(() => {
    if (!SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamilies) setSynonymsIncludeFamilies(false);
  }, [SYNONYM_FAMILIES_FEATURE_ENABLED, synonymsIncludeFamilies, setSynonymsIncludeFamilies]);

  const [relatedEditTarget, setRelatedEditTarget] = useState<
    | { group: 'family'; word: string }
    | { group: 'synonym'; word: string }
    | { group: 'synonymFamily'; word: string }
    | null
  >(null);

  const wordFamilySaveableCount = useMemo(() => countSaveableFamilyMembers(wordFamilyMembers), [wordFamilyMembers]);
  const wordFamilySelectedSaveableCount = useMemo(() => {
    const sel = wordFamilySelected;
    return (Array.isArray(wordFamilyMembers) ? wordFamilyMembers : []).filter((m) => {
      const w = String(m?.word || '').trim();
      if (!w || !sel.has(w)) return false;
      const meaning = String(m?.meaning || '').trim();
      const pos = String(m?.pos || '').trim();
      return !!meaning && !!pos;
    }).length;
  }, [wordFamilyMembers, wordFamilySelected]);

  const synonymsSaveableCount = useMemo(() => countSaveableFamilyMembers(synonymsMembers), [synonymsMembers]);
  const synonymsSelectedSaveableCount = useMemo(() => {
    const sel = synonymsSelected;
    return (Array.isArray(synonymsMembers) ? synonymsMembers : []).filter((m) => {
      const w = String(m?.word || '').trim();
      if (!w || !sel.has(w)) return false;
      const meaning = String(m?.meaning || '').trim();
      const pos = String(m?.pos || '').trim();
      return !!meaning && !!pos;
    }).length;
  }, [synonymsMembers, synonymsSelected]);

  const synonymFamilySaveableCount = useMemo(() => countSaveableFamilyMembers(synonymFamilyMembers), [synonymFamilyMembers]);
  const synonymFamilySelectedSaveableCount = useMemo(() => {
    const sel = synonymFamilySelected;
    return (Array.isArray(synonymFamilyMembers) ? synonymFamilyMembers : []).filter((m) => {
      const w = String(m?.word || '').trim();
      if (!w || !sel.has(w)) return false;
      const meaning = String(m?.meaning || '').trim();
      const pos = String(m?.pos || '').trim();
      return !!meaning && !!pos;
    }).length;
  }, [synonymFamilyMembers, synonymFamilySelected]);

  const extraSelectedSaveableCount = useMemo(() => {
    const family = wordFamilyEnabledEffective ? wordFamilySelectedSaveableCount : 0;
    const syn = synonymsEnabled ? synonymsSelectedSaveableCount : 0;
    const synFam = (synonymsEnabled && synonymsIncludeFamiliesEffective) ? synonymFamilySelectedSaveableCount : 0;
    return family + syn + synFam;
  }, [wordFamilyEnabledEffective, wordFamilySelectedSaveableCount, synonymsEnabled, synonymsSelectedSaveableCount, synonymsIncludeFamiliesEffective, synonymFamilySelectedSaveableCount]);

  const clampSplitPct = (pct: number) => {
    const min = 15;
    const max = 45;
    if (!Number.isFinite(pct)) return 20;
    return Math.max(min, Math.min(max, pct));
  };

  const startSplitDrag = (e: React.MouseEvent) => {
    // Only meaningful when panels are side-by-side.
    if (typeof window !== 'undefined') {
      const isMdUp = window.matchMedia?.('(min-width: 768px)')?.matches;
      if (!isMdUp) return;
    }

    e.preventDefault();
    splitDraggingRef.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!splitDraggingRef.current) return;
      const el = splitContainerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const next = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = clampSplitPct(next);

      if (splitRafRef.current != null) cancelAnimationFrame(splitRafRef.current);
      splitRafRef.current = requestAnimationFrame(() => setSplitPct(clamped));
    };

    const onUp = () => {
      splitDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (splitRafRef.current != null) {
        cancelAnimationFrame(splitRafRef.current);
        splitRafRef.current = null;
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const maybeSuggestExample = async (pickedMeaningVi: string, posOverride?: string) => {
    const w = word.trim();
    const m = (pickedMeaningVi || '').trim();
    if (!w || !m) return;
    if (isExampleDirtyRef.current) return;
    if (!api?.suggestExampleSentence) return;

    const key = `${w}__${m}`.toLowerCase();
    if (lastExampleKeyRef.current === key) return;
    lastExampleKeyRef.current = key;

    try {
      setExampleError('');
      setExampleLoading(true);
      const out = await api.suggestExampleSentence({
        word: w,
        meaningVi: m,
        pos: (posOverride || pos || '').trim(),
        contextSentenceEn: ''
      });
      if (!isExampleDirtyRef.current && !exampleValueRef.current.trim() && String(out || '').trim()) {
        setExample(String(out || '').trim());
      }
    } catch (err) {
      setExampleError(`Failed to suggest example: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExampleLoading(false);
    }
  };

  useEffect(() => {
    exampleValueRef.current = example;
  }, [example]);

  const getIpaForWord = (wRaw: string) => {
    const w = (wRaw || '').trim();
    const key = w.toLowerCase();
    if (!w) return Promise.resolve("");

    if (lastIpaKeyRef.current === key) {
      if (ipaValueRef.current) return Promise.resolve(ipaValueRef.current);
      if (ipaPromiseRef.current) return ipaPromiseRef.current;
    }

    lastIpaKeyRef.current = key;
    ipaValueRef.current = '';
    const p = lookupIPA(w)
      .then((ipa) => {
        if (lastIpaKeyRef.current === key) ipaValueRef.current = ipa || '';
        return ipa || '';
      })
      .catch(() => '')
      .finally(() => {
        if (lastIpaKeyRef.current === key) ipaPromiseRef.current = null;
      });
    ipaPromiseRef.current = p;
    return p;
  };

  useEffect(() => {
    const w = word.trim();
    if (ipaDebounceTimerRef.current != null) {
      window.clearTimeout(ipaDebounceTimerRef.current);
      ipaDebounceTimerRef.current = null;
    }
    if (!w) {
      lastIpaKeyRef.current = '';
      ipaValueRef.current = '';
      ipaPromiseRef.current = null;
      return;
    }
    ipaDebounceTimerRef.current = window.setTimeout(() => {
      void getIpaForWord(w);
    }, 250);
    return () => {
      if (ipaDebounceTimerRef.current != null) {
        window.clearTimeout(ipaDebounceTimerRef.current);
        ipaDebounceTimerRef.current = null;
      }
    };
  }, [word]);

  const [showInputModal, setShowInputModal] = usePersistedState<boolean>('manager_showInputModal', false);
  const [inputModalTitle, setInputModalTitle] = usePersistedState<string>('manager_inputModalTitle', "");
  const [inputModalPlaceholder, setInputModalPlaceholder] = usePersistedState<string>('manager_inputModalPlaceholder', "");
  const [inputModalType, setInputModalType] = usePersistedState<"folder" | "file" | "rename" | null>('manager_inputModalType', null);
  const [inputModalParent, setInputModalParent] = usePersistedState<string | null>('manager_inputModalParent', null);

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x?: number;
    y?: number;
    item?: TreeNode | null;
    isEmpty?: boolean;
    destFolder?: string;
  }>({ visible: false });

  const [clipboard, setClipboard] = usePersistedState<{
    action: "copy" | "cut";
    path: string;
    type: "file" | "folder";
  } | null>('manager_clipboard', null);

  const [errorMessage, setErrorMessage] = useState<string>('');

  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = usePersistedState<boolean>('manager_confirmBulkDeleteOpen', false);

  const api = window.api;

  const cancelPendingSuggest = async () => {
    const rid = lastSuggestRequestIdRef.current;
    if (!rid) return;
    lastSuggestRequestIdRef.current = null;
    try {
      if (api?.autoMeaningCancel) {
        await api.autoMeaningCancel(rid);
      }
    } catch {
      // ignore
    }
  };

  const handleSuggest = async () => {
    const w = word.trim();
    if (!w) {
      setErrorMessage("Please enter a word first");
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }
    if (!api?.autoMeaning) {
      setErrorMessage('API unavailable');
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }

    try {
      setSuggestError('');
      setSuggestCandidates([]);
      await cancelPendingSuggest();

      const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      lastSuggestRequestIdRef.current = requestId;
      setSuggestLoading(true);

      const resp: AutoMeaningResponse = await api.autoMeaning({
        requestId,
        word: w,
        contextSentenceEn: '',
        from: 'en',
        to: 'vi',
      });

      if (!resp || resp.requestId !== requestId) return;

      const suggested = (resp.meaningSuggested || '').trim();
      const suggestedNote = (resp.meaningNoteVie || resp.meaningNoteVi || '').trim();
      if (!meaning.trim() && suggested) {
        setMeaning(suggested);
        // If user is using API suggestion for meaning, auto-generate a memorable example sentence.
        if (!isExampleDirtyRef.current) {
          setExample('');
          setExampleError('');
          lastExampleKeyRef.current = '';
          void maybeSuggestExample(suggested);
        }
      }
      if (!meaningNoteVi.trim() && suggestedNote) {
        setMeaningNoteVi(suggestedNote);
      }

      const candidates = Array.isArray(resp.candidates) ? resp.candidates : [];
      setSuggestCandidates(candidates);

      if (!pos.trim()) {
        const firstWithPos = candidates.find((c) => c && c.pos);
        const normalized = normalizePos(firstWithPos?.pos);
        if (normalized) setPos(normalized);
      }

      // Word Family: fetch on-demand when user presses "Gợi ý"
      void (async () => {
        if (!wordFamilyEnabledEffective) return;
        if (!api?.getWordFamily) return;
        if (!w || /\s/.test(w) || w.length > 40) return;

        const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        wordFamilyReqRef.current = rid;
        setWordFamilyLoading(true);
        setWordFamilyError('');
        setWordFamilyMembers([]);
        setWordFamilySelected(new Set());
        setWordFamilyFor(w.toLowerCase());

        try {
          const resp = await getWordFamily(w);
          if (wordFamilyReqRef.current !== rid) return;
          const members = Array.isArray(resp?.family) ? resp!.family : [];
          const enriched = await enrichWordFamilyMembers(members, { concurrency: 2, contextSentenceEn: '' });
          if (wordFamilyReqRef.current !== rid) return;
          setWordFamilyMembers(enriched);
          setWordFamilySelected(new Set(enriched.map((m) => m.word)));
        } catch (e) {
          if (wordFamilyReqRef.current !== rid) return;
          setWordFamilyError('Failed to fetch word family');
          setWordFamilyMembers([]);
          setWordFamilySelected(new Set());
        } finally {
          if (wordFamilyReqRef.current === rid) setWordFamilyLoading(false);
        }
      })();

      // Synonyms: fetch on-demand when user presses "Gợi ý"
      void (async () => {
        if (!synonymsEnabled) return;
        if (!w || /\s/.test(w) || w.length > 40) return;

        const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        synonymsReqRef.current = rid;
        setSynonymsLoading(true);
        setSynonymsError('');
        setSynonymsMembers([]);
        setSynonymsSelected(new Set());
        setSynonymFamilyMembers([]);
        setSynonymFamilySelected(new Set());
        setSynonymsFor(w.toLowerCase());

        try {
          const resp = await getSynonyms(w);
          if (synonymsReqRef.current !== rid) return;
          const members = Array.isArray(resp?.synonyms) ? resp!.synonyms : [];
          const enriched = await enrichSynonyms(members, { concurrency: 2, contextSentenceEn: '' });
          if (synonymsReqRef.current !== rid) return;
          setSynonymsMembers(enriched);
          setSynonymsSelected(new Set(enriched.map((m) => m.word)));

          if (synonymsIncludeFamiliesEffective) {
            const fam = await getSynonymFamilies(enriched, { maxSynonyms: 3, contextSentenceEn: '' });
            if (synonymsReqRef.current !== rid) return;
            const famEnriched = await enrichSynonyms(fam, { concurrency: 2, contextSentenceEn: '' });
            if (synonymsReqRef.current !== rid) return;
            setSynonymFamilyMembers(famEnriched);
            setSynonymFamilySelected(new Set(famEnriched.map((m) => m.word)));
          }
        } catch {
          if (synonymsReqRef.current !== rid) return;
          setSynonymsError('Failed to fetch synonyms');
          setSynonymsMembers([]);
          setSynonymsSelected(new Set());
          setSynonymFamilyMembers([]);
          setSynonymFamilySelected(new Set());
        } finally {
          if (synonymsReqRef.current === rid) setSynonymsLoading(false);
        }
      })();
    } catch (err) {
      setSuggestError(`Failed to suggest meaning: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSuggestLoading(false);
    }
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

  async function handleRowDelete(idx: number): Promise<void> {
    const deleteWord = api?.deleteWord;
    if (!deleteWord) return;
    if (!currentFile) return;
    try {
      await deleteWord(currentFile, idx);
      setRows(prev => prev.filter((_, i) => i !== idx));
    } catch (err) {
      console.error('Delete failed', err);
      setErrorMessage(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrorMessage(''), 5000);
      throw err;
    }
  }

  async function handleRowEdit(idx: number, word: string, meaning: string, meaningEn: string, meaningVi: string, pronunciation: string, pos: string, example: string) {
    if (!api?.editWord || !currentFile) return;
    try {
      const ipa = ensureIpaSlashes(pronunciation);
      await api.editWord(currentFile, idx, { word, meaning, meaningEn, meaningVi, pronunciation: ipa, pos, example });
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, word, meaning, meaningEn, meaningVi, pronunciation: ipa, pos, example } : r));
    } catch (err) {
      console.error('Edit failed', err);
      setErrorMessage(`Edit failed: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrorMessage(''), 5000);
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
      if (api?.suggestIpa) {
        const out = await api.suggestIpa({ word, dialect: 'US' });
        const cleaned = String(out || '').trim();
        if (cleaned) return ensureIpaSlashes(cleaned);
      }

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

  const suggestExampleForWord = async (wRaw: string, meaningViRaw: string, posRaw: string) => {
    const w = String(wRaw || '').trim();
    const m = String(meaningViRaw || '').trim();
    if (!w || !m) return "";
    if (!api?.suggestExampleSentence) return "";
    try {
      const out = await api.suggestExampleSentence({
        word: w,
        meaningVi: m,
        pos: String(posRaw || '').trim(),
        contextSentenceEn: ""
      });
      return String(out || '').trim();
    } catch {
      return "";
    }
  };

  const normalizeBulkWord = (w: string) => String(w || '').trim().replace(/^[-*\d.\s]+/, '').trim();

  const prepareBulkList = () => {
    const raw = String(bulkInput || "");
    const tokens = raw
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map(normalizeBulkWord)
      .filter(Boolean);

    const prevByKey = new Map<string, BulkSuggestItem>();
    for (const it of bulkItems) {
      const key = String(it.word || '').trim().toLowerCase();
      if (key) prevByKey.set(key, it);
    }

    const next: BulkSuggestItem[] = [];
    const seen = new Set<string>();
    for (const w of tokens) {
      const key = w.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const prev = prevByKey.get(key);
      next.push(
        prev
          ? { ...prev, word: w }
          : {
              word: w,
              selected: true,
              status: "idle",
              meaning: "",
              meaningNoteVi: "",
              pos: "",
              pronunciation: "",
              example: "",
              synonymsExpanded: false,
              synonymsLoading: false,
              synonymsError: "",
              synonyms: [],
              synonymsSelected: []
            }
      );
    }

    setBulkSuggestError("");
    setBulkAddMessage("");
    setBulkItems(next);
  };

  const clearBulkPanel = () => {
    // Cancel any in-flight suggest workers.
    bulkSuggestReqRef.current = '';
    setBulkSuggestLoading(false);
    setBulkSuggestError('');
    setBulkAddMessage('');
    setBulkItems([]);
    setBulkInput('');
  };

  const setBulkItem = (wordToFind: string, patch: Partial<BulkSuggestItem>) => {
    const target = String(wordToFind || '').trim();
    if (!target) return;
    setBulkItems((prev) => prev.map((it) => (String(it.word || '').trim() === target ? { ...it, ...patch } : it)));
  };

  const bulkSelectedCount = useMemo(() => bulkItems.filter((x) => x.selected).length, [bulkItems]);
  const bulkDoneCount = useMemo(() => bulkItems.filter((x) => x.selected && x.status === "done").length, [bulkItems]);

  const toggleBulkSynonyms = async (wordRaw: string) => {
    const w = String(wordRaw || '').trim();
    if (!w) return;

    const current = bulkItems.find((x) => String(x.word || '').trim() === w);
    const nextExpanded = !current?.synonymsExpanded;
    setBulkItem(w, {
      synonymsExpanded: nextExpanded,
      synonymsError: nextExpanded ? "" : current?.synonymsError || "",
    });

    if (!nextExpanded) return;
    if (current?.synonymsLoading) return;
    if (Array.isArray(current?.synonyms) && current!.synonyms.length > 0) return;

    setBulkItem(w, { synonymsLoading: true, synonymsError: "" });
    try {
      const resp = await getSynonyms(w);
      const list = Array.isArray(resp?.synonyms) ? resp!.synonyms : [];

      // Keep existing selection if present; otherwise default-select all.
      const existing = bulkItems.find((x) => String(x.word || '').trim() === w);
      const existingSelected = Array.isArray(existing?.synonymsSelected) ? existing!.synonymsSelected : [];
      const nextSelected = existingSelected.length > 0
        ? existingSelected
        : list.map((x) => String((x as any)?.word || '').trim()).filter(Boolean);

      setBulkItem(w, {
        synonymsLoading: false,
        synonymsError: "",
        synonyms: list,
        synonymsSelected: nextSelected
      });
    } catch (e) {
      setBulkItem(w, {
        synonymsLoading: false,
        synonymsError: e instanceof Error ? e.message : "Failed to load synonyms",
        synonyms: []
      });
    }
  };

  const toggleBulkSynonymSelected = (baseWordRaw: string, synWordRaw: string) => {
    const baseWord = String(baseWordRaw || '').trim();
    const synWord = String(synWordRaw || '').trim();
    if (!baseWord || !synWord) return;

    setBulkItems((prev) => prev.map((it) => {
      if (String(it.word || '').trim() !== baseWord) return it;
      const current = Array.isArray(it.synonymsSelected) ? it.synonymsSelected : [];
      const key = synWord.toLowerCase();
      const has = current.some((x) => String(x || '').toLowerCase() === key);
      const next = has
        ? current.filter((x) => String(x || '').toLowerCase() !== key)
        : [...current, synWord];
      return { ...it, synonymsSelected: next };
    }));
  };

  const suggestBulkSelected = async () => {
    const enrichWordBulk = (api as any)?.enrichWordBulk as undefined | ((payload: any) => Promise<any>);
    const autoMeaning = (api as any)?.autoMeaning as undefined | ((payload: any) => Promise<any>);
    if (!enrichWordBulk && !autoMeaning) {
      setBulkSuggestError("API unavailable");
      return;
    }

    const selected = bulkItems.filter((it) => it.selected && String(it.word || '').trim());
    if (selected.length === 0) {
      setBulkSuggestError("No selected words");
      return;
    }

    const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    bulkSuggestReqRef.current = rid;
    setBulkSuggestLoading(true);
    setBulkSuggestError("");
    setBulkAddMessage("");

    setBulkItems((prev) => prev.map((it) => (it.selected ? { ...it, status: "loading", error: "" } : it)));

    const canBatch = typeof enrichWordBulk === 'function';
    const chunkSize = 3;
    const batches: string[][] = [];
    for (let i = 0; i < selected.length; i += chunkSize) {
      batches.push(selected.slice(i, i + chunkSize).map((x) => String(x.word || '').trim()).filter(Boolean));
    }

    const batchConcurrency = canBatch ? 2 : 3;
    let cursor = 0;
    const workerCount = Math.min(batchConcurrency, canBatch ? batches.length : selected.length);

    const workers = new Array(workerCount).fill(0).map(async () => {
      while (true) {
        if (bulkSuggestReqRef.current !== rid) return;

        if (canBatch) {
          const batchIndex = cursor++;
          const batchWords = batches[batchIndex];
          if (!batchWords || batchWords.length === 0) return;

          try {
            const resp = await enrichWordBulk({
              requestId: `${rid}__b${batchIndex}`,
              words: batchWords,
              contextSentenceEn: "",
              from: "en",
              to: "vi",
              dialect: "US"
            });

            if (bulkSuggestReqRef.current !== rid) return;
            const items = Array.isArray(resp?.items) ? resp.items : [];
            const byKey = new Map<string, any>();
            for (const x of items) {
              const ww = String(x?.word || '').trim();
              if (ww) byKey.set(ww.toLowerCase(), x);
            }

            for (const w of batchWords) {
              if (bulkSuggestReqRef.current !== rid) return;
              const x = byKey.get(w.toLowerCase());
              const r = x?.result;
              if (!r) {
                setBulkItem(w, { status: "error", error: String(x?.error || 'Failed to suggest') });
                continue;
              }

              const meaningSuggested = String(r?.meaningSuggested || '').trim();
              const normalizedPos = normalizePos(String(r?.posSuggested || '').trim()) || "";
              let ipa = ensureIpaSlashes(String(r?.ipa || '').trim());
              if (!ipa) {
                const fallbackIpa = await lookupIPA(w);
                ipa = String(fallbackIpa || '').trim();
              }

              if (!meaningSuggested || !normalizedPos) {
                setBulkItem(w, {
                  status: "error",
                  meaning: meaningSuggested,
                  pos: normalizedPos,
                  pronunciation: ipa,
                  example: String(r?.example || '').trim(),
                  error: "Missing meaning/POS"
                });
                continue;
              }

              setBulkItem(w, {
                status: "done",
                meaning: meaningSuggested,
                meaningNoteVi: String(r?.meaningNoteVi || '').trim(),
                pos: normalizedPos,
                pronunciation: ipa,
                example: String(r?.example || '').trim(),
                error: ""
              });
            }
          } catch (e) {
            if (bulkSuggestReqRef.current !== rid) return;
            for (const w of batchWords) {
              setBulkItem(w, { status: "error", error: e instanceof Error ? e.message : "Failed to suggest" });
            }
          }
        } else {
          const it = selected[cursor++];
          if (!it) return;
          const w = String(it.word || '').trim();
          try {
            const requestId = `${rid}__${w.toLowerCase()}`;
            const [resp, ipa] = await Promise.all([
              autoMeaning!({
                requestId,
                word: w,
                contextSentenceEn: "",
                from: "en",
                to: "vi"
              }),
              lookupIPA(w)
            ]);

            if (bulkSuggestReqRef.current !== rid) return;
            const meaningSuggested = String(resp?.meaningSuggested || '').trim();
            const candidates = Array.isArray(resp?.candidates) ? resp.candidates : [];
            const firstWithPos = candidates.find((c: any) => c && c.pos);
            const normalized = normalizePos((firstWithPos as any)?.pos) || "";
            const ex = await suggestExampleForWord(w, meaningSuggested, normalized);

            if (bulkSuggestReqRef.current !== rid) return;
            setBulkItem(w, {
              status: "done",
              meaning: meaningSuggested,
              meaningNoteVi: String(resp?.meaningNoteVi || '').trim(),
              pos: normalized,
              pronunciation: String(ipa || '').trim(),
              example: String(ex || '').trim(),
              error: ""
            });
          } catch (e) {
            if (bulkSuggestReqRef.current !== rid) return;
            setBulkItem(w, {
              status: "error",
              error: e instanceof Error ? e.message : "Failed to suggest"
            });
          }
        }
      }
    });

    try {
      await Promise.all(workers);
    } finally {
      if (bulkSuggestReqRef.current === rid) setBulkSuggestLoading(false);
    }
  };

  const addBulkSelectedToDeck = async () => {
    console.log('[BulkAdd] === START ===');
    setBulkSuggestError('');
    setBulkAddMessage('Adding...');

    if (!currentFile) {
      console.log('[BulkAdd] ERROR: No deck selected');
      setBulkSuggestError("No deck selected");
      setBulkAddMessage('');
      return;
    }
    console.log('[BulkAdd] currentFile:', currentFile);

    const addWordsBulk = (api as any)?.addWordsBulk as undefined | ((relPath: string, rows: any[]) => Promise<{ added: number }>);
    const addWordSingle = api?.addWord;
    console.log('[BulkAdd] addWordsBulk available:', typeof addWordsBulk === 'function', ', addWordSingle available:', typeof addWordSingle === 'function');
    if (!addWordsBulk && !addWordSingle) {
      console.log('[BulkAdd] ERROR: API unavailable');
      setBulkSuggestError("API unavailable");
      setBulkAddMessage('');
      return;
    }

    if (bulkAddLoading) {
      console.log('[BulkAdd] Already loading, skip');
      return;
    }
    setBulkAddLoading(true);

    const writeToDeck = async (rowsToWrite: any[]) => {
      console.log('[BulkAdd] writeToDeck called with', rowsToWrite.length, 'rows');
      if (rowsToWrite.length === 0) return;
      if (typeof addWordsBulk === 'function') {
        console.log('[BulkAdd] Using addWordsBulk');
        await addWordsBulk(currentFile!, rowsToWrite);
      } else {
        console.log('[BulkAdd] Using addWordSingle (slow path)');
        for (const r of rowsToWrite) await addWordSingle!(currentFile!, r);
      }
      console.log('[BulkAdd] writeToDeck done');
    };

    let addedWords = 0, addedSynonyms = 0, skippedMissing = 0, skippedDup = 0, synFetchFail = 0, synEnrichFail = 0;

    try {
      const existing = new Set(
        (Array.isArray(rows) ? rows : []).map((r: any) => String(r?.word || '').trim().toLowerCase()).filter(Boolean)
      );
      console.log('[BulkAdd] Existing words in deck:', existing.size);

      const selected = bulkItems.filter((it) => it.selected);
      console.log('[BulkAdd] Selected items:', selected.length);
      console.log('[BulkAdd] Selected items sample:', selected.slice(0, 3).map(it => ({ word: it.word, meaning: it.meaning?.slice(0, 30), pos: it.pos, status: it.status })));

      // STEP 1: Collect and write base words
      console.log('[BulkAdd] STEP 1: Collect base words');
      const baseRows: any[] = [];
      for (const it of selected) {
        const w = String(it.word || '').trim(), m = String(it.meaning || '').trim(), p = String(it.pos || '').trim();
        if (!w || !m || !p) {
          if (w) {
            console.log('[BulkAdd] Skip (missing fields):', w, '| meaning:', !!m, '| pos:', !!p);
            skippedMissing++;
          }
          continue;
        }
        const k = w.toLowerCase();
        if (existing.has(k)) {
          console.log('[BulkAdd] Skip (duplicate):', w);
          skippedDup++;
          continue;
        }
        existing.add(k);
        baseRows.push({ word: w, meaning: m, meaningNoteVi: String(it.meaningNoteVi || '').trim(), pronunciation: ensureIpaSlashes(String(it.pronunciation || '')), pos: p, example: String(it.example || '').trim() });
      }
      console.log('[BulkAdd] Base rows to add:', baseRows.length);
      if (baseRows.length > 0) {
        await writeToDeck(baseRows);
        addedWords = baseRows.length;
        console.log('[BulkAdd] Base words written:', addedWords);
      }

      // STEP 2: Fetch synonyms
      console.log('[BulkAdd] STEP 2: Fetch synonyms');
      const synMap = new Map<string, BulkSynonymMember[]>();
      const fetchQueue: Array<{ word: string; key: string }> = [];
      for (const it of selected) {
        const bw = String(it.word || '').trim(); if (!bw) continue;
        const bk = bw.toLowerCase();
        if (Array.isArray(it.synonyms) && it.synonyms.length > 0) {
          synMap.set(bk, it.synonyms);
          console.log('[BulkAdd] Synonym cached for:', bw, '| count:', it.synonyms.length);
        } else {
          fetchQueue.push({ word: bw, key: bk });
        }
      }
      console.log('[BulkAdd] Synonyms to fetch:', fetchQueue.length, '| Already cached:', synMap.size);

      if (fetchQueue.length > 0) {
        let fi = 0;
        const fw = new Array(Math.min(3, fetchQueue.length)).fill(0).map(async () => {
          while (fi < fetchQueue.length) {
            const idx = fi++; const item = fetchQueue[idx]; if (!item) continue;
            try {
              console.log('[BulkAdd] Fetching synonyms for:', item.word);
              const resp = await getSynonyms(item.word);
              const list = Array.isArray(resp?.synonyms) ? resp.synonyms as BulkSynonymMember[] : [];
              console.log('[BulkAdd] Got', list.length, 'synonyms for:', item.word);
              synMap.set(item.key, list);
              const allWords = list.map((x) => String((x as any)?.word || '').trim()).filter(Boolean);
              setBulkItem(item.word, { synonyms: list, synonymsSelected: allWords, synonymsLoading: false, synonymsError: '' });
            } catch (err) {
              console.log('[BulkAdd] Synonym fetch failed for:', item.word, err);
              synFetchFail++;
              synMap.set(item.key, []);
            }
          }
        });
        await Promise.all(fw);
      }
      console.log('[BulkAdd] Synonym fetch done. Total in synMap:', synMap.size);

      // STEP 3: Collect unique synonyms with their info
      console.log('[BulkAdd] STEP 3: Collect unique synonyms to enrich');
      type SynInfo = { word: string; baseWord: string; baseMeaning: string; baseMeaningNoteVi: string; pos: string };
      const synToEnrich: SynInfo[] = [];
      const synSeen = new Set<string>();
      for (const it of selected) {
        const bw = String(it.word || '').trim();
        const bk = bw.toLowerCase(); if (!bk) continue;
        const baseMeaning = String(it.meaning || '').trim();
        const baseMeaningNoteVi = String(it.meaningNoteVi || '').trim();
        const list = synMap.get(bk) || [];
        const selArr = Array.isArray(it.synonymsSelected) && it.synonymsSelected.length > 0
          ? it.synonymsSelected : list.map((x) => String((x as any)?.word || '').trim()).filter(Boolean);
        const selSet = new Set(selArr.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
        for (const s of list) {
          const sw = String((s as any)?.word || '').trim(), sk = sw.toLowerCase();
          const spos = normalizePos(String((s as any)?.pos || '').trim()) || '';
          if (!sk) continue;
          if (!selSet.has(sk)) { continue; }
          if (existing.has(sk)) { skippedDup++; continue; }
          if (synSeen.has(sk)) continue;
          synSeen.add(sk);
          synToEnrich.push({ word: sw, baseWord: bw, baseMeaning, baseMeaningNoteVi, pos: spos });
        }
      }
      console.log('[BulkAdd] Unique synonyms to enrich:', synToEnrich.length, '| Sample:', synToEnrich.slice(0, 5).map(x => `${x.word}(${x.pos})`));

      // STEP 4: Enrich synonyms
      console.log('[BulkAdd] STEP 4: Enrich synonyms');
      const synInfoMap = new Map<string, SynInfo>(synToEnrich.map(s => [s.word.toLowerCase(), s]));
      if (synToEnrich.length > 0) {
        const enrichWordBulk = (api as any)?.enrichWordBulk as undefined | ((payload: any) => Promise<any>);
        console.log('[BulkAdd] enrichWordBulk available:', typeof enrichWordBulk === 'function');
        const enrichedMap = new Map<string, any>();
        const synWords = synToEnrich.map(s => s.word);

        if (typeof enrichWordBulk === 'function') {
          const batches: string[][] = [];
          for (let i = 0; i < synWords.length; i += 3) batches.push(synWords.slice(i, i + 3));
          console.log('[BulkAdd] Enrich batches:', batches.length);
          let bi = 0;
          const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
          const ew = new Array(Math.min(2, batches.length)).fill(0).map(async () => {
            while (bi < batches.length) {
              const bIdx = bi++; const batch = batches[bIdx]; if (!batch) continue;
              try {
                console.log('[BulkAdd] Enriching batch', bIdx, ':', batch);
                const resp = await enrichWordBulk({ requestId: `${rid}__s${bIdx}`, words: batch, contextSentenceEn: '', from: 'en', to: 'vi', dialect: 'US' });
                const items = Array.isArray(resp?.items) ? resp.items : [];
                console.log('[BulkAdd] Batch', bIdx, 'response items:', items.length);
                for (const x of items) {
                  const ww = String(x?.word || '').trim();
                  // Response structure: { word, result: { meaningSuggested, posSuggested, ipa, example } } or { word, error }
                  const resultData = x?.result || x;
                  if (ww && resultData && !x?.error) {
                    enrichedMap.set(ww.toLowerCase(), resultData);
                    console.log('[BulkAdd] Enriched:', ww, '| meaning:', String(resultData?.meaningSuggested || '').slice(0, 30), '| pos:', resultData?.posSuggested);
                  } else if (ww && x?.error) {
                    console.log('[BulkAdd] Enrich error for:', ww, '|', x.error);
                  }
                }
              } catch (err) {
                console.log('[BulkAdd] Enrich batch', bIdx, 'failed:', err);
                synEnrichFail += batch.length;
              }
            }
          });
          await Promise.all(ew);
        } else {
          console.log('[BulkAdd] Using enrichSynonyms fallback');
          try {
            const enriched = await enrichSynonyms(synWords.map((w) => ({ word: w })), { concurrency: 3, contextSentenceEn: '' });
            console.log('[BulkAdd] enrichSynonyms returned:', enriched.length);
            for (const e of enriched) {
              const ew = String(e?.word || '').trim();
              if (ew) enrichedMap.set(ew.toLowerCase(), e);
            }
          } catch (err) {
            console.log('[BulkAdd] enrichSynonyms failed:', err);
            synEnrichFail += synToEnrich.length;
          }
        }
        console.log('[BulkAdd] Total enriched:', enrichedMap.size);

        // STEP 5: Write synonym rows (with fallback if enrich failed)
        console.log('[BulkAdd] STEP 5: Write synonym rows');
        const synRows: any[] = [];
        for (const synInfo of synToEnrich) {
          const sw = synInfo.word;
          const sk = sw.toLowerCase();
          if (existing.has(sk)) {
            console.log('[BulkAdd] Synonym skip (already exists):', sw);
            continue;
          }
          const e = enrichedMap.get(sk);
          let meaning = '', meaningNoteVi = '', pos = '', pronunciation = '', example = '';

          if (e) {
            // Use enriched data
            meaning = String(e?.meaning || e?.meaningSuggested || '').trim();
            meaningNoteVi = String(e?.meaningNoteVi || '').trim();
            pos = normalizePos(String(e?.pos || e?.posSuggested || '').trim()) || '';
            pronunciation = ensureIpaSlashes(String(e?.pronunciation || e?.ipa || ''));
            example = String(e?.example || '').trim();
          }

          // Fallback: use POS from getSynonyms and meaning from base word
          if (!pos && synInfo.pos) {
            pos = synInfo.pos;
            console.log('[BulkAdd] Fallback POS for:', sw, '→', pos);
          }
          if (!meaning && synInfo.baseMeaning) {
            meaning = `(synonym of ${synInfo.baseWord}) ${synInfo.baseMeaning}`;
            console.log('[BulkAdd] Fallback meaning for:', sw, '→', meaning.slice(0, 40));
          }
          if (!meaningNoteVi && synInfo.baseMeaningNoteVi) {
            meaningNoteVi = synInfo.baseMeaningNoteVi;
          }

          if (!meaning || !pos) {
            console.log('[BulkAdd] Synonym skip (missing meaning/pos after fallback):', sw, '| meaning:', !!meaning, '| pos:', !!pos);
            synEnrichFail++;
            continue;
          }
          existing.add(sk);
          synRows.push({ word: sw, meaning, meaningNoteVi, pronunciation, pos, example });
        }
        console.log('[BulkAdd] Synonym rows to write:', synRows.length);
        if (synRows.length > 0) {
          await writeToDeck(synRows);
          addedSynonyms = synRows.length;
          console.log('[BulkAdd] Synonyms written:', addedSynonyms);
        }
      } else {
        console.log('[BulkAdd] No synonyms to enrich');
      }

      // Summary
      const total = addedWords + addedSynonyms;
      console.log('[BulkAdd] === SUMMARY ===');
      console.log('[BulkAdd] addedWords:', addedWords, '| addedSynonyms:', addedSynonyms, '| total:', total);
      console.log('[BulkAdd] skippedMissing:', skippedMissing, '| skippedDup:', skippedDup);
      console.log('[BulkAdd] synFetchFail:', synFetchFail, '| synEnrichFail:', synEnrichFail);

      const parts: string[] = [];
      parts.push(`Added ${total} (${addedWords} words + ${addedSynonyms} synonyms)`);
      if (skippedMissing > 0) parts.push(`${skippedMissing} missing fields`);
      if (skippedDup > 0) parts.push(`${skippedDup} duplicates`);
      if (synFetchFail > 0) parts.push(`${synFetchFail} synonym fetch fail`);
      if (synEnrichFail > 0) parts.push(`${synEnrichFail} synonym enrich fail`);
      if (total === 0 && skippedMissing > 0) parts.push('Tip: run Goi y hang loat first');
      setBulkAddMessage(parts.join(' | '));
      if (total > 0) await openFile(currentFile);
      console.log('[BulkAdd] === END ===');
    } catch (e) {
      console.error('[BulkAdd] EXCEPTION:', e);
      setBulkSuggestError('Error: ' + (e instanceof Error ? e.message : String(e)));
      setBulkAddMessage('');
    } finally {
      setBulkAddLoading(false);
    }
  };

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
          className="p-6 text-center text-slate-500 dark:text-slate-400 h-full flex flex-col items-center justify-center"
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
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
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
            className={`p-3 border rounded-xl cursor-pointer transition flex items-center gap-3 min-w-[180px] ${
              selectedItems.has(item.path)
                ? "bg-violet-100 dark:bg-violet-900/30 border-violet-500 dark:border-violet-400 border-2"
                : "hover:bg-slate-50 dark:hover:bg-slate-700/50 border-slate-200 dark:border-slate-600"
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
              <div className="text-sm font-medium truncate dark:text-slate-200" title={item.name}>
                {item.name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate whitespace-nowrap">{item.type === "folder" ? "Folder" : "CSV File"}</div>
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

    setConfirmBulkDeleteOpen(true);
  }

  async function doBulkDeleteConfirmed() {
    if (selectedItems.size === 0) return;
    
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
        <div className="text-lg font-semibold dark:text-white">Electron API not available</div>
        <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Trang này cần chạy trong cửa sổ Electron (npm run dev), không phải mở
          bằng browser.
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {confirmBulkDeleteOpen && (
        <ConfirmModal
          title="Delete selected items?"
          message={`Delete ${selectedItems.size} selected items?`}
          confirmText="Delete"
          cancelText="Cancel"
          danger
          onCancel={() => setConfirmBulkDeleteOpen(false)}
          onConfirm={async () => {
            setConfirmBulkDeleteOpen(false);
            await doBulkDeleteConfirmed();
          }}
        />
      )}
      <div
        ref={splitContainerRef}
        className="flex h-full bg-gradient-to-br from-slate-50 via-violet-50/30 to-purple-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 flex-col md:flex-row"
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
      <div
        className="w-full md:shrink-0 md:min-w-64 md:max-w-[60%] border-r border-slate-200/60 dark:border-slate-700/60 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm shadow-xl flex flex-col"
        style={{ width: typeof window === 'undefined' ? undefined : `${clampSplitPct(splitPct)}%` }}
      >
        <FolderNavigator
          tree={tree}
          onSelectFile={openFile}
          onCreateFolder={createFolder}
          onCreateFile={createFile}
          onDeleteNode={handleDeleteNode}
          selectedFile={currentFile}
          currentFolder={currentFolder}
          onFolderChange={handleFolderChange}
          onRequestContextMenu={(opts) => setContextMenu({ visible: true, x: opts.x, y: opts.y, item: opts.item || null, isEmpty: !!opts.isEmpty, destFolder: opts.destFolder })}
          selectedItems={selectedItems}
          setSelectedItems={setSelectedItems}
        />
      </div>

      {/* Splitter */}
      <div
        className="hidden md:block w-1.5 cursor-col-resize bg-slate-200/60 dark:bg-slate-700/60 hover:bg-slate-300/80 dark:hover:bg-slate-600/80 active:bg-slate-400/80 dark:active:bg-slate-500/80"
        onMouseDown={startSplitDrag}
        title="Drag to resize"
      />

      {/* Right: Vocab Table */}
      <div className="flex-1 hidden md:flex flex-col min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60 px-6 py-5 shadow-lg">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 bg-clip-text text-transparent">
                Vocabulary Manager
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-2">
                <svg className="w-4 h-4 text-violet-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                Manage your vocabulary files and collections
              </p>
            </div>
          </div>
          
          {/* Add Word Form - Enhanced with better styling */}
          <div className="space-y-4">
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className={addUiMode === 'single' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                onClick={() => setAddUiMode('single')}
              >
                Single
              </button>
              <button
                type="button"
                className={addUiMode === 'bulk' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                onClick={() => setAddUiMode('bulk')}
              >
                Bulk
              </button>
            </div>

            {addUiMode === 'single' && (
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-3">
                <div className="relative flex-1">
                 
                  <input
                    placeholder="Enter word..."
                    className="input-field pl-11 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-700 dark:to-slate-800/50 border-slate-300 dark:border-slate-600 hover:border-violet-400 dark:hover:border-violet-500 focus:border-violet-500 dark:focus:border-violet-400 transition-all"
                    value={word}
                    onChange={(e) => {
                      setWord(e.target.value);
                      setSuggestError('');
                      setSuggestCandidates([]);

                      // New word -> clear example unless user explicitly typed one.
                      isExampleDirtyRef.current = false;
                      lastExampleKeyRef.current = '';
                      setExample('');
                      setMeaningNoteVi('');
                      setExampleError('');

                      // New word -> clear prefetched IPA.
                      lastIpaKeyRef.current = '';
                      ipaValueRef.current = '';
                      ipaPromiseRef.current = null;
                    }}
                  />
                </div>
                <div className="relative flex-1">
                
                  <input
                    placeholder="Enter meaning..."
                    className="input-field pl-11 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-700 dark:to-slate-800/50 border-slate-300 dark:border-slate-600 hover:border-purple-400 dark:hover:border-purple-500 focus:border-purple-500 dark:focus:border-purple-400 transition-all"
                    value={meaning}
                    onChange={(e) => setMeaning(e.target.value)}
                  />
                </div>
                <div className="relative flex-[1.35]">
                  <input
                    placeholder="Giải thích nghĩa (VI)..."
                    className="input-field bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-700 dark:to-slate-800/50 border-slate-300 dark:border-slate-600 hover:border-fuchsia-400 dark:hover:border-fuchsia-500 focus:border-fuchsia-500 dark:focus:border-fuchsia-400 transition-all"
                    value={meaningNoteVi}
                    onChange={(e) => setMeaningNoteVi(e.target.value)}
                  />
                </div>
                <div className="relative w-44">
                
                  <select
                    className="input-field pl-9 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-700 dark:to-slate-800/50 border-slate-300 dark:border-slate-600 hover:border-fuchsia-400 dark:hover:border-fuchsia-500 focus:border-fuchsia-500 dark:focus:border-fuchsia-400 transition-all"
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
                className="btn-secondary px-5 py-3 flex items-center gap-2 whitespace-nowrap shadow-md hover:shadow-lg transition-all"
                onClick={handleSuggest}
                type="button"
                disabled={suggestLoading}
                title="Gợi ý nghĩa và POS (chỉ chạy khi bấm)"
              >
                {suggestLoading ? (
                  <div className="spinner"></div>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                )}
                {suggestLoading ? 'Suggesting…' : 'Gợi ý'}
              </button>

              <button
                className="btn-primary px-7 py-3 flex items-center gap-2 whitespace-nowrap text-base"
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
                      const baseWord = word.trim();
                      const baseKey = baseWord.toLowerCase();
                      let familyToUse: EnrichedWordFamilyMember[] = [];
                      let synonymsToUse: EnrichedWordFamilyMember[] = [];
                      let synonymFamiliesToUse: EnrichedWordFamilyMember[] = [];

                      if (wordFamilyEnabledEffective && baseWord && !/\s/.test(baseWord) && baseWord.length <= 40) {
                        if (wordFamilyFor === baseKey && wordFamilyMembers.length > 0) {
                          familyToUse = wordFamilyMembers;
                        } else {
                          const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                          wordFamilyReqRef.current = rid;
                          setWordFamilyLoading(true);
                          setWordFamilyError('');
                          setWordFamilyMembers([]);
                          setWordFamilySelected(new Set());
                          setWordFamilyFor(baseKey);

                          try {
                            const resp = await getWordFamily(baseWord);
                            const members = Array.isArray(resp?.family) ? resp!.family : [];
                            const enriched = await enrichWordFamilyMembers(members, { concurrency: 2, contextSentenceEn: '' });
                            if (wordFamilyReqRef.current === rid) {
                              setWordFamilyMembers(enriched);
                              setWordFamilySelected(new Set(enriched.map((m) => m.word)));
                              familyToUse = enriched;
                            }
                          } catch {
                            if (wordFamilyReqRef.current === rid) {
                              setWordFamilyError('Failed to fetch word family');
                              setWordFamilyMembers([]);
                              setWordFamilySelected(new Set());
                            }
                          } finally {
                            if (wordFamilyReqRef.current === rid) setWordFamilyLoading(false);
                          }
                        }
                      }

                      if (synonymsEnabled && baseWord && !/\s/.test(baseWord) && baseWord.length <= 40) {
                        if (synonymsFor === baseKey && synonymsMembers.length > 0) {
                          synonymsToUse = synonymsMembers;
                          synonymFamiliesToUse = synonymFamilyMembers;
                        } else {
                          const rid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                          synonymsReqRef.current = rid;
                          setSynonymsLoading(true);
                          setSynonymsError('');
                          setSynonymsMembers([]);
                          setSynonymsSelected(new Set());
                          setSynonymFamilyMembers([]);
                          setSynonymFamilySelected(new Set());
                          setSynonymsFor(baseKey);

                          try {
                            const resp = await getSynonyms(baseWord);
                            const members = Array.isArray(resp?.synonyms) ? resp!.synonyms : [];
                            const enriched = await enrichSynonyms(members, { concurrency: 2, contextSentenceEn: '' });
                            if (synonymsReqRef.current === rid) {
                              setSynonymsMembers(enriched);
                              setSynonymsSelected(new Set(enriched.map((m) => m.word)));
                              synonymsToUse = enriched;

                              if (synonymsIncludeFamiliesEffective) {
                                const fam = await getSynonymFamilies(enriched, { maxSynonyms: 3, contextSentenceEn: '' });
                                const famEnriched = await enrichSynonyms(fam, { concurrency: 2, contextSentenceEn: '' });
                                setSynonymFamilyMembers(famEnriched);
                                setSynonymFamilySelected(new Set(famEnriched.map((m) => m.word)));
                                synonymFamiliesToUse = famEnriched;
                              }
                            }
                          } catch {
                            if (synonymsReqRef.current === rid) {
                              setSynonymsError('Failed to fetch synonyms');
                              setSynonymsMembers([]);
                              setSynonymsSelected(new Set());
                              setSynonymFamilyMembers([]);
                              setSynonymFamilySelected(new Set());
                            }
                          } finally {
                            if (synonymsReqRef.current === rid) setSynonymsLoading(false);
                          }
                        }
                      }

                      const ipa = await getIpaForWord(word.trim());
                      await addWord(currentFile, {
                        word: word.trim(),
                        meaning: meaning.trim(),
                        meaningNoteVi: meaningNoteVi.trim(),
                        pronunciation: ipa,
                        pos: pos.trim(),
                        example: example.trim(),
                      });

                      const added = new Set<string>();
                      added.add(baseKey);

                      if (wordFamilyEnabledEffective && familyToUse.length > 0 && wordFamilySelected.size > 0) {
                        for (const m of familyToUse) {
                          const mw = String(m?.word || '').trim();
                          if (!mw || !wordFamilySelected.has(mw)) continue;
                          const mk = mw.toLowerCase();
                          if (added.has(mk)) continue;
                          const mm = String(m?.meaning || '').trim();
                          const mp = String(m?.pos || '').trim();
                          if (!mm || !mp) continue;
                          await addWord(currentFile, {
                            word: mw,
                            meaning: mm,
                            meaningNoteVi: '',
                            pronunciation: ensureIpaSlashes(String(m?.pronunciation || '')),
                            pos: mp,
                            example: String(m?.example || '').trim()
                          });
                          added.add(mk);
                        }
                      }

                      if (synonymsEnabled && synonymsToUse.length > 0 && synonymsSelected.size > 0) {
                        for (const m of synonymsToUse) {
                          const mw = String(m?.word || '').trim();
                          if (!mw || !synonymsSelected.has(mw)) continue;
                          const mk = mw.toLowerCase();
                          if (added.has(mk)) continue;
                          const mm = String(m?.meaning || '').trim();
                          const mp = String(m?.pos || '').trim();
                          if (!mm || !mp) continue;
                          await addWord(currentFile, {
                            word: mw,
                            meaning: mm,
                            meaningNoteVi: '',
                            pronunciation: ensureIpaSlashes(String(m?.pronunciation || '')),
                            pos: mp,
                            example: String(m?.example || '').trim()
                          });
                          added.add(mk);
                        }
                      }

                      if (synonymsEnabled && synonymsIncludeFamiliesEffective && synonymFamiliesToUse.length > 0 && synonymFamilySelected.size > 0) {
                        for (const m of synonymFamiliesToUse) {
                          const mw = String(m?.word || '').trim();
                          if (!mw || !synonymFamilySelected.has(mw)) continue;
                          const mk = mw.toLowerCase();
                          if (added.has(mk)) continue;
                          const mm = String(m?.meaning || '').trim();
                          const mp = String(m?.pos || '').trim();
                          if (!mm || !mp) continue;
                          await addWord(currentFile, {
                            word: mw,
                            meaning: mm,
                            meaningNoteVi: '',
                            pronunciation: ensureIpaSlashes(String(m?.pronunciation || '')),
                            pos: mp,
                            example: String(m?.example || '').trim()
                          });
                          added.add(mk);
                        }
                      }

                      setWord("");
                      setMeaning("");
                      setMeaningNoteVi("");
                      setPos("");
                      setExample("");
                      setExampleError('');
                      isExampleDirtyRef.current = false;
                      lastExampleKeyRef.current = '';

                      setWordFamilyMembers([]);
                      setWordFamilySelected(new Set());
                      setWordFamilyError('');
                      setWordFamilyLoading(false);
                      setWordFamilyFor('');

                      setSynonymsMembers([]);
                      setSynonymsSelected(new Set());
                      setSynonymFamilyMembers([]);
                      setSynonymFamilySelected(new Set());
                      setSynonymsError('');
                      setSynonymsLoading(false);
                      setSynonymsFor('');

                      await Promise.all([loadTree(), openFile(currentFile)]);
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
                {extraSelectedSaveableCount > 0 ? `Add Word (+${extraSelectedSaveableCount})` : 'Add Word'}
              </button>
            </div>
            )}

            {addUiMode === 'bulk' && (
            <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/70 dark:bg-slate-800/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Bulk add</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Dán nhiều từ (mỗi dòng 1 từ), chọn nhiều dòng, rồi bấm gợi ý song song.</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 text-xs"
                    onClick={prepareBulkList}
                    disabled={bulkSuggestLoading}
                  >
                    Prepare
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 text-xs"
                    onClick={clearBulkPanel}
                    disabled={bulkSuggestLoading}
                    title="Clear bulk list and reset"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 text-xs"
                    onClick={suggestBulkSelected}
                    disabled={bulkSuggestLoading || bulkSelectedCount === 0}
                  >
                    {bulkSuggestLoading ? 'Suggesting…' : 'Gợi ý hàng loạt'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary px-3 py-2 text-xs"
                    onClick={addBulkSelectedToDeck}
                    disabled={!currentFile || bulkSelectedCount === 0 || bulkAddLoading}
                    title={currentFile ? 'Add selected items to current deck' : 'Open a deck first'}
                  >
                    {bulkAddLoading ? 'Adding…' : 'Add Selected'}
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <textarea
                  className="input-field w-full text-sm resize-none"
                  rows={3}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  placeholder={'one word per line\nexample:\naddress\nresolve\nissue'}
                />
              </div>

              {(bulkSuggestError || bulkItems.length > 0) && (
                <div className="mt-3 text-xs">
                  {bulkSuggestError ? <div className="text-red-600 dark:text-red-400">{bulkSuggestError}</div> : null}
                  {bulkAddMessage ? <div className="text-slate-600 dark:text-slate-300">{bulkAddMessage}</div> : null}
                  {bulkItems.length > 0 ? (
                    <div className="text-slate-600 dark:text-slate-300">Selected: {bulkSelectedCount} • Done: {bulkDoneCount}/{bulkSelectedCount}</div>
                  ) : null}
                </div>
              )}

              {bulkItems.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={bulkItems.length > 0 && bulkSelectedCount === bulkItems.length}
                            onChange={(e) => {
                              const checked = e.target.checked
                              setBulkItems((prev) => prev.map((it) => ({ ...it, selected: checked })))
                            }}
                            title="Select all"
                          />
                        </th>
                        <th className="py-2 pr-3">Word</th>
                        <th className="py-2 pr-3">Meaning</th>
                        <th className="py-2 pr-3">POS</th>
                        <th className="py-2 pr-3">IPA</th>
                        <th className="py-2 pr-3">Example</th>
                        <th className="py-2 pr-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-800 dark:text-slate-200">
                      {bulkItems.flatMap((it) => {
                        const rows: React.ReactNode[] = [];
                        rows.push(
                          <tr key={it.word} className="border-t border-slate-200/60 dark:border-slate-700/60">
                            <td className="py-2 pr-2 align-top">
                              <input type="checkbox" checked={it.selected} onChange={(e) => setBulkItem(it.word, { selected: e.target.checked })} />
                            </td>
                            <td className="py-2 pr-3 align-top font-semibold whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span>{it.word}</span>
                                <button
                                  type="button"
                                  className="text-[10px] font-normal text-slate-500 dark:text-slate-400 hover:underline"
                                  onClick={() => toggleBulkSynonyms(it.word)}
                                >
                                  {it.synonymsExpanded ? 'Hide synonyms' : 'Synonyms'}
                                </button>
                              </div>
                            </td>
                            <td className="py-2 pr-3 align-top max-w-[260px]">
                              <input className="input-field !py-1 !text-xs" value={it.meaning} onChange={(e) => setBulkItem(it.word, { meaning: e.target.value })} placeholder="…" />
                            </td>
                            <td className="py-2 pr-3 align-top">
                              <select className="input-field !py-1 !text-xs" value={it.pos} onChange={(e) => setBulkItem(it.word, { pos: e.target.value })}>
                                <option value="">POS…</option>
                                {POS_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pr-3 align-top max-w-[160px]">
                              <input className="input-field !py-1 !text-xs" value={it.pronunciation} onChange={(e) => setBulkItem(it.word, { pronunciation: e.target.value })} placeholder="/…/" />
                            </td>
                            <td className="py-2 pr-3 align-top max-w-[320px]">
                              <input className="input-field !py-1 !text-xs" value={it.example} onChange={(e) => setBulkItem(it.word, { example: e.target.value })} placeholder="…" />
                            </td>
                            <td className="py-2 pr-2 align-top whitespace-nowrap">
                              {it.status === 'loading' ? '…' : it.status}
                              {it.status === 'error' && it.error ? <div className="text-[10px] text-red-600 dark:text-red-400 mt-1">{it.error}</div> : null}
                            </td>
                          </tr>
                        );

                        if (it.synonymsExpanded) {
                          rows.push(
                            <tr key={`${it.word}__syn`} className="border-t border-slate-200/40 dark:border-slate-700/40">
                              <td className="py-2 pr-2" />
                              <td className="py-2 pr-2" colSpan={6}>
                                {it.synonymsLoading ? (
                                  <span className="text-slate-500 dark:text-slate-400">Loading…</span>
                                ) : it.synonymsError ? (
                                  <span className="text-red-600 dark:text-red-400">{it.synonymsError}</span>
                                ) : it.synonyms.length === 0 ? (
                                  <span className="text-slate-500 dark:text-slate-400">No synonyms</span>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {it.synonyms.map((s) => {
                                      const sw = String(s?.word || '').trim();
                                      const selected = (Array.isArray(it.synonymsSelected) ? it.synonymsSelected : [])
                                        .some((x) => String(x || '').trim().toLowerCase() === sw.toLowerCase());
                                      return (
                                        <button
                                          key={`${it.word}__syn__${s.word}`}
                                          type="button"
                                          onClick={() => toggleBulkSynonymSelected(it.word, sw)}
                                          className={
                                            `px-2 py-1 rounded-lg border text-xs transition-colors ` +
                                            (selected
                                              ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                                              : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200')
                                          }
                                          title={selected ? 'Selected' : 'Click to select'}
                                        >
                                          <span className="font-semibold">{s.word}</span>
                                          {s.pos ? <span className="opacity-70"> ({s.pos})</span> : null}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        }

                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )}

            {addUiMode === 'single' && WORD_FAMILY_FEATURE_ENABLED && (wordFamilyLoading || wordFamilyError || wordFamilyMembers.length > 0) && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Word Family</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 select-none">
                      <input
                        type="checkbox"
                        checked={wordFamilyEnabled}
                        onChange={(e) => setWordFamilyEnabled(e.target.checked)}
                      />
                      Auto-add family
                    </label>
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {wordFamilyLoading && 'Finding related forms…'}
                  {!wordFamilyLoading && wordFamilyError && wordFamilyError}
                  {!wordFamilyLoading && !wordFamilyError && wordFamilyMembers.length === 0 && 'Press Gợi ý to fetch word family.'}
                  {!wordFamilyLoading && !wordFamilyError && wordFamilyMembers.length > 0 && (
                    <span>
                      Ready: {wordFamilySaveableCount}/{wordFamilyMembers.length} (selected: {wordFamilySelectedSaveableCount})
                    </span>
                  )}
                </div>

                {wordFamilyMembers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {wordFamilyMembers.map((m) => {
                      const mw = String(m.word || '').trim();
                      const selected = wordFamilySelected.has(mw);
                      const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim();
                      return (
                        <button
                          key={mw}
                          type="button"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setWordFamilySelected((prev) => {
                              const next = new Set(prev);
                              next.add(mw);
                              return next;
                            });
                            setRelatedEditTarget({ group: 'family', word: mw });
                          }}
                          onClick={() => {
                            setWordFamilySelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(mw)) next.delete(mw);
                              else next.add(mw);
                              return next;
                            });
                          }}
                          className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                            selected
                              ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                              : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                          title={m.relation || ''}
                        >
                          <span className="font-semibold">{mw}</span>
                          {m.pos ? <span className="opacity-70"> ({m.pos})</span> : ''}
                          {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                        </button>
                      );
                    })}
                  </div>
                )}

                {relatedEditTarget?.group === 'family' && (() => {
                  const mw = String(relatedEditTarget?.word || '').trim();
                  if (!mw) return null;
                  const m = (Array.isArray(wordFamilyMembers) ? wordFamilyMembers : []).find((x) => String(x?.word || '').trim() === mw);
                  if (!m) return null;
                  return (
                    <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Edit: {mw}{m.relation ? <span className="ml-2 font-normal opacity-70">({m.relation})</span> : null}</div>
                        <button type="button" onClick={() => setRelatedEditTarget(null)} className="text-xs text-slate-600 dark:text-slate-300 hover:underline">Close</button>
                      </div>

                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">POS</label>
                          <select
                            value={String(m.pos || '')}
                            onChange={(e) => {
                              const v = e.target.value;
                              setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pos: v } : x)));
                            }}
                            className="input-field"
                          >
                            <option value="">Select POS...</option>
                            {POS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Pronunciation (IPA)</label>
                          <input
                            type="text"
                            value={String(m.pronunciation || '')}
                            onChange={(e) => {
                              const v = e.target.value;
                              setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, pronunciation: v } : x)));
                            }}
                            className="input-field"
                            placeholder="/…/"
                          />
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Meaning (VI)</label>
                        <textarea
                          value={String(m.meaning || '')}
                          onChange={(e) => {
                            const v = e.target.value;
                            setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, meaning: v } : x)));
                          }}
                          rows={2}
                          className="input-field resize-none"
                          placeholder="Nhập nghĩa..."
                        />
                      </div>

                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Example (EN)</label>
                        <textarea
                          value={String(m.example || '')}
                          onChange={(e) => {
                            const v = e.target.value;
                            setWordFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, example: v } : x)));
                          }}
                          rows={2}
                          className="input-field resize-none"
                          placeholder="Optional example sentence"
                        />
                      </div>

                      <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Tip: right-click a chip to edit.</div>
                    </div>
                  );
                })()}
              </div>
            )}

            {addUiMode === 'single' && (synonymsLoading || synonymsError || synonymsMembers.length > 0 || synonymFamilyMembers.length > 0) && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Synonyms</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 select-none">
                      <input
                        type="checkbox"
                        checked={synonymsEnabled}
                        onChange={(e) => setSynonymsEnabled(e.target.checked)}
                      />
                      Auto-add synonyms
                    </label>

                    {SYNONYM_FAMILIES_FEATURE_ENABLED && (
                      <label className={`flex items-center gap-2 text-xs select-none ${synonymsEnabled ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-600'}`}>
                        <input
                          type="checkbox"
                          checked={synonymsIncludeFamilies}
                          disabled={!synonymsEnabled}
                          onChange={(e) => setSynonymsIncludeFamilies(e.target.checked)}
                        />
                        Include synonym families
                      </label>
                    )}
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {synonymsLoading && 'Finding synonyms…'}
                  {!synonymsLoading && synonymsError && synonymsError}
                  {!synonymsLoading && !synonymsError && synonymsMembers.length === 0 && synonymFamilyMembers.length === 0 && 'Press Gợi ý to fetch synonyms.'}
                  {!synonymsLoading && !synonymsError && (synonymsMembers.length > 0 || synonymFamilyMembers.length > 0) && (
                    <span>
                      Synonyms ready: {synonymsSaveableCount}/{synonymsMembers.length} (selected: {synonymsSelectedSaveableCount})
                      {SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamiliesEffective ? (
                        <span> • Family ready: {synonymFamilySaveableCount}/{synonymFamilyMembers.length} (selected: {synonymFamilySelectedSaveableCount})</span>
                      ) : null}
                    </span>
                  )}
                </div>

                {synonymsMembers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {synonymsMembers.map((m) => {
                      const mw = String(m.word || '').trim();
                      const selected = synonymsSelected.has(mw);
                      const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim();
                      return (
                        <button
                          key={`syn_${mw}`}
                          type="button"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSynonymsSelected((prev) => {
                              const next = new Set(prev);
                              next.add(mw);
                              return next;
                            });
                            setRelatedEditTarget({ group: 'synonym', word: mw });
                          }}
                          onClick={() => {
                            setSynonymsSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(mw)) next.delete(mw);
                              else next.add(mw);
                              return next;
                            });
                          }}
                          className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                            selected
                              ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                              : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                          title={m.relation || ''}
                        >
                          <span className="font-semibold">{mw}</span>
                          {m.pos ? <span className="opacity-70"> ({m.pos})</span> : ''}
                          {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                        </button>
                      );
                    })}
                  </div>
                )}

                {SYNONYM_FAMILIES_FEATURE_ENABLED && synonymsIncludeFamiliesEffective && synonymFamilyMembers.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Synonym families</div>
                    <div className="flex flex-wrap gap-2">
                      {synonymFamilyMembers.map((m) => {
                        const mw = String(m.word || '').trim();
                        const selected = synonymFamilySelected.has(mw);
                        const ready = !!String(m.meaning || '').trim() && !!String(m.pos || '').trim();
                        return (
                          <button
                            key={`synfam_${mw}`}
                            type="button"
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSynonymFamilySelected((prev) => {
                                const next = new Set(prev);
                                next.add(mw);
                                return next;
                              });
                              setRelatedEditTarget({ group: 'synonymFamily', word: mw });
                            }}
                            onClick={() => {
                              setSynonymFamilySelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(mw)) next.delete(mw);
                                else next.add(mw);
                                return next;
                              });
                            }}
                            className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                              selected
                                ? 'border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200'
                                : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                            }`}
                            title={m.relation || ''}
                          >
                            <span className="font-semibold">{mw}</span>
                            {m.pos ? <span className="opacity-70"> ({m.pos})</span> : ''}
                            {!ready ? <span className="ml-1 opacity-60">…</span> : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(relatedEditTarget?.group === 'synonym' || relatedEditTarget?.group === 'synonymFamily') && (() => {
                  const mw = String(relatedEditTarget?.word || '').trim();
                  if (!mw) return null;

                  const combined = [...(Array.isArray(synonymsMembers) ? synonymsMembers : []), ...(Array.isArray(synonymFamilyMembers) ? synonymFamilyMembers : [])];
                  const m = combined.find((x) => String(x?.word || '').trim() === mw);
                  if (!m) return null;

                  const updateBoth = (patch: Partial<EnrichedWordFamilyMember>) => {
                    setSynonymsMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, ...patch } : x)));
                    setSynonymFamilyMembers((prev) => prev.map((x) => (String(x.word || '').trim() === mw ? { ...x, ...patch } : x)));
                  };

                  return (
                    <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Edit: {mw}{m.relation ? <span className="ml-2 font-normal opacity-70">({m.relation})</span> : null}</div>
                        <button type="button" onClick={() => setRelatedEditTarget(null)} className="text-xs text-slate-600 dark:text-slate-300 hover:underline">Close</button>
                      </div>

                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">POS</label>
                          <select value={String(m.pos || '')} onChange={(e) => updateBoth({ pos: e.target.value })} className="input-field">
                            <option value="">Select POS...</option>
                            {POS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Pronunciation (IPA)</label>
                          <input type="text" value={String(m.pronunciation || '')} onChange={(e) => updateBoth({ pronunciation: e.target.value })} className="input-field" placeholder="/…/" />
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Meaning (VI)</label>
                        <textarea value={String(m.meaning || '')} onChange={(e) => updateBoth({ meaning: e.target.value })} rows={2} className="input-field resize-none" placeholder="Nhập nghĩa..." />
                      </div>

                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Example (EN)</label>
                        <textarea value={String(m.example || '')} onChange={(e) => updateBoth({ example: e.target.value })} rows={2} className="input-field resize-none" placeholder="Optional example sentence" />
                      </div>

                      <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Tip: right-click a chip to edit.</div>
                    </div>
                  );
                })()}
              </div>
            )}

          {addUiMode === 'single' && (
          <>
          {/* Example (optional) - Enhanced */}
          <div className="bg-gradient-to-br from-violet-50/50 to-purple-50/50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-xl p-4 border border-violet-100/50 dark:border-violet-800/50">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Example sentence (optional)
              {exampleLoading && (
                <span className="inline-flex items-center gap-1.5 ml-2 px-2 py-0.5 bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 text-xs rounded-full font-medium">
                  <div className="spinner !w-3 !h-3"></div>
                  Generating…
                </span>
              )}
            </label>
            <textarea
              className="input-field w-full bg-white/80 dark:bg-slate-700/80 backdrop-blur-sm"
              rows={2}
              value={example}
              onChange={(e) => {
                isExampleDirtyRef.current = true;
                setExample(e.target.value);
              }}
              placeholder="Optional: a memorable English sentence using the word"
            />
            {exampleError && (
              <div className="mt-2 flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {exampleError}
              </div>
            )}
          </div>

          {(suggestError || suggestCandidates.length > 0) && (
            <div className="bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-4 border border-amber-100/50 dark:border-amber-800/50">
              {suggestError && (
                <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 mb-3">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {suggestError}
                </div>
              )}

              {suggestCandidates.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                    <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Other suggestions
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestCandidates.slice(0, 8).map((c, idx) => (
                      <button
                        key={`${c.vi}_${idx}`}
                        type="button"
                        onClick={() => {
                          setMeaning(c.vi);
                          if (!pos.trim()) {
                            const normalized = normalizePos(c.pos);
                            if (normalized) setPos(normalized);
                          }

                          // Auto-generate example after user picks a suggested meaning.
                          if (!isExampleDirtyRef.current) {
                            setExample('');
                            setExampleError('');
                            lastExampleKeyRef.current = '';
                            void maybeSuggestExample(c.vi, c.pos);
                          }
                        }}
                        className="px-4 py-2 rounded-xl border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 hover:border-amber-300 dark:hover:border-amber-600 hover:shadow-md transition-all duration-200 font-medium"
                        title={(c.back && c.back.length > 0) ? c.back.join(', ') : ''}
                      >
                        <span className="font-semibold text-amber-700 dark:text-amber-400">{c.vi}</span>
                        {c.pos && <span className="text-slate-500 dark:text-slate-400 ml-1.5">({c.pos})</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          </>
          )}
          
          {errorMessage && (
            <div className="alert alert-error animate-slide-down">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}

          {currentFile && (
            <div className="relative overflow-hidden rounded-xl border border-violet-200 dark:border-violet-700 bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 dark:from-violet-900/30 dark:via-purple-900/30 dark:to-fuchsia-900/30 p-4 shadow-soft animate-slide-down">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-violet-400/10 to-purple-400/10 rounded-full -mr-16 -mt-16"></div>
              <div className="relative flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-0.5">Current File</p>
                  <p className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-2" title={currentFile}>
                    {currentFile.split(/[/\\]/).pop()}
                    <span className="inline-flex items-center px-2 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 text-xs rounded-full font-medium">
                      Active
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}
          {!currentFile && (
            <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 p-6 text-center animate-fade-in">
              <div className="inline-block p-3 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 rounded-xl mb-3">
                <svg className="w-8 h-8 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No file selected</p>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Select a CSV file from the left panel to view and edit</p>
            </div>
          )}
        </div>

        <div className="p-6 bg-gradient-to-br from-slate-50/30 dark:from-slate-800/30 to-white dark:to-slate-900">
          {currentFile ? (
            <div className="animate-fade-in">
              <VocabTable
                rows={rows}
                onDelete={handleRowDelete}
                onEdit={handleRowEdit}
                onSpeak={speakWord}
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
            const ipa = await getIpaForWord(word.trim());
            await addWord(filePath, {
              word: word.trim(),
              meaning: meaning.trim(),
              meaningEn: meaning.trim(),
              meaningVi: meaningNoteVi.trim(),
              pronunciation: ipa,
              pos: pos.trim(),
              example: example.trim(),
            });

            setShowChoose(false);
            setWord("");
            setMeaning("");
            setMeaningNoteVi("");
            setPos("");
            setExample("");
            setExampleError('');
            isExampleDirtyRef.current = false;
            lastExampleKeyRef.current = '';

            await Promise.all([
              loadTree(),
              filePath === currentFile ? openFile(filePath) : Promise.resolve(),
            ]);
          }}
        />
      )}

      {showPdfChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg w-96 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold dark:text-white">Choose PDF Deck</div>
              <button className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300" onClick={() => setShowPdfChooser(false)}>Close</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {pdfList.filter((p:any) => !p.trashed).length === 0 && <div className="text-sm text-slate-500 dark:text-slate-400">No PDFs found</div>}
              {pdfList.filter((p:any) => !p.trashed).map((p:any) => (
                <div key={p.pdfId} className="flex items-center justify-between p-2 border-b border-slate-200 dark:border-slate-700">
                  <div className="truncate mr-2">
                    <div className="text-sm font-medium dark:text-slate-200">{p.baseName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{p.deckCsvPath ? p.deckCsvPath.split(/[/\\]/).pop() : 'No deck'}</div>
                  </div>
                  <div className="flex-shrink-0 space-x-2">
                    <button
                      className="px-2 py-1 bg-violet-500 hover:bg-violet-600 text-white text-xs rounded-lg transition-colors"
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
                      className="px-2 py-1 bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300 text-xs rounded-lg hover:bg-slate-300 dark:hover:bg-slate-500 transition-colors"
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
          className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden"
          onMouseLeave={() => clearContext()}
        >
          <div className="py-1">
            {selectedItems.size > 1 && (
              <>
                <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 font-bold bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                  {selectedItems.size} items selected
                </div>
                <button className="w-full px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/30 text-left text-red-600 dark:text-red-400 flex items-center gap-2" onClick={() => { doBulkDelete(); clearContext(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete All
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left dark:text-slate-300 flex items-center gap-2" onClick={() => { doBulkCopy(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy All
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left dark:text-slate-300 flex items-center gap-2" onClick={() => { doBulkCut(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                  </svg>
                  Cut All
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-left text-violet-600 dark:text-violet-400 font-semibold flex items-center gap-2 border-t border-slate-200 dark:border-slate-700" onClick={() => { doStudySelected(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Study Selected
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left text-xs text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700" onClick={() => { setSelectedItems(new Set()); clearContext(); }}>
                  Clear Selection
                </button>
              </>
            )}

            {selectedItems.size <= 1 && !contextMenu.isEmpty && contextMenu.item && (
              <>
                <button className="w-full px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/30 text-left text-red-600 dark:text-red-400 flex items-center gap-2" onClick={() => { handleDeleteNode(contextMenu.item!.path, contextMenu.item!.type); clearContext(); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left dark:text-slate-300 flex items-center gap-2" onClick={() => { doCopyItem(contextMenu.item!); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left dark:text-slate-300 flex items-center gap-2" onClick={() => { doCutItem(contextMenu.item!); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                  </svg>
                  Cut
                </button>
                <button className="w-full px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left dark:text-slate-300 flex items-center gap-2" onClick={() => { doRename(contextMenu.item!); }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Rename
                </button>
              </>
            )}

            {contextMenu.isEmpty && (
              <>
                <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                  Paste to: {contextMenu.destFolder || '<root>'}
                </div>
                <button className={`w-full px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left dark:text-slate-300 flex items-center gap-2 ${!clipboard ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (clipboard) doPasteTo(contextMenu.destFolder||''); }}>
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
