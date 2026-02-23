import { describe, it, expect } from 'vitest';
import {
  parseTasksFromPlan,
  parseTasksFromTable,
  parseTasksFromLists,
  detectPlan,
  detectStrandPlan,
  parseGoalsFromPlan,
  normalizeAgentToRole,
  getSupportedRoles,
  convertPhasesToDependsOn,
} from '../plugins/helix-goals/lib/plan-parser.js';

describe('plan-parser', () => {
  describe('detectStrandPlan', () => {
    it('detects ## Goals header', () => {
      expect(detectStrandPlan('## Goals\n| # | Goal | Description |')).toBe(true);
    });

    it('detects ## Milestones header', () => {
      expect(detectStrandPlan('Here is my plan:\n## Milestones\n1. First milestone')).toBe(true);
    });

    it('detects ## Objectives header', () => {
      expect(detectStrandPlan('### Objectives\n- Objective one')).toBe(true);
    });

    it('detects goal table with | Goal | column', () => {
      expect(detectStrandPlan('| # | Goal | Description | Priority |\n|---|------|-------------|----------|')).toBe(true);
    });

    it('detects goal table with | Milestone | column', () => {
      expect(detectStrandPlan('| Milestone | Description |\n|-----------|-------------|')).toBe(true);
    });

    it('falls back to general plan detection', () => {
      expect(detectStrandPlan('## Plan\n| Task | Agent |\n|------|-------|')).toBe(true);
    });

    it('returns false for non-plan content', () => {
      expect(detectStrandPlan('Hello, how are you?')).toBe(false);
    });

    it('returns false for null/empty input', () => {
      expect(detectStrandPlan(null)).toBe(false);
      expect(detectStrandPlan('')).toBe(false);
    });
  });

  describe('parseGoalsFromPlan', () => {
    it('parses goals from a markdown table', () => {
      const content = `## Goals

| # | Goal | Description | Priority |
|---|------|-------------|----------|
| 1 | Setup authentication | Implement JWT auth flow | high |
| 2 | Build dashboard UI | Create the main dashboard | medium |
| 3 | Add API endpoints | REST API for CRUD operations | low |`;

      const result = parseGoalsFromPlan(content);
      expect(result.hasPlan).toBe(true);
      expect(result.goals).toHaveLength(3);
      expect(result.goals[0].title).toBe('Setup authentication');
      expect(result.goals[0].description).toBe('Implement JWT auth flow');
      expect(result.goals[0].priority).toBe('high');
      expect(result.goals[1].title).toBe('Build dashboard UI');
      expect(result.goals[2].title).toBe('Add API endpoints');
      expect(result.goals[2].priority).toBe('low');
    });

    it('parses goals with embedded per-goal tasks', () => {
      const content = `## Goals

| # | Goal | Description | Priority |
|---|------|-------------|----------|
| 1 | Auth system | User authentication | high |
| 2 | Dashboard | Main UI | medium |

#### Auth system
- Implement JWT middleware (backend)
- Create login form (frontend)

#### Dashboard
- Design layout (designer)
- Build components (frontend)`;

      const result = parseGoalsFromPlan(content);
      expect(result.hasPlan).toBe(true);
      expect(result.goals).toHaveLength(2);
      expect(result.goals[0].title).toBe('Auth system');
      expect(result.goals[0].tasks.length).toBeGreaterThanOrEqual(1);
      expect(result.goals[1].title).toBe('Dashboard');
      expect(result.goals[1].tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('parses goals from section headings when no table present', () => {
      const content = `## Goals

#### Setup Backend
- Create database schema (backend)
- Implement API routes (backend)

#### Build Frontend
- Design components (frontend)
- Implement routing (frontend)`;

      const result = parseGoalsFromPlan(content);
      expect(result.hasPlan).toBe(true);
      expect(result.goals).toHaveLength(2);
      expect(result.goals[0].title).toBe('Setup Backend');
      expect(result.goals[1].title).toBe('Build Frontend');
    });

    it('returns empty for non-plan content', () => {
      const result = parseGoalsFromPlan('Hello, how are you?');
      expect(result.hasPlan).toBe(false);
      expect(result.goals).toHaveLength(0);
    });

    it('returns empty for null/empty input', () => {
      expect(parseGoalsFromPlan(null).goals).toHaveLength(0);
      expect(parseGoalsFromPlan('').goals).toHaveLength(0);
    });

    it('handles table without Goal column gracefully', () => {
      const content = `## Goals

| # | Item | Notes |
|---|------|-------|
| 1 | Something | Some notes |`;

      const result = parseGoalsFromPlan(content);
      // Should still detect the plan but may not extract goals without Goal column
      expect(result.hasPlan).toBe(true);
    });

    it('handles empty goals table', () => {
      const content = `## Goals

| # | Goal | Description | Priority |
|---|------|-------------|----------|`;

      const result = parseGoalsFromPlan(content);
      expect(result.hasPlan).toBe(true);
      expect(result.goals).toHaveLength(0);
    });

    it('skips section headers that are clearly not goal titles', () => {
      const content = `## Goals

## Overview
This is an overview.

#### Real Goal
- Task one (backend)

## Summary
This wraps things up.`;

      const result = parseGoalsFromPlan(content);
      expect(result.goals.some(g => g.title === 'Real Goal')).toBe(true);
      expect(result.goals.some(g => g.title === 'Overview')).toBe(false);
      expect(result.goals.some(g => g.title === 'Summary')).toBe(false);
    });

    it('cleans markdown formatting from goal titles', () => {
      const content = `## Goals

| # | Goal | Description | Priority |
|---|------|-------------|----------|
| 1 | **Bold Goal** | Description here | high |`;

      const result = parseGoalsFromPlan(content);
      expect(result.goals[0].title).toBe('Bold Goal');
    });
  });

  describe('parseGoalsFromPlan with Phase column', () => {
    it('parses phase values from table', () => {
      const content = `## Goals

| # | Goal | Description | Priority | Phase |
|---|------|-------------|----------|-------|
| 1 | Project Foundation | Set up project | high | 1 |
| 2 | Recipe Management | Recipe CRUD | high | 2 |
| 3 | Search & Favorites | Search + favorites | medium | 2 |`;

      const result = parseGoalsFromPlan(content);
      expect(result.hasPlan).toBe(true);
      expect(result.goals).toHaveLength(3);
      expect(result.goals[0].phase).toBe(1);
      expect(result.goals[1].phase).toBe(2);
      expect(result.goals[2].phase).toBe(2);
    });

    it('returns null phase when no Phase column present', () => {
      const content = `## Goals

| # | Goal | Description | Priority |
|---|------|-------------|----------|
| 1 | Setup auth | JWT auth | high |`;

      const result = parseGoalsFromPlan(content);
      expect(result.goals).toHaveLength(1);
      expect(result.goals[0].phase).toBeNull();
    });

    it('handles wave/stage column headers as phase', () => {
      const content = `## Goals

| # | Goal | Description | Wave |
|---|------|-------------|------|
| 1 | Foundation | Setup | 1 |
| 2 | Features | Build | 2 |`;

      const result = parseGoalsFromPlan(content);
      expect(result.goals[0].phase).toBe(1);
      expect(result.goals[1].phase).toBe(2);
    });

    it('ignores non-numeric phase values', () => {
      const content = `## Goals

| # | Goal | Description | Phase |
|---|------|-------------|-------|
| 1 | Setup | Initial | first |
| 2 | Build | Features | 2 |`;

      const result = parseGoalsFromPlan(content);
      expect(result.goals[0].phase).toBeNull();
      expect(result.goals[1].phase).toBe(2);
    });
  });

  describe('convertPhasesToDependsOn', () => {
    it('sets dependsOn for phase 2 goals to all phase 1 goal IDs', () => {
      const goals = [
        { id: 'g1', phase: 1 },
        { id: 'g2', phase: 2 },
        { id: 'g3', phase: 2 },
      ];

      convertPhasesToDependsOn(goals);

      expect(goals[0].dependsOn).toBeUndefined();
      expect(goals[1].dependsOn).toEqual(['g1']);
      expect(goals[2].dependsOn).toEqual(['g1']);
    });

    it('chains three phases correctly', () => {
      const goals = [
        { id: 'g1', phase: 1 },
        { id: 'g2', phase: 1 },
        { id: 'g3', phase: 2 },
        { id: 'g4', phase: 3 },
      ];

      convertPhasesToDependsOn(goals);

      // Phase 1 goals: no deps
      expect(goals[0].dependsOn).toBeUndefined();
      expect(goals[1].dependsOn).toBeUndefined();
      // Phase 2 depends on phase 1
      expect(goals[2].dependsOn).toEqual(['g1', 'g2']);
      // Phase 3 depends on phase 2
      expect(goals[3].dependsOn).toEqual(['g3']);
    });

    it('handles empty array', () => {
      const result = convertPhasesToDependsOn([]);
      expect(result).toEqual([]);
    });

    it('handles goals without phases', () => {
      const goals = [
        { id: 'g1', phase: null },
        { id: 'g2' },
      ];

      convertPhasesToDependsOn(goals);

      // No deps set since no phases
      expect(goals[0].dependsOn).toBeUndefined();
      expect(goals[1].dependsOn).toBeUndefined();
    });

    it('handles mix of phased and unphased goals', () => {
      const goals = [
        { id: 'g1', phase: 1 },
        { id: 'g2' }, // no phase
        { id: 'g3', phase: 2 },
      ];

      convertPhasesToDependsOn(goals);

      // g3 depends on g1 (phase 1)
      expect(goals[2].dependsOn).toEqual(['g1']);
      // unphased goal unchanged
      expect(goals[1].dependsOn).toBeUndefined();
    });
  });

  describe('existing parseTasksFromPlan', () => {
    it('still works for task-level plans', () => {
      const content = `## Tasks

| # | Task | Agent | Time |
|---|------|-------|------|
| 1 | Build login page | frontend | 2h |
| 2 | Create API routes | backend | 3h |`;

      const result = parseTasksFromPlan(content);
      expect(result.hasPlan).toBe(true);
      expect(result.tasks).toHaveLength(2);
    });
  });
});
