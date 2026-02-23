/**
 * Pipeline Debug E2E Test
 *
 * Creates a strand, sends a prompt, clicks Full Auto, and traces the pipeline
 * to identify where auto-kickoff of next tasks breaks.
 *
 * Run: npx playwright test e2e/pipeline-debug.spec.js
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';

test.setTimeout(1_800_000); // 30 minutes

const STRAND_NAME = 'Helix Landing';
const REPO_URL = 'https://github.com/Adrian-LuMed/helix-landing';
const PROMPT = "I dont like how the hero is set up with the instructions for the agent/human below the main title, put them side by side and validate the design with playwright. review the entire design to make sure it has a good UI/UX";

function getGatewayToken() {
  try {
    const confPath = join(os.homedir(), '.openclaw', 'openclaw.json');
    const conf = JSON.parse(readFileSync(confPath, 'utf-8'));
    return conf?.gateway?.auth?.token || conf?.gateway?.auth?.password || '';
  } catch { return ''; }
}

/** Poll a page.evaluate function until it returns a truthy value */
async function pollUntil(page, fn, arg, { timeoutMs = 600_000, intervalMs = 2000, label = '' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(fn, arg).catch(() => null);
    if (result) return result;
    await page.waitForTimeout(intervalMs);
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms: ${label}`);
}

test.describe('Pipeline Debug', () => {

  test('full pipeline trace', async ({ page }) => {
    const gatewayToken = getGatewayToken();
    console.log(`Token: ${gatewayToken ? gatewayToken.slice(0, 8) + '...' : 'NONE'}`);

    // ─── Patch WebSocket to capture events before page loads ───
    await page.addInitScript(() => {
      window.__pipelineEvents = [];
      const OrigWS = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
        ws.addEventListener('message', function(evt) {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'event') {
              window.__pipelineEvents.push({ ts: Date.now(), event: msg.event, payload: msg.payload });
            }
          } catch {}
        });
        return ws;
      };
      window.WebSocket.prototype = OrigWS.prototype;
      window.WebSocket.CONNECTING = OrigWS.CONNECTING;
      window.WebSocket.OPEN = OrigWS.OPEN;
      window.WebSocket.CLOSING = OrigWS.CLOSING;
      window.WebSocket.CLOSED = OrigWS.CLOSED;
    });

    // Override config to connect through serve.js proxy + set token
    await page.addInitScript((token) => {
      window.HELIX_CONFIG = {
        gatewayWsUrl: window.location.origin.replace(/^http/, 'ws') + '/',
      };
      if (token) localStorage.setItem('sharp_token', token);
    }, gatewayToken);

    // Log browser console events for pipeline debugging
    page.on('console', msg => {
      const t = msg.text();
      if (t.includes('auto-kickoff') || t.includes('[auto-kickoff]')) {
        console.log(`  [BROWSER] ${t}`);
      }
    });

    await page.goto('/');

    // ─── 1. Wait for connection ───
    console.log('\n=== 1. Connecting... ===');
    await page.waitForSelector('#connectionText:has-text("Connected")', { timeout: 30_000 });
    console.log('Connected');

    // ─── 2. Clean up existing test strand ───
    console.log('\n=== 2. Cleanup ===');
    const existing = await page.evaluate((name) => {
      return (state.strands || []).find(c => c.name === name);
    }, STRAND_NAME);
    if (existing) {
      console.log(`Deleting existing strand ${existing.id}...`);
      await page.evaluate(async (id) => {
        await rpcCall('strands.delete', { id }, 30000);
        await loadStrands();
        await loadGoals();
      }, existing.id);
      await page.waitForTimeout(2000);
    }

    // ─── 3. Create strand via UI ───
    console.log('\n=== 3. Creating strand ===');
    await page.click('button[onclick="showCreateStrandModal()"]');
    await page.waitForSelector('#createStrandModal', { state: 'visible' });
    await page.fill('#createStrandName', STRAND_NAME);
    await page.fill('#createStrandRepoUrl', REPO_URL);
    await page.click('#createStrandModal .form-btn:has-text("Create")');

    const strand = await pollUntil(page, (name) => {
      const c = state.strands.find(c => c.name === name);
      return c ? { id: c.id, name: c.name } : null;
    }, STRAND_NAME, { label: 'strand created', timeoutMs: 60_000 });

    console.log(`Strand: ${strand.id}`);
    await page.screenshot({ path: 'test-results/01-strand-created.png' });

    // ─── 4. Open strand and send prompt ───
    console.log('\n=== 4. Opening strand & sending prompt ===');
    await page.evaluate((id) => openStrandPanel(id), strand.id);
    await page.waitForTimeout(1000);

    // Clear events before sending
    await page.evaluate(() => { window.__pipelineEvents = []; });

    await page.fill('#strandChatInput', PROMPT);
    await page.click('#strandChatSendBtn');
    console.log('Prompt sent');

    // ─── 5. Wait for PM to finish responding ───
    console.log('\n=== 5. Waiting for PM to finish... ===');
    // PM sets strandPmPendingResponse=true while responding, false when done
    // Also wait for action buttons to appear
    let pmDone = false;
    for (let i = 0; i < 600; i++) { // 10 min max
      await page.waitForTimeout(1000);

      const status = await page.evaluate(() => ({
        pending: state.strandPmPendingResponse,
        planActionsVisible: (() => {
          const el = document.getElementById('strandPlanActions');
          return el ? !el.classList.contains('hidden') : false;
        })(),
      }));

      if (i % 15 === 0) {
        console.log(`  [${i}s] pending=${status.pending} planActions=${status.planActionsVisible}`);
      }

      if (!status.pending && status.planActionsVisible) {
        pmDone = true;
        console.log(`PM finished after ${i}s, action buttons visible`);
        break;
      }
      // Also check if PM finished but no action buttons (PM may have auto-created goals)
      if (!status.pending && i > 10) {
        const goalCount = await page.evaluate((strandId) => {
          return state.goals.filter(g => g.strandId === strandId).length;
        }, strand.id);
        if (goalCount > 0) {
          console.log(`PM auto-created ${goalCount} goals after ${i}s`);
          pmDone = true;
          break;
        }
      }
    }

    await page.screenshot({ path: 'test-results/02-pm-done.png' });
    if (!pmDone) console.log('WARNING: PM may not have finished');

    // ─── 6. Create goals from PM plan ───
    console.log('\n=== 6. Creating goals ===');

    let goalCount = await page.evaluate((id) => state.goals.filter(g => g.strandId === id).length, strand.id);

    if (goalCount === 0) {
      // First, click "Create Goals" to create goal records from the PM plan
      const createBtn = page.locator('button:has-text("Create Goals")');
      if (await createBtn.isVisible().catch(() => false)) {
        console.log('Clicking "Create Goals"...');
        await createBtn.click();
        await page.waitForTimeout(3000);
        await page.evaluate(() => loadGoals());
        await page.waitForTimeout(2000);
      }
    }

    goalCount = await page.evaluate((id) => state.goals.filter(g => g.strandId === id).length, strand.id);
    console.log(`Goals after Create: ${goalCount}`);

    if (goalCount === 0) {
      console.log('No goals created — dumping state');
      const dump = await page.evaluate((id) => ({
        allGoals: state.goals.map(g => ({ id: g.id, title: g.title, strandId: g.strandId })),
        strands: state.strands.map(c => ({ id: c.id, name: c.name })),
        events: window.__pipelineEvents.map(e => e.event).slice(-20),
      }), strand.id);
      console.log(JSON.stringify(dump, null, 2));
      await page.screenshot({ path: 'test-results/03-no-goals.png' });
      // Wait longer
      await pollUntil(page, (id) => {
        const goals = state.goals.filter(g => g.strandId === id);
        return goals.length > 0 ? true : null;
      }, strand.id, { label: 'goals appear', timeoutMs: 60_000 }).catch(() => null);
      goalCount = await page.evaluate((id) => state.goals.filter(g => g.strandId === id).length, strand.id);
    }

    expect(goalCount).toBeGreaterThan(0);

    // Print initial goal details (likely 0 tasks — tasks are created by cascade)
    let goals = await page.evaluate((id) => {
      return state.goals.filter(g => g.strandId === id).map(g => ({
        id: g.id, title: g.title, status: g.status,
        tasks: (g.tasks || []).map(t => ({
          id: t.id, text: t.text, status: t.status,
          sessionKey: t.sessionKey, dependsOn: t.dependsOn,
        })),
      }));
    }, strand.id);
    for (const g of goals) {
      console.log(`  Goal: "${g.title}" (${g.status}) — ${g.tasks.length} tasks`);
    }
    await page.screenshot({ path: 'test-results/03-goals-created.png' });

    // ─── 7. Click "Full Auto" to start cascade (goal PMs → tasks → agents) ───
    console.log('\n=== 7. Starting Full Auto cascade ===');

    // Now that goals exist, buttons should show "Plan All Goals" / "Full Auto"
    // Wait for the buttons to re-render
    await page.waitForTimeout(1000);
    // Force re-render of strand panel to get updated buttons
    await page.evaluate(() => {
      const el = document.getElementById('strandPlanActions');
      if (el) {
        const parent = el.parentElement;
        if (parent) parent.innerHTML = parent.innerHTML; // force re-render
      }
      renderStrandPmChat();
    });
    await page.waitForTimeout(1000);

    const fullAutoBtn = page.locator('button:has-text("Full Auto")');
    const planAllBtn = page.locator('button:has-text("Plan All Goals")');

    if (await fullAutoBtn.isVisible().catch(() => false)) {
      console.log('Clicking "Full Auto"...');
      await fullAutoBtn.click();
    } else if (await planAllBtn.isVisible().catch(() => false)) {
      console.log('Clicking "Plan All Goals"...');
      await planAllBtn.click();
    } else {
      // Fallback: manually trigger cascade
      console.log('No cascade button visible — triggering cascade via RPC...');
      const cascadeResult = await page.evaluate(async () => {
        try {
          return await startStrandCascade('full');
        } catch (e) { return { error: e.message }; }
      });
      console.log(`Cascade result: ${JSON.stringify(cascadeResult)}`);
    }

    await page.waitForTimeout(3000);

    // ─── 7b. Wait for cascade to create tasks (goal PMs need to respond) ───
    console.log('\n=== 7b. Waiting for tasks to be created by goal PMs ===');
    let taskCount = 0;
    for (let i = 0; i < 600; i++) { // 10 min max
      await page.waitForTimeout(1000);
      if (i % 10 === 0) {
        await page.evaluate(() => loadGoals()).catch(() => {});
      }

      const snapshot = await page.evaluate((strandId) => {
        const gs = state.goals.filter(g => g.strandId === strandId);
        return {
          totalTasks: gs.reduce((sum, g) => sum + (g.tasks || []).length, 0),
          goals: gs.map(g => ({
            title: g.title,
            taskCount: (g.tasks || []).length,
            tasks: (g.tasks || []).map(t => ({ text: t.text, status: t.status, sessionKey: t.sessionKey })),
          })),
          kickoffEvents: (window.__pipelineEvents || []).filter(e => e.event === 'goal.kickoff').length,
        };
      }, strand.id);

      if (i % 15 === 0) {
        console.log(`  [${i}s] tasks=${snapshot.totalTasks} kickoff-events=${snapshot.kickoffEvents}`);
        for (const g of snapshot.goals) {
          console.log(`    "${g.title}": ${g.taskCount} tasks`);
          for (const t of g.tasks) {
            console.log(`      [${t.status}] "${t.text}" session=${t.sessionKey ? 'yes' : 'no'}`);
          }
        }
      }

      if (snapshot.totalTasks > 0) {
        taskCount = snapshot.totalTasks;
        console.log(`Tasks created! Total: ${taskCount}`);
        break;
      }
    }

    if (taskCount === 0) {
      console.log('WARNING: No tasks created by cascade after 3 minutes');
      await page.screenshot({ path: 'test-results/04-no-tasks.png' });
    }

    // Refresh goal details now that tasks exist
    await page.evaluate(() => loadGoals());
    await page.waitForTimeout(1000);
    goals = await page.evaluate((id) => {
      return state.goals.filter(g => g.strandId === id).map(g => ({
        id: g.id, title: g.title, status: g.status,
        tasks: (g.tasks || []).map(t => ({
          id: t.id, text: t.text, status: t.status,
          sessionKey: t.sessionKey, dependsOn: t.dependsOn,
        })),
      }));
    }, strand.id);
    for (const g of goals) {
      console.log(`  Goal: "${g.title}" (${g.status}) — ${g.tasks.length} tasks`);
      for (const t of g.tasks) {
        console.log(`    Task: "${t.text}" [${t.status}] deps=${JSON.stringify(t.dependsOn || [])} session=${t.sessionKey ? 'yes' : 'no'}`);
      }
    }
    await page.screenshot({ path: 'test-results/04-goals-started.png' });

    // ─── 8. Monitor pipeline — watch for task completions and auto-kickoff ───
    console.log('\n=== 8. Monitoring pipeline ===');
    console.log('Watching for: task completions, auto-kickoff events, new sessions...');

    let firstDoneAt = 0;
    let autoKickoffSeen = false;
    const seenDoneTasks = new Set();

    for (let i = 0; i < 1200; i++) { // 20 min max
      await page.waitForTimeout(1000);

      // Refresh goals from backend every 10s
      if (i % 10 === 0) {
        await page.evaluate(() => loadGoals()).catch(() => {});
      }

      const snapshot = await page.evaluate((strandId) => {
        const goals = state.goals.filter(g => g.strandId === strandId);
        const events = window.__pipelineEvents;
        return {
          goals: goals.map(g => ({
            id: g.id, title: g.title, status: g.status,
            tasks: (g.tasks || []).map(t => ({
              id: t.id, text: t.text, status: t.status,
              done: t.done, sessionKey: t.sessionKey,
            })),
          })),
          kickoffs: events.filter(e => e.event === 'goal.kickoff').map(e => ({
            ts: e.ts, goalId: e.payload?.goalId,
            count: e.payload?.spawnedCount,
            sessions: (e.payload?.spawnedSessions || []).map(s => ({
              taskId: s.taskId, sessionKey: s.sessionKey,
              hasContext: !!s.taskContext,
            })),
          })),
          taskCompletions: events.filter(e => e.event === 'goal.task_completed').map(e => ({
            ts: e.ts, goalId: e.payload?.goalId, taskId: e.payload?.taskId,
            allDone: e.payload?.allTasksDone,
          })),
        };
      }, strand.id);

      // Count statuses
      let done = 0, inProg = 0, pending = 0, total = 0;
      const newDone = [];
      for (const g of snapshot.goals) {
        for (const t of g.tasks) {
          total++;
          if (t.done || t.status === 'done') {
            done++;
            if (!seenDoneTasks.has(t.id)) {
              seenDoneTasks.add(t.id);
              newDone.push(t);
            }
          }
          else if (t.status === 'in-progress') inProg++;
          else pending++;
        }
      }

      // Report new completions
      for (const t of newDone) {
        const elapsed = firstDoneAt ? i : i;
        firstDoneAt = firstDoneAt || i;
        console.log(`\n  TASK DONE at ${i}s: "${t.text}" (${t.id})`);
      }

      // Report kickoff events
      if (snapshot.kickoffs.length > 0 && !autoKickoffSeen) {
        // Check for kickoff events after first task completion
        const postDoneKickoffs = snapshot.kickoffs.filter(k => firstDoneAt > 0);
        if (postDoneKickoffs.length > 0) {
          autoKickoffSeen = true;
          console.log(`\n  AUTO-KICKOFF EVENT at ${i}s:`);
          for (const k of snapshot.kickoffs) {
            console.log(`    goalId=${k.goalId} spawned=${k.count} sessions=${JSON.stringify(k.sessions)}`);
          }
        }
      }

      // Periodic status
      if (i % 15 === 0) {
        console.log(`  [${i}s] done=${done} in-progress=${inProg} pending=${pending} total=${total} kickoff-events=${snapshot.kickoffs.length} task-completed-events=${snapshot.taskCompletions.length}`);

        // Detail view
        for (const g of snapshot.goals) {
          for (const t of g.tasks) {
            console.log(`    [${t.status}${t.done ? '/done' : ''}] "${t.text}" session=${t.sessionKey ? t.sessionKey.slice(-12) : 'none'}`);
          }
        }
      }

      // ─── KEY DIAGNOSTIC: task done but next not started ───
      if (firstDoneAt && !autoKickoffSeen && (i - firstDoneAt) === 15) {
        console.log('\n  *** AUTO-KICKOFF DIAGNOSIS at +15s after first task done ***');
        console.log(`  Kickoff events received: ${snapshot.kickoffs.length}`);
        console.log(`  Task completion events: ${snapshot.taskCompletions.length}`);

        for (const tc of snapshot.taskCompletions) {
          console.log(`    task_completed: goal=${tc.goalId} task=${tc.taskId} allDone=${tc.allDone}`);
        }
        for (const k of snapshot.kickoffs) {
          console.log(`    kickoff: goal=${k.goalId} spawned=${k.count}`);
          for (const s of k.sessions) {
            console.log(`      session=${s.sessionKey} task=${s.taskId} hasContext=${s.hasContext}`);
          }
        }

        // Check pending tasks and their deps
        for (const g of snapshot.goals) {
          const pendingTasks = g.tasks.filter(t => !t.done && t.status !== 'done' && !t.sessionKey);
          if (pendingTasks.length > 0) {
            console.log(`  Goal "${g.title}" has ${pendingTasks.length} unfired pending tasks`);
          }
        }

        await page.screenshot({ path: 'test-results/05-auto-kickoff-diag.png' });
      }

      // ─── Auto-kickoff never arrived — manual recovery at +30s ───
      if (firstDoneAt && !autoKickoffSeen && (i - firstDoneAt) === 30) {
        console.log('\n  *** AUTO-KICKOFF FAILED — attempting manual recovery ***');

        for (const g of snapshot.goals) {
          const pendingWithoutSession = g.tasks.filter(t => !t.done && t.status !== 'done' && !t.sessionKey);
          if (pendingWithoutSession.length > 0) {
            console.log(`  Manual kickoff for goal "${g.title}" (${pendingWithoutSession.length} pending)...`);
            const r = await page.evaluate(async (goalId) => {
              try {
                const result = await rpcCall('goals.kickoff', { goalId }, 120000);
                if (result?.spawnedSessions) {
                  for (const s of result.spawnedSessions) {
                    if (s.taskContext && s.sessionKey) {
                      await rpcCall('chat.send', {
                        sessionKey: s.sessionKey,
                        message: s.taskContext,
                        idempotencyKey: 'recovery-' + s.taskId + '-' + Date.now(),
                      }, 120000).catch(() => {});
                    }
                  }
                }
                return { ok: true, spawned: result?.spawnedSessions?.length || 0, msg: result?.message };
              } catch (e) { return { ok: false, error: e.message }; }
            }, g.id);
            console.log(`  Result: ${JSON.stringify(r)}`);
          }
        }
      }

      // Done?
      if (done === total && total > 0) {
        console.log(`\n  ALL TASKS DONE at ${i}s!`);
        break;
      }
    }

    // ─── Final report ───
    console.log('\n=== FINAL REPORT ===');
    const final = await page.evaluate((strandId) => {
      const goals = state.goals.filter(g => g.strandId === strandId);
      return {
        goals: goals.map(g => ({
          title: g.title, status: g.status,
          tasks: (g.tasks || []).map(t => ({
            text: t.text, status: t.status, done: t.done,
            sessionKey: t.sessionKey,
          })),
        })),
        events: window.__pipelineEvents
          .filter(e => ['goal.kickoff', 'goal.task_completed', 'goal.completed'].includes(e.event))
          .map(e => ({ event: e.event, goalId: e.payload?.goalId, taskId: e.payload?.taskId, spawned: e.payload?.spawnedCount })),
      };
    }, strand.id);

    for (const g of final.goals) {
      const d = g.tasks.filter(t => t.done || t.status === 'done').length;
      console.log(`Goal "${g.title}" (${g.status}): ${d}/${g.tasks.length} done`);
      for (const t of g.tasks) console.log(`  [${t.status}] "${t.text}" session=${t.sessionKey ? 'yes' : 'no'}`);
    }
    console.log(`\nPipeline events:`);
    for (const e of final.events) console.log(`  ${e.event} goal=${e.goalId} task=${e.taskId || '-'} spawned=${e.spawned || '-'}`);

    await page.screenshot({ path: 'test-results/06-final.png' });
  });
});
