// PendingPassagesSidebar.tsx - Sidebar for translating multiple passages in parallel
// Similar to PendingWordsSidebar but for longer text passages

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { ApiKeyPool } from '../../store/ApiKeyPool'
import './PendingPassagesSidebar.css'

export interface PendingPassage {
  id: string
  text: string
  pageNumber?: number
  
  // Translation result - support both naming conventions
  translatedText?: string
  translation?: string
  
  // Status
  isLoading: boolean
  isComplete?: boolean
  error?: string
  
  // Timestamps
  addedAt?: number
  createdAt?: number
  completedAt?: number
}

interface PendingPassagesSidebarProps {
  passages: PendingPassage[]
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  onClearAll: () => void
}

export default function PendingPassagesSidebar({
  passages,
  onRemove,
  onRetry,
  onClearAll,
}: PendingPassagesSidebarProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const getTranslation = (p: PendingPassage) => p.translation || p.translatedText
  const isComplete = (p: PendingPassage) => p.isComplete || (!p.isLoading && (p.translation || p.translatedText))
  
  const completedCount = passages.filter(p => isComplete(p)).length
  const loadingCount = passages.filter(p => p.isLoading).length
  const errorCount = passages.filter(p => p.error && !p.isLoading).length

  const handleCopy = async (passage: PendingPassage) => {
    const text = getTranslation(passage)
    if (!text) return
    
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(passage.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (e) {
      console.error('Failed to copy:', e)
    }
  }

  return (
    <div className="pending-passages-sidebar h-full flex flex-col bg-white dark:bg-slate-800">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-white">Dịch đoạn</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {passages.length} đoạn
              </p>
            </div>
          </div>
        </div>

        {/* Status badges */}
        {passages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {loadingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs rounded-full">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                {loadingCount} đang dịch
              </span>
            )}
            {completedCount > 0 && (
              <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs rounded-full">
                ✓ {completedCount} xong
              </span>
            )}
            {errorCount > 0 && (
              <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs rounded-full">
                ✗ {errorCount} lỗi
              </span>
            )}
          </div>
        )}
      </div>

      {/* Passages List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {passages.length === 0 ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
            <p className="text-sm">Chưa có đoạn nào</p>
            <p className="text-xs mt-1">Bôi đen đoạn văn dài trong PDF để dịch</p>
          </div>
        ) : (
          passages.map(passage => {
            const isExpanded = expandedId === passage.id
            const isCopied = copiedId === passage.id
            
            return (
              <div
                key={passage.id}
                className={`
                  rounded-xl border-2 transition-all overflow-hidden
                  ${passage.isComplete 
                    ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
                    : passage.error
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                      : passage.isLoading
                        ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  }
                `}
              >
                {/* Passage Header */}
                <div 
                  className="p-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : passage.id)}
                >
                  <div className="flex items-start gap-2">
                    {/* Status Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {passage.isLoading ? (
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      ) : passage.isComplete ? (
                        <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : passage.error ? (
                        <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      ) : (
                        <div className="w-5 h-5 bg-slate-300 dark:bg-slate-600 rounded-full" />
                      )}
                    </div>

                    {/* Text Preview */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">
                        {passage.text}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Trang {passage.pageNumber} • {passage.text.split(/\s+/).length} từ
                      </div>
                    </div>

                    {/* Expand Icon */}
                    <svg 
                      className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-slate-200 dark:border-slate-700">
                    {/* Original Text */}
                    <div className="mt-3 mb-3">
                      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">
                        Văn bản gốc
                      </div>
                      <div className="text-sm text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-lg p-3 max-h-32 overflow-y-auto">
                        {passage.text}
                      </div>
                    </div>

                    {/* Translation */}
                    {getTranslation(passage) && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">
                          Bản dịch
                        </div>
                        <div className="text-sm text-slate-700 dark:text-slate-300 bg-green-100 dark:bg-green-900/40 rounded-lg p-3 max-h-40 overflow-y-auto">
                          {getTranslation(passage)}
                        </div>
                      </div>
                    )}

                    {/* Error Message */}
                    {passage.error && (
                      <div className="mb-3 p-2 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg text-sm">
                        {passage.error}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      {isComplete(passage) && getTranslation(passage) && (
                        <button
                          onClick={() => handleCopy(passage)}
                          className={`
                            flex-1 py-2 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-1
                            ${isCopied 
                              ? 'bg-green-500 text-white'
                              : 'bg-blue-500 hover:bg-blue-600 text-white'
                            }
                          `}
                        >
                          {isCopied ? (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Đã copy
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
                      )}
                      
                      {passage.error && (
                        <button
                          onClick={() => onRetry(passage.id)}
                          className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Thử lại
                        </button>
                      )}
                      
                      <button
                        onClick={() => onRemove(passage.id)}
                        className="px-3 py-2 border-2 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        title="Xóa"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer Actions */}
      {passages.length > 0 && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
          <button
            onClick={onClearAll}
            className="w-full py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors font-medium"
          >
            Xóa tất cả
          </button>
        </div>
      )}
    </div>
  )
}

// Hook to manage pending passages with parallel translation
export function usePendingPassages(pdfId: string) {
  const [passages, setPassages] = useState<PendingPassage[]>([])
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  // Add a new passage for translation
  const addPassage = useCallback(async (text: string, pageNumber: number) => {
    const id = `passage_${Date.now()}_${Math.random().toString(36).slice(2)}`
    
    const newPassage: PendingPassage = {
      id,
      text: text.trim(),
      pageNumber,
      isLoading: true,
      isComplete: false,
      addedAt: Date.now()
    }
    
    setPassages(prev => [...prev, newPassage])
    
    // Start translation
    translatePassage(id, text.trim())
    
    return id
  }, [])

  // Translate a passage using available API keys
  const translatePassage = useCallback(async (id: string, text: string) => {
    const abortController = new AbortController()
    abortControllersRef.current.set(id, abortController)

    try {
      setPassages(prev => prev.map(p => 
        p.id === id ? { ...p, isLoading: true, error: undefined } : p
      ))

      // Use ApiKeyPool for translation
      const result = await ApiKeyPool.executeWithKey(async (apiKey, keyId) => {
        // Call translation API
        if ((window as any)?.api?.translatePassage) {
          return await (window as any).api.translatePassage({
            text,
            from: 'en',
            to: 'vi',
            apiKey
          })
        }
        
        // Fallback: use autoMeaning API with passage mode
        if ((window as any)?.api?.autoMeaning) {
          const resp = await (window as any).api.autoMeaning({
            word: text,
            contextSentenceEn: '',
            from: 'en',
            to: 'vi',
            isPassage: true
          })
          return resp?.contextSentenceVi || resp?.meaningSuggested || ''
        }
        
        throw new Error('Translation API not available')
      }, { maxRetries: 3 })

      if (abortController.signal.aborted) return

      setPassages(prev => prev.map(p => 
        p.id === id ? {
          ...p,
          translatedText: String(result || '').trim(),
          isLoading: false,
          isComplete: true,
          completedAt: Date.now()
        } : p
      ))
    } catch (error: any) {
      if (abortController.signal.aborted) return

      setPassages(prev => prev.map(p => 
        p.id === id ? {
          ...p,
          isLoading: false,
          isComplete: false,
          error: error?.message || 'Lỗi khi dịch đoạn'
        } : p
      ))
    } finally {
      abortControllersRef.current.delete(id)
    }
  }, [])

  // Remove a passage
  const removePassage = useCallback((id: string) => {
    // Cancel any ongoing translation
    const controller = abortControllersRef.current.get(id)
    if (controller) {
      controller.abort()
      abortControllersRef.current.delete(id)
    }
    
    setPassages(prev => prev.filter(p => p.id !== id))
  }, [])

  // Retry a failed translation
  const retryPassage = useCallback((id: string) => {
    const passage = passages.find(p => p.id === id)
    if (passage) {
      translatePassage(id, passage.text)
    }
  }, [passages, translatePassage])

  // Clear all passages
  const clearAll = useCallback(() => {
    // Cancel all ongoing translations
    abortControllersRef.current.forEach(controller => controller.abort())
    abortControllersRef.current.clear()
    
    setPassages([])
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach(controller => controller.abort())
    }
  }, [])

  return {
    passages,
    addPassage,
    removePassage,
    retryPassage,
    clearAll
  }
}
