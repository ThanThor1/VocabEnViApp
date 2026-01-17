import React, { useEffect, useMemo, useState } from 'react'

interface Props {
  text: string
  from?: string
  to?: string
  onClose: () => void
}

export default function TranslateTextModal({ text, from = 'en', to = 'vi', onClose }: Props) {
  const rawText = useMemo(() => String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'), [text])
  const cleanText = useMemo(() => {
    const raw = String(text || '').trim()
    if (!raw) return ''

    // PDF selections often contain hard-wrapped newlines (end of rendered line),
    // which should NOT be treated as paragraph breaks.
    // We only preserve real paragraph breaks:
    // - blank lines (\n\n)
    // - some common paragraph markers like "Note." (math textbooks)
    const s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = s.split('\n')

    const paragraphs: string[] = []
    let current = ''

    const flush = () => {
      const t = current.trim()
      if (t) paragraphs.push(t)
      current = ''
    }

    const isParagraphMarker = (lineTrim: string) => {
      return /^(note|remark|solution|example|proof)\b\s*[:.]/i.test(lineTrim)
    }

    const appendLine = (lineRaw: string) => {
      const line = lineRaw.trim()
      if (!line) return
      if (!current) {
        current = line
        return
      }

      // Join hyphenated end-of-line: "transla-" + "tion" => "translation"
      if (/[A-Za-z]-$/.test(current) && /^[A-Za-z]/.test(line)) {
        current = current.slice(0, -1) + line
        return
      }

      current = current + ' ' + line
    }

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        flush()
        continue
      }

      if (isParagraphMarker(trimmed)) {
        flush()
        appendLine(trimmed)
        continue
      }

      appendLine(line)
    }

    flush()

    return paragraphs.join('\n\n').trim()
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
        setTranslated(String(resp || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
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
    <div className="modal-backdrop">
      <div className="modal-content max-w-2xl w-full">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.069 15.61 3 18.129" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Translate Passage</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">Original</div>
              <button
                onClick={() => copyText(rawText)}
                className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                type="button"
              >
                Copy
              </button>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
              {rawText}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">Translation</div>
              <button
                onClick={() => copyText(translated)}
                className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                type="button"
                disabled={!translated}
              >
                Copy
              </button>
            </div>
            <div className="p-3 bg-violet-50 dark:bg-violet-900/30 rounded-lg border border-violet-200 dark:border-violet-800 text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap min-h-[4rem]">
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
