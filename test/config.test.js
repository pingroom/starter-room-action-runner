import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PingRoomError } from '@pingroom/sdk';
import { loadConnection, loadPolicy, saveConnection } from '../src/config.js';
import { errorSummary } from '../src/errors.js';

test('credentials are private; complete environment pair overrides, partial pair fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pingroom-config-test-'));
  try {
    await saveConnection(root, { token: 'local-token', room: 'local-room' });
    assert.deepEqual(await loadConnection(root, {}), { token: 'local-token', room: 'local-room' });
    assert.deepEqual(await loadConnection(root, { PINGROOM_TOKEN: 'ci-token', PINGROOM_ROOM: 'ci-room' }), { token: 'ci-token', room: 'ci-room' });
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
  assert.throws(() => loadPolicy('room', {}), /TRUSTED_SENDER/);
  assert.throws(() => loadPolicy('room', { PINGROOM_TRUSTED_SENDER_ID: 'Alice', PINGROOM_ACTION_NUMBER: '1' }), /TRUSTED_SENDER/);
  assert.deepEqual(loadPolicy('room', { PINGROOM_TRUSTED_SENDER_ID: '11111111-1111-1111-1111-111111111111', PINGROOM_ACTION_NUMBER: '2' }), {
    room: 'room', senderId: '11111111-1111-1111-1111-111111111111', actionNumber: 2,
  });
});

test('API error logs exclude raw response text and credentials', () => {
  assert.equal(errorSummary(new PingRoomError('Secret: token', { status: 403, code: 'room_not_granted', body: { token: 'secret' } })), 'PingRoom room_not_granted (HTTP 403).');
});
