from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# ai-service/app/config.py -> repo root. In Docker, SHARED_DIR=/shared is set by the Dockerfile.
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    log_level: str = "info"
    shared_dir: Path = REPO_ROOT / "shared"
    cors_origins: str = "http://localhost:4000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
