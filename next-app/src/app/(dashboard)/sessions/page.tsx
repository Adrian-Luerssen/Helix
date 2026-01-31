'use client';

/**
 * Agent Sessions Page
 * 
 * Lists and manages Clawdbot agent sessions with real-time updates:
 * - Smart status filtering (Running, Needs You, Error, Recent, Idle)
 * - Quick filter presets (Inbox, Active, Errors, Topics, Crons)
 * - Search and channel/agent filtering
 */

import { Suspense, useCallback, useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SessionList } from '@/components/sessions';
import { useGateway } from '@/hooks/use-gateway';
import { 
  FILTER_PRESETS, 
  getAllStatusConfigs,
  type SmartSessionStatus,
} from '@/lib/session-status';
import type { SessionKey } from '@/lib/types';

const ALL_STATUSES: SmartSessionStatus[] = ['running', 'needs-you', 'error', 'recent', 'idle'];

function SessionsPageContent(): React.ReactElement {
  const { isConnected } = useGateway();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  
  const agentFilterFromUrl = searchParams.get('agent') ?? '';

  // Debounce search
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  // Sync URL agent filter
  useEffect(() => {
    if (agentFilterFromUrl) {
      setAgentFilter(agentFilterFromUrl);
    }
  }, [agentFilterFromUrl]);

  const handleSessionSelect = useCallback((sessionKey: SessionKey) => {
    const encoded = encodeURIComponent(sessionKey);
    router.push(`/sessions/${encoded}`);
  }, [router]);

  const handlePresetClick = useCallback((presetId: string) => {
    if (activePreset === presetId) {
      // Toggle off
      setActivePreset(null);
      setStatusFilter('all');
      setTypeFilter('all');
    } else {
      setActivePreset(presetId);
      // Clear other filters when using preset
      setStatusFilter('all');
      setTypeFilter('all');
    }
  }, [activePreset]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setChannelFilter('all');
    setStatusFilter('all');
    setTypeFilter('all');
    setAgentFilter('all');
    setActivePreset(null);
    if (agentFilterFromUrl) {
      router.push('/sessions');
    }
  }, [agentFilterFromUrl, router]);

  const statusConfigs = useMemo(() => getAllStatusConfigs(), []);
  
  const hasActiveFilters = 
    searchQuery !== '' || 
    channelFilter !== 'all' || 
    statusFilter !== 'all' || 
    typeFilter !== 'all' ||
    agentFilter !== 'all' ||
    activePreset !== null;

  return (
    <main className="flex flex-col h-full">
      {/* Page Header */}
      <header className="h-[60px] bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-center px-6 gap-4 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">Sessions</h1>
        <span className="text-sm text-[var(--text-dim)]">Agent Management</span>
        
        <div className="flex-1" />
        
        <button 
          className="
            bg-[var(--accent)] hover:bg-[var(--accent-hover)] 
            text-white px-4 py-2 rounded-[var(--radius-md)] 
            text-sm font-medium transition-all 
            hover:shadow-[var(--shadow-glow)]
            disabled:opacity-50 disabled:cursor-not-allowed
          "
          disabled={!isConnected}
        >
          New Session
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 p-6 overflow-hidden">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden h-full flex flex-col">
          
          {/* Search bar */}
          <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  type="search"
                  placeholder="Search sessions..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="
                    w-full bg-[var(--bg-input)] border border-[var(--border-subtle)]
                    rounded-[var(--radius-sm)] pl-9 pr-3 py-2 text-sm
                    text-[var(--text)] placeholder:text-[var(--text-muted)]
                    focus:outline-none focus:border-[var(--accent)]
                    transition-colors
                  "
                />
                <svg 
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="
                    text-xs px-3 py-2 rounded-[var(--radius-sm)]
                    bg-[var(--bg-elevated)] border border-[var(--border-subtle)]
                    text-[var(--text-secondary)] hover:text-[var(--text)]
                    transition-colors whitespace-nowrap
                  "
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Quick Presets */}
          <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-center gap-2 overflow-x-auto">
            <span className="text-xs text-[var(--text-muted)] shrink-0">Quick:</span>
            {FILTER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetClick(preset.id)}
                title={preset.description}
                className={`
                  text-xs px-3 py-1.5 rounded-full whitespace-nowrap
                  transition-all
                  ${activePreset === preset.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]'
                  }
                `}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Filter Dropdowns */}
          <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-center gap-3 flex-wrap">
            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)]">Status:</label>
              <select 
                className="
                  bg-[var(--bg-input)] border border-[var(--border-subtle)]
                  rounded-[var(--radius-sm)] px-2 py-1.5 text-xs
                  text-[var(--text-secondary)]
                  focus:outline-none focus:border-[var(--accent)]
                  transition-colors cursor-pointer
                "
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setActivePreset(null);
                }}
              >
                <option value="all">All</option>
                {ALL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusConfigs[status].emoji} {statusConfigs[status].label}
                  </option>
                ))}
              </select>
            </div>

            {/* Type Filter */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)]">Type:</label>
              <select 
                className="
                  bg-[var(--bg-input)] border border-[var(--border-subtle)]
                  rounded-[var(--radius-sm)] px-2 py-1.5 text-xs
                  text-[var(--text-secondary)]
                  focus:outline-none focus:border-[var(--accent)]
                  transition-colors cursor-pointer
                "
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setActivePreset(null);
                }}
              >
                <option value="all">All Types</option>
                <option value="conversations">💬 Conversations</option>
                <option value="topics">📑 Topics</option>
                <option value="crons">⏰ Cron Jobs</option>
                <option value="webchat">🌐 Webchat</option>
                <option value="apps">📱 App Sessions</option>
              </select>
            </div>

            {/* Channel Filter */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)]">Channel:</label>
              <select 
                className="
                  bg-[var(--bg-input)] border border-[var(--border-subtle)]
                  rounded-[var(--radius-sm)] px-2 py-1.5 text-xs
                  text-[var(--text-secondary)]
                  focus:outline-none focus:border-[var(--accent)]
                  transition-colors cursor-pointer
                "
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
              >
                <option value="all">All Channels</option>
                <option value="telegram">Telegram</option>
                <option value="webchat">Webchat</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
              </select>
            </div>

            {/* Agent Filter */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)]">Agent:</label>
              <select 
                className="
                  bg-[var(--bg-input)] border border-[var(--border-subtle)]
                  rounded-[var(--radius-sm)] px-2 py-1.5 text-xs
                  text-[var(--text-secondary)]
                  focus:outline-none focus:border-[var(--accent)]
                  transition-colors cursor-pointer
                "
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="all">All Agents</option>
                <option value="main">main</option>
                <option value="caffeine">caffeine</option>
                <option value="codex">codex</option>
                <option value="app-assistant">app-assistant</option>
              </select>
            </div>
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto">
            <SessionList
              onSessionSelect={handleSessionSelect}
              searchQuery={debouncedSearchQuery}
              channelFilter={channelFilter}
              statusFilter={statusFilter}
              typeFilter={typeFilter}
              agentFilter={agentFilter !== 'all' ? agentFilter : agentFilterFromUrl}
              activePreset={activePreset}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SessionsPage(): React.ReactElement {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-dim)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium">Loading...</div>
      </div>
    }>
      <SessionsPageContent />
    </Suspense>
  );
}
