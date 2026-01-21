import React, { useState, useEffect, useRef, useMemo } from 'react'
import { POS_OPTIONS, normalizePos } from '../posOptions/posOptions'
import './PendingWordsSidebar.css'

interface Rect {
  xPct: number
  yPct: number
  wPct: number
  hPct: number
}

export interface PendingWord {
  id: string
  text: string
  pageNumber: number
  rects: Rect[]
  contextSentenceEn: string
  // Auto-fetched data
  word: string
  meaning: string
  pronunciation: string
  pos: string
  example: string
  contextVi: string
  candidates: AutoMeaningCandidate[]
  // Loading states
  isApiLoading: boolean
  isApiComplete: boolean
  apiError?: string
}

type AutoMeaningCandidate = { vi: string; pos?: string; back?: string[] }

interface Props {
  pendingWords: PendingWord[]
  onSave: (wordId: string, word: string, meaning: string, pronunciation: string, pos: string, example: string) => void
  onRemove: (wordId: string) => void
  onUpdateWord: (wordId: string, updates: Partial<PendingWord>) => void
  onSaveAll?: () => void
  saveAllDisabled?: boolean
}

// Individual word item in the sidebar list
function PendingWordItem({
  item,
  isSelected,
  onClick
}: {
  item: PendingWord
  isSelected: boolean
  onClick: () => void
}) {
  const displayText = String(item.word || item.text || '').trim() || String(item.text || '')
  return (
    <div
      className={`pending-word-item ${isSelected ? 'selected' : ''} ${item.isApiComplete ? 'api-complete' : ''}`}
      onClick={onClick}
    >
      <div className="pending-word-content">
        <div className="pending-word-text">{displayText}</div>
        {item.meaning && (
          <div className="pending-word-meaning">{item.meaning}</div>
        )}
      </div>
      <div className="pending-word-status">
        {item.isApiLoading ? (
          <div className="loading-spinner" />
        ) : item.isApiComplete ? (
          <svg className="check-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : item.apiError ? (
          <svg className="error-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        ) : (
          <div className="pending-dot" />
        )}
      </div>
    </div>
  )
}

// Edit form when a word is selected
function WordEditForm({
  item,
  onSave,
  onRemove,
  onClose,
  onUpdateWord
}: {
  item: PendingWord
  onSave: (word: string, meaning: string, pronunciation: string, pos: string, example: string) => void
  onRemove: () => void
  onClose: () => void
  onUpdateWord: (updates: Partial<PendingWord>) => void
}) {
  const [word, setWord] = useState(item.word || item.text)
  const [meaning, setMeaning] = useState(item.meaning || '')
  const [pronunciation, setPronunciation] = useState(item.pronunciation || '')
  const [pos, setPos] = useState(item.pos || '')
  const [example, setExample] = useState(item.example || '')
  const [errorMessage, setErrorMessage] = useState('')

  // Sync from item when API completes
  useEffect(() => {
    if (item.meaning && !meaning) setMeaning(item.meaning)
    if (item.pronunciation && !pronunciation) setPronunciation(item.pronunciation)
    if (item.pos && !pos) setPos(item.pos)
    if (item.example && !example) setExample(item.example)
  }, [item.meaning, item.pronunciation, item.pos, item.example])

  const ensureIpaSlashes = (val: string) => {
    const v = (val || '').trim().replace(/"/g, '')
    if (!v) return ''
    const core = v.replace(/^\/+|\/+$/g, '')
    return `/${core}/`
  }

  const handleSave = () => {
    if (!word.trim() || !meaning.trim() || !pos.trim()) {
      setErrorMessage('Cần điền: từ, nghĩa, và loại từ')
      setTimeout(() => setErrorMessage(''), 3000)
      return
    }
    onSave(word.trim(), meaning.trim(), ensureIpaSlashes(pronunciation), pos.trim(), example.trim())
  }

  const handleSelectCandidate = (candidate: AutoMeaningCandidate) => {
    setMeaning(candidate.vi)
    onUpdateWord({ meaning: candidate.vi })
    if (candidate.pos) {
      const normalized = normalizePos(candidate.pos)
      if (normalized) {
        setPos(normalized)
        onUpdateWord({ pos: normalized })
      }
    }
  }

  return (
    <div className="word-edit-form">
      <div className="edit-form-header">
        <h3>Thêm từ</h3>
        <button className="close-btn" onClick={onClose} title="Đóng">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {errorMessage && (
        <div className="error-message">{errorMessage}</div>
      )}

      {/* Context sentence */}
      {item.contextSentenceEn && (
        <div className="context-section">
          <div className="context-label">Ngữ cảnh:</div>
          <div className="context-text">{item.contextSentenceEn}</div>
          {item.contextVi && (
            <div className="context-text-vi">{item.contextVi}</div>
          )}
        </div>
      )}

      {/* Word input */}
      <div className="form-group">
        <label>Từ</label>
        <input
          type="text"
          value={word}
          onChange={(e) => {
            const v = e.target.value
            setWord(v)
            onUpdateWord({ word: v })
          }}
          placeholder="Nhập từ..."
        />
      </div>

      {/* Meaning input with loading indicator */}
      <div className="form-group">
        <label>
          Nghĩa
          {item.isApiLoading && <span className="loading-text"> (đang tải...)</span>}
        </label>
        <input
          type="text"
          value={meaning}
          onChange={(e) => {
            const v = e.target.value
            setMeaning(v)
            onUpdateWord({ meaning: v })
          }}
          placeholder="Nhập nghĩa..."
        />
      </div>

      {/* Meaning candidates */}
      {item.candidates && item.candidates.length > 0 && (
        <div className="candidates-section">
          <div className="candidates-label">Gợi ý:</div>
          <div className="candidates-list">
            {item.candidates.map((c, i) => (
              <button
                key={i}
                className={`candidate-chip ${meaning === c.vi ? 'selected' : ''}`}
                onClick={() => handleSelectCandidate(c)}
              >
                {c.vi}
                {c.pos && <span className="candidate-pos">({c.pos})</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* POS select */}
      <div className="form-group">
        <label>Loại từ</label>
        <select
          value={pos}
          onChange={(e) => {
            const v = e.target.value
            setPos(v)
            onUpdateWord({ pos: v })
          }}
        >
          <option value="">-- Chọn --</option>
          {POS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Pronunciation input */}
      <div className="form-group">
        <label>Phát âm (IPA)</label>
        <input
          type="text"
          value={pronunciation}
          onChange={(e) => {
            const v = e.target.value
            setPronunciation(v)
            onUpdateWord({ pronunciation: v })
          }}
          placeholder="/ˈeksəmpəl/"
        />
      </div>

      {/* Example input */}
      <div className="form-group">
        <label>Ví dụ</label>
        <textarea
          value={example}
          onChange={(e) => {
            const v = e.target.value
            setExample(v)
            onUpdateWord({ example: v })
          }}
          placeholder="Nhập câu ví dụ..."
          rows={2}
        />
      </div>

      {/* Action buttons */}
      <div className="form-actions">
        <button className="btn-remove" onClick={onRemove}>
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Xóa
        </button>
        <button className="btn-save" onClick={handleSave}>
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Lưu
        </button>
      </div>
    </div>
  )
}

export default function PendingWordsSidebar({
  pendingWords,
  onSave,
  onRemove,
  onUpdateWord,
  onSaveAll,
  saveAllDisabled
}: Props) {
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null)
  const selectedWord = pendingWords.find((w) => w.id === selectedWordId)

  const saveableCount = useMemo(() => {
    return (Array.isArray(pendingWords) ? pendingWords : []).filter((w) => {
      if (!w) return false
      if (!w.isApiComplete) return false
      if (w.isApiLoading) return false
      if (w.apiError) return false
      const word = String(w.word || w.text || '').trim()
      const meaning = String(w.meaning || '').trim()
      const pos = String(w.pos || '').trim()
      return !!word && !!meaning && !!pos
    }).length
  }, [pendingWords])

  // Auto-select the first word if none selected and there are pending words
  useEffect(() => {
    if (!selectedWordId && pendingWords.length > 0) {
      setSelectedWordId(pendingWords[0].id)
    }
    // If selected word was removed, clear selection
    if (selectedWordId && !pendingWords.find((w) => w.id === selectedWordId)) {
      setSelectedWordId(pendingWords.length > 0 ? pendingWords[0].id : null)
    }
  }, [pendingWords, selectedWordId])

  if (pendingWords.length === 0) {
    return (
      <div className="pending-words-sidebar empty">
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <p>Chọn từ trong PDF để thêm vào danh sách</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pending-words-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <h3>Từ đang xử lý ({pendingWords.length})</h3>
          {onSaveAll && (
            <button
              type="button"
              className="btn-save-all"
              onClick={onSaveAll}
              disabled={!!saveAllDisabled || saveableCount === 0}
              title={saveableCount === 0 ? 'Chưa có từ nào dịch xong đủ dữ liệu để lưu' : 'Lưu tất cả từ đã dịch xong'}
            >
              Save all ({saveableCount})
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-content">
        {/* List of pending words */}
        <div className="pending-words-list">
          {pendingWords.map((item) => (
            <PendingWordItem
              key={item.id}
              item={item}
              isSelected={selectedWordId === item.id}
              onClick={() => setSelectedWordId(item.id)}
            />
          ))}
        </div>

        {/* Edit form for selected word */}
        {selectedWord && (
          <WordEditForm
            key={selectedWord.id}
            item={selectedWord}
            onSave={(word, meaning, pronunciation, pos, example) => {
              onSave(selectedWord.id, word, meaning, pronunciation, pos, example)
            }}
            onRemove={() => onRemove(selectedWord.id)}
            onClose={() => setSelectedWordId(null)}
            onUpdateWord={(updates) => onUpdateWord(selectedWord.id, updates)}
          />
        )}
      </div>
    </div>
  )
}
