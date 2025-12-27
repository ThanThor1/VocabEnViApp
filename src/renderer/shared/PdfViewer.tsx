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
    return () => {};
  }, [pdfId]);

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
        setSelectedText({
          text: event.data.text,
          pageNumber: event.data.pageNumber,
          rects: Array.isArray(event.data?.rects) ? event.data.rects : []
        });
        setShowAddWordModal(true);
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
  }, [highlights, wordMap]);

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

  const handleAddWord = async (word: string, meaning: string, pronunciation: string) => {
    try {
      if (!deckCsvPath) return;

      await window.api.addWord(deckCsvPath, {
        word,
        meaning,
        pronunciation
      });

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
        const updatedHighlights = [...safeHighlights, newHighlight];
        await window.api.pdfWriteHighlights(pdfId, updatedHighlights);
        setHighlights(updatedHighlights);
        const newWordMap = new Map(wordMap);
        newWordMap.set(wordKey, { meaning, pronunciation });
        setWordMap(newWordMap);
        try {
          const w = sanitize(word);
          if (w) {
            const newWordOnly = new Map(wordOnlyMap);
            if (!newWordOnly.has(w)) newWordOnly.set(w, { meaning, pronunciation });
            setWordOnlyMap(newWordOnly);
          }
        } catch (e) {}
      }

      setShowAddWordModal(false);
      setSelectedText(null);
    } catch (error) {
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