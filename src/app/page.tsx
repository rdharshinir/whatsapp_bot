'use client';

import { useState, useCallback } from 'react';
import ConversationList from '@/components/ConversationList';
import ChatPanel from '@/components/ChatPanel';
import { Conversation } from '@/lib/types';

export default function DashboardPage() {
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  const handleSelectConversation = useCallback((conversation: Conversation) => {
    setActiveConversation(conversation);
  }, []);

  const handleModeChange = useCallback((mode: 'agent' | 'human') => {
    setActiveConversation((prev) =>
      prev ? { ...prev, mode } : null
    );
  }, []);

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <ConversationList
        activeId={activeConversation?.id || null}
        onSelect={handleSelectConversation}
      />

      {/* Chat Panel or Welcome Screen */}
      {activeConversation ? (
        <ChatPanel
          key={activeConversation.id}
          conversation={activeConversation}
          onModeChange={handleModeChange}
        />
      ) : (
        <div className="welcome-panel">
          <div className="welcome-icon">💬</div>
          <h2>WhatsApp AI Agent</h2>
          <p>
            Select a conversation from the sidebar to view messages and manage
            your AI agent. Incoming WhatsApp messages will appear here in
            real-time.
          </p>
          <div className="welcome-features">
            <div className="welcome-feature">
              <span className="welcome-feature-icon">🤖</span>
              <span>AI Auto-replies</span>
            </div>
            <div className="welcome-feature">
              <span className="welcome-feature-icon">👤</span>
              <span>Human Takeover</span>
            </div>
            <div className="welcome-feature">
              <span className="welcome-feature-icon">⚡</span>
              <span>Real-time Updates</span>
            </div>
            <div className="welcome-feature">
              <span className="welcome-feature-icon">💬</span>
              <span>Manual Messages</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
