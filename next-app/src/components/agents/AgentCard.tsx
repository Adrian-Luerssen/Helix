'use client';

/**
 * AgentCard Component
 * Displays an individual agent configuration card
 */

import type { Agent } from '@/lib/types';

type AgentCardProps = {
  agent: Agent;
  isActive?: boolean;
  onClick?: (agentId: string) => void;
};

const shortenModel = (model: string): string => {
  if (!model) return 'Unknown';
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
};

const formatWorkspace = (workspace: string): string => {
  if (!workspace) return 'Unknown';
  if (workspace.startsWith('~')) return workspace;
  return workspace.replace(/^\/home\/[^/]+/, '~');
};

export function AgentCard({ agent, isActive = false, onClick }: AgentCardProps): React.ReactElement {
  const isInteractive = Boolean(onClick);
  const displayName = agent.identityName || agent.name || agent.id;
  const modelName = shortenModel(agent.model);
  const workspace = formatWorkspace(agent.workspace);

  const handleClick = (): void => {
    if (!isInteractive) return;
    onClick?.(agent.id);
  };

  return (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : -1}
      onClick={isInteractive ? handleClick : undefined}
      onKeyDown={isInteractive ? (event) => event.key === 'Enter' && handleClick() : undefined}
      className={`
        group p-4 border border-[var(--border-subtle)] rounded-[var(--radius-lg)]
        bg-[var(--bg-card)] transition-all duration-[var(--transition-fast)]
        ${isInteractive ? 'cursor-pointer hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)]' : ''}
      `}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{agent.identityEmoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--text)]">
              {displayName} ({agent.id})
            </span>
            {agent.isDefault && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-muted)] text-[var(--accent)] font-semibold"
                title="Default agent"
              >
                default
              </span>
            )}
            {isActive && (
              <span className="text-xs" title="Active sessions">
                ⚡
              </span>
            )}
            <div className="ml-auto" />
          </div>

          <div className="mt-2 text-sm text-[var(--text-secondary)] space-y-1">
            <div>
              <span className="text-[var(--text-dim)]">Model:</span> {modelName}
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Workspace:</span> {workspace}
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Routes:</span>{' '}
              {agent.bindings > 0
                ? `${agent.bindings} rule${agent.bindings !== 1 ? 's' : ''}`
                : 'default (no explicit rules)'}
            </div>
          </div>

          {isInteractive && (
            <div className="mt-3 text-xs text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
              View sessions →
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentCard;
