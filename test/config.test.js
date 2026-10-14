import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PingRoomError } from '@pingroom/sdk';
import { loadConnection, loadPolicy, saveConnection } from '../src/config.js';
import { errorSummary } from '../src/errors.js';
import { matchesAction } from '../src/runner.js';

const SENDER = '11111111-1111-1111-1111-111111111111';

test('credentials are private; complete environment pair overrides, partial pair fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pingroom-config-test-'));
  try {
    await saveConnection(root, { token: 'local-token', room: 'LOCAL-ROOM' });
    assert.deepEqual(await loadConnection(root, {}), { token: 'local-token', room: 'LOCAL-ROOM' });
    assert.deepEqual(await loadConnection(root, { PINGROOM_TOKEN: 'ci-token', PINGROOM_ROOM: 'CI-ROOM' }), { token: 'ci-token', room: 'CI-ROOM' });
    await assert.rejects(loadConnection(root, { PINGROOM_TOKEN: 'partial' }), /both/);
    await assert.rejects(loadConnection(root, { PINGROOM_TOKEN: '', PINGROOM_ROOM: '' }), /both/);
    await assert.rejects(loadConnection(root, { PINGROOM_ROOM: '' }), /both/);
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(root, 'credentials.json'))).mode & 0o777, 0o600);
      assert.equal((await stat(root)).mode & 0o777, 0o700);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sender and slot must be explicit; a display name or public User ID is not accepted', () => {
  assert.throws(() => loadPolicy('ROOM', {}), /TRUSTED_SENDER/);
  assert.throws(() => loadPolicy('ROOM', { PINGROOM_TRUSTED_SENDER_ID: 'Alice', PINGROOM_ACTION_NUMBER: '1' }), /TRUSTED_SENDER/);
  assert.deepEqual(loadPolicy('ROOM', { PINGROOM_TRUSTED_SENDER_ID: SENDER, PINGROOM_ACTION_NUMBER: '2' }), {
    room: 'ROOM', senderId: SENDER, actionNumber: 2,
  });
});

test('a lowercase room code is uppercased, so the stored code in the wait feed still matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pingroom-config-test-'));
  try {
    const fromEnv = await loadConnection(root, { PINGROOM_TOKEN: 'ci-token', PINGROOM_ROOM: 'abcd12efgh34' });
    assert.equal(fromEnv.room, 'ABCD12EFGH34');
    await saveConnection(root, { token: 'local-token', room: 'abcd12efgh34' });
    assert.equal((await loadConnection(root, {})).room, 'ABCD12EFGH34');
  } finally { await rm(root, { recursive: true, force: true }); }
  const policy = loadPolicy('abcd12efgh34', { PINGROOM_TRUSTED_SENDER_ID: SENDER, PINGROOM_ACTION_NUMBER: '2' });
  assert.equal(policy.room, 'ABCD12EFGH34');
  // The server resolves invite codes case-insensitively but reports the stored, uppercase code.
  const press = {
    id: '00000000-0000-0000-0000-000000000001', room: { code: 'ABCD12EFGH34' }, sender: { id: SENDER },
    action_number: 2, trigger_source: 'manual', origin_agent: null, question: null, is_handoff: false,
  };
  assert.equal(matchesAction(press, policy), true);
});

test('API error logs exclude raw response text and credentials', () => {
  assert.equal(errorSummary(new PingRoomError('Secret: token', { status: 403, code: 'room_not_granted', body: { token: 'secret' } })), 'PingRoom room_not_granted (HTTP 403).');
});
