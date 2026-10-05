# MQTT vitals simulator. Mount devices.json (from `npm run devices:provision`) at /app/devices.json.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DEVICES_FILE=/app/devices.json
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY simulator ./simulator
RUN useradd --create-home sim
USER sim
CMD ["python", "-m", "simulator", "run"]
