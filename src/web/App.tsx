import './App.css'
import { ChatWindow } from './components/ChatWindow'
import { MessageInput } from './components/MessageInput'
import { ThemeToggle } from './components/ThemeToggle'
import { Sidebar } from './components/Sidebar'
import { useService } from './hooks/useService'
import { useTheme } from './hooks/useTheme'
import { useConversations } from './hooks/useConversations'
import { useEffect, useCallback } from 'react'

export default function App() {
  const { messages, isLoading, sendMessage, loadMessages, clearMessages } = useService()
  const { theme, toggleTheme } = useTheme()
  const {
    conversations, activeConversation, activeId, isCreating,
    createConversation, deleteConversation, selectConversation, updateTitle,
  } = useConversations()

  // Load messages when active conversation changes
  useEffect(() => {
    if (activeId) {
      loadMessages(activeId)
    } else {
      clearMessages()
    }
  }, [activeId, loadMessages, clearMessages])

  const handleSend = useCallback(async (text: string) => {
    const sent = await sendMessage(text, activeId)
    // Auto-title: use first message as conversation title
    if (sent && activeConversation?.title === 'New conversation') {
      updateTitle(activeConversation.id, text.slice(0, 50) + (text.length > 50 ? '…' : ''))
    }
  }, [activeId, activeConversation, sendMessage, updateTitle])

  const handleNewChat = useCallback(async () => {
    await createConversation()
  }, [createConversation])

  return (
    <>
      <header className="app-header">
        <div>
          <h1>Copilot SDK Chat</h1>
          <p>Chat with the Copilot SDK. Try asking a question.</p>
        </div>
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>
      <div className="main-layout">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={selectConversation}
          onDelete={deleteConversation}
          onCreate={handleNewChat}
          isCreating={isCreating}
        />
        <div className="chat-container">
          {activeId ? (
            <>
              <ChatWindow messages={messages} isStreaming={isLoading} />
              <MessageInput onSend={handleSend} disabled={isLoading} />
            </>
          ) : (
            <div className="empty-state">
              <div>
                <p>Select a conversation or start a new one</p>
                <button className="empty-new-btn" onClick={handleNewChat} disabled={isCreating}>
                  + New Conversation
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <footer className="footer">
        Built with the <a href="https://github.com/github/copilot-sdk" target="_blank" rel="noopener noreferrer">Copilot SDK</a>
        {' · '}
        <a href="https://github.com/azure-samples/copilot-sdk-service" target="_blank" rel="noopener noreferrer">View on GitHub</a>
      </footer>
    </>
  )
}
