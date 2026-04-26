"""External read-only roots: scan + config endpoint."""

from __future__ import annotations

import importlib
import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient


def reload_all() -> None:
    from pype import config, main
    from pype.routers import config as config_router
    from pype.routers import files, sessions, workspace
    from pype.services import sessions as sess_svc
    from pype.services import workspace as ws_svc

    for mod in (config, ws_svc, sess_svc, workspace, sessions, files, config_router, main):
        importlib.reload(mod)


def test_scan_picks_up_external_root(synthetic_bdf: Path, tmp_path: Path) -> None:
    """A .bdf in an external root must appear in the workspace without copying."""
    from pype import config

    external = tmp_path / "external_data"
    external.mkdir()
    src_copy = external / "EXT01_MEV_D2_REST.fif"
    shutil.copy(synthetic_bdf, src_copy)

    # Write config.json BEFORE reload so load_external_roots picks it up.
    cfg_path = config.DATA_DIR / "config.json"
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps({"external_roots": [str(external)]}))

    reload_all()
    from pype.main import app

    client = TestClient(app)
    r = client.post("/api/workspace/scan")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["sessions"]]
    assert "TEST01_D1" in ids  # internal source
    assert "EXT01_D2" in ids  # external root
    # File path of EXT01 must point at the external location, NOT a copy.
    ext_session = next(s for s in r.json()["sessions"] if s["id"] == "EXT01_D2")
    assert ext_session["source_file"] == str(src_copy.resolve())


def test_external_roots_endpoint(synthetic_bdf: Path, tmp_path: Path) -> None:
    reload_all()
    from pype.main import app

    client = TestClient(app)
    external = tmp_path / "rest_data"
    external.mkdir()

    r = client.put("/api/config/external-roots", json={"external_roots": [str(external)]})
    assert r.status_code == 200
    assert r.json()["external_roots"] == [str(external.resolve())]

    r = client.get("/api/config/external-roots")
    assert r.json()["external_roots"] == [str(external.resolve())]


def test_external_roots_rejects_nonexistent(synthetic_bdf: Path) -> None:
    reload_all()
    from pype.main import app

    client = TestClient(app)
    r = client.put(
        "/api/config/external-roots",
        json={"external_roots": ["/this/does/not/exist/anywhere"]},
    )
    assert r.status_code == 400
