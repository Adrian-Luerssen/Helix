import WebSocket from 'ws';
import { readFileSync } from 'fs';
import os from 'os';

const BEARER = readFileSync(os.homedir() + '/.config/systemd/user/openclaw-gateway.service', 'utf-8').match(/OPENCLAW_GATEWAY_TOKEN=(\S+)/)?.[1] || '';
const PASSWORD = JSON.parse(readFileSync(os.homedir() + '/.openclaw/openclaw.json', 'utf-8'))?.gateway?.auth?.token || '';
const strandId = process.argv[2];
if (!strandId) { console.log('Usage: node tests/_cleanup.js <strandId>'); process.exit(1); }

const ws = new WebSocket('ws://127.0.0.1:18789/ws', { headers: { Origin: 'http://127.0.0.1:18789', Authorization: 'Bearer ' + BEARER } });
let authDone = false;
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    ws.send(JSON.stringify({ type: 'req', id: 'c1', method: 'connect', params: { minProtocol: 3, maxProtocol: 3, client: { id: 'webchat-ui', displayName: 'cleanup', mode: 'webchat', version: '2.0.0', platform: 'node' }, auth: { token: PASSWORD } } }));
    return;
  }
  if (msg.type === 'res' && !authDone) {
    authDone = true;
    if (!msg.ok) { console.log('Auth fail'); ws.close(); return; }
    ws.send(JSON.stringify({ type: 'req', id: 'del', method: 'strands.delete', params: { id: strandId } }));
    return;
  }
  if (msg.id === 'del') { console.log('Deleted strand ' + strandId + ':', msg.ok ? 'OK' : JSON.stringify(msg.error)); ws.close(); }
});
setTimeout(() => process.exit(0), 5000);
