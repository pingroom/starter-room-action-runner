import { PingRoom } from '@pingroom/sdk';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRunner } from './runner.js';
import { reportHandler } from './report.js';

const head = '00000000-0000-0000-0000-000000000000';
const id = '00000000-0000-0000-0000-000000000001';
const policy = { room: 'demo-room', senderId: '11111111-1111-1111-1111-111111111111', actionNumber: 1 };
const event = { id, room: { code: policy.room }, sender: { id: policy.senderId }, action_number: 1, trigger_source: 'manual', origin_agent: null, question: null, is_handoff: false };
let requests = 0;
// Every request is answered locally. No environment credentials, global fetch,
// pairing, or real PingRoom request is used by this demo.
const client = new PingRoom({
  token: 'offline-demo', baseUrl: 'https://offline.invalid',
  async fetch(url, options) {
    const request = new URL(url);
    if (request.pathname !== '/api/agent/notifications/wait' || options.method !== 'GET') throw new Error('Unexpected demo request.');
    requests += 1;
    const payload = requests === 1 ? { notifications: [], cursor: head } : { notifications: [event, event], cursor: id };
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  },
});
const directory = await mkdtemp(join(tmpdir(), 'pingroom-action-demo-'));
let runner;
try {
  const options = { client, policy, directory: join(directory, 'state'), connectionKey: 'offline', handle: reportHandler(join(directory, 'output')) };
  runner = await openRunner(options);
  console.log('First delivery:', await runner.poll());
  await runner.close();
  runner = await openRunner(options);
  console.log('Restart and duplicate delivery:', await runner.poll());
  console.log(`Report files: ${(await readdir(join(directory, 'output'))).length}. All temporary demo files are removed.`);
} finally {
  await runner?.close();
  await rm(directory, { recursive: true, force: true });
}
