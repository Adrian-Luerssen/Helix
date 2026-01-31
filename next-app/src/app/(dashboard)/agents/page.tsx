'use client';

/**
 * Agents Page
 * Displays configured Clawdbot agents
 */

import { AgentList } from '@/components/agents';

export default function AgentsPage(): React.ReactElement {
  return (
    <main className="flex flex-col h-full">
      {/* Page Header */}
      <header className="h-[60px] bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-center px-6 gap-4 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">Agents</h1>
        <span className="text-sm text-[var(--text-dim)]">Agent Configuration</span>

        <div className="flex-1" />

        <button
          className="
            bg-[var(--accent)] hover:bg-[var(--accent-hover)]
            text-white px-4 py-2 rounded-[var(--radius-md)]
            text-sm font-medium transition-all
            hover:shadow-[var(--shadow-glow)]
            disabled:opacity-50 disabled:cursor-not-allowed
          "
          disabled
          title="New agent creation is not available yet"
        >
          + New Agent
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-5xl">
          <AgentList />
        </div>
      </div>
    </main>
  );
}
