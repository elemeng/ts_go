from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import mdoc, preview, project, ts, frame, files

app = FastAPI(
	title="TS-SV Backend API",
	description="CryoET Tilt Series Filtering and Inspection System - Backend API",
	version="0.0.1",
)

# CORS configuration
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],  # Should restrict to specific domains in production
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

# Register routes
app.include_router(mdoc.router, prefix="/api/mdoc", tags=["mdoc"])
app.include_router(preview.router, prefix="/api/preview", tags=["preview"])
app.include_router(project.router, prefix="/api/project", tags=["project"])
app.include_router(ts.router, prefix="/api/ts", tags=["ts"])
app.include_router(frame.router, prefix="/api/frame", tags=["frame"])
app.include_router(files.router, prefix="/api/files", tags=["files"])


@app.get("/health")
async def health_check():
	return {"status": "ok"}


@app.get("/")
async def root():
	return {
		"message": "TS-SV Backend API",
		"version": "0.0.1",
		"docs": "/docs",
		"redoc": "/redoc",
	}