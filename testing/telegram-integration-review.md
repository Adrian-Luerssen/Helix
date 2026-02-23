# Helix + Telegram Agent Integration Testing Review

**Date:** 2026-02-07
**Tester:** Bob (AI Agent)
**Status:** 🔄 IN PROGRESS

---

## Test Environment

- **Helix URL:** http://localhost:9000/
- **Telegram Group:** Auto (-1003814943696)
- **Telebiz MCP:** via mcporter

---

## Test Cases

### 1. Session auto-classification (before_agent_start hook)
**Status:** ⚠️ PARTIALLY TESTED
**Expected:** Session appears, auto-binds or shows strand menu
**Actual:** 
- Sent test message via telebiz to Auto group topic:1 (General)
- Message appeared in "Telebiz Message Testing Results" strand in Helix
- Session correctly classified to the topic-based strand
**Issues:** 
- Cannot fully test before_agent_start hook without triggering agent response
- telebiz messages appear as if user sent them, not invoking agent hook
**Notes:** Need to test via actual Telegram bot message or via message tool

---

### 2. Agent creates a new strand (strand_bind)
**Status:** ⏳ PENDING
**Expected:** New strand appears in real-time, session binds to it
**Actual:** _TBD_
**Issues:** _TBD_

---

### 3. Agent creates a goal inside the strand (strand_create_goal)
**Status:** ⏳ PENDING
**Expected:** New goal card appears in real-time with tasks
**Actual:** _TBD_
**Issues:** _TBD_

---

### 4. Agent adds tasks to an existing goal (goal_update with addTasks)
**Status:** ❌ FAILED - TO REVIEW
**Expected:** New tasks appear in Tasks panel in real-time
**Actual:** 
- Called goal_update with addTasks containing 5 tasks
- Tool returned success with 5 task IDs:
  - task_6e55252d35bdba3ef551d00a
  - task_8c69e6a3de4daee31f1f2707
  - task_5e0b5886fbb03edcdb5a37dd
  - task_bf2f3136c4d52003de7bff4f
  - task_5ccbe911e0523b1b4a405cac
- Tasks DO NOT appear in UI even after page refresh
- UI shows "No tasks yet. Add the next physical step."
- Timestamp still shows old value "Last updated: 2026-02-07 13:05"
**Issues:** 
1. **CRITICAL BUG**: Tasks not rendering in goal detail view
2. Real-time WebSocket refresh not triggering
3. Goal timestamp not updating after goal_update
4. Polling fallback (30s) not picking up tasks either

---

### 5. Agent updates task status to in-progress (goal_update)
**Status:** ⏳ PENDING
**Expected:** Task status dot changes to in-progress in real-time
**Actual:** _TBD_
**Issues:** _TBD_

---

### 6. Agent marks a task done (goal_update)
**Status:** ⏳ PENDING
**Expected:** Task status dot changes to done, strikethrough styling
**Actual:** _TBD_
**Issues:** _TBD_

---

### 7. Agent tracks files (goal_update with files)
**Status:** ⏳ PENDING
**Expected:** Tracked files panel populates with icons and metadata
**Actual:** _TBD_
**Issues:** _TBD_

---

### 8. Agent tracks more files with different types
**Status:** ⏳ PENDING
**Expected:** Different file types show correct icons
**Actual:** _TBD_
**Issues:** _TBD_

---

### 9. Remove a tracked file from the dashboard
**Status:** ⏳ PENDING
**Expected:** × button appears on hover, file removed on click
**Actual:** _TBD_
**Issues:** _TBD_

---

### 10. Agent spawns a subagent for a task (strand_spawn_task)
**Status:** ⏳ PENDING
**Expected:** Task gets session key, subagent appears in sessions panel
**Actual:** _TBD_
**Issues:** _TBD_

---

### 11. Agent marks the entire goal done (goal_update)
**Status:** ⏳ PENDING
**Expected:** Goal status changes to DONE in real-time
**Actual:** _TBD_
**Issues:** _TBD_

---

### 12. Rapid-fire updates (debounce coalescing)
**Status:** ⏳ PENDING
**Expected:** Multiple tool events coalesce into single UI update
**Actual:** _TBD_
**Issues:** _TBD_

---

### 13. Polling fallback (30s cycle)
**Status:** ⏳ PENDING
**Expected:** RPC bypass still shows in UI after polling refresh
**Actual:** _TBD_
**Issues:** _TBD_

---

### 14. Cross-session goal updates
**Status:** ⏳ PENDING
**Expected:** Different session updates same goal in real-time
**Actual:** _TBD_
**Issues:** _TBD_

---

### 15. Goal view persistence across navigation
**Status:** ⏳ PENDING
**Expected:** Data persists when navigating away and back
**Actual:** _TBD_
**Issues:** _TBD_

---

## Issues Found

| # | Test | Severity | Description | Status | Fix Branch/PR |
|---|------|----------|-------------|--------|---------------|
| - | - | - | - | - | - |

---

## Summary

**Tests Passed:** 0/15
**Tests Failed:** 0/15
**Tests Pending:** 15/15

---

## Notes

_Testing notes will be added here as tests progress._
