#!/bin/sh
# Ensures the server account exists (from env) before Mosquitto starts, so the broker works before
# any device has been provisioned. Device accounts are added by `npm run devices:provision`.
set -eu
dir=/mosquitto/config/generated
mkdir -p "$dir"
touch "$dir/passwd"
mosquitto_passwd -b "$dir/passwd" "$MQTT_SERVER_USERNAME" "$MQTT_SERVER_PASSWORD"
if [ ! -s "$dir/acl" ]; then
  printf 'user %s\ntopic read ruralcare/vitals/#\ntopic read $SYS/#\n' "$MQTT_SERVER_USERNAME" > "$dir/acl"
fi
chmod 0600 "$dir/passwd" "$dir/acl" 2>/dev/null || true
chown mosquitto:mosquitto "$dir/passwd" "$dir/acl" 2>/dev/null || true
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
