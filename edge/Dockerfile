# MQTT vitals simulator. Mount infra/mosquitto/generated at /app/generated (devices.json is written by the seed).
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DEVICES_FILE=/app/generated/devices.json
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY simulator ./simulator
RUN useradd --create-home sim
USER sim
CMD ["python", "-m", "simulator", "run"]
