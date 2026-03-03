import { useState, useCallback, useEffect } from 'react'
import type { StoredConversation } from '../types'

const STORAGE_KEY = 'conversations'
const ACTIVE_KEY = 'activeConversationId'

function loadConversations(): StoredConversation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveConversations(convs: StoredConversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convs))
}

function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

function saveActiveId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}

export function useConversations() {
  const [conversations, setConversations] = useState<StoredConversation[]>(loadConversations)
  const [activeId, setActiveId] = useState<string | null>(loadActiveId)
  const [isCreating, setIsCreating] = useState(false)

  // Sync activeId to localStorage
  useEffect(() => { saveActiveId(activeId) }, [activeId])

  const createConversation = useCallback(async () => {
    setIsCreating(true)
    try {
      const res = await fetch('/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New conversation' }),
      })
      if (!res.ok) throw new Error(`Failed to create: ${res.status}`)
      const data = await res.json()
      const conv: StoredConversation = {
        id: data.id,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      }
      const updated = [conv, ...conversations]
      setConversations(updated)
      saveConversations(updated)
      setActiveId(conv.id)
      return conv
    } finally {
      setIsCreating(false)
    }
  }, [conversations])

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await fetch(`/conversations/${id}`, { method: 'DELETE' })
    } catch { /* best effort */ }
    const updated = conversations.filter(c => c.id !== id)
    setConversations(updated)
    saveConversations(updated)
    if (activeId === id) {
      setActiveId(updated.length > 0 ? updated[0].id : null)
    }
  }, [conversations, activeId])

  const selectConversation = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const updateTitle = useCallback((id: string, title: string) => {
    const updated = conversations.map(c =>
      c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c,
    )
    setConversations(updated)
    saveConversations(updated)
  }, [conversations])

  const activeConversation = conversations.find(c => c.id === activeId) ?? null

  return {
    conversations,
    activeConversation,
    activeId,
    isCreating,
    createConversation,
    deleteConversation,
    selectConversation,
    updateTitle,
  }
}
