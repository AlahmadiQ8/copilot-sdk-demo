import type { StoredConversation } from '../types'
import './Sidebar.css'

interface SidebarProps {
  conversations: StoredConversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onCreate: () => void
  isCreating: boolean
}

export function Sidebar({ conversations, activeId, onSelect, onDelete, onCreate, isCreating }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Conversations</span>
        <button className="sidebar-new-btn" onClick={onCreate} disabled={isCreating} title="New conversation">
          +
        </button>
      </div>
      <div className="sidebar-list">
        {conversations.length === 0 && (
          <div className="sidebar-empty">No conversations yet</div>
        )}
        {conversations.map(conv => (
          <div
            key={conv.id}
            className={`sidebar-item ${conv.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <span className="sidebar-item-title">{conv.title}</span>
            <button
              className="sidebar-delete-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
              title="Delete conversation"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
