import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'

export interface PendingPassage {
  id: string
  text: string
  translation?: string
  isLoading: boolean
  createdAt: number
}

interface PassagesContextValue {
  passages: PendingPassage[]
  addPassage: (text: string) => string
  removePassage: (id: string) => void
  updatePassageTranslation: (id: string, translation: string) => void
  setPassageLoading: (id: string, loading: boolean) => void
  clearAll: () => void
  translatePassage: (id: string) => Promise<void>
}

const PassagesContext = createContext<PassagesContextValue | null>(null)

export function usePassages() {
  const context = useContext(PassagesContext)
  // Return null if not in provider - allows optional usage
  return context
}

interface PassagesProviderProps {
  children: ReactNode
}

export function PassagesProvider({ children }: PassagesProviderProps) {
  const [passages, setPassages] = useState<PendingPassage[]>([])

  const addPassage = useCallback((text: string): string => {
    const id = `passage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newPassage: PendingPassage = {
      id,
      text: text.trim(),
      isLoading: true,
      createdAt: Date.now(),
    }
    setPassages(prev => [newPassage, ...prev])
    
    // Auto-translate
    translatePassageAsync(id, text.trim())
    
    return id
  }, [])

  const removePassage = useCallback((id: string) => {
    setPassages(prev => prev.filter(p => p.id !== id))
  }, [])

  const updatePassageTranslation = useCallback((id: string, translation: string) => {
    setPassages(prev => prev.map(p => 
      p.id === id ? { ...p, translation, isLoading: false } : p
    ))
  }, [])

  const setPassageLoading = useCallback((id: string, loading: boolean) => {
    setPassages(prev => prev.map(p => 
      p.id === id ? { ...p, isLoading: loading } : p
    ))
  }, [])

  const clearAll = useCallback(() => {
    setPassages([])
  }, [])

  const translatePassageAsync = async (id: string, text: string) => {
    try {
      // Clean the text (similar to TranslateTextModal)
      const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
      
      // Call translation API
      const result = await (window as any).api.translatePlain({ text: cleanText, from: 'en', to: 'vi' })
      if (result) {
        setPassages(prev => prev.map(p => 
          p.id === id ? { ...p, translation: String(result || ''), isLoading: false } : p
        ))
      } else {
        setPassages(prev => prev.map(p => 
          p.id === id ? { ...p, isLoading: false } : p
        ))
      }
    } catch (err) {
      console.error('Translation error:', err)
      setPassages(prev => prev.map(p => 
        p.id === id ? { ...p, isLoading: false } : p
      ))
    }
  }

  const translatePassage = useCallback(async (id: string) => {
    const passage = passages.find(p => p.id === id)
    if (!passage) return
    
    setPassages(prev => prev.map(p => 
      p.id === id ? { ...p, isLoading: true } : p
    ))
    
    await translatePassageAsync(id, passage.text)
  }, [passages])

  return (
    <PassagesContext.Provider value={{
      passages,
      addPassage,
      removePassage,
      updatePassageTranslation,
      setPassageLoading,
      clearAll,
      translatePassage,
    }}>
      {children}
    </PassagesContext.Provider>
  )
}
