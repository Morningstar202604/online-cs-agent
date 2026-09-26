import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import ResponsiveShell from './components/ResponsiveShell'
import { Spinner } from './components/Spinner'
import './index.css'
import './styles.css'

// 路由级代码分割（React.lazy + Suspense）
const VisitorChat = lazy(() => import('./VisitorChat'))
const OperatorDesk = lazy(() => import('./OperatorDesk'))
const Settings = lazy(() => import('./Settings'))

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ResponsiveShell>
          <Suspense fallback={<Spinner full />}>
            <Routes>
              <Route path="/" element={<VisitorChat />} />
              <Route path="/operator" element={<OperatorDesk />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </ResponsiveShell>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
