#!/bin/sh
# Starts Mosquitto and reloads it (SIGHUP) whenever the generated passwd/acl change, so device
# credentials written by the seed (or `npm run devices:provision`) take effect without a restart.
set -eu
dir=/mosquitto/config/generated
mkdir -p "$dir"
touch "$dir/passwd"

ensure_server_account() {
  # The server account always comes from the environment, so broker and server agree.
  mosquitto_passwd -b "$dir/passwd" "$MQTT_SERVER_USERNAME" "$MQTT_SERVER_PASSWORD"
  if [ ! -s "$dir/acl" ]; then
    printf 'user %s\ntopic read ruralcare/vitals/#\ntopic read $SYS/#\n' "$MQTT_SERVER_USERNAME" > "$dir/acl"
  fi
  chmod 0644 "$dir/passwd" "$dir/acl" 2>/dev/null || true
}
fingerprint() { cat "$dir/passwd" "$dir/acl" 2>/dev/null | md5sum; }

ensure_server_account
/usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null || true' TERM INT

last=$(fingerprint)
while kill -0 "$pid" 2>/dev/null; do
  sleep 2 &
  wait $! || true
  now=$(fingerprint)
  if [ "$now" != "$last" ]; then
    sleep 1 # let the writer finish all files
    ensure_server_account
    echo "entrypoint: credentials changed, reloading mosquitto"
    kill -HUP "$pid" 2>/dev/null || true
    last=$(fingerprint)
  fi
done
wait "$pid"
