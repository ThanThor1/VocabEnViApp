import React, { useState, useEffect, useRef } from 'react'
import ErrorBoundary from '../shared/ErrorBoundary'
import { useLocation } from 'react-router-dom'

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
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [deck, setDeck] = useState<Card[]>([])
  const [queue, setQueue] = useState<Card[]>([])
  const [index, setIndex] = useState(0)
  const [revealLevel, setRevealLevel] = useState(0) // 0 = all underscores, 1+ = reveal that many chars
  const [input, setInput] = useState("")
  const [phase, setPhase] = useState<'idle'|'studying'|'review-result'|'summary'>('idle')
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null)
  const [toReview, setToReview] = useState<Card[]>([])
  const [stats, setStats] = useState({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
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
      <div>
      <div className="mb-4">
        <div className="font-semibold">Select files to study</div>
        <div className="space-y-1 mt-2">
          { allFiles.map((f:any, i:number)=> (
            <div key={i}><label><input type="checkbox" onChange={(e)=>{
              const s = [...selectedFiles]
              if (e.target.checked) s.push(f.path)
              else { const idx = s.indexOf(f.path); if (idx>=0) s.splice(idx,1) }
              setSelectedFiles(s)
            }} /> {f.name} ({f.path})</label></div>
          ))}
        </div>
        <div className="mt-2"><button className="px-3 py-1 bg-blue-500 text-white" onClick={start}>Start</button></div>
      </div>

      {phase !== 'idle' && queue.length>0 && (
        <div className="p-4 border rounded w-full max-w-2xl">
          <div className="flex justify-between items-center mb-2">
            <div className="text-sm text-gray-500">Progress: {currentPos}/{totalToLearn}</div>
            <button className="px-2 py-1 bg-red-500 text-white rounded" onClick={quitStudy}>Thoát</button>
          </div>
          <div className="text-sm text-gray-500">Meaning: {queue[index].meaning}</div>

          {phase === 'studying' && (
            <>
              <div className="text-lg font-medium mt-2">{ maskWordAllUnderscore(queue[index].word, revealLevel) }</div>
              <div className="mt-3 flex gap-2">
                <button className="px-3 py-1 bg-gray-200" onClick={()=>{
                  try {
                    const ut = new SpeechSynthesisUtterance(queue[index].word);
                    window.speechSynthesis.speak(ut);
                  } catch (err) {
                    console.error('Speech error', err);
                  }
                }}>🔊 Speak</button>
                <button className="px-3 py-1 bg-gray-200" onClick={()=>{ setRevealLevel(Math.max(0, revealLevel-1))}}>← Unhint</button>
                <button className="px-3 py-1 bg-gray-200" onClick={()=>{ setRevealLevel(Math.min(queue[index].word.length, revealLevel+1)); }}>Hint →</button>
                <input ref={inputRef} className="border p-2 flex-1" value={input} onChange={(e)=>setInput(e.target.value)} placeholder="Type your answer and press Enter" />
                <button className="px-3 py-1 bg-blue-500 text-white" onClick={submitAnswer}>Submit</button>
              </div>
            </>
          )}

          {phase === 'review-result' && (
            <div className="mt-3">
              <div className="text-lg font-bold">Answer: {queue[index].word} <span className="text-sm text-gray-500">/{queue[index].pronunciation || ''}/</span></div>
              <div className="mt-2">Your answer: <span className={`font-medium ${lastAnswerCorrect? 'text-green-600' : 'text-red-600'}`}>{input}</span></div>
              <div className="mt-3 text-sm text-gray-600">Press 1 to replay, 2 = mark Easy, 3 = mark Hard</div>
              <div className="mt-2 flex gap-2">
                <button className="px-3 py-1 bg-gray-200" onClick={()=>handleChoice(1)}>1 Replay</button>
                <button className="px-3 py-1 bg-green-200" onClick={()=>handleChoice(2)}>2 Easy</button>
                <button className="px-3 py-1 bg-red-200" onClick={()=>handleChoice(3)}>3 Hard</button>
              </div>
            </div>
          )}

          {phase === 'summary' && (
            <div className="mt-4 p-4 bg-blue-50 rounded border border-blue-200">
              <h2 className="text-2xl font-bold mb-4">📊 Study Summary</h2>
              <table className="w-full border-collapse mb-4">
                <tbody>
                  <tr className="border-b">
                    <td className="p-2 font-semibold">❌ Incorrect:</td>
                    <td className="p-2 text-red-600 font-bold">{stats.incorrect}</td>
                  </tr>
                  <tr>
                    <td className="p-2 font-semibold">🔄 Hard (Replayed):</td>
                    <td className="p-2 text-orange-600 font-bold">{stats.hard}</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-4">
                <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={()=>{
                  setSelectedFiles([])
                  setPhase('idle')
                  setIndex(0)
                  setInput('')
                  setStats({ correct: 0, incorrect: 0, hard: 0, easy: 0 })
                }}>
                  Back to Menu
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </ErrorBoundary>
  )
}
