import { PingRoom } from '@pingroom/sdk';
import { saveConnection, stateDirectory } from './config.js';
import { shutdownSignal } from './signals.js';
import { errorSummary } from './errors.js';

const shutdown = shutdownSignal();
try {
  console.log('Watch a trusted teammate’s quick action and build a local report.');
  console.log('Install or open PingRoom and sign in: https://pingroom.io/i');
  const client = new PingRoom();
  const pairing = await client.auth.startPairing({ agent_label: 'Room action runner' });
  console.log(`Approve this connection and select your shared private room: ${pairing.pair_browser_url ?? pairing.pair_url}`);
  const active = await client.auth.waitForPairing(pairing, { signal: shutdown.signal });
  const room = active.home_room ?? active.room;
  if (!room?.invite_code) throw new Error('No delivery room returned. Create a shared private room and connect again.');
  await saveConnection(stateDirectory, { token: active.credential, room: room.invite_code });
  console.log('Saved .pingroom/credentials.json. Have your teammate tap the intended quick action, then run npm run inspect.');
} catch (error) {
  console.error(errorSummary(error));
  process.exitCode ||= 1;
} finally { shutdown.dispose(); }
