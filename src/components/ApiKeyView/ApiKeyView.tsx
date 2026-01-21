import React, { useEffect, useMemo, useRef, useState } from 'react'
import './ApiKeyView.css'
import ConfirmModal from '../ConfirmModal/ConfirmModal'

export default function ApiKey() {
  const api = window.api

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [statusMsg, setStatusMsg] = useState<string>('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [activeIds, setActiveIds] = useState<string[]>([])
  const [items, setItems] = useState<Array<{ id: string; name: string; masked: string }>>([])
  const [hasConfiguredKey, setHasConfiguredKey] = useState<boolean>(false)

  const [nameInput, setNameInput] = useState('')
  const [keyInput, setKeyInput] = useState('')

  const [concurrency, setConcurrency] = useState<number>(4)
  const [concurrencyInput, setConcurrencyInput] = useState<string>('4')

  const busyTokenRef = useRef<string | null>(null)

  const hasActiveKey = useMemo(() => activeIds.length > 0, [activeIds])

  const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
    let to: any
    const timeout = new Promise<T>((_, reject) => {
      to = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    })
    try {
      return await Promise.race([p, timeout])
    } finally {
      try {
        clearTimeout(to)
      } catch {
        // ignore
      }
    }
  }

  const runBusy = async <T,>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    const token = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    busyTokenRef.current = token
    setLoading(true)

    const watchdog: any = setTimeout(() => {
      // Safety net: never allow the UI to remain disabled indefinitely.
      if (busyTokenRef.current === token) {
        setLoading(false)
      }
    }, Math.max(5000, timeoutMs + 1000))

    try {
      return await withTimeout(fn(), timeoutMs, label)
    } finally {
      try {
        clearTimeout(watchdog)
      } catch {
        // ignore
      }
      if (busyTokenRef.current === token) {
        busyTokenRef.current = null
        setLoading(false)
      }
    }
  }

  const refresh = async () => {
    if (!api?.listGoogleAiStudioApiKeys) return
    const data = await api.listGoogleAiStudioApiKeys()
    setActiveIds(Array.isArray(data?.activeIds) ? data.activeIds : (data?.activeId ? [data.activeId] : []))
    setItems(Array.isArray(data?.items) ? data.items : [])
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        setError('')
        await runBusy(async () => {
          await refresh()
          if (api?.getGoogleAiStudioStatus) {
            const st = await api.getGoogleAiStudioStatus()
            if (!cancelled) setHasConfiguredKey(!!st?.hasKey)
          }

          if (api?.getGoogleAiStudioConcurrency) {
            const c = await api.getGoogleAiStudioConcurrency()
            const v = Number(c?.concurrency)
            if (!cancelled && Number.isFinite(v) && v > 0) {
              setConcurrency(v)
              setConcurrencyInput(String(v))
            }
          }
        }, 8000, 'Load API keys')
      } catch (e: any) {
        if (!cancelled) setError(e?.message ? String(e.message) : 'Failed to load API keys')
      }
    }
    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaveConcurrency = async () => {
    try {
      setStatusMsg('')
      setError('')
      if (!api?.setGoogleAiStudioConcurrency) {
        setError('API unavailable')
        return
      }

      const raw = Number(concurrencyInput)
      const next = Number.isFinite(raw) ? Math.floor(raw) : 4

      await runBusy(async () => {
        const out = await api.setGoogleAiStudioConcurrency(next)
        const v = Number(out?.concurrency)
        if (Number.isFinite(v) && v > 0) {
          setConcurrency(v)
          setConcurrencyInput(String(v))
        }
      }, 8000, 'Save concurrency')

      setStatusMsg('Saved concurrency. New requests apply immediately.')
      setTimeout(() => setStatusMsg(''), 2500)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to save concurrency')
    }
  }

  const handleAdd = async () => {
    try {
      setStatusMsg('')
      setError('')
      if (!api?.addGoogleAiStudioApiKey) {
        setError('API unavailable')
        return
      }
      const apiKey = keyInput.trim()
      const name = nameInput.trim()
      if (!name) {
        setError('Vui lòng nhập tên API key')
        return
      }
      if (!apiKey) {
        setError('Vui lòng nhập API key')
        return
      }
      await runBusy(async () => {
        await api.addGoogleAiStudioApiKey({ name, apiKey })
        setNameInput('')
        setKeyInput('')
        await refresh()
      }, 12000, 'Save API key')
      setStatusMsg('Saved. Auto-translation is enabled for this user.')
      setTimeout(() => setStatusMsg(''), 4000)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to save API key')
    }
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      setStatusMsg('')
      setError('')
      if (!api?.toggleGoogleAiStudioApiKey) {
        setError('API unavailable')
        return
      }
      await runBusy(async () => {
        await api.toggleGoogleAiStudioApiKey(id, enabled)
        await refresh()
      }, 12000, 'Toggle API key')
      setStatusMsg(enabled ? 'Key enabled.' : 'Key disabled.')
      setTimeout(() => setStatusMsg(''), 2500)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to toggle key')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      setStatusMsg('')
      setError('')
      if (!api?.deleteGoogleAiStudioApiKey) {
        setError('API unavailable')
        return
      }
      setConfirmDeleteId(id)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to delete API key')
    }
  }

  const handleDisable = async () => {
    try {
      setStatusMsg('')
      setError('')
      if (activeIds.length === 0) return
      if (!api?.clearGoogleAiStudioApiKey) {
        setError('API unavailable')
        return
      }
      await runBusy(async () => {
        await api.clearGoogleAiStudioApiKey()
        await refresh()
        if (api?.getGoogleAiStudioStatus) {
          const st = await api.getGoogleAiStudioStatus()
          setHasConfiguredKey(!!st?.hasKey)
        } else {
          setHasConfiguredKey(false)
        }
      }, 12000, 'Disable auto-translation')
      setStatusMsg('Disabled. Auto-translation is off for this user.')
      setTimeout(() => setStatusMsg(''), 3500)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to disable auto-translation')
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50 via-violet-50/30 to-purple-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-8">
      <div className="max-w-3xl mx-auto pb-8">
      {confirmDeleteId && (
        <ConfirmModal
          title="Delete API key?"
          message="This will remove the key from your local list."
          confirmText="Delete"
          cancelText="Cancel"
          danger
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={async () => {
            const id = confirmDeleteId
            setConfirmDeleteId(null)
            try {
              if (!id) return
              await runBusy(async () => {
                await api.deleteGoogleAiStudioApiKey(id)
                await refresh()
              }, 12000, 'Delete API key')
            } catch (e: any) {
              setError(e?.message ? String(e.message) : 'Failed to delete API key')
            }
          }}
        />
      )}
      
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 via-purple-500 to-accent-500 flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 bg-clip-text text-transparent">
              API Key Management
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Configure auto-translation with Gemini API keys
            </p>
          </div>
        </div>
      </div>

      {/* Status Card */}
      <div className="card hover:shadow-xl transition-shadow mb-6">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-xl flex items-center justify-center shadow-lg ${
            hasActiveKey 
              ? "bg-gradient-to-br from-green-400 to-emerald-600" 
              : "bg-gradient-to-br from-slate-400 to-slate-600"
          }`}>
            {hasActiveKey ? (
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <div className="text-lg font-bold text-slate-900 dark:text-white">Auto-translation Status</div>
            <div className="text-sm mt-1">
              {hasActiveKey ? (
                <span className="inline-flex items-center gap-2 text-green-700 dark:text-green-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  Active ({activeIds.length} key{activeIds.length > 1 ? 's' : ''} enabled - rotating for parallel requests)
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500"></span>
                  Disabled (no key selected)
                </span>
              )}
            </div>
          </div>
          {hasActiveKey && (
            <button 
              type="button" 
              className="btn-danger px-6 py-2.5" 
              onClick={handleDisable} 
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="spinner"></span>
                  Disabling...
                </span>
              ) : (
                "Disable"
              )}
            </button>
          )}
        </div>
      </div>

      {/* Performance */}
      <div className="card hover:shadow-xl transition-shadow mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="text-lg font-bold text-slate-900 dark:text-white">Performance (Per-Key Concurrency)</div>
            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Số request song song <strong>mỗi API key</strong>.
              {activeIds.length > 0 && (
                <span className="text-violet-600 dark:text-violet-400 font-medium ml-1">
                  Bạn có {activeIds.length} keys × {concurrency} = <strong>{activeIds.length * concurrency} request song song</strong> tổng cộng.
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 w-48">Per-key concurrency (1–8)</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  value={concurrencyInput}
                  onChange={(e) => setConcurrencyInput(e.target.value)}
                  className="input-field bg-slate-50 dark:bg-slate-700 w-28"
                />
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Current: {concurrency}/key
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={Number(concurrencyInput) || concurrency}
                  onChange={(e) => setConcurrencyInput(e.target.value)}
                  className="flex-1"
                />
                <button
                  onClick={handleSaveConcurrency}
                  disabled={loading}
                  className="btn-primary px-4"
                >
                  Save
                </button>
              </div>
              
              {activeIds.length > 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 p-2 rounded">
                  💡 Ví dụ: {activeIds.length} keys × {concurrency} concurrency = {activeIds.length * concurrency} requests chạy song song cùng lúc trên server Google.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add API Key Card */}
      <div className="card hover:shadow-xl transition-shadow mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-white">Add New API Key</div>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Key Name
            </label>
            <input
              className="input-field w-full"
              placeholder="e.g., Personal Key, Work Key..."
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value)
                if (error) setError('')
              }}
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              API Key
            </label>
            <input
              className="input-field w-full font-mono"
              type="password"
              placeholder="Paste your Gemini API key here..."
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value)
                if (error) setError('')
              }}
              disabled={loading}
            />
          </div>

          <div className="flex items-center justify-end">
            <button 
              type="button" 
              className="btn-primary px-8 py-2.5 flex items-center gap-2" 
              onClick={handleAdd} 
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save Key
                </>
              )}
            </button>
          </div>
        </div>

        {(statusMsg || error) && (
          <div className="mt-4">
            {statusMsg && (
              <div className="alert-success">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {statusMsg}
              </div>
            )}
            {error && (
              <div className="alert-error">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* API Keys List Card */}
      <div className="card hover:shadow-xl transition-shadow">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 flex items-center justify-center shadow-md">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">Your API Keys</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">Select multiple keys for parallel API calls (keys rotate automatically)</div>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton h-16 rounded-xl"></div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">
            <svg className="w-16 h-16 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <div className="text-sm font-medium">No API keys yet</div>
            <div className="text-xs mt-1">Add your first key above to get started</div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((it) => {
              const isActive = activeIds.includes(it.id)
              return (
              <div 
                key={it.id} 
                className={`flex items-center gap-4 p-4 border-2 rounded-xl transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border-violet-500 shadow-md"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-md"
                }`}
              >
                <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => handleToggle(it.id, e.target.checked)}
                    disabled={loading}
                    className="w-5 h-5 text-violet-600 focus:ring-2 focus:ring-violet-500 rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {it.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{it.masked}</div>
                  </div>
                  {isActive && (
                    <span className="badge bg-gradient-to-r from-violet-500 to-purple-600 text-white px-3 py-1">
                      Active
                    </span>
                  )}
                </label>
                <button 
                  type="button" 
                  className="btn-danger px-4 py-2" 
                  onClick={() => handleDelete(it.id)} 
                  disabled={loading}
                >
                  Delete
                </button>
              </div>
            )})}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
