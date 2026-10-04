from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# ai-service/app/config.py -> ai-service/ and the repo root. In Docker, SHARED_DIR=/shared and
# the model lives in /app/models (= AI_SERVICE_DIR / "models").
AI_SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_SERVICE_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    log_level: str = "info"
    shared_dir: Path = REPO_ROOT / "shared"
    model_dir: Path = AI_SERVICE_DIR / "models"
    cors_origins: str = "http://localhost:4000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
