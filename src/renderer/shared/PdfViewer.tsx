import React, { useEffect, useRef, useState } from 'react';
import AddWordModal from './AddWordModal';
import ErrorBoundary from './ErrorBoundary';

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

  const [showAddWordModal, setShowAddWordModal] = useState(false);
  const [selectedText, setSelectedText] = useState<{
    text: string;
    pageNumber: number;
    rects: Rect[];
  } | null>(null);

  const [targetPage, setTargetPage] = useState('');

  const [viewerReady, setViewerReady] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    console.log('[PdfViewer] mounted / pdfId =', pdfId);
    return () => {
      console.log('[PdfViewer] unmounted / pdfId =', pdfId);
    };
  }, [pdfId]);

  // Load PDF data and initialize
  useEffect(() => {
    let cancelled = false;

    const initializePdf = async () => {
      try {
        console.log('[INIT] start, pdfId =', pdfId);

        const pdfData = await window.api.pdfGet(pdfId);
        console.log('[INIT] pdfData =', pdfData);

        const loadedHighlights = Array.isArray(pdfData?.highlights) ? (pdfData.highlights as Highlight[]) : [];
        console.log('[INIT] loadedHighlights.length =', loadedHighlights.length);

        if (!cancelled) {
          setHighlights(loadedHighlights);
          setDeckCsvPath(pdfData?.deckCsvPath || '');
        }

        console.log('[INIT] deckCsvPath =', pdfData?.deckCsvPath || '');

        const csvPath = pdfData?.deckCsvPath || '';
        if (csvPath) {
          console.log('[INIT] reading CSV from =', csvPath);

          const csvRows = await window.api.readCsv(csvPath);
          console.log('[INIT] csvRows type =', Array.isArray(csvRows) ? 'array' : typeof csvRows);
          console.log('[INIT] csvRows.length =', Array.isArray(csvRows) ? csvRows.length : 0);

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
          console.log('[INIT] wordMap.size =', newWordMap.size);
        } else {
          console.log('[INIT] deckCsvPath is empty, skip readCsv');
          if (!cancelled) setWordMap(new Map());
        }

        const bytes = await window.api.pdfGetSourceBytes(pdfId);
        const bytesLen =
          bytes && typeof bytes.length === 'number'
            ? bytes.length
            : bytes && bytes.byteLength
              ? bytes.byteLength
              : undefined;

        console.log('[INIT] pdfBytes received, length =', bytesLen);

        if (!cancelled) setPdfBytes(bytes);

        console.log('[INIT] done');
      } catch (error) {
        console.error('[INIT] Failed to initialize PDF:', error);
      }
    };

    initializePdf();

    return () => {
      cancelled = true;
      console.log('[INIT] cancelled = true');
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
    console.log('[POST] sending PDF_SET_HIGHLIGHTS, count =', enriched.length);
    console.log('[POST] enriched highlights sample =', enriched.slice(0, 6));

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
      if (type) console.log('[IFRAME->APP] message type =', type);

      if (type === 'PDF_VIEWER_READY') {
        console.log('[IFRAME] viewer ready');
        setViewerReady(true);
        return;
      }

      // Gửi lại highlights sau khi page đã render xong
      if (type === 'PDF_PAGE_RENDERED') {
        console.log('[IFRAME] page rendered, pageNumber =', event.data?.pageNumber);
        sendHighlightsToIframe();
        return;
      }

      if (type === 'PDF_SELECTION') {
        console.log('[IFRAME] selection received:', {
          text: event.data?.text,
          pageNumber: event.data?.pageNumber,
          rectsCount: Array.isArray(event.data?.rects) ? event.data.rects.length : 0
        });

        setSelectedText({
          text: event.data.text,
          pageNumber: event.data.pageNumber,
          rects: Array.isArray(event.data.rects) ? event.data.rects : []
        });
        setShowAddWordModal(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [highlights, wordMap]);

  // Listen for deck updates from main process and reload CSV when changed
  useEffect(() => {
    if (!window.api || !window.api.onDeckUpdated) return;
    const handler = async (data: any) => {
      try {
        if (!data) return;
        // If this update affects current pdf (by pdfId or deckCsvPath), reload CSV and update maps
        if (data.pdfId === pdfId || (data.deckCsvPath && data.deckCsvPath === deckCsvPath)) {
          console.log('[DECK UPDATE] detected for', data);
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
            console.error('[DECK UPDATE] failed to reload csv', e);
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
    console.log('[POST] viewerReady =', viewerReady, 'pdfBytes =', !!pdfBytes);

    if (!viewerReady) return;
    if (!pdfBytes) return;

    const cw = iframeRef.current?.contentWindow;
    if (!cw) {
      console.log('[POST] iframe contentWindow not available');
      return;
    }

    const bytesLen =
      pdfBytes && typeof pdfBytes.length === 'number'
        ? pdfBytes.length
        : pdfBytes && pdfBytes.byteLength
          ? pdfBytes.byteLength
          : undefined;

    console.log('[POST] sending PDF_OPEN_BYTES, length =', bytesLen);

    cw.postMessage(
      {
        type: 'PDF_OPEN_BYTES',
        bytes: pdfBytes
      },
      '*'
    );
  }, [viewerReady, pdfBytes]);

  // Send highlights to iframe when they change
  useEffect(() => {
    if (!viewerReady) return;
    sendHighlightsToIframe();
  }, [viewerReady, highlights, wordMap]);

  const handleAddWord = async (word: string, meaning: string, pronunciation: string) => {
    try {
      console.log('[ADD WORD] start', { pdfId, word, meaning, pronunciation });
      console.log('[ADD WORD] deckCsvPath =', deckCsvPath);
      console.log('[ADD WORD] selectedText =', selectedText);

      if (!deckCsvPath) {
        console.log('[ADD WORD] deckCsvPath is empty, abort');
        return;
      }

      await window.api.addWord(deckCsvPath, {
        word,
        meaning,
        pronunciation
      });

      console.log('[ADD WORD] addWord done');

      if (selectedText) {
        const wordKey = `${word}_${meaning}`.toLowerCase();
        const newHighlight: Highlight = {
          id: `${pdfId}_${selectedText.pageNumber}_${Date.now()}`,
          pageNumber: selectedText.pageNumber,
          text: selectedText.text,
          rects: Array.isArray(selectedText.rects) ? selectedText.rects : [],
          wordKey,
          meaning,
          pronunciation
        };

        const safeHighlights = Array.isArray(highlights) ? highlights : [];
        console.log('[ADD WORD] current highlights count =', safeHighlights.length);

        const updatedHighlights = [...safeHighlights, newHighlight];
        console.log('[ADD WORD] updated highlights count =', updatedHighlights.length);

        await window.api.pdfWriteHighlights(pdfId, updatedHighlights);
        console.log('[ADD WORD] pdfWriteHighlights done');

        setHighlights(updatedHighlights);

        const newWordMap = new Map(wordMap);
        newWordMap.set(wordKey, { meaning, pronunciation });
        setWordMap(newWordMap);
        // also update wordOnlyMap
        try {
          const w = sanitize(word);
          if (w) {
            const newWordOnly = new Map(wordOnlyMap);
            if (!newWordOnly.has(w)) newWordOnly.set(w, { meaning, pronunciation });
            setWordOnlyMap(newWordOnly);
          }
        } catch (e) {}

        console.log('[ADD WORD] wordMap.size =', newWordMap.size);
      } else {
        console.log('[ADD WORD] selectedText is null, skip highlight write');
      }

      setShowAddWordModal(false);
      setSelectedText(null);

      console.log('[ADD WORD] done');
    } catch (error) {
      console.error('[ADD WORD] Failed to add word:', error);
    }
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

    console.log('[POST] sending PDF_GO_TO_PAGE =', pageNumParsed);

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
      <div className="flex flex-col h-full w-full bg-white">
      {errorMessage && (
        <div className="p-2 bg-red-100 border border-red-300 rounded text-sm text-red-700 mb-2">
          {errorMessage}
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="/pdfjs/web/viewer.html"
        className="flex-1 border-0 w-full"
        sandbox="allow-same-origin allow-scripts allow-popups allow-presentation"
        title="PDF Viewer"
      />

      {showAddWordModal && selectedText && (
        <AddWordModal
          selectedText={selectedText.text}
          onSave={handleAddWord}
          onCancel={() => {
            console.log('[ADD WORD] cancelled by user');
            setShowAddWordModal(false);
            setSelectedText(null);
          }}
        />
      )}
      </div>
    </ErrorBoundary>
  );
};

export default PdfViewer;