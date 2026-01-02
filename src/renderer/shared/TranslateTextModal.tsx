import React, { useEffect, useMemo, useState } from 'react'

interface Props {
  text: string
  from?: string
  to?: string
  onClose: () => void
}

export default function TranslateTextModal({ text, from = 'en', to = 'vi', onClose }: Props) {
  const cleanText = useMemo(() => {
    const raw = String(text || '').trim()
    if (!raw) return ''

    // PDF selections often contain:
    // - hard line breaks in the middle of sentences
    // - hyphenation at line breaks (e.g., "transla-\ntion")
    // Cleaning helps Azure produce better Vietnamese.
    let s = raw

    // Normalize line endings
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // Join hyphenated line-breaks: "transla-\n tion" -> "translation"
    s = s.replace(/([A-Za-z])\-\n\s*([A-Za-z])/g, '$1$2')

    // Preserve paragraph breaks: treat 2+ newlines as paragraph separator
    s = s.replace(/\n{2,}/g, '\n\n')

    // Within a paragraph, replace single newlines with spaces
    s = s.replace(/(?<!\n)\n(?!\n)/g, ' ')

    // Collapse spaces/tabs but keep paragraph breaks
    s = s.replace(/[\t ]+/g, ' ')
    s = s.replace(/\n\n+/g, '\n\n')

    return s.trim()
  }, [text])
  const [translated, setTranslated] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        setError('')
        setTranslated('')
        if (!cleanText) return
        if (!(window as any)?.api?.translatePlain) {
          setError('Translate API not available. Hãy restart app (Electron) để reload preload.js, rồi thử lại.')
          return
        }
        setLoading(true)
        const resp: string = await (window as any).api.translatePlain({ text: cleanText, from, to })
        if (cancelled) return
        setTranslated(String(resp || '').trim())
      } catch (e) {
        if (cancelled) return
        setError('Failed to translate')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [cleanText, from, to])

  const copyText = async (value: string) => {
    try {
      if (!value) return
      await navigator.clipboard.writeText(value)
    } catch (e) {
      // ignore
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.069 15.61 3 18.129" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Translate Passage</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-700">Original</div>
              <button
                onClick={() => copyText(cleanText)}
                className="text-xs text-gray-600 hover:text-gray-900"
                type="button"
              >
                Copy
              </button>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-800 whitespace-pre-wrap">
              {cleanText}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-700">Translation</div>
              <button
                onClick={() => copyText(translated)}
                className="text-xs text-gray-600 hover:text-gray-900"
                type="button"
                disabled={!translated}
              >
                Copy
              </button>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg border border-purple-200 text-sm text-gray-900 whitespace-pre-wrap min-h-[4rem]">
              {loading ? 'Translating…' : (translated || '')}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </div>
  )
}
