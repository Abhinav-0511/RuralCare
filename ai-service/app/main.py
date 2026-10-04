import logging
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import Settings
from app.model.conditions import load_conditions, load_triage_levels
from app.model.policy import most_severe, prediction_level
from app.model.predictor import Predictor
from app.safety import RedFlagEngine, TriageContext
from app.safety.red_flags import LocalizedText

log = logging.getLogger("ruralcare.ai")


class PossibleCondition(BaseModel):
    id: str
    probability: float
    triageLevel: str  # noqa: N815 (JSON key)
    name: LocalizedText
    advice: LocalizedText


class PredictResponse(BaseModel):
    level: Literal["EMERGENCY", "SEE_DOCTOR_24H", "SEE_DOCTOR_SOON", "SELF_CARE"]
    source: Literal["rule_engine", "model"]
    confidence: float | None
    lowConfidence: bool  # noqa: N815
    modelVersion: str  # noqa: N815
    rulesVersion: str  # noqa: N815
    topConditions: list[PossibleCondition]  # noqa: N815
    advice: LocalizedText
    disclaimer: LocalizedText
    redFlags: list[str]  # noqa: N815
    safetyFloors: list[str]  # noqa: N815
    unmodelledSymptoms: list[str]  # noqa: N815


class ModelVersionResponse(BaseModel):
    modelVersion: str  # noqa: N815
    algorithm: str
    createdAt: str  # noqa: N815
    sha256: str
    sizeBytes: int  # noqa: N815
    featureCount: int  # noqa: N815
    classCount: int  # noqa: N815


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    # Shared rules and texts must load: a broken file stops the service.
    red_flags = RedFlagEngine.from_shared_dir(settings.shared_dir)
    conditions = load_conditions(settings.shared_dir)
    levels = load_triage_levels(settings.shared_dir)
    # A missing/corrupt model does not stop the service: /predict answers 503 and the server
    # falls back to rules-only triage.
    try:
        predictor: Predictor | None = Predictor(settings.model_dir)
    except Exception:  # noqa: BLE001
        log.exception("Model could not be loaded from %s", settings.model_dir)
        predictor = None
    if predictor is not None:
        unknown = set(predictor.metadata.classes) - {c.id for c in conditions.conditions}
        if unknown:
            raise ValueError(f"Model classes missing from conditions.json: {sorted(unknown)}")

    app = FastAPI(title="RuralCare AI service", version="0.3.0")
    app.state.red_flags = red_flags
    app.state.predictor = predictor
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    def require_model() -> Predictor:
        if app.state.predictor is None:
            raise HTTPException(503, "Model not loaded")
        return app.state.predictor

    @app.get("/health")
    def health() -> dict:
        p = app.state.predictor
        return {
            "status": "ok",
            "service": "ruralcare-ai-service",
            "shared": {
                "redFlagRulesVersion": red_flags.rules_version,
                "redFlagRuleCount": len(red_flags.rules),
                "conditionsVersion": conditions.version,
            },
            "model": {"loaded": p is not None, "modelVersion": p.version if p else None},
        }

    @app.get("/model/version", response_model=ModelVersionResponse)
    def model_version() -> ModelVersionResponse:
        """Lets the PWA decide whether its cached model (same sha256) is current."""
        m = require_model().metadata
        return ModelVersionResponse(
            modelVersion=m.modelVersion,
            algorithm=m.algorithm,
            createdAt=m.createdAt,
            sha256=m.sha256,
            sizeBytes=m.sizeBytes,
            featureCount=len(m.features),
            classCount=len(m.classes),
        )

    @app.post("/predict", response_model=PredictResponse)
    def predict(ctx: TriageContext) -> PredictResponse:
        """Red-flag rules first (defence in depth: the server already checked), then model + policy."""
        predictor = require_model()
        rf = red_flags.evaluate(ctx)
        common = {
            "modelVersion": predictor.version,
            "rulesVersion": red_flags.rules_version,
            "disclaimer": levels.disclaimer,
            "safetyFloors": [f.id for f in rf.matched_floors],
        }
        if rf.is_emergency:
            return PredictResponse(
                level="EMERGENCY",
                source="rule_engine",
                confidence=None,
                lowConfidence=False,
                topConditions=[],
                advice=levels.advice("EMERGENCY"),
                redFlags=[r.id for r in rf.matched_rules],
                unmodelledSymptoms=[],
                **common,
            )

        ranking = predictor.rank(ctx.symptoms)
        result = prediction_level(
            ranking.ranked, ranking.known_feature_count, ranking.unmodelled_symptoms, conditions
        )
        level = most_severe(result.level, rf.minimum_level)  # safety floors, e.g. fever + unknown age
        top = ranking.ranked[: conditions.policy.topK]
        return PredictResponse(
            level=level,
            source="model",
            confidence=round(top[0].probability, 6) if ranking.known_feature_count else 0.0,
            lowConfidence=result.low_confidence,
            topConditions=[
                PossibleCondition(
                    id=c.id,
                    probability=round(c.probability, 6),
                    triageLevel=conditions.get(c.id).triageLevel,
                    name=conditions.get(c.id).name,
                    advice=conditions.get(c.id).advice,
                )
                for c in (top if ranking.known_feature_count else [])
            ],
            advice=levels.advice(level),
            redFlags=[],
            unmodelledSymptoms=ranking.unmodelled_symptoms,
            **common,
        )

    return app


app = create_app()
