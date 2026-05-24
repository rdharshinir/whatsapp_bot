'use client';

import { useState, useRef, useEffect } from 'react';

interface MessageInputProps {
  onSend: (message: string) => void;
  mode: 'agent' | 'human';
}

export default function MessageInput({ onSend, mode }: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setMessage('');
      // Reset textarea height
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
    } catch (error) {
      console.error('Error sending:', error);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  return (
    <div className="message-input-container">
      <div className="message-input-wrapper">
        <textarea
          ref={inputRef}
          id="message-input"
          value={message}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'human'
              ? 'Type a reply as human agent...'
              : 'Type a message (override AI)...'
          }
          className="message-textarea"
          rows={1}
          disabled={sending}
        />
        <button
          id="send-button"
          className={`send-button ${message.trim() ? 'active' : ''}`}
          onClick={handleSend}
          disabled={!message.trim() || sending}
          title="Send message"
        >
          {sending ? (
            <div className="loading-spinner small" />
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="send-icon">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </div>
      <div className="input-hint">
        {mode === 'human' ? (
          <span className="hint-human">👤 Replying as human agent</span>
        ) : (
          <span className="hint-agent">🤖 AI auto-replies enabled • You can still send manual messages</span>
        )}
      </div>
    </div>
  );
}
