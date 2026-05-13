import React, { useState, useEffect, useRef, useMemo } from 'react'
import './TypingGameView.css'
import { VocabularyStore, useVocabularyStore } from '../../store/VocabularyStore'
import { playSound } from '../../utils/sounds'

type GameState = 'menu' | 'playing' | 'paused' | 'gameover'
type PracticeDuration = '1min' | '5min' | '10min' | 'unlimited'

type VocabEntry = { entry: string; meaning: string; pos?: string }
type PracticeToken = { word: string; meaning: string; pos?: string; groupId: string; groupText: string }

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function TypingGameView() {
  useVocabularyStore()
  
  const [gameState, setGameState] = useState<GameState>('menu')
  const [practiceDuration, setPracticeDuration] = useState<PracticeDuration>('1min')
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [wordsCompleted, setWordsCompleted] = useState(0)
  const [wordsAttempted, setWordsAttempted] = useState(0)
  const [practiceInput, setPracticeInput] = useState('')
  const [startTime, setStartTime] = useState<number>(0)
  const [inputStatus, setInputStatus] = useState<'neutral' | 'correct' | 'incorrect'>('neutral')
  const [currentWordIndex, setCurrentWordIndex] = useState(0)
  const [windowStartIndex, setWindowStartIndex] = useState(0)
  const [practiceWords, setPracticeWords] = useState<PracticeToken[]>([])
  const [wordResults, setWordResults] = useState<Record<number, 'correct' | 'wrong'>>({})
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [lastCompletedMeaning, setLastCompletedMeaning] = useState<{
    text: string
    meaning: string
    pos?: string
  } | null>(null)

  const nextGroupIdRef = useRef(1)

  const inputRef = useRef<HTMLInputElement>(null)
  const linesBoxRef = useRef<HTMLDivElement>(null)
  const [linesBoxWidth, setLinesBoxWidth] = useState(900)

  // Get words from VocabularyStore
  const availableEntries = useMemo<VocabEntry[]>(() => {
    const allVocab = VocabularyStore.getAll()
    return allVocab
      .filter(v => v.state !== 'new' && v.word && v.word.trim())
      .map(v => ({
        entry: String(v.word || '').trim(),
        meaning: v.meaning || '',
        pos: (v as any).pos,
      }))
      .filter(v => v.entry.length > 0)
  }, [gameState])

  const availableTokenCount = useMemo(() => {
    let count = 0
    for (const e of availableEntries) {
      count += e.entry.split(/\s+/g).filter(Boolean).length
    }
    return count
  }, [availableEntries])

  const generatePracticeTokens = (targetTokenCount: number): PracticeToken[] => {
    if (availableEntries.length === 0) return []
    if (targetTokenCount <= 0) return []

    const tokens: PracticeToken[] = []
    let pool = shuffle([...availableEntries])
    let poolIndex = 0

    while (tokens.length < targetTokenCount) {
      if (poolIndex >= pool.length) {
        pool = shuffle([...availableEntries])
        poolIndex = 0
      }

      const entry = pool[poolIndex++]
      const words = entry.entry.split(/\s+/g).filter(Boolean)
      if (words.length === 0) continue

      const groupId = `g${nextGroupIdRef.current++}`
      for (const w of words) {
        tokens.push({ word: w, meaning: entry.meaning, pos: entry.pos, groupId, groupText: entry.entry })
      }
    }

    return tokens
  }

  // Focus input when game starts
  useEffect(() => {
    if (gameState === 'playing') {
      inputRef.current?.focus()
    }
  }, [gameState])

  // Track practice lines container width
  useEffect(() => {
    const el = linesBoxRef.current
    if (!el) return

    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return

      // Use inner content width (exclude padding + border) so our line-fit math
      // matches the actual render area; otherwise words can get clipped.
      const style = window.getComputedStyle(el)
      const paddingLeft = parseFloat(style.paddingLeft || '0') || 0
      const paddingRight = parseFloat(style.paddingRight || '0') || 0
      const borderLeft = parseFloat(style.borderLeftWidth || '0') || 0
      const borderRight = parseFloat(style.borderRightWidth || '0') || 0
      const innerWidth = rect.width - paddingLeft - paddingRight - borderLeft - borderRight

      if (innerWidth > 0) setLinesBoxWidth(innerWidth)
    }

    update()

    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Practice mode timer
  useEffect(() => {
    if (gameState !== 'playing' || timeRemaining === null) return
    
    if (timeRemaining <= 0) {
      setGameState('gameover')
      playSound('success')
      return
    }
    
    const timer = setInterval(() => {
      setTimeRemaining(t => t !== null && t > 0 ? t - 1 : t)
    }, 1000)
    
    return () => clearInterval(timer)
  }, [gameState, timeRemaining])

  const submitCurrentWord = () => {
    if (gameState !== 'playing') return
    if (currentWordIndex >= practiceWords.length) return

    const currentWord = practiceWords[currentWordIndex]
    const targetWord = currentWord.word.toLowerCase()
    const typed = practiceInput.trim().toLowerCase()

    if (!typed) return

    const isCorrect = typed === targetWord
    setWordsAttempted(a => a + 1)
    setWordResults(prev => ({ ...prev, [currentWordIndex]: isCorrect ? 'correct' : 'wrong' }))

    const nextIndex = currentWordIndex + 1

    // A "group" corresponds to one deck entry (single word or multi-word phrase).
    // Only play feedback sound when the group is finished.
    const isGroupComplete =
      nextIndex >= practiceWords.length ||
      practiceWords[nextIndex]?.groupId !== currentWord.groupId

    if (isCorrect) {
      const baseScore = currentWord.word.length * 10
      const comboMultiplier = 1 + combo * 0.1
      setScore(s => s + Math.floor(baseScore * comboMultiplier))
      setCombo(c => {
        const newCombo = c + 1
        setMaxCombo(m => Math.max(m, newCombo))
        return newCombo
      })
      setWordsCompleted(w => w + 1)
    } else {
      setCombo(0)
    }

    if (isGroupComplete) {
      playSound(isCorrect ? 'correct' : 'incorrect')
    }

    // If this token completes the group (single-word entry or end of phrase), show meaning.
    if (isGroupComplete) {
      setLastCompletedMeaning({
        text: currentWord.groupText,
        meaning: currentWord.meaning,
        pos: currentWord.pos,
      })
    }

    setCurrentWordIndex(nextIndex)
    setPracticeInput('')
    setInputStatus('neutral')

    // Ensure we never run out of words (timed and unlimited)
    if (nextIndex >= practiceWords.length - 10) {
      const moreWords = generatePracticeTokens(120)
      if (moreWords.length > 0) setPracticeWords(prev => [...prev, ...moreWords])
    }
  }

  // Handle practice mode input
  const handlePracticeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Disallow whitespace inside the input; space is used to submit.
    const value = e.target.value.replace(/\s+/g, '')
    setPracticeInput(value)

    if (currentWordIndex >= practiceWords.length) return

    const currentWord = practiceWords[currentWordIndex]
    const targetWord = currentWord.word.toLowerCase()

    // Check if matches
    if (targetWord.startsWith(value.toLowerCase())) {
      setInputStatus('correct')
    } else {
      setInputStatus('incorrect')
    }
  }

  // Compute 2-line window (stable until a line is completed)
  const { line1End, line2End } = useMemo(() => {
    const start = windowStartIndex
    const words = practiceWords
    if (words.length === 0) return { line1End: start, line2End: start }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return { line1End: Math.min(start + 1, words.length), line2End: Math.min(start + 2, words.length) }

    // Match Tailwind `text-4xl font-mono` reasonably well
    const fontSizePx = 36
    ctx.font = `${fontSizePx}px 'JetBrains Mono', 'Fira Code', Consolas, monospace`

    const paddingX = 8 // px-2
    const gapX = 16 // gap-x-4
    const available = Math.max(200, linesBoxWidth)

    const computeEnd = (from: number) => {
      let x = 0
      let i = from
      for (; i < words.length; i++) {
        const w = words[i].word
        const wWidth = ctx.measureText(w).width + paddingX * 2
        const add = (i === from ? wWidth : gapX + wWidth)
        if (x + add > available && i > from) break
        x += add
      }

      let end = Math.max(from + 1, i)

      // Best-effort: avoid breaking a multi-word phrase between lines.
      // If the boundary would split a group, move the entire group to the next line
      // (unless the group starts at `from`, meaning it wouldn't fit as a unit).
      if (end < words.length) {
        const leftGroup = words[end - 1]?.groupId
        const rightGroup = words[end]?.groupId
        if (leftGroup && rightGroup && leftGroup === rightGroup) {
          let groupStart = end - 1
          while (groupStart > from && words[groupStart - 1].groupId === leftGroup) {
            groupStart--
          }
          if (groupStart > from) {
            end = groupStart
          }
        }
      }

      return end
    }

    const l1 = computeEnd(start)
    const l2 = computeEnd(l1)
    return { line1End: l1, line2End: l2 }
  }, [practiceWords, windowStartIndex, linesBoxWidth])

  // When user finishes line 1, shift line 2 up to line 1
  useEffect(() => {
    if (gameState !== 'playing') return
    if (line1End <= windowStartIndex) return
    if (currentWordIndex >= line1End) {
      setWindowStartIndex(line1End)
    }
  }, [gameState, currentWordIndex, line1End, windowStartIndex])

  // Start game
  const startGame = () => {
    if (availableTokenCount < 5) {
      return
    }
    setGameState('playing')
    setScore(0)
    setCombo(0)
    setMaxCombo(0)
    setWordsCompleted(0)
    setWordsAttempted(0)
    setStartTime(Date.now())
    setInputStatus('neutral')
    setWordResults({})
    setLastCompletedMeaning(null)
    
    nextGroupIdRef.current = 1
    const words = generatePracticeTokens(220)
    setPracticeWords(words)
    setCurrentWordIndex(0)
    setWindowStartIndex(0)
    setPracticeInput('')
    
    // Set timer
    if (practiceDuration === '1min') setTimeRemaining(60)
    else if (practiceDuration === '5min') setTimeRemaining(300)
    else if (practiceDuration === '10min') setTimeRemaining(600)
    else setTimeRemaining(null)
  }

  // Pause/Resume
  const togglePause = () => {
    if (gameState === 'playing') {
      setGameState('paused')
    } else if (gameState === 'paused') {
      setGameState('playing')
      inputRef.current?.focus()
    }
  }

  // Calculate word accuracy
  const accuracy = wordsAttempted > 0 ? Math.round((wordsCompleted / wordsAttempted) * 100) : 100

  // Calculate WPM
  const elapsedMinutes = gameState !== 'menu' ? (Date.now() - startTime) / 60000 : 0
  const wpm = elapsedMinutes > 0 ? Math.round(wordsCompleted / elapsedMinutes) : 0

  const line1Words = practiceWords.slice(windowStartIndex, line1End)
  const line2Words = practiceWords.slice(line1End, line2End)

  return (
    <div className="typing-game-container relative">
      {/* Menu Screen */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
          <div className="text-center mb-12">
            <h1 className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400 mb-4">
              ⌨️ Luyện Gõ 10 Ngón
            </h1>
            <p className="text-xl text-slate-400">Luyện tập với từ vựng của bạn</p>
          </div>

          {/* Word count info */}
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/50 rounded-xl border border-slate-700">
              <span className="text-slate-400">Số từ có sẵn:</span>
              <span className={`font-bold ${availableTokenCount >= 5 ? 'text-emerald-400' : 'text-red-400'}`}>
                {availableTokenCount}
              </span>
            </div>
            {availableTokenCount < 5 && (
              <p className="text-red-400 text-sm mt-2">
                Cần ít nhất 5 từ đã học để luyện tập!
              </p>
            )}
          </div>

          {/* Duration selection */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-slate-300 mb-4 text-center">Thời gian</h3>
            <div className="grid grid-cols-2 gap-3">
              {(['1min', '5min', '10min', 'unlimited'] as PracticeDuration[]).map(d => (
                <button
                  key={d}
                  onClick={() => setPracticeDuration(d)}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                    practiceDuration === d
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30'
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border border-slate-700'
                  }`}
                >
                  {d === '1min' && '⏱️ 1 phút'}
                  {d === '5min' && '⏱️ 5 phút'}
                  {d === '10min' && '⏱️ 10 phút'}
                  {d === 'unlimited' && '∞ Vô thời hạn'}
                </button>
              ))}
            </div>
          </div>

          {/* Start Button */}
          <button
            onClick={startGame}
            disabled={availableTokenCount < 5}
            className={`px-12 py-4 rounded-2xl font-bold text-xl transition-all ${
              availableTokenCount >= 5
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-105'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            🚀 Bắt đầu luyện tập
          </button>

          {/* Instructions */}
          <div className="mt-12 max-w-md text-center">
            <h3 className="text-lg font-semibold text-slate-300 mb-3">Cách chơi</h3>
            <ul className="text-slate-400 text-sm space-y-2">
              <li>⌨️ Gõ các từ tiếng Anh theo thứ tự từ trái sang phải</li>
              <li>🎯 Từ hiện tại có nền xám - gõ xong tự động chuyển từ tiếp theo</li>
              <li>⚡ Gõ nhanh và chính xác để tăng WPM và điểm</li>
              <li>📊 Kết quả tính theo số từ/phút (WPM)</li>
            </ul>
          </div>
        </div>
      )}

      {/* Game Screen */}
      {(gameState === 'playing' || gameState === 'paused') && (
        <>
          {/* Stats Panel - Top */}
          <div className="absolute top-0 left-0 right-0 z-20 p-4">
            <div className="stats-panel rounded-2xl p-4 flex items-center justify-between">
              {/* Timer */}
              <div className="flex items-center gap-6">
                {timeRemaining !== null ? (
                  <div className="text-center">
                    <div className="text-xs text-slate-400 uppercase tracking-wide">Thời gian</div>
                    <div className={`text-3xl font-bold ${
                      timeRemaining <= 10 ? 'text-red-400 animate-pulse' : 
                      timeRemaining <= 30 ? 'text-amber-400' : 'text-cyan-400'
                    }`}>
                      {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="text-xs text-slate-400 uppercase tracking-wide">Số từ</div>
                    <div className="text-3xl font-bold text-cyan-400">{wordsCompleted}</div>
                  </div>
                )}
              </div>

              {/* Center - Combo */}
              {combo > 0 && (
                <div className="combo-counter text-center">
                  <div className="text-3xl font-bold text-amber-400">
                    {combo}x
                  </div>
                  <div className="text-xs text-amber-300">COMBO</div>
                </div>
              )}

              {/* Right stats */}
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-wide">WPM</div>
                  <div className="text-2xl font-bold text-blue-400">{wpm}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-wide">Độ chính xác</div>
                  <div className={`text-2xl font-bold ${accuracy >= 90 ? 'text-emerald-400' : accuracy >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                    {accuracy}%
                  </div>
                </div>
                <button
                  onClick={togglePause}
                  className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 transition-colors"
                >
                  {gameState === 'paused' ? '▶️' : '⏸️'}
                </button>
                <button
                  onClick={() => {
                    setGameState('gameover')
                    playSound('success')
                  }}
                  className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 transition-colors"
                  title="Dừng và xem kết quả"
                >
                  ⏹️
                </button>
              </div>
            </div>
          </div>

          {/* Practice Area - Center (input anchored to screen center) */}
          <div className="absolute inset-0 px-8 pt-28 pb-10">
            <div className="h-full w-full max-w-6xl mx-auto flex flex-col items-center justify-center gap-6">
              {currentWordIndex < practiceWords.length ? (
                <>
                  {/* Two-line word display (stable window; shifts only when line 1 completed) */}
                  <div className="w-full">
                    {lastCompletedMeaning && (
                      <div className="mb-4 mx-auto w-full max-w-5xl text-center">
                        <div className="inline-flex flex-col items-center gap-1.5 px-5 py-3 rounded-2xl bg-slate-900/50 border border-slate-700">
                          <div className="text-[20px] text-slate-400 uppercase tracking-wide">Nghĩa vừa gõ</div>
                          <div className="text-slate-100 text-xl leading-snug">
                            {lastCompletedMeaning.meaning?.trim() ? lastCompletedMeaning.meaning : '(chưa có nghĩa)'}
                          </div>
                          {String(lastCompletedMeaning.pos || '').trim() && (
                            <div className="text-slate-400 text-sm">{lastCompletedMeaning.pos}</div>
                          )}
                          <div className="text-slate-400 text-sm">{lastCompletedMeaning.text}</div>
                        </div>
                      </div>
                    )}
                    <div
                      ref={linesBoxRef}
                      className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900/40 p-6"
                    >
                      <div className="text-4xl font-mono leading-relaxed flex flex-nowrap gap-x-4 overflow-hidden">
                        {line1Words.map((w, idx) => {
                          const absoluteIndex = windowStartIndex + idx
                          const isActive = absoluteIndex === currentWordIndex
                          const isDone = absoluteIndex < currentWordIndex
                          const result = wordResults[absoluteIndex]
                          const base = 'px-2 py-1 rounded'

                          return (
                            <span
                              key={absoluteIndex}
                              className={`${base} ${
                                isActive
                                  ? 'bg-slate-700/70'
                                  : isDone
                                    ? (result === 'wrong' ? 'text-red-400' : 'text-slate-500')
                                    : 'text-slate-400'
                              }`}
                            >
                              {isActive ? (
                                <>
                                  <span className="text-white">{w.word.slice(0, practiceInput.length)}</span>
                                  <span className="text-slate-400">{w.word.slice(practiceInput.length)}</span>
                                </>
                              ) : (
                                w.word
                              )}
                            </span>
                          )
                        })}
                      </div>

                      <div className="mt-3 text-4xl font-mono leading-relaxed flex flex-nowrap gap-x-4 overflow-hidden">
                        {line2Words.map((w, idx) => {
                          const absoluteIndex = line1End + idx
                          const isActive = absoluteIndex === currentWordIndex
                          const isDone = absoluteIndex < currentWordIndex
                          const result = wordResults[absoluteIndex]
                          const base = 'px-2 py-1 rounded'

                          return (
                            <span
                              key={absoluteIndex}
                              className={`${base} ${
                                isActive
                                  ? 'bg-slate-700/70'
                                  : isDone
                                    ? (result === 'wrong' ? 'text-red-400' : 'text-slate-500')
                                    : 'text-slate-400'
                              }`}
                            >
                              {isActive ? (
                                <>
                                  <span className="text-white">{w.word.slice(0, practiceInput.length)}</span>
                                  <span className="text-slate-400">{w.word.slice(practiceInput.length)}</span>
                                </>
                              ) : (
                                w.word
                              )}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Input */}
                  <div className="w-full">
                    <input
                      ref={inputRef}
                      type="text"
                      value={practiceInput}
                      onChange={handlePracticeInput}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
                          e.preventDefault()
                          submitCurrentWord()
                        }
                      }}
                      disabled={gameState === 'paused'}
                      placeholder={gameState === 'paused' ? 'TẠM DỪNG' : 'Gõ từ hiện tại rồi nhấn Space...'}
                      className={`typing-input block w-full max-w-2xl mx-auto px-6 py-4 rounded-2xl text-2xl text-center text-white font-mono
                        placeholder:text-slate-500 outline-none ${inputStatus}`}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                    />
                    <div className="mt-3 text-center text-sm text-slate-400">
                      Nhấn <span className="text-slate-200 font-semibold">Space</span> để chuyển sang từ tiếp theo.
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-4xl font-bold text-emerald-400">
                  ✅ Hoàn thành!
                </div>
              )}
            </div>
          </div>

          {/* Pause Overlay */}
          {gameState === 'paused' && (
            <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center backdrop-blur-sm">
              <div className="text-center">
                <h2 className="text-4xl font-bold text-white mb-6">⏸️ Tạm dừng</h2>
                <button
                  onClick={togglePause}
                  className="px-8 py-3 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-cyan-500/30 transition-all"
                >
                  Tiếp tục
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Game Over Screen */}
      {gameState === 'gameover' && (
        <div className="game-over-overlay absolute inset-0 z-40 flex items-center justify-center">
          <div className="text-center p-8 max-w-lg">
            <h1 className="text-5xl font-bold text-emerald-500 mb-2">✅ Hoàn thành!</h1>
            <p className="text-slate-400 mb-8">Kết quả luyện gõ của bạn</p>

            {/* Final Stats */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                <div className="text-3xl font-bold text-cyan-400">{wordsCompleted}</div>
                <div className="text-sm text-slate-400">Số từ đã gõ</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                <div className="text-3xl font-bold text-blue-400">{wpm}</div>
                <div className="text-sm text-slate-400">WPM</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                <div className={`text-3xl font-bold ${accuracy >= 90 ? 'text-emerald-400' : accuracy >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                  {accuracy}%
                </div>
                <div className="text-sm text-slate-400">Độ chính xác</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                <div className="text-3xl font-bold text-amber-400">{maxCombo}x</div>
                <div className="text-sm text-slate-400">Combo cao nhất</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 justify-center">
              <button
                onClick={startGame}
                className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-emerald-500/30 transition-all"
              >
                🔄 Luyện lại
              </button>
              <button
                onClick={() => setGameState('menu')}
                className="px-8 py-3 bg-slate-700 text-slate-300 rounded-xl font-semibold hover:bg-slate-600 transition-all"
              >
                📋 Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
