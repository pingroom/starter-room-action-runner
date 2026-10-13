import { PingRoom } from '@pingroom/sdk';
import { loadConnection, loadEnvironment } from './config.js';
import { errorSummary } from './errors.js';

try {
  loadEnvironment();
  const { token, room } = await loadConnection();
  const client = new PingRoom({ token, timeoutMs: 10_000 });
  const [actions, recent] = await Promise.all([client.actions.list(room), client.notifications.list({ limit: 25 })]);
  console.log('Existing quick actions (read only):');
  console.log(JSON.stringify(actions.map((action) => ({ slot: action.action_number, label: action.label, input_type: action.input_type ?? 'none' })), null, 2));
  console.log('Recent notification metadata in your configured room (up to 25 across the feed):');
  console.log(JSON.stringify(recent.data.filter((event) => event.room?.code === room).map((event) => ({
    created_at: event.created_at, room: event.room.code, sender_id: event.sender?.id,
    sender_name: event.sender?.name, action_number: event.action_number, trigger_source: event.trigger_source,
    has_agent_origin: event.origin_agent != null,
  })), null, 2));
  console.log('Identify the harmless test ping your trusted teammate just sent. Copy its sender_id and action_number into .env.');
  console.log('A display name alone does not establish trust. Your own pings are excluded from the live wait feed.');
} catch (error) { console.error(errorSummary(error)); process.exitCode = 1; }
