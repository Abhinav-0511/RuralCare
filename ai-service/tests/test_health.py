from fastapi.testclient import TestClient

from app.main import create_app


def test_health_reports_shared_rules() -> None:
    client = TestClient(create_app())
    res = client.get("/health")

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["shared"]["redFlagRuleCount"] >= 8
    assert body["model"]["loaded"] is False
