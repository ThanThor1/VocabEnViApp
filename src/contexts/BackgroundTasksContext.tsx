import React, { createContext, useContext, useState, useRef, useCallback } from 'react'
import { normalizePos } from '../components/posOptions/posOptions'

// Types
type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] }

export interface BackgroundTranslationTask {
  id: string
  word: string
  contextSentenceEn: string
  pdfId: string
  deckCsvPath: string
  pageNumber: number
  rects: any[]
  // Status
  status: 'pending' | 'running' | 'completed' | 'error'
  progress: string
  // Results
  meaning?: string
  pronunciation?: string
  pos?: string
  example?: string
  contextVi?: string
  candidates?: AutoMeaningCandidate[]
  error?: string
  // Timestamps
  startedAt: number
  completedAt?: number
}

interface BackgroundTasksContextType {
  tasks: BackgroundTranslationTask[]
  addTranslationTask: (task: Omit<BackgroundTranslationTask, 'status' | 'progress' | 'startedAt'>) => void
  removeTask: (taskId: string) => void
  clearCompletedTasks: () => void
  getTasksForPdf: (pdfId: string) => BackgroundTranslationTask[]
  runningCount: number
  completedCount: number
}

const BackgroundTasksContext = createContext<BackgroundTasksContextType | null>(null)

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTasksContext)
  if (!ctx) {
    throw new Error('useBackgroundTasks must be used within BackgroundTasksProvider')
  }
  return ctx
}

// Helper to ensure IPA has slashes
const ensureIpaSlashes = (val: string) => {
  const v = (val || '').trim().replace(/"/g, '')
  if (!v) return ''
  const core = v.replace(/^\/+|\/+$/g, '')
  return `/${core}/`
}

export function BackgroundTasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTranslationTask[]>([])
  const runningTasksRef = useRef<Set<string>>(new Set())
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  const updateTask = useCallback((taskId: string, updates: Partial<BackgroundTranslationTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
  }, [])

  const runTranslationTask = useCallback(async (task: BackgroundTranslationTask) => {
    if (runningTasksRef.current.has(task.id)) return
    runningTasksRef.current.add(task.id)

    const abortController = new AbortController()
    abortControllersRef.current.set(task.id, abortController)

    const requestId = `bg_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const cleanWord = task.word.trim()
    const cleanContext = (task.contextSentenceEn || '').trim()

    const fetchDictionaryIpa = async () => {
      try {
        const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`)
        if (!resp.ok) return ''
        const data = await resp.json()
        if (Array.isArray(data) && data[0]?.phonetics?.length > 0) {
          const ph = data[0].phonetics.find((p: any) => p.text)
          if (ph?.text) return ensureIpaSlashes(ph.text)
        }
      } catch (e) {}
      return ''
    }

    try {
      updateTask(task.id, { status: 'running', progress: 'Đang dịch...' })

      let pronunciation = ''
      let meaning = ''
      let candidates: AutoMeaningCandidate[] = []
      let contextVi = ''
      let pos = ''
      let example = ''

      const enrichWord = (window as any)?.api?.enrichWord
      if (enrichWord) {
        try {
          const resp = await enrichWord({
            requestId,
            word: cleanWord,
            contextSentenceEn: cleanContext,
            from: 'en',
            to: 'vi',
            dialect: 'US'
          })

          if (resp) {
            meaning = String(resp.meaningSuggested || '').trim()
            candidates = Array.isArray(resp.candidates) ? resp.candidates : []
            contextVi = String(resp.contextSentenceVi || '').trim()
            example = String((resp as any).example || '').trim()

            const posSuggested = normalizePos((resp as any).posSuggested)
            if (posSuggested) {
              pos = posSuggested
            } else {
              const firstWithPos = candidates.find((c: any) => c && c.pos)
              const normalized = normalizePos(firstWithPos?.pos)
              if (normalized) pos = normalized
            }

            const ipa = String((resp as any).ipa || '').trim()
            if (ipa) pronunciation = ensureIpaSlashes(ipa)
          }
        } catch (e) {
          console.warn('[BackgroundTask] enrichWord error:', e)
        }

        if (!pronunciation && !/\s/.test(cleanWord)) {
          pronunciation = await fetchDictionaryIpa()
        }

        // If example missing, do a cheap fallback.
        if (!example && meaning && (window as any)?.api?.suggestExampleSentence) {
          try {
            const exampleOut = await (window as any).api.suggestExampleSentence({
              word: cleanWord,
              meaningVi: meaning,
              pos: pos || '',
              contextSentenceEn: cleanContext
            })
            if (String(exampleOut || '').trim()) example = String(exampleOut || '').trim()
          } catch (e) {}
        }
      } else {
        // Older builds: keep previous behavior
        updateTask(task.id, { progress: 'Đang lấy phát âm...' })
        try {
          const suggestIpa = (window as any)?.api?.suggestIpa
          if (suggestIpa) {
            const out = await suggestIpa({ word: cleanWord, dialect: 'US' })
            if (String(out || '').trim()) pronunciation = ensureIpaSlashes(String(out || ''))
          }
          if (!pronunciation && !/\s/.test(cleanWord)) {
            pronunciation = await fetchDictionaryIpa()
          }
        } catch (e) {}

        if (abortController.signal.aborted) return
        updateTask(task.id, { pronunciation, progress: 'Đang dịch nghĩa...' })

        try {
          if ((window as any)?.api?.autoMeaning) {
            const resp = await (window as any).api.autoMeaning({
              requestId,
              word: cleanWord,
              contextSentenceEn: cleanContext,
              from: 'en',
              to: 'vi'
            })

            if (resp) {
              meaning = (resp.meaningSuggested || '').trim()
              candidates = Array.isArray(resp.candidates) ? resp.candidates : []
              contextVi = (resp.contextSentenceVi || '').trim()

              const firstWithPos = candidates.find((c: any) => c && c.pos)
              const normalized = normalizePos(firstWithPos?.pos)
              if (normalized) pos = normalized
            }
          }
        } catch (e) {}

        if (abortController.signal.aborted) return
        updateTask(task.id, { meaning, candidates, contextVi, pos, progress: 'Đang tạo câu ví dụ...' })

        if (meaning && (window as any)?.api?.suggestExampleSentence) {
          try {
            const exampleOut = await (window as any).api.suggestExampleSentence({
              word: cleanWord,
              meaningVi: meaning,
              pos: pos || '',
              contextSentenceEn: cleanContext
            })
            if (String(exampleOut || '').trim()) example = String(exampleOut || '').trim()
          } catch (e) {}
        }
      }

      if (abortController.signal.aborted) return

      // Persist results to task state
      updateTask(task.id, { pronunciation, meaning, candidates, contextVi, pos, example })

      // Done
      updateTask(task.id, { status: 'completed', progress: 'Hoàn tất!', completedAt: Date.now() })

    } catch (error: any) {
      if (!abortController.signal.aborted) {
        updateTask(task.id, {
          status: 'error',
          progress: 'Lỗi',
          error: error?.message || 'Unknown error',
          completedAt: Date.now()
        })
      }
    } finally {
      runningTasksRef.current.delete(task.id)
      abortControllersRef.current.delete(task.id)
    }
  }, [updateTask])

  const addTranslationTask = useCallback((taskData: Omit<BackgroundTranslationTask, 'status' | 'progress' | 'startedAt'>) => {
    const newTask: BackgroundTranslationTask = {
      ...taskData,
      status: 'pending',
      progress: 'Đang chờ...',
      startedAt: Date.now()
    }

    setTasks(prev => {
      // Check if task with same id already exists
      if (prev.some(t => t.id === newTask.id)) return prev
      return [...prev, newTask]
    })

    // Start the task
    setTimeout(() => runTranslationTask(newTask), 100)
  }, [runTranslationTask])

  const removeTask = useCallback((taskId: string) => {
    // Abort if running
    const controller = abortControllersRef.current.get(taskId)
    if (controller) {
      controller.abort()
      abortControllersRef.current.delete(taskId)
    }
    runningTasksRef.current.delete(taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }, [])

  const clearCompletedTasks = useCallback(() => {
    setTasks(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'error'))
  }, [])

  const getTasksForPdf = useCallback((pdfId: string) => {
    return tasks.filter(t => t.pdfId === pdfId)
  }, [tasks])

  const runningCount = tasks.filter(t => t.status === 'running' || t.status === 'pending').length
  const completedCount = tasks.filter(t => t.status === 'completed').length

  return (
    <BackgroundTasksContext.Provider value={{
      tasks,
      addTranslationTask,
      removeTask,
      clearCompletedTasks,
      getTasksForPdf,
      runningCount,
      completedCount
    }}>
      {children}
    </BackgroundTasksContext.Provider>
  )
}
