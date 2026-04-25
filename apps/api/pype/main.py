"""FastAPI app entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pype import __version__
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
)


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(ok=True, service="pype", version=__version__)
