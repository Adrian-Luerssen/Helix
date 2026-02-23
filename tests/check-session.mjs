import WebSocket from 'ws';
import { readFileSync } from 'fs';
import os from 'os';

const BEARER = readFileSync(os.homedir() + '/.config/systemd/user/openclaw-gateway.service', 'utf-8').match(/OPENCLAW_GATEWAY_TOKEN=(\S+)/)?.[1] || '';
const PASSWORD = JSON.parse(readFileSync(os.homedir() + '/.openclaw/openclaw.json', 'utf-8'))?.gateway?.auth?.token || '';

const strandId = process.argv[2];
if (!strandId) { console.log('Usage: node /tmp/check-session.mjs <strandId>'); process.exit(1); }

const ws = new WebSocket('ws://127.0.0.1:18789/ws', { headers: { Origin: 'http://127.0.0.1:18789', Authorization: 'Bearer ' + BEARER } });
let reqId = 0;
const pending = new Map();

function sendRpc(method, params) {
  const id = 'r' + (++reqId);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
    setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, 15000);
  });
}

let authDone = false;
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    ws.send(JSON.stringify({ type: 'req', id: 'c1', method: 'connect', params: { minProtocol: 3, maxProtocol: 3, client: { id: 'webchat-ui', displayName: 'checker', mode: 'webchat', version: '2.0.0', platform: 'node' }, auth: { token: PASSWORD } } }));
    return;
  }
  if (msg.type === 'res' && !authDone) {
    authDone = true;
    if (!msg.ok) { console.log('Auth fail'); ws.close(); return; }
    run().catch(e => { console.error(e); ws.close(); });
    return;
  }
  if (msg.type === 'res' && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.payload);
    else p.reject(new Error(JSON.stringify(msg.error)));
  }
});

async function run() {
  // Get goals for this strand
  const goalsResult = await sendRpc('goals.list', { strandId });
  const goals = goalsResult.goals || [];
  console.log(`\nStrand ${strandId}: ${goals.length} goals\n`);

  for (const goal of goals) {
    console.log(`\n=== ${goal.title} (${goal.id}) ===`);
    console.log(`  Status: ${goal.status}, Tasks: ${(goal.tasks || []).length}`);

    for (const task of (goal.tasks || [])) {
      console.log(`\n  Task: ${task.text}`);
      console.log(`    Status: ${task.status}, Agent: ${task.assignedAgent}`);
      console.log(`    Session: ${task.sessionKey || 'none'}`);

      if (task.sessionKey) {
        try {
          const history = await sendRpc('chat.history', { sessionKey: task.sessionKey, limit: 50 });
          const messages = history.messages || [];
          console.log(`    Messages: ${messages.length}`);

          // Show tool uses (goal_update calls)
          for (const m of messages) {
            if (m.role === 'assistant' && m.content) {
              // Check for tool_use blocks
              const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }];
              for (const b of blocks) {
                if (b.type === 'tool_use') {
                  console.log(`    🔧 Tool: ${b.name}(${JSON.stringify(b.input).substring(0, 200)})`);
                } else if (b.type === 'text' && b.text) {
                  const preview = b.text.substring(0, 150).replace(/\n/g, '\\n');
                  console.log(`    💬 ${preview}...`);
                }
              }
            }
          }
        } catch (e) {
          console.log(`    ⚠️ Could not fetch history: ${e.message}`);
        }
      }
    }
  }

  ws.close();
}

setTimeout(() => process.exit(0), 30000);
