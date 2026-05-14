/**
 * @file Root visual shell (background + ChatLayout). Mounted from `main.jsx`.
 * @module App
 */

import ChatLayout from './components/layout/ChatLayout'
import './App.css'

/**
 * Application root: chrome background and main `ChatLayout`.
 */
function App() {
  return (
    <div className="app-container">
      <div className="app-bg-gradient" />
      <ChatLayout />
    </div>
  )
}

export default App
