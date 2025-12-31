import React, { useState, useEffect, useRef } from 'react'
import ErrorBoundary from '../shared/ErrorBoundary'
import { useLocation } from 'react-router-dom'
import { usePersistedState } from '../shared/usePersistedState'

declare const window:any

function shuffle<T>(a:T[]){
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
  return a
}

type Card = {
  word: string;
  meaning: string;
  pronunciation?: string;
  source?: string;
}

export default function Study(){
  const location = useLocation();
  const [tree, setTree] = useState<any[]>([])
  const [selectedFiles, setSelectedFiles] = usePersistedState<string[]>('study_selectedFiles', [])
  const [deck, setDeck] = usePersistedState<Card[]>('study_deck', [])
  const [queue, setQueue] = usePersistedState<Card[]>('study_queue', [])
  const [index, setIndex] = usePersistedState<number>('study_index', 0)
  const [revealLevel, setRevealLevel] = useState(0) // 0 = all underscores, 1+ = reveal that many chars
  const [input, setInput] = useState("")
  const [phase, setPhase] = usePersistedState<'idle'|'studying'|'review-result'|'summary'>('study_phase', 'idle')
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null)
  const [toReview, setToReview] = usePersistedState<Card[]>('study_toReview', [])
  const [stats, setStats] = usePersistedState('study_stats', { correct: 0, incorrect: 0, hard: 0, easy: 0 })
  const inputRef = useRef<HTMLInputElement|null>(null)

  useEffect(()=>{ window.api.listTree().then((t:any)=>setTree(t)) }, [])

  // Auto-start if files are passed via navigation state
  useEffect(() => {
    const state = (location.state as { selectedFiles?: string[] } | null);
    if (state?.selectedFiles && state.selectedFiles.length > 0) {
      setSelectedFiles(state.selectedFiles);
      // Auto-start study with these files
      setTimeout(() => {
        handleAutoStart(state.selectedFiles!);
      }, 100);
    }
  }, [location]);

  async function handleAutoStart(files: string[]) {
    const cards = await fetchCsvForFiles(files)
    const shuffled = shuffle(cards)
    setDeck(shuffled)
    setQueue(shuffled.slice())
    setIndex(0)
    setPhase('studying')
    setRevealLevel(0)
    setToReview([])
    setLastAnswerCorrect(null)
    setInput('')
    setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
  }

  async function fetchCsvForFiles(files:string[]) {
    const all: Card[] = []
    for(const f of files){
      try{
        const rows = await window.api.readCsv(f)
        for(const r of rows){
          if (!r.word || !r.meaning) continue
          all.push({ word: String(r.word), meaning: String(r.meaning), pronunciation: r.pronunciation || '', source: f })
        }
      }catch(err){
        console.error('readCsv error', f, err)
      }
    }
    return all
  }

  function maskWordAllUnderscore(w:string, revealCount:number){
    if (!w) return ''
    const chars = w.split('')
    if (revealCount <= 0) return chars.map(()=> '_').join(' ')
    const total = chars.length
    const reveal = Math.min(total, revealCount)
    return chars.map((ch,i)=> i < reveal ? ch : '_').join(' ')
  }

  async function lookupIPA(word:string){
    if (!word) return ''
    try{
      const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
      if (!resp.ok) return ''
      const data = await resp.json()
      if (Array.isArray(data) && data[0].phonetics && data[0].phonetics.length>0){
        const ph = data[0].phonetics.find((p:any)=>p.text && p.text.includes('/'))
        if (ph && ph.text) return ph.text.replace(/\//g,'')
        return data[0].phonetics[0].text?.replace(/\//g,'') || ''
      }
      return ''
    }catch(err){
      console.error('IPA lookup failed', err)
      return ''
    }
  }

  async function start(){
    const cards = await fetchCsvForFiles(selectedFiles)
    const shuffled = shuffle(cards)
    setDeck(shuffled)
    setQueue(shuffled.slice())
    setIndex(0)
    setPhase('studying')
    setRevealLevel(0)
    setToReview([])
    setLastAnswerCorrect(null)
    setInput('')
    setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
  }

  // handle submit answer
  async function submitAnswer(){
    if (phase !== 'studying') return
    const card = queue[index]
    if (!card) return
    const normalized = (input||'').trim().toLowerCase()
    const correct = (card.word||'').trim().toLowerCase()
    const isCorrect = normalized === correct
    setLastAnswerCorrect(isCorrect)
    // if pronunciation missing, try lookup
    if (!card.pronunciation) {
      const ipa = await lookupIPA(card.word)
      if (ipa) card.pronunciation = ipa
    }
    if (isCorrect) {
      setStats((s) => ({ ...s, correct: s.correct + 1 }))
    } else {
      setStats((s) => ({ ...s, incorrect: s.incorrect + 1 }))
      setToReview((t)=>[...t, card])
    }
    setPhase('review-result')
  }

  // user choice after reveal: 1 replay, 2 easy, 3 hard
  function handleChoice(choice: 1|2|3){
    const card = queue[index]
    if (!card) return
    if (choice === 1){
      // replay: push same card next
      setQueue((q)=>{ const nq=q.slice(); nq.splice(index+1,0,card); return nq })
    } else if (choice === 2){
      // mark easy: do nothing (card considered learned)
      setStats((s) => ({ ...s, easy: s.easy + 1 }))
    } else if (choice === 3){
      // mark hard: requeue
      setStats((s) => ({ ...s, hard: s.hard + 1 }))
      setToReview((t)=>[...t, card])
    }

    // advance
    advanceAfterResult()
  }

  function advanceAfterResult(){
    setInput('')
    setRevealLevel(0)
    setLastAnswerCorrect(null)
    // move to next index
    setIndex((i)=>{
      const next = i+1
      if (next < queue.length) return next
      // queue finished; if toReview exists, start a new round with review items
      if (toReview.length>0){
        setQueue(shuffle(toReview))
        setToReview([])
        return 0
      }
      // finished all
      setPhase('summary')
      return 0
    })
    setPhase((p)=> p === 'review-result' ? 'studying' : p)
  }

  function quitStudy(){
    try{
      if (!window.confirm('Bạn có chắc muốn thoát trò chơi?')) return
    }catch(e){ /* ignore in non-browser env */ }
    setPhase('idle')
    setQueue([])
    setDeck([])
    setIndex(0)
    setRevealLevel(0)
    setInput('')
    setToReview([])
    setLastAnswerCorrect(null)
    setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
  }

  // keyboard handling: enter submits; when in result, 1/2/3 map to choices
  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      if (phase === 'studying' && e.key === 'Enter'){
        submitAnswer()
      } else if (phase === 'review-result'){
        if (e.key === '1') handleChoice(1)
        if (e.key === '2') handleChoice(2)
        if (e.key === '3') handleChoice(3)
      }
    }
    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, input, queue, index, toReview])

  // Recursively get all files from tree
  function getAllFiles(nodes: any[]): any[] {
    let files: any[] = []
    for (const node of nodes) {
      if (node.type === 'file') {
        files.push(node)
      } else if (node.children?.length > 0) {
        files = files.concat(getAllFiles(node.children))
      }
    }
    return files
  }

  // progress counts
  const totalToLearn = queue.length
  const currentPos = Math.min(index+1, totalToLearn)
  const allFiles = getAllFiles(tree)

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-6">
      
      {/* Selection Phase */}
      {phase === 'idle' && (
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-block p-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-lg mb-4">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Study Session</h1>
            <p className="text-gray-600">Select files to start learning</p>
          </div>

          {/* File Selection Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Select Files to Study
            </h2>
            
            {allFiles.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-lg">No files available</p>
                <p className="text-sm mt-2">Create some vocabulary files first</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {allFiles.map((f: any, i: number) => (
                  <label
                    key={i}
                    className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-all group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(f.path)}
                      onChange={(e) => {
                        const s = [...selectedFiles]
                        if (e.target.checked) s.push(f.path)
                        else {
                          const idx = s.indexOf(f.path)
                          if (idx >= 0) s.splice(idx, 1)
                        }
                        setSelectedFiles(s)
                      }}
                      className="w-5 h-5 text-blue-500 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{f.name}</div>
                      <div className="text-xs text-gray-500 truncate">{f.path}</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </label>
                ))}
              </div>
            )}

            {selectedFiles.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    <span className="font-semibold text-blue-600">{selectedFiles.length}</span> file(s) selected
                  </div>
                  <button
                    onClick={start}
                    className="btn-primary px-8 py-3 text-lg flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Learning
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Study Phase */}
      {phase !== 'idle' && queue.length > 0 && (
        <div className="max-w-4xl mx-auto">
          {/* Progress Header */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-sm font-medium text-gray-600">
                  Progress:
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold text-blue-600">{currentPos}</div>
                  <div className="text-gray-400">/</div>
                  <div className="text-xl font-semibold text-gray-700">{totalToLearn}</div>
                </div>
                {/* Progress Bar */}
                <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
                    style={{ width: `${(currentPos / totalToLearn) * 100}%` }}
                  />
                </div>
              </div>
              <button
                onClick={quitStudy}
                className="btn-danger flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Quit
              </button>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-100">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{stats.correct}</div>
                <div className="text-xs text-gray-500 mt-1">✅ Correct</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{stats.incorrect}</div>
                <div className="text-xs text-gray-500 mt-1">❌ Incorrect</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{stats.hard}</div>
                <div className="text-xs text-gray-500 mt-1">🔄 Hard</div>
              </div>
            </div>
          </div>

          {/* Study Card */}
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8">
            {/* Meaning Display */}
            <div className="mb-8">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Meaning</div>
              <div className="text-2xl font-medium text-gray-900 leading-relaxed">{queue[index].meaning}</div>
            </div>

            {phase === 'studying' && (
              <div className="space-y-6">
                {/* Word Display (masked) */}
                <div className="p-6 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-200">
                  <div className="text-sm font-semibold text-gray-600 mb-2">Your Answer:</div>
                  <div className="text-4xl font-mono font-bold text-blue-600 tracking-wider text-center py-4">
                    {maskWordAllUnderscore(queue[index].word, revealLevel)}
                  </div>
                </div>

                {/* Controls */}
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={() => {
                      try {
                        const ut = new SpeechSynthesisUtterance(queue[index].word)
                        window.speechSynthesis.speak(ut)
                      } catch (err) {
                        console.error('Speech error', err)
                      }
                    }}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                    </svg>
                    Speak
                  </button>
                  <button
                    onClick={() => setRevealLevel(Math.max(0, revealLevel - 1))}
                    className="btn-secondary"
                  >
                    ← Less Hint
                  </button>
                  <button
                    onClick={() => setRevealLevel(Math.min(queue[index].word.length, revealLevel + 1))}
                    className="btn-secondary"
                  >
                    More Hint →
                  </button>
                </div>

                {/* Input */}
                <div className="space-y-3">
                  <input
                    ref={inputRef}
                    className="input-field text-lg"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your answer and press Enter..."
                    autoFocus
                  />
                  <button onClick={submitAnswer} className="btn-primary w-full py-3 text-lg">
                    Submit Answer
                  </button>
                </div>
              </div>
            )}

            {phase === 'review-result' && (
              <div className="space-y-6">
                {/* Answer Reveal */}
                <div className={`p-6 rounded-xl border-2 ${
                  lastAnswerCorrect
                    ? 'bg-green-50 border-green-300'
                    : 'bg-red-50 border-red-300'
                }`}>
                  <div className="text-sm font-semibold text-gray-600 mb-3">Correct Answer:</div>
                  <div className="text-4xl font-bold mb-2">
                    {queue[index].word}
                  </div>
                  {queue[index].pronunciation && (
                    <div className="text-lg text-gray-600">/{queue[index].pronunciation}/</div>
                  )}
                </div>

                {/* Your Answer */}
                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="text-sm font-semibold text-gray-600 mb-2">Your Answer:</div>
                  <div className={`text-2xl font-bold ${
                    lastAnswerCorrect ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {input || '(empty)'}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3">
                  <div className="text-sm text-gray-600 text-center mb-4">
                    How difficult was this word?
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleChoice(1)}
                      className="p-4 bg-gray-100 hover:bg-gray-200 rounded-xl border-2 border-gray-300 hover:border-gray-400 transition-all active:scale-95"
                    >
                      <div className="text-2xl mb-2">🔄</div>
                      <div className="font-semibold">Again</div>
                      <div className="text-xs text-gray-500 mt-1">Press 1</div>
                    </button>
                    <button
                      onClick={() => handleChoice(2)}
                      className="p-4 bg-green-50 hover:bg-green-100 rounded-xl border-2 border-green-300 hover:border-green-400 transition-all active:scale-95"
                    >
                      <div className="text-2xl mb-2">✅</div>
                      <div className="font-semibold text-green-700">Easy</div>
                      <div className="text-xs text-gray-500 mt-1">Press 2</div>
                    </button>
                    <button
                      onClick={() => handleChoice(3)}
                      className="p-4 bg-red-50 hover:bg-red-100 rounded-xl border-2 border-red-300 hover:border-red-400 transition-all active:scale-95"
                    >
                      <div className="text-2xl mb-2">🔥</div>
                      <div className="font-semibold text-red-700">Hard</div>
                      <div className="text-xs text-gray-500 mt-1">Press 3</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {phase === 'summary' && (
              <div className="text-center py-8">
                <div className="inline-block p-6 bg-gradient-to-br from-green-400 to-blue-500 rounded-full mb-6">
                  <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-6">🎉 Great Job!</h2>
                
                <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mb-8">
                  <div className="p-6 bg-red-50 rounded-xl border border-red-200">
                    <div className="text-4xl font-bold text-red-600 mb-2">{stats.incorrect}</div>
                    <div className="text-sm text-gray-600">❌ Incorrect</div>
                  </div>
                  <div className="p-6 bg-orange-50 rounded-xl border border-orange-200">
                    <div className="text-4xl font-bold text-orange-600 mb-2">{stats.hard}</div>
                    <div className="text-sm text-gray-600">🔄 Hard</div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSelectedFiles([])
                    setPhase('idle')
                    setIndex(0)
                    setInput('')
                    setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
                  }}
                  className="btn-primary px-8 py-3 text-lg"
                >
                  Back to Menu
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  )
}
