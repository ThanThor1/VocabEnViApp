import React, { useEffect, useRef, useState, createContext, useContext } from 'react'
import { BrowserRouter, HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import {
  ApiKeyView,
  ErrorBoundary,
  ManagerPdfView,
  ManagerView,
  PdfReaderView,
  StudyView,
} from './components'
import { BackgroundTasksProvider } from './contexts/BackgroundTasksContext'

import './App.css'

// Theme Context
type Theme = 'light' | 'dark'
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: 'light',
  toggleTheme: () => {},
})

export const useTheme = () => useContext(ThemeContext)

// Sidebar collapsed context
const SidebarContext = createContext<{ collapsed: boolean; setCollapsed: (v: boolean) => void }>({
  collapsed: false,
  setCollapsed: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

function NavLink({
  to,
  icon,
  label,
  collapsed,
  badge,
}: {
  to: string
  icon: React.ReactNode
  label: string
  collapsed?: boolean
  badge?: number
}) {
  const location = useLocation()
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(`${to}/`))

  return (
    <Link
      to={to}
      className={`
        nav-link group relative flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200
        ${collapsed ? 'justify-center' : ''}
        ${
          isActive
            ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-lg shadow-violet-500/30'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
        }
      `}
      title={collapsed ? label : undefined}
    >
      <div
        className={`
          w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 flex-shrink-0
          ${isActive ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800 group-hover:bg-white dark:group-hover:bg-slate-700 group-hover:shadow-sm'}
        `}
      >
        {icon}
      </div>
      {!collapsed && (
        <>
          <span className="flex-1 text-sm font-semibold truncate">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="px-2 py-0.5 text-xs font-bold bg-rose-500 text-white rounded-full">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
      {isActive && !collapsed && (
        <div className="absolute right-2 w-1 h-6 bg-white/70 rounded-full"></div>
      )}
    </Link>
  )
}

function RouteStateSync() {
  const location = useLocation()
  const navigate = useNavigate()
  const suppressFirstSaveRef = useRef(false)
  const didInitRef = useRef(false)

  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    try {
      const key = 'app_lastPath'
      const last = window.localStorage.getItem(key)
      const isRoot = location.pathname === '/' || location.pathname === ''
      if (isRoot && last && last !== '/') {
        suppressFirstSaveRef.current = true
        navigate(last, { replace: true })
      }
    } catch {}
  }, [])

  useEffect(() => {
    const isRoot = location.pathname === '/' || location.pathname === ''
    if (suppressFirstSaveRef.current && isRoot) return
    suppressFirstSaveRef.current = false
    try {
      const key = 'app_lastPath'
      const val = `${location.pathname}${location.search || ''}`
      window.localStorage.setItem(key, val)
    } catch {}
  }, [location.pathname, location.search])

  return null
}

function AppSidebar({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const { theme, toggleTheme } = useTheme()

  return (
    <aside
      className={`
        ${collapsed ? 'w-[72px]' : 'w-64'}
        bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl 
        border-r border-slate-200/50 dark:border-slate-700/50 
        flex flex-col transition-all duration-300 ease-out
        shadow-xl shadow-slate-900/5 dark:shadow-black/20
      `}
    >
      {/* Logo */}
      <div className={`p-4 border-b border-slate-200/50 dark:border-slate-700/50 ${collapsed ? 'px-3' : ''}`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-10 h-10 bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30 flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">VocabMaster</h1>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Smart Learning</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {!collapsed && (
          <div className="px-2 py-2 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Main Menu
          </div>
        )}
        
        <NavLink
          to="/manager"
          collapsed={collapsed}
          label="Vocabulary"
          icon={
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />

        <NavLink
          to="/study"
          collapsed={collapsed}
          label="Study"
          icon={
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          }
        />

        {!collapsed && (
          <div className="px-2 py-2 mt-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Documents
          </div>
        )}

        <NavLink
          to="/manager-pdf"
          collapsed={collapsed}
          label="PDF Library"
          icon={
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          }
        />

        <NavLink
          to="/pdf"
          collapsed={collapsed}
          label="PDF Reader"
          icon={
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          }
        />

        {!collapsed && (
          <div className="px-2 py-2 mt-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Settings
          </div>
        )}

        <NavLink
          to="/api-key"
          collapsed={collapsed}
          label="API Keys"
          icon={
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          }
        />
      </nav>

      {/* Bottom actions */}
      <div className={`p-3 border-t border-slate-200/50 dark:border-slate-700/50 space-y-2`}>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className={`
            w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200
            text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white
            ${collapsed ? 'justify-center' : ''}
          `}
          title={collapsed ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : undefined}
        >
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 flex-shrink-0">
            {theme === 'dark' ? (
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </div>
          {!collapsed && <span className="text-sm font-semibold">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`
            w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200
            text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white
            ${collapsed ? 'justify-center' : ''}
          `}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 flex-shrink-0">
            <svg 
              className={`w-[18px] h-[18px] transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </div>
          {!collapsed && <span className="text-sm font-semibold">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

export default function App() {
  const Router: React.FC<React.PropsWithChildren> =
    typeof window !== 'undefined' && window.location && window.location.protocol === 'file:'
      ? HashRouter
      : BrowserRouter

  // Theme state
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('app_theme')
      if (saved === 'dark' || saved === 'light') return saved
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    } catch {}
    return 'light'
  })

  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('app_sidebar_collapsed') === 'true'
    } catch {}
    return false
  })

  useEffect(() => {
    try {
      localStorage.setItem('app_sidebar_collapsed', String(sidebarCollapsed))
    } catch {}
  }, [sidebarCollapsed])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('app_theme', theme)
    } catch {}
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

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
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <SidebarContext.Provider value={{ collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed }}>
        <BackgroundTasksProvider>
          <Router>
            <ErrorBoundary>
              <RouteStateSync />
              <div className="flex h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
                <AppSidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />

                <main className="flex-1 overflow-hidden flex flex-col">
                  <ErrorBoundary>
                    <Routes>
                      <Route path="/manager" element={<ManagerView />} />
                      <Route path="/manager-pdf" element={<ManagerPdfView />} />
                      <Route path="/study" element={<StudyView />} />
                      <Route path="/pdf" element={<PdfReaderView />} />
                      <Route path="/api-key" element={<ApiKeyView />} />
                      <Route path="/" element={<ManagerView />} />
                    </Routes>
                  </ErrorBoundary>
                </main>
              </div>
            </ErrorBoundary>
          </Router>
        </BackgroundTasksProvider>
      </SidebarContext.Provider>
    </ThemeContext.Provider>
  )
}
