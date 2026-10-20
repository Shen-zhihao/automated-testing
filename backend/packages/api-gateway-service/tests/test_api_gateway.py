from api_gateway.app import create_app
from fastapi.testclient import TestClient


def test_gateway_starts_without_external_services():
    with TestClient(create_app()) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "api-gateway", "mode": "prototype"}
        paths = client.get("/openapi.json").json()["paths"]
        assert set(paths) == {"/api/health"}
        assert client.get("/api/agent/tasks").status_code == 404


def test_local_frontend_cors():
    with TestClient(create_app()) as client:
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        denied = client.options(
            "/api/health",
            headers={
                "Origin": "https://unconfigured.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert denied.status_code == 400
