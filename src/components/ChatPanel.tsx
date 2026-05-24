'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase';
import { Conversation, Message } from '@/lib/types';
import MessageInput from './MessageInput';

interface ChatPanelProps {
  conversation: Conversation;
  onModeChange: (mode: 'agent' | 'human') => void;
}

export default function ChatPanel({ conversation, onModeChange }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(conversation.mode);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/messages`);
      const data = await res.json();
      setMessages(data);
      setTimeout(scrollToBottom, 100);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  }, [conversation.id, scrollToBottom]);

  useEffect(() => {
    setMode(conversation.mode);
    setLoading(true);
    fetchMessages();

    // Subscribe to new messages for this conversation
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`messages-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
          setTimeout(scrollToBottom, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id, conversation.mode, fetchMessages, scrollToBottom]);

  const handleToggleMode = async () => {
    const newMode = mode === 'agent' ? 'human' : 'agent';
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        setMode(newMode);
        onModeChange(newMode);
      }
    } catch (error) {
      console.error('Error toggling mode:', error);
    }
  };

  const handleSendMessage = async (text: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        throw new Error('Failed to send message');
      }

      // Message will appear via realtime subscription
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: Message[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msg.created_at, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-avatar">
            {(conversation.name || conversation.phone).charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="chat-header-name">
              {conversation.name || conversation.phone}
            </h2>
            <p className="chat-header-phone">
              {conversation.name ? conversation.phone : ''}
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <button
          id="mode-toggle"
          className={`mode-toggle ${mode}`}
          onClick={handleToggleMode}
          title={`Switch to ${mode === 'agent' ? 'human' : 'agent'} mode`}
        >
          <span className="mode-toggle-label">
            {mode === 'agent' ? '🤖 Agent' : '👤 Human'}
          </span>
          <div className={`mode-toggle-track ${mode}`}>
            <div className="mode-toggle-thumb" />
          </div>
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={scrollContainerRef}>
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-chat">
            <div className="empty-chat-icon">💬</div>
            <p>No messages yet</p>
            <span>Messages from this contact will appear here</span>
          </div>
        ) : (
          groupedMessages.map((group, gi) => (
            <div key={gi}>
              <div className="date-divider">
                <span>{formatDate(group.date)}</span>
              </div>
              {group.messages.map((msg, mi) => (
                <div
                  key={msg.id}
                  className={`message-wrapper ${msg.role}`}
                  style={{ animationDelay: `${mi * 0.03}s` }}
                >
                  <div className={`message-bubble ${msg.role}`}>
                    <p className="message-text">{msg.content}</p>
                    <div className="message-meta">
                      <span className="message-role-label">
                        {msg.role === 'assistant' ? '🤖 AI' : ''}
                      </span>
                      <span className="message-time">
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <MessageInput onSend={handleSendMessage} mode={mode} />
    </div>
  );
}
