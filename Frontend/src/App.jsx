import { useState } from 'react'
import ChatWindow from './components/ChatWindow'
import './App.css'

function App() {
  return (
    <div className="app-container">
      <div className="app-bg-gradient" />
      <ChatWindow />
    </div>
  )
}

export default App
