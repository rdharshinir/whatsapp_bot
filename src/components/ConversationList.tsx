'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase';
import { Conversation } from '@/lib/types';

interface ConversationListProps {
  activeId: string | null;
  onSelect: (conversation: Conversation) => void;
}

export default function ConversationList({ activeId, onSelect }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      setConversations(data);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();

    // Subscribe to realtime changes
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredConversations = conversations.filter((conv) => {
    const query = searchQuery.toLowerCase();
    return (
      conv.name?.toLowerCase().includes(query) ||
      conv.phone.includes(query)
    );
  });

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const truncate = (str: string, len: number) => {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
  };

  return (
    <div className="conversation-list">
      {/* Header */}
      <div className="conversation-list-header">
        <h1>Chats</h1>
        <div className="header-badge">
          {conversations.length}
        </div>
      </div>

      {/* Search */}
      <div className="search-container">
        <div className="search-input-wrapper">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search or start new chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
            id="search-conversations"
          />
        </div>
      </div>

      {/* Conversations */}
      <div className="conversations-scroll">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Loading chats...</p>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-icon">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <p>{searchQuery ? 'No chats found' : 'No conversations yet'}</p>
            <span>Messages will appear here when users message your WhatsApp number</span>
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <button
              key={conv.id}
              id={`conversation-${conv.id}`}
              className={`conversation-item ${activeId === conv.id ? 'active' : ''}`}
              onClick={() => onSelect(conv)}
            >
              {/* Avatar */}
              <div className="conversation-avatar">
                {(conv.name || conv.phone).charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="conversation-info">
                <div className="conversation-top-row">
                  <span className="conversation-name">
                    {conv.name || conv.phone}
                  </span>
                  <span className="conversation-time">
                    {formatTime(conv.last_message_at || conv.updated_at)}
                  </span>
                </div>
                <div className="conversation-bottom-row">
                  <span className="conversation-preview">
                    {truncate(conv.last_message || '', 45)}
                  </span>
                  <span className={`mode-badge ${conv.mode}`}>
                    {conv.mode === 'agent' ? '🤖' : '👤'}
                  </span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
