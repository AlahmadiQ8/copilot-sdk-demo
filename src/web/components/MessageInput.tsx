import { useState, type FormEvent } from 'react'

interface Props {
  onSend: (message: string) => void
  disabled: boolean
}

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
  }

  return (
    <form className="input-form" onSubmit={handleSubmit}>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Type a message..."
        autoFocus
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  )
}
