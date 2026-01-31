/**
 * Smart Session Status Detection
 * Tracks session states and user read status for intelligent filtering
 */

import type { Session, SessionKey } from './types';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SmartSessionStatus = 'running' | 'needs-you' | 'error' | 'recent' | 'idle';

export type StatusConfig = {
  label: string;
  emoji: string;
  color: string;
  bgColor: string;
  description: string;
};

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'sharp_session_reads';
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Patterns that indicate the agent is waiting for user input
 */
const WAITING_PATTERNS = [
  /\?[\s]*$/,                    // Ends with question mark
  /what do you think/i,
  /let me know/i,
  /should I/i,
  /want me to/i,
  /would you like/i,
  /do you want/i,
  /which (?:one|option)/i,
  /your (?:thoughts|preference|choice)/i,
  /please (?:confirm|choose|select|decide)/i,
  /waiting for/i,
  /need your/i,
];

// ═══════════════════════════════════════════════════════════════
// STATUS CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const STATUS_CONFIGS: Record<SmartSessionStatus, StatusConfig> = {
  running: {
    label: 'Running',
    emoji: '🔴',
    color: 'var(--red)',
    bgColor: 'rgba(239, 68, 68, 0.15)',
    description: 'Agent is actively processing',
  },
  'needs-you': {
    label: 'Needs You',
    emoji: '🟠',
    color: 'var(--orange)',
    bgColor: 'rgba(249, 115, 22, 0.15)',
    description: 'Unread messages or waiting for input',
  },
  error: {
    label: 'Error',
    emoji: '🟡',
    color: 'var(--yellow)',
    bgColor: 'rgba(234, 179, 8, 0.15)',
    description: 'Last run failed or was aborted',
  },
  recent: {
    label: 'Recent',
    emoji: '🟢',
    color: 'var(--green)',
    bgColor: 'rgba(34, 197, 94, 0.15)',
    description: 'Active in the last hour',
  },
  idle: {
    label: 'Idle',
    emoji: '⚪',
    color: 'var(--text-muted)',
    bgColor: 'transparent',
    description: 'No recent activity',
  },
};

// ═══════════════════════════════════════════════════════════════
// LOCAL STORAGE HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Get all read timestamps from localStorage
 */
function getReadTimestamps(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Save read timestamps to localStorage
 */
function saveReadTimestamps(timestamps: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timestamps));
  } catch {
    // Ignore write errors
  }
}

/**
 * Get the timestamp when a session was last read by the user
 * @param sessionKey - The session key to check
 * @returns Timestamp in ms, or 0 if never read
 */
export function getLastRead(sessionKey: SessionKey): number {
  const timestamps = getReadTimestamps();
  return timestamps[sessionKey] || 0;
}

/**
 * Mark a session as read (updates the last read timestamp to now)
 * @param sessionKey - The session key to mark as read
 */
export function markAsRead(sessionKey: SessionKey): void {
  const timestamps = getReadTimestamps();
  timestamps[sessionKey] = Date.now();
  saveReadTimestamps(timestamps);
}

/**
 * Get set of session keys that have unread messages
 * @param sessions - Array of sessions to check
 * @returns Set of session keys with unread messages
 */
export function getUnreadSessions(sessions: Session[]): Set<SessionKey> {
  const timestamps = getReadTimestamps();
  const unread = new Set<SessionKey>();
  
  for (const session of sessions) {
    const lastRead = timestamps[session.key] || 0;
    const updatedAt = session.updatedAt || 0;
    if (updatedAt > lastRead) {
      unread.add(session.key);
    }
  }
  
  return unread;
}

/**
 * Check if a session has unread messages
 * @param session - The session to check
 * @returns true if there are unread messages
 */
export function hasUnread(session: Session): boolean {
  const lastRead = getLastRead(session.key);
  const updatedAt = session.updatedAt || 0;
  return updatedAt > lastRead;
}

// ═══════════════════════════════════════════════════════════════
// STATUS DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract text content from a message
 */
function getMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join(' ');
  }
  
  return '';
}

/**
 * Check if the last assistant message indicates waiting for user input
 * @param session - The session to check
 * @returns true if the agent appears to be waiting for input
 */
export function isWaitingForInput(session: Session): boolean {
  const messages = session.messages;
  if (!messages || messages.length === 0) return false;
  
  // Get the last message
  const lastMessage = messages[0]; // messages are usually newest-first
  if (!lastMessage) return false;
  
  // Only check assistant messages
  const role = (lastMessage as Record<string, unknown>).role;
  if (role !== 'assistant') return false;
  
  const text = getMessageText(lastMessage);
  if (!text) return false;
  
  // Check against waiting patterns
  return WAITING_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Get the smart status for a session
 * @param session - The session to check
 * @param activeRuns - Set of session keys that are currently running
 * @returns The smart status for the session
 */
export function getSessionStatus(
  session: Session,
  activeRuns: Set<SessionKey>
): SmartSessionStatus {
  // 1. Running - Agent is actively processing
  if (activeRuns.has(session.key)) {
    return 'running';
  }
  
  // 2. Error - Last run failed or was aborted
  if (session.abortedLastRun === true) {
    return 'error';
  }
  
  // 3. Needs You - Unread messages OR waiting for input
  const unread = hasUnread(session);
  const waiting = isWaitingForInput(session);
  if (unread || waiting) {
    return 'needs-you';
  }
  
  // 4. Recent - Updated in the last hour
  const updatedAt = session.updatedAt || 0;
  const hourAgo = Date.now() - ONE_HOUR_MS;
  if (updatedAt > hourAgo) {
    return 'recent';
  }
  
  // 5. Idle - No recent activity
  return 'idle';
}

/**
 * Get the configuration for a status
 * @param status - The status to get config for
 * @returns Status configuration with label, emoji, colors, and description
 */
export function getStatusConfig(status: SmartSessionStatus): StatusConfig {
  return STATUS_CONFIGS[status];
}

/**
 * Get all status configurations
 * @returns All status configurations
 */
export function getAllStatusConfigs(): Record<SmartSessionStatus, StatusConfig> {
  return STATUS_CONFIGS;
}

// ═══════════════════════════════════════════════════════════════
// FILTER PRESETS
// ═══════════════════════════════════════════════════════════════

export type FilterPreset = {
  id: string;
  label: string;
  description: string;
  filter: (session: Session, activeRuns: Set<SessionKey>) => boolean;
};

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'inbox',
    label: 'Inbox',
    description: 'Things that need your attention',
    filter: (session, activeRuns) => {
      const status = getSessionStatus(session, activeRuns);
      return status === 'running' || status === 'needs-you';
    },
  },
  {
    id: 'active',
    label: 'Active',
    description: 'Currently active sessions',
    filter: (session, activeRuns) => {
      const status = getSessionStatus(session, activeRuns);
      return status === 'running' || status === 'recent';
    },
  },
  {
    id: 'errors',
    label: 'Errors',
    description: 'Sessions with errors',
    filter: (session, activeRuns) => {
      const status = getSessionStatus(session, activeRuns);
      return status === 'error';
    },
  },
  {
    id: 'topics',
    label: 'Topics',
    description: 'Telegram topic sessions',
    filter: (session) => {
      return session.key.includes(':topic:');
    },
  },
  {
    id: 'crons',
    label: 'Crons',
    description: 'Scheduled cron jobs',
    filter: (session) => {
      return session.key.includes(':cron:');
    },
  },
];

/**
 * Get a filter preset by ID
 * @param presetId - The preset ID
 * @returns The filter preset or undefined
 */
export function getFilterPreset(presetId: string): FilterPreset | undefined {
  return FILTER_PRESETS.find((p) => p.id === presetId);
}
