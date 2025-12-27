// AppStateManager.ts - Manages persistence of app state to localStorage

interface PdfViewerState {
  pdfId: string;
  scrollPosition: number;
  zoomLevel: string; // 'page-width', '100', '150', etc.
  currentPage: number;
  timestamp: number;
}

interface ScreenState {
  screenName: string; // 'manager', 'manager-pdf', 'study', 'pdf'
  data: any;
  timestamp: number;
}

const STORAGE_PREFIX = 'vocab_app_state_';
const PDF_STORAGE_PREFIX = 'vocab_pdf_state_';

export const AppStateManager = {
  // PDF Viewer State Methods
  savePdfViewerState(pdfId: string, state: Partial<Omit<PdfViewerState, 'pdfId' | 'timestamp'>>) {
    try {
      const key = `${PDF_STORAGE_PREFIX}${pdfId}`;
      const fullState: PdfViewerState = {
        pdfId,
        scrollPosition: state.scrollPosition ?? 0,
        zoomLevel: state.zoomLevel ?? '150',
        currentPage: state.currentPage ?? 1,
        timestamp: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(fullState));
      console.log('[STATE] saved PDF viewer state for', pdfId);
    } catch (error) {
      console.error('[STATE] failed to save PDF viewer state:', error);
    }
  },

  loadPdfViewerState(pdfId: string): PdfViewerState | null {
    try {
      const key = `${PDF_STORAGE_PREFIX}${pdfId}`;
      const data = localStorage.getItem(key);
      if (!data) return null;
      const state = JSON.parse(data) as PdfViewerState;
      console.log('[STATE] loaded PDF viewer state for', pdfId);
      return state;
    } catch (error) {
      console.error('[STATE] failed to load PDF viewer state:', error);
      return null;
    }
  },

  // Screen State Methods
  saveScreenState(screenName: string, data: any) {
    try {
      const key = `${STORAGE_PREFIX}${screenName}`;
      const fullState: ScreenState = {
        screenName,
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(fullState));
      console.log('[STATE] saved screen state for', screenName);
    } catch (error) {
      console.error('[STATE] failed to save screen state:', error);
    }
  },

  loadScreenState(screenName: string): any | null {
    try {
      const key = `${STORAGE_PREFIX}${screenName}`;
      const data = localStorage.getItem(key);
      if (!data) return null;
      const state = JSON.parse(data) as ScreenState;
      console.log('[STATE] loaded screen state for', screenName);
      return state.data;
    } catch (error) {
      console.error('[STATE] failed to load screen state:', error);
      return null;
    }
  },

  // Clear all state
  clearAllState() {
    try {
      const keysToDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(STORAGE_PREFIX) || key.startsWith(PDF_STORAGE_PREFIX))) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => localStorage.removeItem(key));
      console.log('[STATE] cleared all app state');
    } catch (error) {
      console.error('[STATE] failed to clear app state:', error);
    }
  },

  // Clear specific PDF state
  clearPdfState(pdfId: string) {
    try {
      const key = `${PDF_STORAGE_PREFIX}${pdfId}`;
      localStorage.removeItem(key);
      console.log('[STATE] cleared PDF state for', pdfId);
    } catch (error) {
      console.error('[STATE] failed to clear PDF state:', error);
    }
  },

  // Clear specific screen state
  clearScreenState(screenName: string) {
    try {
      const key = `${STORAGE_PREFIX}${screenName}`;
      localStorage.removeItem(key);
      console.log('[STATE] cleared screen state for', screenName);
    } catch (error) {
      console.error('[STATE] failed to clear screen state:', error);
    }
  }
};
