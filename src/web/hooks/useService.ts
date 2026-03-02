import { useState, useRef, useCallback } from 'react'
import type { Message } from '../types'

export function useService() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const messagesRef = useRef<Message[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (text: string) => {
    // Abort any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' }

    messagesRef.current = [...messagesRef.current, userMsg, assistantMsg]
    setMessages([...messagesRef.current])
    setIsLoading(true)

    // Build history from previous messages (exclude current)
    const history = messagesRef.current
      .filter(m => m.id !== assistantId && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: m.content }))
    // Remove last entry (it's the current user message, we pass it as `message`)
    history.pop()

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.length > 0 ? history : undefined }),
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
          // Keep the last (possibly incomplete) line in the buffer
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

      // If no content was streamed, set a fallback
      if (!content) {
        messagesRef.current = messagesRef.current.map(m =>
          m.id === assistantId ? { ...m, content: '(empty response)' } : m,
        )
        setMessages([...messagesRef.current])
      }
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

  return { messages, isLoading, sendMessage }
}
