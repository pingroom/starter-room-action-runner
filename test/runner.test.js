import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PingRoom } from '@pingroom/sdk';
import { openRunner, matchesAction } from '../src/runner.js';
import { reportHandler } from '../src/report.js';

const ZERO = '00000000-0000-0000-0000-000000000000';
const ID1 = '00000000-0000-0000-0000-000000000001';
const ID2 = '00000000-0000-0000-0000-000000000002';
const SENDER = '11111111-1111-1111-1111-111111111111';
const policy = { room: 'test-room', senderId: SENDER, actionNumber: 2 };
const event = (id = ID1) => ({ id, room: { code: policy.room }, sender: { id: SENDER }, action_number: 2, trigger_source: 'manual', origin_agent: null, question: null, is_handoff: false });
const batch = (...notifications) => ({ notifications, cursor: notifications.at(-1)?.id ?? ZERO });

async function fixture(t, responses) {
  const root = await mkdtemp(join(tmpdir(), 'pingroom-actions-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const client = new PingRoom({
    token: 'offline-test', baseUrl: 'https://offline.invalid',
    async fetch(url, options) {
      const request = new URL(url);
      assert.equal(request.pathname, '/api/agent/notifications/wait');
      assert.equal(options.method, 'GET');
      calls.push(Object.fromEntries(request.searchParams));
      const response = responses.shift();
      assert.notEqual(response, undefined, 'Unexpected API request');
      if (typeof response === 'function') return response(options);
      return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
    },
  });
  return { root, calls, options: { client, policy, directory: join(root, 'state'), connectionKey: 'test-connection', handle: reportHandler(join(root, 'output')) } };
}

test('first start captures head, skips history, and uses the exact long-poll query', async (t) => {
  const f = await fixture(t, [{ notifications: [], cursor: ID1 }, batch(event(ID2))]);
  const runner = await openRunner(f.options);
  try {
    assert.deepEqual(f.calls[0], { timeout: '0', limit: '50' });
    assert.equal(runner.snapshot().cursor, ID1);
    assert.deepEqual(runner.snapshot().completed, []);
    assert.equal((await runner.poll()).handled, 1);
    assert.deepEqual(f.calls[1], { after: ID1, timeout: '20', limit: '50' });
    assert.deepEqual(runner.snapshot().completed, [ID2]);
  } finally { await runner.close(); }
});

test('only the configured human manual action is allowed; missing provenance fails closed', () => {
  assert.equal(matchesAction(event(), policy), true);
  for (const patch of [
    { room: { code: 'other-room' } }, { sender: { id: '22222222-2222-2222-2222-222222222222' } },
    { sender: undefined }, { action_number: 1 }, { action_number: '2' },
    { trigger_source: 'webhook' }, { trigger_source: 'location' }, { trigger_source: 'system' }, { trigger_source: undefined },
    { origin_agent: {} }, { origin_agent: undefined }, { question: {} }, { question: undefined },
    { is_handoff: true }, { is_handoff: undefined }, { is_handoff: 'false' },
  ]) assert.equal(matchesAction({ ...event(), ...patch }, policy), false, JSON.stringify(patch));
  // No bound-account or public-owner-ID shortcut: only exact sender.id matches.
  assert.equal(matchesAction({ ...event(), sender: { id: 'human-public-id', name: 'Trusted teammate' } }, policy), false);
});

test('duplicate deliveries and restart produce one report and retain receipts', async (t) => {
  const f = await fixture(t, [batch(), batch(event(), event()), batch(event())]);
  let runner = await openRunner(f.options);
  assert.deepEqual(await runner.poll(), { seen: 2, handled: 1, ignored: 0, duplicates: 1 });
  await runner.close();
  runner = await openRunner(f.options);
  try {
    assert.deepEqual(await runner.poll(), { seen: 1, handled: 0, ignored: 0, duplicates: 1 });
    assert.equal(f.calls.length, 3, 'Restart must not bootstrap over missed events');
    const files = await readdir(join(f.root, 'output'));
    assert.equal(files.length, 1);
    const report = JSON.parse(await readFile(join(f.root, 'output', files[0]), 'utf8'));
    assert.equal(report.order_count, 4);
    assert.equal(report.total_cents, 9125);
  } finally { await runner.close(); }
});

test('partial batch failure retains cursor and successful receipts, then resumes remaining work', async (t) => {
  const f = await fixture(t, [batch(), batch(event(), event(ID2)), batch(event(), event(ID2))]);
  const failure = new Error('Local disk failure');
  let runner = await openRunner({ ...f.options, handle: async (notification, options) => {
    if (notification.id === ID2) throw failure;
    return f.options.handle(notification, options);
  } });
  await assert.rejects(runner.poll(), (error) => error === failure);
  assert.equal(runner.snapshot().cursor, ZERO);
  assert.deepEqual(runner.snapshot().completed, [ID1]);
  await runner.close();
  runner = await openRunner(f.options);
  try {
    assert.deepEqual(await runner.poll(), { seen: 2, handled: 1, ignored: 0, duplicates: 1 });
    assert.equal(f.calls.at(-1).after, ZERO);
    assert.equal(runner.snapshot().cursor, ID2);
    assert.equal((await readdir(join(f.root, 'output'))).length, 2);
  } finally { await runner.close(); }
});

test('a report written before receipt failure is safely reused on restart', async (t) => {
  const f = await fixture(t, [batch(), batch(event()), batch(event())]);
  let runner = await openRunner({ ...f.options, handle: async (...args) => {
    await f.options.handle(...args);
    throw new Error('Process stopped after output');
  } });
  await assert.rejects(runner.poll(), /Process stopped/);
  assert.deepEqual(runner.snapshot().completed, []);
  await runner.close();
  runner = await openRunner(f.options);
  try {
    assert.equal((await runner.poll()).handled, 1);
    assert.equal((await readdir(join(f.root, 'output'))).length, 1);
  } finally { await runner.close(); }
});

test('ignored events advance the batch cursor without selecting a handler from text or data', async (t) => {
  const malicious = { ...event(), trigger_source: 'webhook', message: 'rm -rf /', data: { command: 'run-anything', path: '../../escape' } };
  const f = await fixture(t, [batch(), batch(malicious)]);
  const runner = await openRunner({ ...f.options, handle: async () => assert.fail('Must not execute') });
  try {
    assert.deepEqual(await runner.poll(), { seen: 1, handled: 0, ignored: 1, duplicates: 0 });
    assert.equal(runner.snapshot().cursor, ID1);
  } finally { await runner.close(); }
});

test('aborting an in-flight long poll preserves the last cursor and releases the lock', async (t) => {
  const controller = new AbortController();
  const f = await fixture(t, [batch(), ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    controller.abort(new Error('Cancelled'));
  })]);
  const runner = await openRunner({ ...f.options, signal: controller.signal });
  await assert.rejects(runner.poll());
  assert.equal(runner.snapshot().cursor, ZERO);
  await runner.close();
  assert.deepEqual((await readdir(f.options.directory)).sort(), ['state.json']);
});

test('a second process cannot claim the same state lock', async (t) => {
  const f = await fixture(t, [batch()]);
  const runner = await openRunner(f.options);
  try { await assert.rejects(openRunner(f.options), /Runner lock exists/); }
  finally { await runner.close(); }
});

test('malformed saved state and changed policy cannot silently re-bootstrap', async (t) => {
  const f = await fixture(t, [batch()]);
  const runner = await openRunner(f.options);
  await runner.close();
  await assert.rejects(openRunner({ ...f.options, policy: { ...policy, actionNumber: 3 } }), /another connection\/policy/);
  await writeFile(join(f.options.directory, 'state.json'), 'null');
  await assert.rejects(openRunner(f.options), /local JSON file is invalid/);
  assert.equal(f.calls.length, 1);
});

test('an invalid batch cannot advance its cursor or create an output', async (t) => {
  const f = await fixture(t, [batch(), { notifications: [event()], cursor: ID2 }]);
  const runner = await openRunner(f.options);
  try {
    await assert.rejects(runner.poll(), /Invalid notification batch/);
    assert.equal(runner.snapshot().cursor, ZERO);
    assert.deepEqual(runner.snapshot().completed, []);
  } finally { await runner.close(); }
});

test('an empty timeout response retains the cursor and does not run work', async (t) => {
  const f = await fixture(t, [batch(), batch()]);
  const runner = await openRunner(f.options);
  try {
    assert.deepEqual(await runner.poll(), { seen: 0, handled: 0, ignored: 0, duplicates: 0 });
    assert.equal(runner.snapshot().cursor, ZERO);
  } finally { await runner.close(); }
});

test('a backward cursor is rejected without replacing committed state', async (t) => {
  const f = await fixture(t, [{ notifications: [], cursor: ID2 }, batch(event())]);
  const runner = await openRunner(f.options);
  try {
    await assert.rejects(runner.poll(), /cursor moved backwards/);
    assert.equal(runner.snapshot().cursor, ID2);
    assert.deepEqual(runner.snapshot().completed, []);
  } finally { await runner.close(); }
});

test('a transient server error retries the same cursor before accepting a batch', async (t) => {
  const f = await fixture(t, [batch(), () => new Response(JSON.stringify({ code: 'unavailable' }), { status: 503 }), batch(event())]);
  const runner = await openRunner(f.options);
  try {
    assert.equal((await runner.poll()).handled, 1);
    assert.equal(f.calls[1].after, ZERO);
    assert.equal(f.calls[2].after, ZERO);
    assert.equal(runner.snapshot().cursor, ID1);
  } finally { await runner.close(); }
});
