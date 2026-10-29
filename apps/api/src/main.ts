import { ConfigError, loadConfig } from '@netflex/config';
import { createApp } from './app.factory.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    // Config errors never contain secret values (see packages/config).
    process.stderr.write(`${e instanceof ConfigError ? e.message : 'Invalid configuration'}\n`);
    process.exit(1);
  }
  const app = await createApp(config);
  await app.listen(config.API_PORT);
}

void main();
