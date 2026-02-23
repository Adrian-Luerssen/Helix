// tests/classifier.test.js
import { describe, it, expect } from 'vitest';
import {
  extractLastUserMessage,
  parseTelegramContext,
  tier1Classify,
  isSkippableMessage,
  detectGoalIntent,
  CLASSIFIER_CONFIG,
} from '../plugins/helix-goals/lib/classifier.js';

// ─── extractLastUserMessage ─────────────────────────────────────

describe('extractLastUserMessage', () => {
  it('returns null for empty messages', () => {
    expect(extractLastUserMessage([])).toBeNull();
    expect(extractLastUserMessage(null)).toBeNull();
    expect(extractLastUserMessage(undefined)).toBeNull();
  });

  it('extracts string content from last user message', () => {
    const messages = [
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second message' },
    ];
    expect(extractLastUserMessage(messages)).toBe('second message');
  });

  it('extracts text from rich content array', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'rich message' }] },
    ];
    expect(extractLastUserMessage(messages)).toBe('rich message');
  });

  it('skips assistant messages', () => {
    const messages = [
      { role: 'user', content: 'the one' },
      { role: 'assistant', content: 'not this' },
    ];
    expect(extractLastUserMessage(messages)).toBe('the one');
  });

  it('returns null when no user messages', () => {
    const messages = [{ role: 'assistant', content: 'only assistant' }];
    expect(extractLastUserMessage(messages)).toBeNull();
  });
});

// ─── parseTelegramContext ───────────────────────────────────────

describe('parseTelegramContext', () => {
  it('returns null for non-Telegram session', () => {
    expect(parseTelegramContext('agent:main:webchat:123')).toBeNull();
    expect(parseTelegramContext('agent:main:cron:abc')).toBeNull();
  });

  it('extracts topic ID from Telegram session key', () => {
    const ctx = parseTelegramContext('agent:main:telegram:group:-1003814943696:topic:2212');
    expect(ctx).toEqual({ isTelegram: true, topicId: 2212, groupId: '-1003814943696' });
  });

  it('handles Telegram session without topic', () => {
    const ctx = parseTelegramContext('agent:main:telegram:group:-100123');
    expect(ctx).toEqual({ isTelegram: true, topicId: null, groupId: '-100123' });
  });

  it('returns null for null/undefined input', () => {
    expect(parseTelegramContext(null)).toBeNull();
    expect(parseTelegramContext(undefined)).toBeNull();
  });
});

// ─── isSkippableMessage ────────────────────────────────────────

describe('isSkippableMessage', () => {
  it('skips greetings', () => {
    expect(isSkippableMessage('hi')).toBe(true);
    expect(isSkippableMessage('Hello!')).toBe(true);
    expect(isSkippableMessage('thanks')).toBe(true);
    expect(isSkippableMessage('ok')).toBe(true);
  });

  it('skips just emoji', () => {
    expect(isSkippableMessage('👍')).toBe(true);
    expect(isSkippableMessage('👍👍')).toBe(true);
  });

  it('does NOT skip project-related messages', () => {
    expect(isSkippableMessage('Update the investor pipeline')).toBe(false);
    expect(isSkippableMessage('Fix the authentication bug in the login page')).toBe(false);
    expect(isSkippableMessage('How do we fix the landing page layout?')).toBe(false);
  });

  it('does NOT skip short but meaningful messages', () => {
    expect(isSkippableMessage('deploy subastas')).toBe(false);
    expect(isSkippableMessage('check investor crm')).toBe(false);
  });

  it('returns false for null/empty', () => {
    expect(isSkippableMessage(null)).toBe(false);
    expect(isSkippableMessage('')).toBe(false);
  });
});

// ─── tier1Classify ─────────────────────────────────────────────

describe('tier1Classify', () => {
  const strands = [
    {
      id: 'strand:investor-crm',
      name: 'Investor CRM',
      keywords: ['investor', 'pipeline', 'fundraising', 'series'],
      telegramTopicIds: [2212],
    },
    {
      id: 'strand:subastas',
      name: 'Subastas',
      keywords: ['subastas', 'auction', 'scraper', 'murcia'],
      telegramTopicIds: [3001],
    },
    {
      id: 'strand:moltcourt',
      name: 'MoltCourt',
      keywords: ['moltcourt', 'landing', 'court'],
      telegramTopicIds: [],
    },
  ];

  describe('explicit @strand mention', () => {
    it('matches @strand:investor-crm', () => {
      const result = tier1Classify(
        '@strand:investor-crm check the pipeline',
        { topicId: null },
        strands,
      );
      expect(result.strandId).toBe('strand:investor-crm');
      expect(result.confidence).toBe(1.0);
      expect(result.tier).toBe(1);
    });

    it('returns null for unknown @strand mention', () => {
      const result = tier1Classify('@strand:nonexistent hello', { topicId: null }, strands);
      expect(result.strandId).toBeNull();
    });
  });

  describe('Telegram topic matching', () => {
    it('matches by topic ID', () => {
      const result = tier1Classify('any message', { topicId: 2212 }, strands);
      expect(result.strandId).toBe('strand:investor-crm');
      expect(result.confidence).toBe(0.95);
    });

    it('returns null for unknown topic ID', () => {
      const result = tier1Classify('any message', { topicId: 9999 }, strands);
      expect(result.strandId).toBeNull();
    });
  });

  describe('keyword scoring', () => {
    it('scores keywords', () => {
      const result = tier1Classify(
        'Update the investor pipeline contacts',
        { topicId: null },
        strands,
      );
      expect(result.strandId).toBe('strand:investor-crm');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('scores strand name appearing in message', () => {
      const result = tier1Classify(
        'Build a landing page for MoltCourt',
        { topicId: null },
        strands,
      );
      expect(result.strandId).toBe('strand:moltcourt');
    });

    it('picks highest scoring strand', () => {
      const result = tier1Classify(
        'Check subastas auction scraper',
        { topicId: null },
        strands,
      );
      expect(result.strandId).toBe('strand:subastas');
    });

    it('returns null for message with no keyword matches', () => {
      const result = tier1Classify(
        'What is the weather today?',
        { topicId: null },
        strands,
      );
      expect(result.strandId).toBeNull();
    });

    it('requires minimum confidence gap between top two', () => {
      // If two strands score nearly the same, result should be low confidence
      const ambiguousStrands = [
        { id: 'a', name: 'Alpha', keywords: ['shared'], telegramTopicIds: [] },
        { id: 'b', name: 'Beta', keywords: ['shared'], telegramTopicIds: [] },
      ];
      const result = tier1Classify('check shared thing', { topicId: null }, ambiguousStrands);
      // Both score the same - confidence should be low
      expect(result.confidence).toBeLessThan(CLASSIFIER_CONFIG.autoRouteThreshold);
    });
  });

  describe('empty/edge cases', () => {
    it('returns null for no strands', () => {
      const result = tier1Classify('hello', { topicId: null }, []);
      expect(result.strandId).toBeNull();
    });

    it('returns null for empty message', () => {
      const result = tier1Classify('', { topicId: null }, strands);
      expect(result.strandId).toBeNull();
    });

    it('handles strands with no keywords', () => {
      const bare = [{ id: 'c1', name: 'Bare', keywords: [], telegramTopicIds: [] }];
      const result = tier1Classify('test', { topicId: null }, bare);
      expect(result.strandId).toBeNull();
    });
  });
});

// ─── detectGoalIntent ──────────────────────────────────────────

describe('detectGoalIntent', () => {
  it('detects task-like messages', () => {
    expect(detectGoalIntent('Build a landing page for the product - first design the mockups, then implement the responsive layout, finally deploy to production').isGoal).toBe(true);
  });

  it('detects bullet point lists', () => {
    expect(detectGoalIntent('We need to build the new feature:\n- Design the API endpoints for auth\n- Build the frontend components\n- Write comprehensive tests').isGoal).toBe(true);
  });

  it('rejects short messages', () => {
    expect(detectGoalIntent('fix the bug').isGoal).toBe(false);
  });

  it('rejects conversational messages', () => {
    expect(detectGoalIntent('How are things going with the project?').isGoal).toBe(false);
  });

  it('returns score', () => {
    const result = detectGoalIntent('Build a landing page - first design, then implement, finally deploy');
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns false for null/empty', () => {
    expect(detectGoalIntent(null).isGoal).toBe(false);
    expect(detectGoalIntent('').isGoal).toBe(false);
  });
});
