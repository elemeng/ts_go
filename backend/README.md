# TS-SV Backend

CryoET Tilt Series Filtering and Inspection System - Backend API

## Installation

```bash
cd backend
pip install -e .
```

## Development Dependencies

```bash
pip install -e ".[dev]"
```

## Running

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Documentation

After starting the service, visit:

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Testing

```bash
pytest
```
