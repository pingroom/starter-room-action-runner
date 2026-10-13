import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, readJson, acquireLock } from './storage.js';
import { digest, UUID } from './config.js';
import { isTransient } from './errors.js';

export function matchesAction(event, policy) {
  return event?.room?.code === policy.room && event?.sender?.id === policy.senderId
    && event.action_number === policy.actionNumber && event.trigger_source === 'manual'
    // Missing provenance does not authorize execution on older servers.
    && event.origin_agent === null && event.question === null && event.is_handoff === false;
}

function validateBatch(batch) {
  if (!batch || !UUID.test(batch.cursor ?? '') || !Array.isArray(batch.notifications)
    || batch.notifications.length > 100 || batch.notifications.some((event) => !event || !UUID.test(event.id ?? ''))
    || (batch.notifications.length > 0 && batch.cursor !== batch.notifications.at(-1).id)) {
    throw new Error('Invalid notification batch; delivery cursor was not advanced.');
  }
}

export async function openRunner({ client, policy, directory, connectionKey, handle, signal }) {
  if (!client?.notifications?.wait || typeof handle !== 'function' || !connectionKey
    || typeof policy?.room !== 'string' || !policy.room || !UUID.test(policy.senderId ?? '')
    || !Number.isInteger(policy.actionNumber) || policy.actionNumber < 1 || policy.actionNumber > 16) {
    throw new Error('A client, connection identity, room, trusted sender, action slot, and fixed handler are required.');
  }
  signal?.throwIfAborted();
  const release = await acquireLock(directory);
  let closed = false;
  let polling = false;
  try {
    const scope = digest(JSON.stringify({ connectionKey, room: policy.room, senderId: policy.senderId, actionNumber: policy.actionNumber }));
    let state = await readJson(join(directory, 'state.json'));
    if (state !== null) {
      if (state.version !== 1 || state.scope !== scope || !UUID.test(state.cursor ?? '')
        || !Array.isArray(state.completed) || state.completed.some((id) => !UUID.test(id))) {
        throw new Error('Saved state is invalid or belongs to another connection/policy. Restore it or follow the deliberate reset procedure in README.');
      }
    } else {
      // Omit `after` to capture the current head. Intentionally skip history.
      const head = await client.notifications.wait({ timeout: 0, limit: 50, signal });
      validateBatch(head);
      signal?.throwIfAborted();
      state = { version: 1, scope, cursor: head.cursor, completed: [] };
      await atomicJson(directory, 'state.json', state);
    }
    const completed = new Set(state.completed);
    return {
      snapshot() { return structuredClone(state); },
      async poll() {
        if (closed || polling) throw new Error('This runner is closed or already polling.');
        polling = true;
        try {
          signal?.throwIfAborted();
          let batch;
          for (let attempt = 0; ; attempt += 1) {
            try {
              batch = await client.notifications.wait({ after: state.cursor, timeout: 20, limit: 50, signal });
              break;
            } catch (error) {
              if (signal?.aborted || !isTransient(error) || attempt >= 3) throw error;
              await delay(1_000 * 2 ** attempt, undefined, { signal });
            }
          }
          validateBatch(batch);
          if (batch.cursor.toLowerCase() < state.cursor.toLowerCase()) throw new Error('Server cursor moved backwards; refusing to replace saved state.');
          const result = { seen: batch.notifications.length, handled: 0, ignored: 0, duplicates: 0 };
          for (const event of batch.notifications) {
            signal?.throwIfAborted();
            if (!matchesAction(event, policy)) { result.ignored += 1; continue; }
            if (completed.has(event.id)) { result.duplicates += 1; continue; }
            await handle(event, { signal });
            // Save each receipt while retaining the previous batch cursor.
            // A later failure replays the batch and skips completed events.
            const next = { ...state, completed: [...state.completed, event.id] };
            await atomicJson(directory, 'state.json', next);
            state = next;
            completed.add(event.id);
            result.handled += 1;
          }
          signal?.throwIfAborted();
          const next = { ...state, cursor: batch.cursor };
          await atomicJson(directory, 'state.json', next);
          state = next;
          return result;
        } finally { polling = false; }
      },
      async close() {
        if (polling) throw new Error('Abort and await the active poll before releasing the runner lock.');
        if (!closed) { closed = true; await release(); }
      },
    };
  } catch (error) { await release(); throw error; }
}
