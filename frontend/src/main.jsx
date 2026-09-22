import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import VisitorChat from './VisitorChat'
import OperatorDesk from './OperatorDesk'
import './styles.css'

function Header() {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-dot" />
        在线客服 Agent
      </div>
      <nav className="topnav">
        <NavLink to="/" end className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
          访客对话
        </NavLink>
        <NavLink to="/operator" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
          坐席工作台
        </NavLink>
      </nav>
    </header>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <main className="main">
        <Routes>
          <Route path="/" element={<VisitorChat />} />
          <Route path="/operator" element={<OperatorDesk />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
