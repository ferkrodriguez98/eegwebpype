"""Health check schema."""

from pydantic import BaseModel


class Health(BaseModel):
    ok: bool
    service: str
    version: str
