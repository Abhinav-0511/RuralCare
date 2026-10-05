import { MongoMemoryServer } from 'mongodb-memory-server';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { buildAclFile, buildPasswordFile } from '../src/vitals/mosquitto';
import { VitalsStore } from '../src/vitals/store';
import { MQTT_TEST } from './mqttFixture';

let mongod: MongoMemoryServer | undefined;
const containers: StartedTestContainer[] = [];

/**
 * MongoDB: in-memory. TimescaleDB + Mosquitto: real containers via Testcontainers (needs Docker).
 * Without Docker the vitals/MQTT tests are skipped, unless REQUIRE_DOCKER_TESTS=1 (CI), which fails.
 */
export async function setup(project: TestProject) {
  mongod = await MongoMemoryServer.create();
  project.provide('mongoUri', mongod.getUri());

  let tsdbUrl = '';
  let mqttUrl = '';
  try {
    const [timescale, mosquitto] = await Promise.all([startTimescale(), startMosquitto()]);
    tsdbUrl = `postgres://postgres:test@${timescale.getHost()}:${timescale.getMappedPort(5432)}/vitals`;
    mqttUrl = `mqtt://${mosquitto.getHost()}:${mosquitto.getMappedPort(1883)}`;
    // Migrate once here (test files run in parallel; concurrent CREATE ... IF NOT EXISTS can race).
    const store = VitalsStore.connect(tsdbUrl);
    await store.migrate();
    await store.close();
  } catch (err) {
    if (process.env.REQUIRE_DOCKER_TESTS) throw err;
    console.warn(`\n⚠️  Docker not available, skipping TimescaleDB/MQTT tests: ${(err as Error).message}\n`);
  }
  project.provide('tsdbUrl', tsdbUrl);
  project.provide('mqttUrl', mqttUrl);
}

async function startTimescale() {
  const c = await new GenericContainer('timescale/timescaledb:latest-pg16')
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'vitals' })
    .withExposedPorts(5432)
    // The init script restarts Postgres once, so wait for the second "ready" message.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(120_000)
    .start();
  containers.push(c);
  return c;
}

async function startMosquitto() {
  const { prefix, server, deviceA, deviceB } = MQTT_TEST;
  const devices = [deviceA, deviceB];
  const conf = [
    'listener 1883',
    'allow_anonymous false',
    'password_file /mosquitto/config/passwd',
    'acl_file /mosquitto/config/acl',
    'log_dest stdout',
  ].join('\n');
  const c = await new GenericContainer('eclipse-mosquitto:2')
    .withCopyContentToContainer([
      { content: conf + '\n', target: '/mosquitto/config/mosquitto.conf' },
      { content: buildPasswordFile([server, ...devices]), target: '/mosquitto/config/passwd', mode: 0o644 },
      {
        content: buildAclFile(prefix, server.username, devices),
        target: '/mosquitto/config/acl',
        mode: 0o644,
      },
    ])
    .withExposedPorts(1883)
    .withWaitStrategy(Wait.forLogMessage(/running/))
    .withStartupTimeout(60_000)
    .start();
  containers.push(c);
  return c;
}

export async function teardown() {
  await Promise.allSettled([mongod?.stop(), ...containers.map((c) => c.stop())]);
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
    tsdbUrl: string;
    mqttUrl: string;
  }
}
