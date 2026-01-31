'use client';

/**
 * AgentList Component
 * Displays a list of configured agents
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGateway } from '@/hooks/use-gateway';
import { AgentCard } from './AgentCard';
import type { Agent, SessionKey } from '@/lib/types';

const getAgentFromSessionKey = (sessionKey: SessionKey): string => {
  const parts = sessionKey.split(':');
  return parts[1] || 'unknown';
};

type AgentListProps = {
  onAgentSelect?: (agentId: string) => void;
};

export function AgentList({ onAgentSelect }: AgentListProps): React.ReactElement {
  const { isConnected, listAgents, gateway } = useGateway();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAgentSelect = useCallback((agentId: string) => {
    if (onAgentSelect) {
      onAgentSelect(agentId);
      return;
    }
    router.push(`/sessions?agent=${encodeURIComponent(agentId)}`);
  }, [onAgentSelect, router]);

  const fetchAgents = useCallback(async (): Promise<void> => {
    if (!isConnected) return;

    setIsLoading(true);
    setError(null);

    try {
      const [agentsResult, runsResult] = await Promise.all([
        listAgents(),
        gateway?.getActiveRuns() ?? { runs: [] },
      ]);

      setAgents(agentsResult.agents);
      const activeIds = new Set(runsResult.runs.map((run) => getAgentFromSessionKey(run.sessionKey)));
      setActiveAgents(activeIds);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, listAgents, gateway]);

  useEffect(() => {
    if (isConnected) {
      fetchAgents();
    }
  }, [isConnected, fetchAgents]);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-[var(--text-dim)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium">Connecting to gateway...</div>
      </div>
    );
  }

  if (isLoading && agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-[var(--text-dim)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium">Loading agents...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <div className="text-5xl mb-4 opacity-40">⚠️</div>
        <div className="font-medium text-[var(--red)] mb-1">Error loading agents</div>
        <div className="text-sm text-[var(--text-muted)] mb-4">{error}</div>
        <button
          onClick={fetchAgents}
          className="text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-[var(--text-dim)]">
        <div className="text-5xl mb-4 opacity-40">🤖</div>
        <div className="font-medium mb-1">No agents configured</div>
        <div className="text-sm text-[var(--text-muted)]">
          Configure an agent in Clawdbot to get started
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="px-4 py-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] flex items-center gap-4 text-xs text-[var(--text-dim)]">
        <span>{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
        {activeAgents.size > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
            {activeAgents.size} active
          </span>
        )}
        <button
          onClick={fetchAgents}
          className="ml-auto hover:text-[var(--text-secondary)] transition-colors"
          title="Refresh agents"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="space-y-4">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isActive={activeAgents.has(agent.id)}
            onClick={handleAgentSelect}
          />
        ))}
      </div>
    </div>
  );
}

export default AgentList;
