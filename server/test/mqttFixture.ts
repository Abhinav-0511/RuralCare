// Fixed MQTT accounts baked into the test broker's passwd/acl (see globalSetup.ts).
export const MQTT_TEST = {
  prefix: 'ruralcare/vitals',
  server: { username: 'test-server', password: 'server-pass-123' },
  deviceA: { username: 'test-dev-a', password: 'device-a-pass', patientId: '665f00000000000000000a01' },
  deviceB: { username: 'test-dev-b', password: 'device-b-pass', patientId: '665f00000000000000000b02' },
} as const;
