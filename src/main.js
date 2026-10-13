import { PingRoom } from '@pingroom/sdk';
import { setTimeout as delay } from 'node:timers/promises';
import { digest, loadConnection, loadEnvironment, loadPolicy, outputDirectory, stateDirectory } from './config.js';
import { openRunner } from './runner.js';
import { reportHandler } from './report.js';
import { shutdownSignal } from './signals.js';
import { errorSummary } from './errors.js';

const shutdown = shutdownSignal();
let runner;
try {
  loadEnvironment();
  const { token, room } = await loadConnection();
  runner = await openRunner({
    client: new PingRoom({ token }), policy: loadPolicy(room),
    directory: stateDirectory, connectionKey: digest(token),
    handle: reportHandler(outputDirectory), signal: shutdown.signal,
  });
  console.log('Ready. Have the trusted teammate tap the configured action. Reports appear in output/.');
  while (!shutdown.signal.aborted) {
    const result = await runner.poll();
    if (result.seen) console.log(JSON.stringify(result));
    await delay(0, undefined, { signal: shutdown.signal });
  }
} catch (error) {
  if (!shutdown.signal.aborted) { console.error(errorSummary(error)); process.exitCode = 1; }
} finally {
  try { await runner?.close(); }
  catch (error) { console.error(errorSummary(error)); process.exitCode ||= 1; }
  shutdown.dispose();
}
