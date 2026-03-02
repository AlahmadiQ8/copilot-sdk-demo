export interface Message {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
}
