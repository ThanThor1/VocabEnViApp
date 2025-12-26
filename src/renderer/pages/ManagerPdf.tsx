import React, { useEffect, useState } from 'react'
import ErrorBoundary from '../shared/ErrorBoundary'
import { useNavigate, useLocation } from 'react-router-dom'
import VocabTable from '../shared/VocabTable'

declare const window: any

export default function ManagerPdf() {
  const navigate = useNavigate()
  const location = useLocation()
  const [pdfs, setPdfs] = useState<any[]>([])
  const [selectedPdf, setSelectedPdf] = useState<any | null>(null)
  const [rows, setRows] = useState<any[]>([])

  useEffect(() => {
    loadPdfs()
    // open from navigation state
    const st: any = (location && (location as any).state) || null
    if (st && st.pdfId) {
      // will select after list loaded
      (async () => {
        await loadPdfs()
        const p = (await window.api.pdfList()).find((x:any)=>x.pdfId===st.pdfId)
        if (p) selectPdf(p)
      })().catch(()=>{})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadPdfs() {
    try {
      const list = await window.api.pdfList()
      setPdfs(list || [])
    } catch (err) {
      console.error('Error loading pdfs', err)
      setPdfs([])
    }
  }

  async function selectPdf(p:any) {
    setSelectedPdf(p)
    if (p && p.deckCsvPath) {
      try {
        const data = await window.api.readCsv(p.deckCsvPath)
        setRows(data || [])
      } catch (err) {
        console.error('readCsv error', err)
        setRows([])
      }
    } else {
      setRows([])
    }
  }

  function handleDeleteRow(idx:number) {
    if (!selectedPdf || !selectedPdf.deckCsvPath) return
    window.api.deleteWord(selectedPdf.deckCsvPath, idx).then(()=> selectPdf(selectedPdf))
  }

  function speak(t:string){
    try{ const ut = new SpeechSynthesisUtterance(t); window.speechSynthesis.speak(ut) }catch{}
  }

  return (
    <ErrorBoundary>
      <div className="flex h-full">
      <div className="w-64 border-r p-3 bg-gray-50 overflow-y-auto">
        <div className="font-semibold mb-3">PDF Decks</div>
        {pdfs.map((p:any)=> (
          <div key={p.pdfId} className={`p-2 rounded mb-2 cursor-pointer ${selectedPdf?.pdfId===p.pdfId ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-100'}`} onClick={()=> selectPdf(p)}>
            <div className="text-sm font-medium">{p.baseName}</div>
            <div className="text-xs text-gray-500">{p.deckCsvPath ? p.deckCsvPath.split(/[/\\]/).pop() : 'No deck'}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 p-4 flex flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Manager PDF</div>
            <div className="text-sm text-gray-500">Manage vocab stored inside PDF decks</div>
          </div>
          <div className="space-x-2">
            <button className="px-3 py-1 bg-gray-200 rounded" onClick={loadPdfs}>Refresh</button>
            <button className="px-3 py-1 bg-blue-500 text-white rounded" onClick={()=> navigate('/pdf')}>Open PDF Reader</button>
          </div>
        </div>

        <div className="flex-1 bg-white p-3 overflow-auto">
          {selectedPdf ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{selectedPdf.baseName} vocab</div>
                  <div className="text-xs text-gray-500">{selectedPdf.deckCsvPath}</div>
                </div>
                <div className="space-x-2">
                  <button className="px-2 py-1 bg-green-500 text-white rounded text-sm" onClick={()=> { if (selectedPdf && selectedPdf.deckCsvPath) navigate('/study', { state: { selectedFiles: [selectedPdf.deckCsvPath] } }) }}>Study</button>
                </div>
              </div>

              <VocabTable rows={rows} onDelete={handleDeleteRow} onSpeak={speak} onRefresh={()=> selectPdf(selectedPdf)} currentFile={selectedPdf.deckCsvPath} />
            </div>
          ) : (
            <div className="text-gray-500">Select a PDF on the left to view its deck</div>
          )}
        </div>
      </div>
      </div>
    </ErrorBoundary>
  )
}
