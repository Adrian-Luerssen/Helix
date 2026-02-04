    // ═══════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    const WS_PROTOCOL_VERSION = 3;
    const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
    // Sidebar should only show recently-active sessions (unless pinned / running)
    const SIDEBAR_HIDE_INACTIVE_MS = 15 * 60 * 1000; // 15 minutes
    
    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════
    
    // Get configuration (from config.js)
    const config = window.ClawCondosConfig ? window.ClawCondosConfig.getConfig() : {};

    // localStorage keys (migrate from legacy "sharp_*" keys)
    const LS_PREFIX = 'clawcondos_';
    function lsGet(key, fallback = null) {
      const v = localStorage.getItem(LS_PREFIX + key);
      if (v != null) return v;
      const legacy = localStorage.getItem('sharp_' + key);
      if (legacy != null) return legacy;
      return fallback;
    }
    function lsSet(key, value) {
      localStorage.setItem(LS_PREFIX + key, value);
    }
    function lsRemove(key) {
      localStorage.removeItem(LS_PREFIX + key);
    }

    const state = {
      // Data
      sessions: [],
      apps: [],
      agents: [],
      goals: [],
      currentGoalId: 'all',
      currentGoalOpenId: null,
      currentCondoId: null,
      newSessionCondoId: null,
      newGoalCondoId: null,
      attachSessionKey: null,
      attachGoalId: null,
      
      // UI
      currentView: 'dashboard',
      currentSession: null,
      selectedAppId: null,
      // Recurring tasks (cron)
      selectedCronJobId: null,    // preferred: cron job id
      cronJobs: [],
      cronJobsLoaded: false,
      cronRunsByJobId: {},
      newSessionAgentId: null,
      pendingRouteSessionKey: null,
      pendingRouteGoalId: null,
      pendingRouteCondoId: null,
      pendingRouteAppId: null,
      pendingRouteNewSession: null,
      pendingRouteNewGoalCondoId: null,
      chatHistory: [],
      // Cache last loaded history per session so UI doesn't go blank on transient disconnects.
      sessionHistoryCache: new Map(), // Map<sessionKey, messages[]>
      sessionHistoryLoadSeq: 0,
      isThinking: false,
      messageQueue: [],  // Queued messages when agent is busy

      // Per-session model overrides (UI-level; model switch is triggered by sending /new <model>)
      sessionModelOverrides: (() => {
        try { return JSON.parse(lsGet('session_model_overrides', '{}') || '{}') || {}; } catch { return {}; }
      })(),

      // Chat UX
      chatAutoScroll: true,          // user is at bottom (or near-bottom)
      chatUnseenCount: 0,            // new messages while scrolled up
      streamingBuffers: new Map(),   // Map<runId, string>
      streamingRaf: new Map(),       // Map<runId, rafId>
      recentMessageFingerprints: new Map(), // Map<fingerprint, timestampMs>
      recentMessageFingerprintPruneAt: 0,
      
      // Audio recording
      mediaRecorder: null,
      audioChunks: [],
      recordingStartTime: null,
      recordingTimerInterval: null,
      
      // Auth - loaded from config or localStorage
      // Token should be set via config.json or login modal, NOT hardcoded
      token: lsGet('token', null),
      gatewayUrl: (() => {
        // Priority: localStorage > config > auto-detect
        const saved = lsGet('gateway', null);
        if (saved && !saved.includes(':18789')) {
          return saved;
        }
        // Clear invalid old URLs
        if (saved && saved.includes(':18789') && window.location.hostname !== 'localhost') {
          lsRemove('gateway');
          // Also clear legacy if present
          localStorage.removeItem('sharp_gateway');
        }
        // Use config if available
        if (config.gatewayWsUrl) {
          return config.gatewayWsUrl;
        }
        // Auto-detect from location
        const host = window.location.hostname || 'localhost';
        if (host.includes('.ts.net') && window.location.protocol === 'http:') {
          return 'wss://' + host;
        }
        const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const port = window.location.port;
        return port ? proto + host + ':' + port : proto + host;
      })(),
      
      // WebSocket
      ws: null,
      wsReconnectTimer: null,
      wsKeepaliveTimer: null,
      wsStaleTimer: null,
      wsLastMessageAt: 0,
      wsReconnectAttempts: 0,
      connected: false,
      connectionStatus: 'connecting',
      wsLastClose: null,          // { code, reason, at }
      wsLastError: null,          // string
      wsLastConnectAttemptAt: 0,  // ms
      connectNonce: null,
      connectSent: false,
      rpcIdCounter: 0,
      rpcPending: new Map(),
      
      // Streaming
      activeRuns: new Map(),
      activeRunsStore: JSON.parse(lsGet('active_runs', '{}') || '{}'),  // Persisted: { sessionKey: { runId, startedAt } }
      sessionInputReady: new Map(),
      
      // Pin & Archive
      pinnedSessions: JSON.parse(lsGet('pinned_sessions', '[]') || '[]'),
      archivedSessions: JSON.parse(lsGet('archived_sessions', '[]') || '[]'),
      showArchived: false,
      
      // Custom session names
      sessionNames: JSON.parse(lsGet('session_names', '{}') || '{}'),

      // Per-session UI verbose toggle (best-effort)
      verboseBySession: JSON.parse(lsGet('verbose_by_session', '{}') || '{}'),
      
      // Search & Filters
      searchQuery: '',
      filterChannel: 'all',  // all, telegram, discord, signal, whatsapp, cron
      filterStatus: 'all',   // all, running, unread, error, recent, idle
      recurringSearch: lsGet('recurring_search', '') || '',
      recurringAgentFilter: lsGet('recurring_agent_filter', 'all') || 'all',
      recurringEnabledOnly: lsGet('recurring_enabled_only', '0') === '1',
      agentJobsSearchByAgent: JSON.parse(lsGet('agent_jobs_search', '{}') || '{}'),
      agentJobsEnabledOnlyByAgent: JSON.parse(lsGet('agent_jobs_enabled_only', '{}') || '{}'),
      
      // Auto-title generation tracking
      generatingTitles: new Set(),  // Currently generating
      attemptedTitles: new Set(),   // Already tried (avoid retries)
      
      // Auto-archive: 'never' or number of days
      autoArchiveDays: lsGet('auto_archive_days', '7') || '7',
      
      // Track when sessions were last viewed (for unread indicator)
      lastViewedAt: JSON.parse(lsGet('last_viewed', '{}') || '{}'),
      
      // Track which session groups are expanded (for nested view)
      expandedGroups: JSON.parse(lsGet('expanded_groups', '{}') || '{}'),

      // Track which condos are expanded/collapsed in sidebar
      expandedCondos: JSON.parse(lsGet('expanded_condos', '{}') || '{}'),

      // Track which agent nodes are expanded in sidebar (Agents > Sessions/Subsessions)
      expandedAgents: JSON.parse(lsGet('expanded_agents', '{}') || '{}'),
      
      // Session status (two separate concepts)
      // 1) Brief current state (LLM-generated text)
      sessionBriefStatus: JSON.parse(lsGet('session_brief_status', '{}') || '{}'),
      generatingStatus: new Set(),

      // 2) Agent lifecycle status (idle/thinking/offline/error)
      sessionAgentStatus: JSON.parse(lsGet('session_agent_status', '{}') || '{}'),
      
      // Tool activity tracking (for compact indicator)
      activeTools: new Map(),  // Map<toolCallId, { name, args, output, startedAt, status }>
      toolActivityExpanded: false
    };
    
    // ═══════════════════════════════════════════════════════════════
    // SESSION PIN & ARCHIVE
    // ═══════════════════════════════════════════════════════════════
    function isSessionPinned(key) {
      return state.pinnedSessions.includes(key);
    }
    
    function isSessionArchived(key) {
      return state.archivedSessions.includes(key);
    }
    
    // Parse session key to extract group info for nesting
    function parseSessionGroup(key) {
      // Match patterns like: agent:main:telegram:group:-1003814943696:topic:54
      const topicMatch = key.match(/^(agent:[^:]+:[^:]+:group:[^:]+):topic:(\d+)$/);
      if (topicMatch) {
        return {
          type: 'topic',
          groupKey: topicMatch[1],
          topicId: topicMatch[2],
          isGrouped: true
        };
      }
      // Match patterns like: agent:main:telegram:group:-1003814943696 (group without topic)
      const groupMatch = key.match(/^(agent:[^:]+:[^:]+:group:[^:]+)$/);
      if (groupMatch) {
        return {
          type: 'group',
          groupKey: groupMatch[1],
          isGrouped: false
        };
      }
      return { type: 'standalone', isGrouped: false };
    }

    function getSessionCondoId(session) {
      if (!session?.key) return 'unknown';
      const parsed = parseSessionGroup(session.key);
      if (parsed.type === 'topic') {
        return `${parsed.groupKey}:topic:${parsed.topicId}`;
      }
      if (parsed.type === 'group') {
        return parsed.groupKey;
      }
      if (session.key.startsWith('cron:')) return 'cron';
      return `misc:${session.key.split(':')[0] || 'misc'}`;
    }

    function getSessionCondoName(session) {
      if (!session) return 'Unknown';
      if (session.key.startsWith('cron:')) return 'Recurring';
      if (session.key.includes(':topic:')) return getSessionName(session);
      if (session.key.includes(':group:')) {
        const parsed = parseSessionGroup(session.key);
        return parsed.groupKey ? getGroupDisplayName(parsed.groupKey) : getSessionName(session);
      }
      return session.displayName || session.label || 'Direct';
    }

    function isGoalCompleted(goal) {
      return goal?.completed === true || goal?.status === 'done';
    }

    function getCondoIdForSessionKey(sessionKey) {
      const session = state.sessions.find(s => s.key === sessionKey);
      if (session) return getSessionCondoId(session);
      return state.currentCondoId || null;
    }
    
    function getGroupDisplayName(groupKey) {
      // Try to find a custom name for the group
      const customName = state.sessionNames[groupKey];
      if (customName) return customName;
      // Extract group ID and return a readable name
      const match = groupKey.match(/:group:(-?\d+)$/);
      if (match) {
        return `Group ${match[1]}`;
      }
      return groupKey.split(':').pop();
    }
    
    function toggleGroupExpanded(groupKey) {
      state.expandedGroups[groupKey] = !state.expandedGroups[groupKey];
      lsSet('expanded_groups', JSON.stringify(state.expandedGroups));
      renderSessions();
    }
    
    function isGroupExpanded(groupKey) {
      // Default to expanded
      return state.expandedGroups[groupKey] !== false;
    }

    function toggleCondoExpanded(condoId) {
      state.expandedCondos[condoId] = !isCondoExpanded(condoId);
      lsSet('expanded_condos', JSON.stringify(state.expandedCondos));
      renderCondos();
    }

    function isCondoExpanded(condoId) {
      // Default: expanded unless explicitly set false
      return state.expandedCondos[condoId] !== false;
    }

    function toggleAgentExpanded(agentId) {
      state.expandedAgents[agentId] = !isAgentExpanded(agentId);
      lsSet('expanded_agents', JSON.stringify(state.expandedAgents));
      renderAgents();
    }

    function isAgentExpanded(agentId) {
      // Default to expanded
      return state.expandedAgents[agentId] !== false;
    }
    
    function getGroupUnreadCount(groupKey, sessions) {
      return sessions.filter(s => {
        const parsed = parseSessionGroup(s.key);
        return parsed.groupKey === groupKey && isSessionUnread(s.key);
      }).length;
    }
    
    async function generateGroupTitles(groupKey, event) {
      if (event) event.stopPropagation();
      // Find all sessions in this group
      const groupSessions = state.sessions.filter(s => {
        const parsed = parseSessionGroup(s.key);
        return parsed.groupKey === groupKey && parsed.type === 'topic';
      });
      
      showToast(`Generating titles for ${groupSessions.length} topics...`);
      
      // Generate titles for each session that doesn't have a custom name
      for (const s of groupSessions) {
        if (!getCustomSessionName(s.key) && !state.generatingTitles.has(s.key)) {
          await generateSessionTitle(s.key);
          // Small delay between requests
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    
    // Session status - brief current state (5-10 words)
    function getSessionStatus(key) {
      return state.sessionBriefStatus[key] || null;
    }
    
    async function generateSessionStatusBrief(key, event) {
      if (event) event.stopPropagation();
      if (state.generatingStatus.has(key)) return;
      
      state.generatingStatus.add(key);
      renderSessions();
      
      try {
        const history = await rpcCall('chat.history', { sessionKey: key, limit: 5 });
        if (!history?.messages?.length) {
          state.generatingStatus.delete(key);
          return;
        }
        
        const context = history.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 150) : ''}`)
          .join('\n');
        
        const response = await fetch('/api/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Write a 5-8 word status of what is currently happening. Be specific. No punctuation. Examples: "Adding unread indicators to ClawCondos sidebar", "Debugging Catastro API rate limits", "Waiting for user feedback on design"' },
              { role: 'user', content: context.slice(0, 1500) }
            ],
            max_tokens: 30,
            temperature: 0.3
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const status = data.choices?.[0]?.message?.content?.trim();
          if (status && status.length < 80) {
            state.sessionBriefStatus[key] = { text: status, updatedAt: Date.now() };
            lsSet('session_brief_status', JSON.stringify(state.sessionBriefStatus));
          }
        }
      } catch (err) {
        console.error('Status generation failed:', err);
      } finally {
        state.generatingStatus.delete(key);
        renderSessions();
      }
    }
    
    // Ask the session agent for a full summary
    async function askSessionForSummary(key, event) {
      if (event) event.stopPropagation();
      
      // Send message to the session asking for summary
      try {
        await rpcCall('chat.send', {
          sessionKey: key,
          message: 'Please give me a clean summary of our full conversation so far - what we discussed, what was accomplished, and current status.',
          idempotencyKey: `summary-request-${Date.now()}`
        });
        
        showToast('Asked session for summary - check the chat');
        // Open that session so user can see the response
        openSession(key);
      } catch (err) {
        console.error('Failed to ask for summary:', err);
        showToast('Failed to request summary', 'error');
      }
    }
    
    function renderSessionStatusLine(key) {
      const isGenerating = state.generatingStatus.has(key);
      const status = getSessionStatus(key);
      
      if (isGenerating) {
        return '<div class="item-status generating">⏳</div>';
      }
      
      if (status?.text) {
        return `<div class="item-status" onclick="event.stopPropagation(); generateSessionStatusBrief('${escapeHtml(key)}')" title="Click to refresh">${escapeHtml(status.text)}</div>`;
      }
      
      return `<div class="item-status generate-link" onclick="event.stopPropagation(); generateSessionStatusBrief('${escapeHtml(key)}')">↻ status</div>`;
    }
    
    function isSessionUnread(key) {
      const session = state.sessions.find(s => s.key === key);
      if (!session) return false;
      const lastViewed = state.lastViewedAt[key] || 0;
      const updatedAt = session.updatedAt || 0;
      // Unread if updated since last viewed (with 1s grace period)
      return updatedAt > lastViewed + 1000;
    }
    
    function markSessionRead(key) {
      state.lastViewedAt[key] = Date.now();
      lsSet('last_viewed', JSON.stringify(state.lastViewedAt));
    }
    
    function markSessionUnread(key, event) {
      if (event) event.stopPropagation();
      // Set lastViewed to 0 so it appears unread
      state.lastViewedAt[key] = 0;
      lsSet('last_viewed', JSON.stringify(state.lastViewedAt));
      renderSessions();
      renderSessionsGrid();
    }
    
    function markAllSessionsRead() {
      const now = Date.now();
      state.sessions.forEach(s => {
        state.lastViewedAt[s.key] = now;
      });
      lsSet('last_viewed', JSON.stringify(state.lastViewedAt));
      renderSessions();
      renderSessionsGrid();
      showToast('All sessions marked as read');
    }
    
    function getUnreadCount() {
      return state.sessions.filter(s => isSessionUnread(s.key)).length;
    }
    
    function togglePinSession(key) {
      const idx = state.pinnedSessions.indexOf(key);
      if (idx >= 0) {
        state.pinnedSessions.splice(idx, 1);
      } else {
        state.pinnedSessions.push(key);
      }
      lsSet('pinned_sessions', JSON.stringify(state.pinnedSessions));
      renderSessions();
      renderSessionsGrid();
    }
    
    function toggleArchiveSession(key) {
      const idx = state.archivedSessions.indexOf(key);
      if (idx >= 0) {
        state.archivedSessions.splice(idx, 1);
      } else {
        state.archivedSessions.push(key);
        // Unpin if archived
        const pinIdx = state.pinnedSessions.indexOf(key);
        if (pinIdx >= 0) {
          state.pinnedSessions.splice(pinIdx, 1);
          lsSet('pinned_sessions', JSON.stringify(state.pinnedSessions));
        }
      }
      lsSet('archived_sessions', JSON.stringify(state.archivedSessions));
      renderSessions();
      renderSessionsGrid();
    }
    
    function toggleShowArchived() {
      state.showArchived = !state.showArchived;
      renderSessions();
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SESSION RENAME
    // ═══════════════════════════════════════════════════════════════
    function getCustomSessionName(key) {
      return state.sessionNames[key] || null;
    }
    
    function setCustomSessionName(key, name) {
      if (name && name.trim()) {
        state.sessionNames[key] = name.trim();
      } else {
        delete state.sessionNames[key];
      }
      lsSet('session_names', JSON.stringify(state.sessionNames));
      renderSessions();
      renderSessionsGrid();
    }
    
    function promptRenameSession(key, event) {
      if (event) event.stopPropagation();
      const session = state.sessions.find(s => s.key === key);
      const current = getCustomSessionName(key) || getDefaultSessionName(session);
      const newName = prompt('Rename session:', current);
      if (newName !== null) {
        setCustomSessionName(key, newName);
      }
    }
    
    async function generateSessionTitle(key, event) {
      if (event) event.stopPropagation();
      const session = state.sessions.find(s => s.key === key);
      if (!session) return;
      
      showToast('Generating title...', 'info', 3000);
      
      try {
        // Get first few messages from this session
        const historyResult = await rpcCall('chat.history', { sessionKey: key, limit: 5 });
        const messages = historyResult?.messages || [];
        
        if (messages.length === 0) {
          showToast('No messages to summarize', 'warning');
          return;
        }
        
        // Extract conversation context
        const conversation = messages.slice(0, 4).map(m => {
          const role = m.role === 'user' ? 'User' : 'Assistant';
          let content = '';
          if (typeof m.content === 'string') {
            content = m.content.slice(0, 150);
          } else if (Array.isArray(m.content)) {
            content = m.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join(' ')
              .slice(0, 150);
          }
          return `${role}: ${content}`;
        }).join('\n');
        
        if (!conversation.trim()) {
          showToast('No content to summarize', 'warning');
          return;
        }
        
        // Try LLM-based title generation
        const title = await generateTitleWithLLM(conversation);
        
        if (title) {
          setCustomSessionName(key, title);
          showToast(`Titled: "${title}"`, 'success');
        } else {
          showToast('Could not generate title', 'warning');
        }
      } catch (err) {
        console.error('Failed to generate title:', err);
        showToast('Failed to generate title', 'error');
      }
    }
    
    async function generateTitleWithLLM(conversation) {
      try {
        // Use server-side proxy that injects the API key
        const response = await fetch('/api/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'Generate a very short title (3-6 words) for this conversation. Reply with ONLY the title, no quotes, no punctuation at the end.'
              },
              {
                role: 'user',
                content: conversation
              }
            ],
            max_tokens: 20,
            temperature: 0.3
          })
        });
        
        if (!response.ok) {
          console.error('OpenAI API error:', response.status);
          return null;
        }
        
        const data = await response.json();
        const title = data.choices?.[0]?.message?.content?.trim();
        
        if (title && title.length < 60) {
          return title.replace(/^["']|["']$/g, '').replace(/\.+$/, '');
        }
        return null;
      } catch (err) {
        console.error('LLM title generation failed:', err);
        return null;
      }
    }
    
    // OpenAI API key is injected server-side via /api/openai proxy
    
    async function autoGenerateTitle(key) {
      // Mark as attempted to avoid retries
      state.attemptedTitles.add(key);
      state.generatingTitles.add(key);
      renderSessions();
      
      try {
        const session = state.sessions.find(s => s.key === key);
        if (!session) return;
        
        // Get messages
        const historyResult = await rpcCall('chat.history', { sessionKey: key, limit: 5 });
        const messages = historyResult?.messages || [];
        
        if (messages.length === 0) {
          state.generatingTitles.delete(key);
          renderSessions();
          return;
        }
        
        // Extract conversation
        const conversation = messages.slice(0, 4).map(m => {
          const role = m.role === 'user' ? 'User' : 'Assistant';
          let content = '';
          if (typeof m.content === 'string') {
            content = m.content.slice(0, 150);
          } else if (Array.isArray(m.content)) {
            content = m.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join(' ')
              .slice(0, 150);
          }
          return `${role}: ${content}`;
        }).join('\n');
        
        if (!conversation.trim()) {
          state.generatingTitles.delete(key);
          renderSessions();
          return;
        }
        
        // Generate title
        const title = await generateTitleWithLLM(conversation);
        
        state.generatingTitles.delete(key);
        
        if (title) {
          // Animate the title with typewriter effect
          setCustomSessionName(key, title);
          animateTitle(key, title);
        } else {
          renderSessions();
        }
      } catch (err) {
        console.error('Auto-generate title failed:', err);
        state.generatingTitles.delete(key);
        renderSessions();
      }
    }
    
    function animateTitle(key, title) {
      // Find the session name element and animate it
      const el = document.querySelector(`[data-session-key="${key}"] .item-name`);
      if (el) {
        el.innerHTML = '';
        el.className = 'item-name title-typewriter';
        let i = 0;
        const interval = setInterval(() => {
          if (i < title.length) {
            el.textContent += title[i];
            i++;
          } else {
            clearInterval(interval);
            el.className = 'item-name';
          }
        }, 30);
      } else {
        renderSessions();
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SESSION SEARCH
    // ═══════════════════════════════════════════════════════════════
    function handleSearchInput(value) {
      state.searchQuery = value.toLowerCase().trim();
      renderSessions();
      renderSessionsGrid();
    }
    
    function clearSearch() {
      state.searchQuery = '';
      document.getElementById('sessionSearchInput').value = '';
      renderSessions();
      renderSessionsGrid();
    }
    
    function handleSearchKeydown(event) {
      if (event.key === 'Escape') {
        clearSearch();
        document.getElementById('sessionSearchInput').blur();
      } else if (event.key === 'Enter') {
        // Select first visible session
        const firstSession = document.querySelector('#sessionsList .session-item');
        if (firstSession) firstSession.click();
      }
    }
    
    function matchesSearch(session) {
      // Text search
      if (state.searchQuery) {
        const q = state.searchQuery;
        const name = getSessionName(session).toLowerCase();
        const key = session.key.toLowerCase();
        const label = (session.label || '').toLowerCase();
        const displayName = (session.displayName || '').toLowerCase();
        if (!name.includes(q) && !key.includes(q) && !label.includes(q) && !displayName.includes(q)) {
          return false;
        }
      }
      
      // Channel filter
      if (state.filterChannel !== 'all') {
        const key = session.key.toLowerCase();
        if (state.filterChannel === 'cron' && !key.includes('cron')) return false;
        if (state.filterChannel === 'subagent' && !key.includes('subagent')) return false;
        if (state.filterChannel === 'telegram' && !key.includes('telegram')) return false;
        if (state.filterChannel === 'discord' && !key.includes('discord')) return false;
        if (state.filterChannel === 'signal' && !key.includes('signal')) return false;
        if (state.filterChannel === 'whatsapp' && !key.includes('whatsapp')) return false;
      }
      
      // Status filter
      if (state.filterStatus !== 'all') {
        const status = getSessionStatusType(session);
        if (state.filterStatus !== status) return false;
      }
      
      return true;
    }
    
    function getSessionStatusType(session) {
      // Check if running (has active run)
      if (state.activeRuns?.has?.(session.key)) {
        return 'running';
      }
      
      // Check if unread
      const lastViewed = state.lastViewedAt[session.key] || 0;
      if (session.updatedAt && session.updatedAt > lastViewed + 1000) {
        return 'unread';
      }
      
      // Check if error (look for error in status)
      const statusInfo = state.sessionBriefStatus[session.key];
      if (statusInfo && statusInfo.text && statusInfo.text.toLowerCase().includes('error')) {
        return 'error';
      }
      
      // Check if recent (updated in last hour)
      const hourAgo = Date.now() - 3600000;
      if (session.updatedAt && session.updatedAt > hourAgo) {
        return 'recent';
      }
      
      return 'idle';
    }
    
    function setFilterChannel(value) {
      state.filterChannel = value;
      renderSessions();
      renderSessionsGrid();
    }
    
    function setFilterStatus(value) {
      state.filterStatus = value;
      renderSessions();
      renderSessionsGrid();
    }
    
    // Keyboard shortcut: Cmd/Ctrl+K to focus search
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('sessionSearchInput')?.focus();
      }
    });
    
    // ═══════════════════════════════════════════════════════════════
    // AUTO-ARCHIVE
    // ═══════════════════════════════════════════════════════════════
    function setAutoArchiveDays(value) {
      state.autoArchiveDays = value;
      lsSet('auto_archive_days', value);
      console.log('[ClawCondos] Auto-archive set to:', value);
      // Apply immediately so the sidebar updates without requiring a manual refresh.
      if (state.sessions && state.sessions.length) {
        checkAutoArchive();
        renderSessions();
        renderSessionsGrid();
      }
    }
    
    

    // ═══════════════════════════════════════════════════════════════
    // ACTIVITY WINDOW PRESET (Albert)
    // Collapse all condos except those with goals modified in the last X.
    // X comes from the preset dropdown.

    function parseDaysValue(v) {
      if (v == null) return null;
      if (v === 'never') return null;
      const n = parseFloat(String(v));
      return Number.isFinite(n) && n > 0 ? n : null;
    }

    function goalLastActivityMs(goal) {
      let t = 0;
      if (goal?.updatedAtMs) t = Math.max(t, Number(goal.updatedAtMs) || 0);
      if (goal?.createdAtMs) t = Math.max(t, Number(goal.createdAtMs) || 0);
      // Also consider the most recently updated session inside the goal.
      if (goal?.sessions && Array.isArray(goal.sessions) && state.sessions && state.sessions.length) {
        for (const k of goal.sessions) {
          const s = state.sessions.find(ss => ss.key === k);
          if (s?.updatedAt) t = Math.max(t, Number(s.updatedAt) || 0);
        }
      }
      return t;
    }

    function isGoalBlocked(goal) {
      if (!goal) return false;
      if (goal.status === 'blocked' || goal.blocked === true) return true;
      const tasks = Array.isArray(goal.tasks) ? goal.tasks : [];
      if (!tasks.length) return false;
      const next = tasks.find(t => !(t?.done === true || t?.completed === true));
      if (!next) return false;
      return next.blocked === true || next.status === 'blocked' || next.state === 'blocked';
    }

    function applyActivityWindowPreset() {
      const days = parseDaysValue(state.activityWindowDays);
      if (!days) return;

      const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);

      // Build condo -> goals mapping (pending goals only)
      const recentCondos = new Set();
      for (const g of (state.goals || [])) {
        if (!g || isGoalCompleted(g)) continue;
        const last = goalLastActivityMs(g);
        if (last && last >= threshold) {
          const condoId = g.condoId || 'misc:default';
          recentCondos.add(condoId);
        }
      }

      // Collapse everything except recent condos
      const nextExpanded = {};
      // Keep explicit expansion for current condo if it has recent activity, otherwise collapse it too.
      // (Albert preference: collapse all except recent)
      for (const condoId of Object.keys(state.expandedCondos || {})) {
        nextExpanded[condoId] = false;
      }
      for (const condoId of recentCondos) {
        nextExpanded[condoId] = true;
      }
      state.expandedCondos = nextExpanded;
      lsSet('expanded_condos', JSON.stringify(state.expandedCondos));

      renderGoals();
    }

    function setActivityWindowDays(value) {
      state.activityWindowDays = value;
      lsSet('activity_window_days', String(value));
      // Apply immediately
      applyActivityWindowPreset();
    }
function initAutoArchiveUI() {
      const select = document.getElementById('autoArchiveSelect');
      if (select) {
        select.value = state.autoArchiveDays;
      }
    }
    
    function checkAutoArchive() {
      // Skip if auto-archive is disabled
      if (state.autoArchiveDays === 'never') {
        console.log('[ClawCondos] Auto-archive disabled');
        return;
      }
      
      const days = parseFloat(state.autoArchiveDays);
      if (isNaN(days) || days <= 0) return;
      
      const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
      let autoArchivedCount = 0;
      
      for (const session of state.sessions) {
        // Skip if already archived
        if (isSessionArchived(session.key)) continue;
        
        // Skip pinned sessions (they're important)
        if (isSessionPinned(session.key)) continue;
        
        // Check if session is inactive beyond threshold
        const updatedAt = session.updatedAt || 0;
        if (updatedAt > 0 && updatedAt < threshold) {
          // Auto-archive this session
          state.archivedSessions.push(session.key);
          autoArchivedCount++;
          console.log('[ClawCondos] Auto-archived:', session.key, 'last updated:', new Date(updatedAt).toISOString());
        }
      }
      
      // Save if any were archived
      if (autoArchivedCount > 0) {
        lsSet('archived_sessions', JSON.stringify(state.archivedSessions));
        showToast(`Auto-archived ${autoArchivedCount} inactive session${autoArchivedCount > 1 ? 's' : ''}`, 'info');
        renderSessions();
        renderSessionsGrid();
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════
    function showToast(message, type = 'info', durationMs = 4000) {
      const container = document.getElementById('toastContainer');
      if (!container) return;
      
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      
      const icon = type === 'success' ? '✓' : type === 'warning' ? '⚠' : 'ℹ';
      toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
      
      container.appendChild(toast);
      
      // Auto-remove after duration
      setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
      }, durationMs);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // WEBSOCKET CONNECTION
    // ═══════════════════════════════════════════════════════════════
    function connectWebSocket() {
      if (state.ws) {
        state.ws.close();
        state.ws = null;
      }
      
      state.connectNonce = null;
      state.connectSent = false;
      state.wsLastConnectAttemptAt = Date.now();
      setConnectionStatus('connecting');
      
      // Build WebSocket URL
      let wsUrl = state.gatewayUrl.replace(/^http/, 'ws');
      // If connecting through Caddy (not directly to :18789), use the dedicated ClawCondos WS endpoint.
      if (!wsUrl.includes(':18789')) {
        wsUrl = wsUrl.replace(/\/?$/, '/clawcondos-ws');
      }
      console.log('[WS] Connecting to', wsUrl);
      
      try {
        state.ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error('[WS] Failed to create WebSocket:', err);
        setConnectionStatus('error');
        scheduleReconnect();
        return;
      }
      
      state.ws.onopen = () => {
        console.log('[WS] Socket opened, waiting for challenge...');
        state.wsLastMessageAt = Date.now();
      };
      
      state.ws.onmessage = (event) => {
        state.wsLastMessageAt = Date.now();
        resetStaleTimer();
        
        try {
          const msg = JSON.parse(event.data);
          handleWsMessage(msg);
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };
      
      state.ws.onerror = (err) => {
        const msg = (err && (err.message || err.type)) ? String(err.message || err.type) : 'WebSocket error';
        state.wsLastError = msg;
        console.error('[WS] Error:', err);
      };
      
      state.ws.onclose = (event) => {
        state.wsLastClose = { code: event?.code, reason: event?.reason || '', at: Date.now() };
        console.log('[WS] Closed:', event.code, event.reason);
        state.connected = false;
        state.ws = null;
        state.connectNonce = null;
        state.connectSent = false;
        clearWsTimers();
        setConnectionStatus('error');
        finalizeAllStreamingMessages('disconnected');

        // If auth or handshake failed, prompt for token and STOP reconnect loop until user acts.
        if (event?.code === 1008 && /unauthorized|password mismatch|device identity required|invalid connect params/i.test(event?.reason || '')) {
          // Clear stored token to prevent infinite reconnect spam with a bad secret.
          state.token = null;
          lsRemove('token');
          // Legacy cleanup
          localStorage.removeItem('sharp_token');
          localStorage.removeItem('sharp_gateway_token');

          showLoginModal();
          const errorDiv = document.getElementById('loginError');
          if (errorDiv) {
            errorDiv.textContent = event.reason || 'Authentication required';
            errorDiv.style.display = 'block';
          }

          // Also show a toast so it's visible even if modal is dismissed.
          showToast(event.reason || 'Authentication required', 'error', 8000);
          return;
        }
        
        for (const [id, pending] of state.rpcPending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('WebSocket closed'));
        }
        state.rpcPending.clear();
        
        scheduleReconnect();
      };
    }
    
    function handleWsMessage(msg) {
      // Debug: log all incoming messages
      if (msg.type === 'event') {
        console.log('[ClawCondos] WS Event:', msg.event, msg.payload ? JSON.stringify(msg.payload).slice(0, 200) : '');
      }
      
      // Challenge for auth (comes as event type)
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        state.connectNonce = msg.payload?.nonce;
        // Auto-connect (password hardcoded for Tailscale-only access)
        sendConnect();
        return;
      }
      
      // RPC response
      if (msg.type === 'res' && msg.id) {
        const pending = state.rpcPending.get(msg.id);
        if (pending) {
          state.rpcPending.delete(msg.id);
          clearTimeout(pending.timeout);
          
          if (msg.error) {
            pending.reject(new Error(msg.error?.message || 'RPC failed'));
          } else {
            pending.resolve(msg.payload ?? msg.result);
          }
        }
        return;
      }
      
      // Chat events (streaming)
      if (msg.type === 'event' && msg.event === 'chat') {
        handleChatEvent(msg.payload);
        return;
      }
      
      // Agent lifecycle events (for typing indicator)
      if (msg.type === 'event' && msg.event === 'agent') {
        handleAgentEvent(msg.payload);
        return;
      }
    }
    
    function sendConnect() {
      if (state.connectSent || !state.ws) return;
      state.connectSent = true;
      
      const connectId = String(++state.rpcIdCounter);
      
      const connectParams = {
        minProtocol: WS_PROTOCOL_VERSION,
        maxProtocol: WS_PROTOCOL_VERSION,
        client: {
          // Must be one of OpenClaw's allowed client IDs (see gateway protocol client-info)
          id: 'webchat-ui',
          displayName: 'ClawCondos Dashboard',
          mode: 'ui',
          version: '2.0.0',
          platform: 'browser'
        }
      };
      
      // Authenticate. Different deployments may require password or token.
      // We send both with the same user-provided secret for maximum compatibility.
      if (state.token) {
        connectParams.auth = { token: state.token, password: state.token };
      }
      
      const connectFrame = {
        type: 'req',
        id: connectId,
        method: 'connect',
        params: connectParams
      };
      
      console.log('[WS] Sending connect request');
      state.ws.send(JSON.stringify(connectFrame));
      
      const timeout = setTimeout(() => {
        state.rpcPending.delete(connectId);
        console.error('[WS] Connect timeout');
        state.ws?.close(1008, 'connect timeout');
      }, 10000);
      
      state.rpcPending.set(connectId, {
        resolve: (result) => {
          console.log('[WS] Connected successfully');
          state.connected = true;
          state.wsReconnectAttempts = 0;
          setConnectionStatus('connected');
          hideReconnectOverlay();
          if (state.token) localStorage.setItem('sharp_token', state.token);
          localStorage.setItem('sharp_gateway', state.gatewayUrl);
          hideLoginModal();
          startKeepalive();
          loadInitialData();

          // If user is currently viewing a session, reload history now that we are connected.
          if (state.currentView === 'chat' && state.currentSession?.key) {
            loadSessionHistory(state.currentSession.key, { preserve: true });
          }
        },
        reject: (err) => {
          console.error('[WS] Connect failed:', err);
          state.connectSent = false;
          setConnectionStatus('error');
          showLoginModal();
          const errorDiv = document.getElementById('loginError');
          if (errorDiv) {
            errorDiv.textContent = err.message || 'Authentication failed';
            errorDiv.style.display = 'block';
          }
        },
        timeout
      });
    }
    
    function handleAgentEvent(data) {
      const { sessionKey, runId, stream, data: eventData } = data;
      
      // Show typing indicator when agent starts working
      if (stream === 'lifecycle' && eventData?.phase === 'start') {
        if (state.currentSession?.key === sessionKey) {
          showTypingIndicator(runId);
        }
        if (state.currentView === 'goal' && state.goalChatSessionKey === sessionKey) {
          showTypingIndicator(runId, 'goal');
        }
        // Also set thinking status
        trackActiveRun(sessionKey, runId);
        state.sessionInputReady.set(sessionKey, false);
        if (state.sessionAgentStatus[sessionKey] !== 'thinking') {
          setSessionStatus(sessionKey, 'thinking');
        }
      }
      
      // Hide typing indicator when agent ends
      if (stream === 'lifecycle' && eventData?.phase === 'end') {
        hideTypingIndicator(runId);
        hideTypingIndicator(runId, 'goal');
      }
      
      // Show tool calls via compact activity indicator
      if (stream === 'tool' && state.currentSession?.key === sessionKey) {
        const toolCallId = eventData?.toolCallId || `${runId}-${eventData?.name}-${Date.now()}`;
        const toolName = eventData?.name || eventData?.tool || 'tool';
        const toolInput = eventData?.input || eventData?.args || '';
        const toolOutput = eventData?.output || eventData?.result || '';
        
        if (eventData?.phase === 'start' || eventData?.type === 'call') {
          trackToolStart(runId, toolCallId, toolName, toolInput);
        } else if (eventData?.phase === 'end' || eventData?.phase === 'result' || eventData?.type === 'result') {
          trackToolEnd(runId, toolCallId, toolName, toolOutput);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // COMPACT TOOL ACTIVITY INDICATOR
    // ═══════════════════════════════════════════════════════════════
    
    function getToolIcon(toolName) {
      const name = (toolName || '').toLowerCase();
      if (name.includes('read') || name.includes('file')) return '📄';
      if (name.includes('write') || name.includes('edit')) return '✏️';
      if (name.includes('exec') || name.includes('bash') || name.includes('shell')) return '⚡';
      if (name.includes('browser') || name.includes('web')) return '🌐';
      if (name.includes('search')) return '🔍';
      if (name.includes('image')) return '🖼️';
      if (name.includes('message') || name.includes('send')) return '💬';
      if (name.includes('cron') || name.includes('schedule')) return '⏰';
      if (name.includes('memory')) return '🧠';
      return '🔧';
    }
    
    function trackToolStart(runId, toolCallId, toolName, input) {
      hideTypingIndicator(runId);
      
      state.activeTools.set(toolCallId, {
        runId,
        name: toolName,
        args: input,
        output: null,
        startedAt: Date.now(),
        status: 'running'
      });
      
      renderToolActivity();
      scrollChatToBottom();
    }
    
    function trackToolEnd(runId, toolCallId, toolName, output) {
      // Find by toolCallId or by name (fallback)
      let tool = state.activeTools.get(toolCallId);
      if (!tool) {
        // Fallback: find most recent tool with same name
        for (const [id, t] of state.activeTools) {
          if (t.name === toolName && t.status === 'running') {
            toolCallId = id;
            tool = t;
            break;
          }
        }
      }
      
      if (tool) {
        tool.output = output;
        tool.status = 'done';
        tool.endedAt = Date.now();
        state.activeTools.set(toolCallId, tool);
      }
      
      renderToolActivity();
      
      // Clear completed tools after a delay (keep them visible briefly)
      setTimeout(() => {
        cleanupCompletedTools(runId);
      }, 3000);
    }
    
    function cleanupCompletedTools(runId) {
      // Only clean up if all tools for this run are done
      let allDone = true;
      for (const [id, tool] of state.activeTools) {
        if (tool.runId === runId && tool.status === 'running') {
          allDone = false;
          break;
        }
      }
      
      if (allDone) {
        // Remove all tools for this run
        for (const [id, tool] of state.activeTools) {
          if (tool.runId === runId) {
            state.activeTools.delete(id);
          }
        }
        renderToolActivity();
      }
    }
    
    function clearAllTools() {
      state.activeTools.clear();
      state.toolActivityExpanded = false;
      const el = document.getElementById('toolActivityIndicator');
      if (el) el.remove();
    }
    
    function toggleToolActivityExpanded() {
      state.toolActivityExpanded = !state.toolActivityExpanded;
      const el = document.getElementById('toolActivityIndicator');
      if (el) {
        el.classList.toggle('expanded', state.toolActivityExpanded);
      }
    }
    
    function renderToolActivity() {
      const container = document.getElementById('chatMessages');
      if (!container) return;
      
      let el = document.getElementById('toolActivityIndicator');
      
      // If no active tools, remove the indicator
      if (state.activeTools.size === 0) {
        if (el) el.remove();
        return;
      }
      
      // Count running vs done
      let runningCount = 0;
      let doneCount = 0;
      const tools = Array.from(state.activeTools.values());
      tools.forEach(t => t.status === 'running' ? runningCount++ : doneCount++);
      
      // Build pills HTML
      const pillsHtml = tools.slice(-5).map(t => {
        const icon = getToolIcon(t.name);
        const statusClass = t.status === 'done' ? 'done' : '';
        return `<span class="tool-activity-pill ${statusClass}">
          <span class="pill-icon">${icon}</span>
          <span>${escapeHtml(t.name)}</span>
        </span>`;
      }).join('');
      
      // Build details HTML
      const detailsHtml = tools.map(t => {
        const icon = getToolIcon(t.name);
        const statusClass = t.status === 'running' ? 'running' : 'done';
        const statusText = t.status === 'running' ? '⏳ running' : '✓ done';
        const argsStr = t.args ? (typeof t.args === 'string' ? t.args : JSON.stringify(t.args, null, 2)) : '';
        const outputStr = t.output ? (typeof t.output === 'string' ? t.output : JSON.stringify(t.output, null, 2)) : '';
        const contentStr = outputStr ? `${argsStr}\n\n--- Result ---\n${outputStr}` : argsStr;
        
        return `<div class="tool-activity-item">
          <div class="tool-activity-item-header">

[Showing lines 1-1361 of 8396 (50.0KB limit). Use offset=1362 to continue.]