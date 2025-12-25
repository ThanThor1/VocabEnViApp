import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Manager from './pages/Manager'
import Study from './pages/Study'
import './styles.css'

function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen">
        <aside className="w-64 bg-gray-100 p-4 border-r">
          <h2 className="text-xl font-bold mb-4">Vocab</h2>
          <nav className="flex flex-col gap-2">
            <Link to="/manager" className="px-2 py-1 rounded hover:bg-gray-200">Manager</Link>
            <Link to="/study" className="px-2 py-1 rounded hover:bg-gray-200">Study</Link>
          </nav>
        </aside>
        <main className="flex-1 p-4">
          <Routes>
            <Route path="/manager" element={<Manager />} />
            <Route path="/study" element={<Study />} />
            <Route path="/" element={<Manager />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
