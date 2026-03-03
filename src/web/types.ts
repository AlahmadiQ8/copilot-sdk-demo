export interface Message {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
}

export interface StoredConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}
