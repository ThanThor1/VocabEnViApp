import React, { useEffect, useRef, useState, useCallback } from 'react';
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import TranslateTextModal from '../TranslateTextModal/TranslateTextModal'
import { PendingWordsSidebar, PendingWord } from '../PendingWordsSidebar'
import { normalizePos } from '../posOptions/posOptions'
import { useBackgroundTasks } from '../../contexts/BackgroundTasksContext'

interface Rect {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

interface Highlight {
  id: string;
  pageNumber: number; // 1-based
  text: string;
  rects: Rect[];
  wordKey: string;
  meaning?: string;
  pronunciation?: string;
}

interface PdfViewerProps {
  pdfId: string;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ pdfId }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewerSrc = `${import.meta.env.BASE_URL}pdfjs/web/viewer.html`;

  // Background tasks for translations that persist across navigation
  const { addTranslationTask, getTasksForPdf, removeTask, tasks: allBackgroundTasks } = useBackgroundTasks();

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [deckCsvPath, setDeckCsvPath] = useState<string>('');
  const [wordMap, setWordMap] = useState<Map<string, { meaning?: string; pronunciation?: string }>>(new Map());
  const [wordOnlyMap, setWordOnlyMap] = useState<Map<string, { meaning?: string; pronunciation?: string }>>(new Map());

  const sanitize = (s?: string) => {
    if (!s) return '';
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  };

  // Pending words for sidebar
  const [pendingWords, setPendingWords] = useState<PendingWord[]>([]);
  
  // Track API request IDs to cancel when needed
  const pendingApiRequestsRef = useRef<Map<string, string>>(new Map());

  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [selectedPassage, setSelectedPassage] = useState<string>('');

  const [targetPage, setTargetPage] = useState('');

  const [viewerReady, setViewerReady] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const addQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [pendingAddCount, setPendingAddCount] = useState(0);
  const [lastAddError, setLastAddError] = useState<string>('');

  // Refs to avoid stale closures inside queued jobs.
  const highlightsRef = useRef<Highlight[]>([]);
  const wordMapRef = useRef<Map<string, { meaning?: string; pronunciation?: string }>>(new Map());
  const wordOnlyMapRef = useRef<Map<string, { meaning?: string; pronunciation?: string }>>(new Map());

  useEffect(() => {
    return () => {};
  }, [pdfId]);

  useEffect(() => {
    highlightsRef.current = Array.isArray(highlights) ? highlights : [];
  }, [highlights]);

  useEffect(() => {
    wordMapRef.current = wordMap;
  }, [wordMap]);

  useEffect(() => {
    wordOnlyMapRef.current = wordOnlyMap;
  }, [wordOnlyMap]);

  // Restore pending words from background tasks when returning to PDF view
  useEffect(() => {
    const tasksForThisPdf = getTasksForPdf(pdfId);
    
    if (tasksForThisPdf.length > 0) {
      setPendingWords(prev => {
        const existingIds = new Set(prev.map(w => w.id));
        const restoredWords: PendingWord[] = [];
        
        for (const task of tasksForThisPdf) {
          // Skip if already in pending words
          if (existingIds.has(task.id)) continue;
          
          // Restore this task as a pending word
          const pendingWord: PendingWord = {
            id: task.id,
            text: task.word,
            pageNumber: task.pageNumber,
            rects: task.rects || [],
            contextSentenceEn: task.contextSentenceEn,
            word: task.word,
            meaning: task.meaning || '',
            pronunciation: task.pronunciation || '',
            pos: task.pos || '',
            example: task.example || '',
            contextVi: task.contextVi || '',
            candidates: task.candidates || [],
            isApiLoading: task.status === 'pending' || task.status === 'running',
            isApiComplete: task.status === 'completed',
            apiError: task.status === 'error' ? (task.error || 'Lỗi') : undefined,
          };
          restoredWords.push(pendingWord);
        }
        
        if (restoredWords.length === 0) return prev;
        return [...prev, ...restoredWords];
      });
    }
  }, [pdfId]); // Only run when pdfId changes (component mount/PDF switch)

  // Sync background task progress/results to pending words
  useEffect(() => {
    const tasksForThisPdf = getTasksForPdf(pdfId);
    
    for (const task of tasksForThisPdf) {
      // Update the corresponding pending word if it exists
      setPendingWords(prev => {
        const existingWord = prev.find(w => w.id === task.id);
        if (!existingWord) return prev;
        
        // Only update if there's new data
        if (task.status === 'completed' && !existingWord.isApiComplete) {
          return prev.map(w => w.id === task.id ? {
            ...w,
            meaning: task.meaning || w.meaning,
            pronunciation: task.pronunciation || w.pronunciation,
            pos: task.pos || w.pos,
            example: task.example || w.example,
            contextVi: task.contextVi || w.contextVi,
            candidates: task.candidates || w.candidates,
            isApiLoading: false,
            isApiComplete: true,
          } : w);
        } else if (task.status === 'error' && existingWord.isApiLoading) {
          return prev.map(w => w.id === task.id ? {
            ...w,
            isApiLoading: false,
            isApiComplete: false,
            apiError: task.error || 'Lỗi không xác định',
          } : w);
        } else if ((task.status === 'running' || task.status === 'pending') && !existingWord.isApiLoading && !existingWord.isApiComplete) {
          // Task is still running
          return prev.map(w => w.id === task.id ? {
            ...w,
            isApiLoading: true,
          } : w);
        }
        return prev;
      });
    }
  }, [allBackgroundTasks, pdfId, getTasksForPdf]);

  // Load PDF data and initialize
  useEffect(() => {
    let cancelled = false;

    const initializePdf = async () => {
      try {
        

        const pdfData = await window.api.pdfGet(pdfId);
        

        const loadedHighlights = Array.isArray(pdfData?.highlights) ? (pdfData.highlights as Highlight[]) : [];
        

        if (!cancelled) {
          setHighlights(loadedHighlights);
          setDeckCsvPath(pdfData?.deckCsvPath || '');
        }

        
        const csvPath = pdfData?.deckCsvPath || '';
        if (csvPath) {
          const csvRows = await window.api.readCsv(csvPath);

          const newWordMap = new Map<string, { meaning?: string; pronunciation?: string }>();
          const newWordOnlyMap = new Map<string, { meaning?: string; pronunciation?: string }>();
          (Array.isArray(csvRows) ? csvRows : []).forEach((row: any) => {
            const wordKey = `${row?.word || ''}_${row?.meaning || ''}`.toLowerCase();
            newWordMap.set(wordKey, {
              meaning: row?.meaning || '',
              pronunciation: row?.pronunciation || ''
            });
            const wRaw = (row?.word || '');
            const w = sanitize(wRaw);
            if (w) {
              if (!newWordOnlyMap.has(w)) newWordOnlyMap.set(w, { meaning: row?.meaning || '', pronunciation: row?.pronunciation || '' });
            }
          });

          if (!cancelled) setWordMap(newWordMap);
          if (!cancelled) setWordOnlyMap(newWordOnlyMap);
        } else {
          if (!cancelled) setWordMap(new Map());
        }

        const bytes = await window.api.pdfGetSourceBytes(pdfId);
        const bytesLen =
          bytes && typeof bytes.length === 'number'
            ? bytes.length
            : bytes && bytes.byteLength
              ? bytes.byteLength
              : undefined;

        if (!cancelled) setPdfBytes(bytes);
      } catch (error) {
      }
    };

    initializePdf();

    return () => {
      cancelled = true;
    };
  }, [pdfId]);

  // Helper function to enrich highlights with meanings from wordMap
  const enrichHighlights = (highlightsList: Highlight[]) => {
    const safeHighlights = Array.isArray(highlightsList) ? highlightsList : [];
    const result: Highlight[] = [];
    for (const h of safeHighlights) {
      try {
        let meaning: string | undefined = undefined;
        let pronunciation: string | undefined = undefined;

        if (h.wordKey) {
          const wm = wordMap.get(h.wordKey.toLowerCase());
          if (wm && wm.meaning) {
            meaning = wm.meaning;
            pronunciation = wm.pronunciation;
          }
        }

        if (!meaning) {
          const textKey = sanitize(h.text || '');
          if (textKey) {
            const wm2 = wordOnlyMap.get(textKey);
            if (wm2 && wm2.meaning) {
              meaning = wm2.meaning;
              pronunciation = wm2.pronunciation;
            }
          }
        }

        // Only include highlights that are present in the deck (have a meaning).
        if (meaning) {
          result.push({ ...h, meaning, pronunciation });
        }
      } catch (e) {
        // on error, skip this highlight to avoid stale highlights
      }
    }
    return result;
  };

  // Helper function to send highlights to iframe
  const sendHighlightsToIframe = () => {
    const cw = iframeRef.current?.contentWindow;
    if (!cw) return;

    const enriched = enrichHighlights(highlights);

    cw.postMessage(
      {
        type: 'PDF_SET_HIGHLIGHTS',
        highlights: enriched
      },
      '*'
    );
  };

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) return;

      const type = event.data?.type;

      if (type === 'PDF_VIEWER_READY') {
        setViewerReady(true);
        return;
      }

      // Gửi lại highlights sau khi page đã render xong
      if (type === 'PDF_PAGE_RENDERED') {
        sendHighlightsToIframe();
        return;
      }

      if (type === 'PDF_SELECTION') {
        const rawText = String(event.data?.text || '').trim();
        const wordCount = rawText ? rawText.split(/\s+/g).filter(Boolean).length : 0;

        // If selection is longer than 5 words, translate passage only (do not add vocab).
        if (wordCount > 5) {
          setSelectedPassage(rawText);
          setShowTranslateModal(true);
          return;
        }

        // Add to pending words list (sidebar) and start API fetch
        const wordId = `pending_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const contextSentence = typeof event.data?.contextSentenceEn === 'string' ? event.data.contextSentenceEn : '';
        const pageNum = event.data.pageNumber;
        const rects = Array.isArray(event.data?.rects) ? event.data.rects : [];
        
        const newPendingWord: PendingWord = {
          id: wordId,
          text: rawText,
          pageNumber: pageNum,
          rects: rects,
          contextSentenceEn: contextSentence,
          word: rawText,
          meaning: '',
          pronunciation: '',
          pos: '',
          example: '',
          contextVi: '',
          candidates: [],
          isApiLoading: true,
          isApiComplete: false
        };
        setPendingWords((prev) => [...prev, newPendingWord]);
        
        // Use background task for translation (persists across navigation)
        addTranslationTask({
          id: wordId,
          word: rawText,
          contextSentenceEn: contextSentence,
          pdfId: pdfId,
          deckCsvPath: deckCsvPath,
          pageNumber: pageNum,
          rects: rects,
        });
        
        // Also start fetching API data locally for immediate feedback
        fetchWordData(wordId, rawText, contextSentence);
      }
      // Persist current page sent from iframe (debounced if frequent)
      if (type === 'PDF_CURRENT_PAGE') {
        try {
          const p = parseInt(event.data?.pageNumber, 10);
          const id = event.data?.pdfId || pdfId;
          if (!isNaN(p) && id) {
            try { localStorage.setItem('pdf_last_page_' + id, String(p)); } catch (e) {}
          }
        } catch (e) {}
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [highlights, wordMap, pendingWords, showTranslateModal]);

  // Listen for deck updates from main process and reload CSV when changed
  useEffect(() => {
    if (!window.api || !window.api.onDeckUpdated) return;
    const handler = async (data: any) => {
      try {
        if (!data) return;
        // If this update affects current pdf (by pdfId or deckCsvPath), reload CSV and update maps
        if (data.pdfId === pdfId || (data.deckCsvPath && data.deckCsvPath === deckCsvPath)) {
          const csvPath = data.deckCsvPath || deckCsvPath;
          if (!csvPath) return;
          try {
            const csvRows = await window.api.readCsv(csvPath);
            const newWordMap = new Map<string, { meaning?: string; pronunciation?: string }>();
            const newWordOnlyMap = new Map<string, { meaning?: string; pronunciation?: string }>();
            (Array.isArray(csvRows) ? csvRows : []).forEach((row: any) => {
              const wordKey = `${row?.word || ''}_${row?.meaning || ''}`.toLowerCase();
              newWordMap.set(wordKey, {
                meaning: row?.meaning || '',
                pronunciation: row?.pronunciation || ''
              });
              const wRaw = (row?.word || '');
              const w = sanitize(wRaw);
              if (w) {
                if (!newWordOnlyMap.has(w)) newWordOnlyMap.set(w, { meaning: row?.meaning || '', pronunciation: row?.pronunciation || '' });
              }
            });
            setWordMap(newWordMap);
            setWordOnlyMap(newWordOnlyMap);
            // re-send highlights so tooltips update
            sendHighlightsToIframe();
          } catch (e) {
          }
        }
      } catch (e) {}
    };

    window.api.onDeckUpdated(handler);
    return () => {
      try { if (window.api && window.api.offDeckUpdated) window.api.offDeckUpdated(handler); } catch (e) {}
    };
  }, [pdfId, deckCsvPath]);

  // Gửi PDF bytes sang iframe khi có bytes + iframe ready
  useEffect(() => {
    if (!viewerReady) return;
    if (!pdfBytes) return;

    const cw = iframeRef.current?.contentWindow;
    if (!cw) return;

    cw.postMessage(
      {
        type: 'PDF_OPEN_BYTES',
        bytes: pdfBytes,
        pdfId: pdfId
      },
      '*'
    );
  }, [viewerReady, pdfBytes]);

  // Send highlights to iframe when they change
  useEffect(() => {
    if (!viewerReady) return;
    sendHighlightsToIframe();
  }, [viewerReady, highlights, wordMap]);

  const enqueueBackgroundAdd = (job: () => Promise<void>) => {
    addQueueRef.current = addQueueRef.current
      .then(job)
      .catch(() => {
        // Keep queue alive even if a job fails.
      });
  };

  // Fetch IPA and meaning data for a pending word
  const fetchWordData = useCallback(async (wordId: string, word: string, contextSentenceEn: string) => {
    const cleanWord = word.trim();
    const cleanContext = (contextSentenceEn || '').trim();
    
    if (!cleanWord) return;
    
    const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    pendingApiRequestsRef.current.set(wordId, requestId);
    
    const ensureIpaSlashes = (val: string) => {
      const v = (val || '').trim().replace(/"/g, '');
      if (!v) return '';
      const core = v.replace(/^\/+|\/+$/g, '');
      return `/${core}/`;
    };

    try {
      const results = await Promise.allSettled([
        // 1. IPA
        (async () => {
          const suggestIpa = (window as any)?.api?.suggestIpa;
          if (suggestIpa) {
            const out = await suggestIpa({ word: cleanWord, dialect: 'US' });
            if (String(out || '').trim()) return { type: 'ipa', value: ensureIpaSlashes(String(out || '')) };
          }
          const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data) && data[0]?.phonetics?.length > 0) {
              const ph = data[0].phonetics.find((p: any) => p.text);
              if (ph?.text) return { type: 'ipa', value: ensureIpaSlashes(ph.text) };
            }
          }
          return { type: 'ipa', value: '' };
        })(),

        // 2. Auto meaning
        (async () => {
          if (!(window as any)?.api?.autoMeaning) return { type: 'meaning', value: null };

          const resp = await (window as any).api.autoMeaning({
            requestId,
            word: cleanWord,
            contextSentenceEn: cleanContext,
            from: 'en',
            to: 'vi'
          });

          if (!resp || resp.requestId !== requestId) return { type: 'meaning', value: null };
          return { type: 'meaning', value: resp };
        })()
      ]);

      // Check if this request is still valid
      if (pendingApiRequestsRef.current.get(wordId) !== requestId) return;

      let updates: Partial<PendingWord> = {
        isApiLoading: false,
        isApiComplete: true
      };

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const data = result.value as any;

          if (data.type === 'ipa' && data.value) {
            updates.pronunciation = data.value;
          }

          if (data.type === 'meaning' && data.value) {
            const resp = data.value;
            const suggested = (resp.meaningSuggested || '').trim();
            if (suggested) {
              updates.meaning = suggested;
            }
            updates.candidates = Array.isArray(resp.candidates) ? resp.candidates : [];
            updates.contextVi = (resp.contextSentenceVi || '').trim();

            // Extract POS from first candidate
            const firstWithPos = (Array.isArray(resp.candidates) ? resp.candidates : []).find((c: any) => c && c.pos);
            const normalized = normalizePos(firstWithPos?.pos);
            if (normalized) updates.pos = normalized;
            
            // Fetch example sentence if meaning is available
            if (suggested && (window as any)?.api?.suggestExampleSentence) {
              try {
                const exampleOut = await (window as any).api.suggestExampleSentence({
                  word: cleanWord,
                  meaningVi: suggested,
                  pos: normalized || '',
                  contextSentenceEn: cleanContext
                });
                if (String(exampleOut || '').trim()) {
                  updates.example = String(exampleOut || '').trim();
                }
              } catch (e) {
                // Silent fail
              }
            }
          }
        }
      }

      setPendingWords((prev) =>
        prev.map((w) => (w.id === wordId ? { ...w, ...updates } : w))
      );
    } catch (e) {
      if (pendingApiRequestsRef.current.get(wordId) === requestId) {
        setPendingWords((prev) =>
          prev.map((w) =>
            w.id === wordId
              ? { ...w, isApiLoading: false, isApiComplete: false, apiError: 'Lỗi khi tải dữ liệu' }
              : w
          )
        );
      }
    }
  }, []);

  // Handle saving a word from sidebar
  const handleSaveWord = (
    wordId: string,
    word: string,
    meaning: string,
    pronunciation: string,
    pos: string,
    example: string
  ) => {
    if (!deckCsvPath) return;

    // Find the pending word to get selection data
    const pendingWord = pendingWords.find((w) => w.id === wordId);
    if (!pendingWord) return;

    // Remove from pending words immediately
    setPendingWords((prev) => prev.filter((w) => w.id !== wordId));
    pendingApiRequestsRef.current.delete(wordId);
    // Also remove from background tasks
    removeTask(wordId);
    
    setLastAddError('');
    setPendingAddCount((c) => c + 1);

    const selectionSnapshot = {
      text: pendingWord.text,
      pageNumber: pendingWord.pageNumber,
      rects: pendingWord.rects
    };

    enqueueBackgroundAdd(async () => {
      try {
        await window.api.addWord(deckCsvPath, {
          word,
          meaning,
          pronunciation,
          pos,
          example
        });

        if (selectionSnapshot) {
          const wordKey = `${word}_${meaning}`.toLowerCase();
          const newHighlight: Highlight = {
            id: `${pdfId}_${selectionSnapshot.pageNumber}_${Date.now()}`,
            pageNumber: selectionSnapshot.pageNumber,
            text: selectionSnapshot.text,
            rects: Array.isArray(selectionSnapshot.rects) ? selectionSnapshot.rects : [],
            wordKey,
            meaning,
            pronunciation
          };

          const currentHighlights = Array.isArray(highlightsRef.current) ? highlightsRef.current : [];
          const updatedHighlights = [...currentHighlights, newHighlight];

          await window.api.pdfWriteHighlights(pdfId, updatedHighlights);
          highlightsRef.current = updatedHighlights;
          setHighlights(updatedHighlights);

          const newWordMap = new Map(wordMapRef.current);
          newWordMap.set(wordKey, { meaning, pronunciation });
          wordMapRef.current = newWordMap;
          setWordMap(newWordMap);

          try {
            const w = sanitize(word);
            if (w) {
              const newWordOnly = new Map(wordOnlyMapRef.current);
              if (!newWordOnly.has(w)) newWordOnly.set(w, { meaning, pronunciation });
              wordOnlyMapRef.current = newWordOnly;
              setWordOnlyMap(newWordOnly);
            }
          } catch (e) {}
        }

        // Non-blocking post-processing.
        if (window.api.enhanceWordInBackground) {
          window.api.enhanceWordInBackground(deckCsvPath, word, meaning, pronunciation, pos, example).catch(() => {
            // Silent fail - word is already saved.
          });
        }
      } catch (e) {
        setLastAddError('Thêm từ thất bại (vẫn có thể thử lại).');
      } finally {
        setPendingAddCount((c) => Math.max(0, c - 1));
      }
    });
  };

  const handleSaveAllCompleted = () => {
    if (!deckCsvPath) return;

    const snapshot = (Array.isArray(pendingWords) ? pendingWords : [])
      .filter((w) => w && w.isApiComplete && !w.isApiLoading && !w.apiError)
      .map((w) => ({
        id: w.id,
        word: String(w.word || w.text || '').trim(),
        meaning: String(w.meaning || '').trim(),
        pronunciation: String(w.pronunciation || '').trim(),
        pos: String(w.pos || '').trim(),
        example: String(w.example || '').trim()
      }));

    const valid = snapshot.filter((x) => x.word && x.meaning && x.pos);
    const skipped = snapshot.length - valid.length;

    if (valid.length === 0) {
      setLastAddError(snapshot.length > 0 ? 'Không có từ nào đủ dữ liệu để lưu (cần nghĩa + loại từ).' : 'Chưa có từ nào dịch xong để lưu.');
      return;
    }

    if (skipped > 0) {
      setLastAddError(`Bỏ qua ${skipped} từ thiếu dữ liệu (cần nghĩa + loại từ).`);
    } else {
      setLastAddError('');
    }

    // Use the existing save path (serialized queue + highlight write + background task cleanup).
    for (const item of valid) {
      handleSaveWord(item.id, item.word, item.meaning, item.pronunciation, item.pos, item.example);
    }
  };

  // Handle removing a pending word from sidebar
  const handleRemovePendingWord = (wordId: string) => {
    setPendingWords((prev) => prev.filter((w) => w.id !== wordId));
    // Cancel any pending API request
    const requestId = pendingApiRequestsRef.current.get(wordId);
    if (requestId && (window as any)?.api?.autoMeaningCancel) {
      (window as any).api.autoMeaningCancel(requestId).catch(() => {});
    }
    pendingApiRequestsRef.current.delete(wordId);
    // Also remove from background tasks
    removeTask(wordId);
  };

  // Handle updating a pending word's data
  const handleUpdatePendingWord = (wordId: string, updates: Partial<PendingWord>) => {
    setPendingWords((prev) =>
      prev.map((w) => (w.id === wordId ? { ...w, ...updates } : w))
    );
  };

  const handleAddWord = (
    windowId: string,
    selectionSnapshot: { text: string; pageNumber: number; rects: Rect[] } | null,
    word: string,
    meaning: string,
    pronunciation: string,
    pos: string,
    example: string
  ) => {
    if (!deckCsvPath) return;

    setLastAddError('');
    setPendingAddCount((c) => c + 1);

    enqueueBackgroundAdd(async () => {
      try {
        await window.api.addWord(deckCsvPath, {
          word,
          meaning,
          pronunciation,
          pos,
          example
        });

        if (selectionSnapshot) {
          const wordKey = `${word}_${meaning}`.toLowerCase();
          const newHighlight: Highlight = {
            id: `${pdfId}_${selectionSnapshot.pageNumber}_${Date.now()}`,
            pageNumber: selectionSnapshot.pageNumber,
            text: selectionSnapshot.text,
            rects: Array.isArray(selectionSnapshot.rects) ? selectionSnapshot.rects : [],
            wordKey,
            meaning,
            pronunciation
          };

          const currentHighlights = Array.isArray(highlightsRef.current) ? highlightsRef.current : [];
          const updatedHighlights = [...currentHighlights, newHighlight];

          await window.api.pdfWriteHighlights(pdfId, updatedHighlights);
          highlightsRef.current = updatedHighlights;
          setHighlights(updatedHighlights);

          const newWordMap = new Map(wordMapRef.current);
          newWordMap.set(wordKey, { meaning, pronunciation });
          wordMapRef.current = newWordMap;
          setWordMap(newWordMap);

          try {
            const w = sanitize(word);
            if (w) {
              const newWordOnly = new Map(wordOnlyMapRef.current);
              if (!newWordOnly.has(w)) newWordOnly.set(w, { meaning, pronunciation });
              wordOnlyMapRef.current = newWordOnly;
              setWordOnlyMap(newWordOnly);
            }
          } catch (e) {}
        }

        // Non-blocking post-processing.
        if (window.api.enhanceWordInBackground) {
          window.api.enhanceWordInBackground(deckCsvPath, word, meaning, pronunciation, pos, example).catch(() => {
            // Silent fail - word is already saved.
          });
        }
      } catch (e) {
        setLastAddError('Thêm từ thất bại (vẫn có thể thử lại).');
      } finally {
        setPendingAddCount((c) => Math.max(0, c - 1));
      }
    });
  };

  const handleGoToPage = () => {
    const pageNumParsed = parseInt(targetPage, 10);
    if (isNaN(pageNumParsed) || pageNumParsed < 1) {
      setErrorMessage('Vui lòng nhập số trang hợp lệ')
      setTimeout(() => setErrorMessage(''), 3000)
      return;
    }

    const cw = iframeRef.current?.contentWindow;
    if (!cw) return;

    cw.postMessage(
      {
        type: 'PDF_GO_TO_PAGE',
        pageNumber: pageNumParsed
      },
      '*'
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleGoToPage();
    }
  };

  return (
    <ErrorBoundary>
      <div className="flex h-full w-full bg-slate-50 dark:bg-slate-900">
        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          {errorMessage && (
            <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 shadow-sm animate-pulse">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span className="font-medium">{errorMessage}</span>
              </div>
            </div>
          )}
          
          <iframe
            ref={iframeRef}
            src={viewerSrc}
            className="flex-1 border-0 w-full"
            sandbox="allow-same-origin allow-scripts allow-popups allow-presentation"
            title="PDF Viewer"
          />

          {(pendingAddCount > 0 || lastAddError) && (
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50">
              {pendingAddCount > 0 && (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur px-3 py-2 shadow-lg border border-slate-200 dark:border-slate-700">
                  <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    Đang lưu {pendingAddCount} từ…
                  </div>
                </div>
              )}
              {lastAddError && (
                <button
                  type="button"
                  onClick={() => setLastAddError('')}
                  className="w-full text-left rounded-xl bg-red-50 dark:bg-red-900/30 px-3 py-2 shadow-lg border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
                  title="Bấm để ẩn"
                >
                  {lastAddError}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar for pending words */}
        <div className="w-80 border-l border-slate-200/60 dark:border-slate-700/60 flex-shrink-0">
          <PendingWordsSidebar
            pendingWords={pendingWords}
            onSave={handleSaveWord}
            onRemove={handleRemovePendingWord}
            onUpdateWord={handleUpdatePendingWord}
            onSaveAll={handleSaveAllCompleted}
            saveAllDisabled={!deckCsvPath || pendingAddCount > 0}
          />
        </div>

        {showTranslateModal && selectedPassage && (
          <TranslateTextModal
            text={selectedPassage}
            from="en"
            to="vi"
            onClose={() => {
              setShowTranslateModal(false);
              setSelectedPassage('');
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};

export default PdfViewer;