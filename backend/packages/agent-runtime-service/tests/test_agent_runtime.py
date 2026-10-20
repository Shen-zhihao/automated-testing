from agent_runtime.app import create_app
from fastapi.testclient import TestClient


def test_runtime_starts_without_execution_dependencies():
    with TestClient(create_app()) as client:
        response = client.get("/internal/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "agent-runtime", "mode": "prototype"}
        paths = client.get("/openapi.json").json()["paths"]
        assert set(paths) == {"/internal/health"}
        assert client.post("/internal/chat", json={}).status_code == 404
