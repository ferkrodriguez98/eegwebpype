"""FastAPI app entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pype import __version__
from pype.routers import (
    batch,
    compare,
    detector,
    epochs,
    events,
    export,
    files,
    ica,
    sessions,
    workspace,
)
from pype.routers import config as config_router
from pype.schemas.health import Health

app = FastAPI(
    title="eegwebpype",
    version=__version__,
    description="Backend de preprocesamiento EEG basado en MNE-Python.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(workspace.router)
app.include_router(batch.router)
app.include_router(compare.router)
app.include_router(sessions.router)
app.include_router(events.router)
app.include_router(detector.router)
app.include_router(epochs.router)
app.include_router(export.router)
app.include_router(ica.router)
app.include_router(ica.ws_router)
app.include_router(files.router)
app.include_router(config_router.router)


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(ok=True, service="pype", version=__version__)
