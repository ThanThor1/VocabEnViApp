import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Manager from './pages/Manager'
import ManagerPdf from './pages/ManagerPdf'
import Study from './pages/Study'
import PdfReader from './pages/PdfReader'
import './styles.css'
import ErrorBoundary from './shared/ErrorBoundary'

function App() {
  useEffect(() => {
    function onError(e: ErrorEvent) {
      console.error('[window error]', e.error || e.message, e)
    }
    function onRejection(e: PromiseRejectionEvent) {
      console.error('[unhandledrejection]', e.reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <div className="flex h-screen">
          <aside className="w-64 bg-gray-100 p-4 border-r">
          <h2 className="text-xl font-bold mb-4">Vocab</h2>
          <nav className="flex flex-col gap-2">
            <Link to="/manager" className="px-2 py-1 rounded hover:bg-gray-200">Manager</Link>
            <Link to="/manager-pdf" className="px-2 py-1 rounded hover:bg-gray-200">Manager PDF</Link>
            <Link to="/study" className="px-2 py-1 rounded hover:bg-gray-200">Study</Link>
            <Link to="/pdf" className="px-2 py-1 rounded hover:bg-gray-200">PDF Reader</Link>
          </nav>
        </aside>
        <main className="flex-1 p-4">
          <ErrorBoundary>
            <Routes>
              <Route path="/manager" element={<Manager />} />
              <Route path="/manager-pdf" element={<ManagerPdf />} />
              <Route path="/study" element={<Study />} />
              <Route path="/pdf" element={<PdfReader />} />
              <Route path="/" element={<Manager />} />
            </Routes>
          </ErrorBoundary>
        </main>
        </div>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
