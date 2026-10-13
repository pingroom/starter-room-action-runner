import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';

export const stateDirectory = fileURLToPath(new URL('../.pingroom/', import.meta.url));
export const outputDirectory = fileURLToPath(new URL('../output/', import.meta.url));
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function loadEnvironment() {
  try { process.loadEnvFile('.env'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function saveConnection(directory, connection) {
  await atomicJson(directory, 'credentials.json', connection);
}

export async function loadConnection(directory = stateDirectory, env = process.env) {
  const token = env.PINGROOM_TOKEN?.trim();
  const room = env.PINGROOM_ROOM?.trim();
  let connection;
  if (env.PINGROOM_TOKEN !== undefined || env.PINGROOM_ROOM !== undefined) {
    if (!token || !room) throw new Error('Set both PINGROOM_TOKEN and PINGROOM_ROOM; partial overrides are refused.');
    connection = { token, room };
  } else connection = await readJson(join(directory, 'credentials.json'));
  if (!connection || typeof connection.token !== 'string' || !connection.token.trim()
    || typeof connection.room !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(connection.room)) {
    throw new Error('Run npm run connect, or set both PINGROOM_TOKEN and PINGROOM_ROOM.');
  }
  return { token: connection.token, room: connection.room };
}

export function loadPolicy(room, env = process.env) {
  const senderId = env.PINGROOM_TRUSTED_SENDER_ID?.trim();
  const actionNumber = Number(env.PINGROOM_ACTION_NUMBER);
  if (!UUID.test(senderId ?? '') || !Number.isInteger(actionNumber) || actionNumber < 1 || actionNumber > 16) {
    throw new Error('Set PINGROOM_TRUSTED_SENDER_ID from npm run inspect and PINGROOM_ACTION_NUMBER to an existing slot (1–16).');
  }
  return { room, senderId, actionNumber };
}
