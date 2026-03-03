import { useState, useRef, useCallback } from 'react'
import type { Message } from '../types'

export function useService() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const messagesRef = useRef<Message[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/conversations/${conversationId}`)
      if (!res.ok) {
        messagesRef.current = []
        setMessages([])
        return
      }
      const data = await res.json()
      const loaded: Message[] = (data.messages || []).map((m: { role: string; content: string }, i: number) => ({
        id: `${conversationId}-${i}`,
        role: m.role as Message['role'],
        content: m.content,
      }))
      messagesRef.current = loaded
      setMessages(loaded)
    } catch {
      messagesRef.current = []
      setMessages([])
    }
  }, [])

  const clearMessages = useCallback(() => {
    messagesRef.current = []
    setMessages([])
  }, [])

  const sendMessage = useCallback(async (text: string, conversationId?: string | null) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' }

    messagesRef.current = [...messagesRef.current, userMsg, assistantMsg]
    setMessages([...messagesRef.current])
    setIsLoading(true)

    // Determine endpoint: conversation API or direct /chat fallback
    const url = conversationId ? `/conversations/${conversationId}/messages` : '/chat'
    const body = conversationId
      ? { message: text }
      : (() => {
          const history = messagesRef.current
            .filter(m => m.id !== assistantId && (m.role === 'user' || m.role === 'assistant'))
            .map(m => ({ role: m.role, content: m.content }))
          history.pop()
          return { message: text, history: history.length > 0 ? history : undefined }
        })()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let content = ''
      let buffer = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                if (parsed.error) {
                  throw new Error(parsed.error)
                }
                if (parsed.content) {
                  content += parsed.content
                  messagesRef.current = messagesRef.current.map(m =>
                    m.id === assistantId ? { ...m, content } : m,
                  )
                  setMessages([...messagesRef.current])
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue
                throw e
              }
            }
          }
        }
      }

      if (!content) {
        messagesRef.current = messagesRef.current.map(m =>
          m.id === assistantId ? { ...m, content: '(empty response)' } : m,
        )
        setMessages([...messagesRef.current])
      }

      return text // return user message for title extraction
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      messagesRef.current = messagesRef.current.map(m =>
        m.id === assistantId ? {
          ...m,
          role: 'error' as const,
          content: err instanceof Error ? err.message : 'Unknown error',
        } : m,
      )
      setMessages([...messagesRef.current])
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { messages, isLoading, sendMessage, loadMessages, clearMessages }
}
