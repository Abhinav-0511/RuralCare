# Build context: repo root (so /shared is available). See infra/docker-compose.yml.
# Serves the pre-trained model; training runs outside the container (Phase 3).
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SHARED_DIR=/shared
COPY ai-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/data /shared/data
COPY ai-service/app ./app
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
