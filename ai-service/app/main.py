from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.safety import RedFlagEngine


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    # Load and validate the shared rules at startup: a broken rule file must stop the service.
    red_flags = RedFlagEngine.from_shared_dir(settings.shared_dir)

    app = FastAPI(title="RuralCare AI service", version="0.1.0")
    app.state.red_flags = red_flags
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "service": "ruralcare-ai-service",
            "shared": {
                "redFlagRulesVersion": red_flags.rules_version,
                "redFlagRuleCount": len(red_flags.rules),
            },
            # The triage model is trained and loaded in Phase 3.
            "model": {"loaded": False},
        }

    return app


app = create_app()
