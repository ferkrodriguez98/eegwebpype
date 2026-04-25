# pype — eegwebpype backend

FastAPI + MNE-Python.

## Setup

```bash
uv sync --extra dev
uv run uvicorn pype.main:app --reload --port 8000
```

## Tests

```bash
uv run pytest -q
```

## Lint & format

```bash
uv run ruff check .
uv run ruff format --check .
uv run pyright
```
