import { link, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, UUID } from './config.js';
import { privateDirectory, readJson } from './storage.js';

export function reportHandler(outputDirectory) {
  return async (event, { signal } = {}) => {
    signal?.throwIfAborted();
    if (!UUID.test(event.id ?? '')) throw new Error('A valid notification identity is required.');
    await privateDirectory(outputDirectory);
    // Only the notification identity determines this fixed output path.
    // Text, data, attachments, and action labels never select a command.
    const path = join(outputDirectory, `report-${digest(event.id)}.json`);
    const existing = await readJson(path);
    if (existing !== null) {
      if (existing.kind !== 'sample-order-summary' || existing.notification_id !== event.id) throw new Error('Existing report is inconsistent; refusing to overwrite it.');
      return { path, reused: true };
    }
    const orders = JSON.parse(await readFile(new URL('../fixtures/orders.json', import.meta.url), { encoding: 'utf8', signal }));
    if (!Array.isArray(orders) || orders.some((order) => !Number.isSafeInteger(order.total_cents) || order.total_cents < 0)) throw new Error('Sample order fixture is invalid.');
    const report = {
      kind: 'sample-order-summary', notification_id: event.id,
      order_count: orders.length, total_cents: orders.reduce((sum, order) => sum + order.total_cents, 0),
    };
    const temporary = join(outputDirectory, `.report-${randomUUID()}`);
    try {
      await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600, signal });
      signal?.throwIfAborted();
      // Atomic publish without overwriting an earlier report. A crash after
      // this point but before the receipt is safe: replay reuses the file.
      try { await link(temporary, path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const prior = await readJson(path);
        if (prior?.kind !== report.kind || prior?.notification_id !== event.id) throw new Error('Report output conflict.');
      }
      return { path, reused: false };
    } finally { await rm(temporary, { force: true }); }
  };
}
