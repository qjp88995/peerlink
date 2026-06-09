import { pino } from 'pino';

import { loadConfig } from './config';
import { SignalingServer } from './server';

const config = loadConfig();
const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty' },
});

const server = new SignalingServer(config, log);
void server.listen();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
