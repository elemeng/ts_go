from fastapi import APIRouter, HTTPException
from pathlib import Path
from typing import Literal
import os
import json
from datetime import datetime
from fastapi.responses import FileResponse

router = APIRouter()

# Config directory
CONFIG_DIR = Path.home() / ".ts_sv"
CONFIG_DIR.mkdir(exist_ok=True)


@router.get("/user-home")
async def get_user_home():
    """Get the user's home directory"""
    return {"home": str(Path.home())}


@router.get("/list")
async def list_directory(path: str = "/data"):
    """List directory contents"""
    try:
        # 确保路径是绝对路径
        if not os.path.isabs(path):
            path = os.path.abspath(path)

        dir_path = Path(path).resolve()

        # 注意：已移除安全检查，允许访问任意目录
        # 生产环境请根据需要重新添加安全检查

        if not dir_path.exists():
            raise HTTPException(status_code=404, detail=f"Directory not found: {path}")

        if not dir_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

        entries = []
        try:
            for item in dir_path.iterdir():
                item_type: Literal["dir", "file"] = "dir" if item.is_dir() else "file"
                entries.append({"name": item.name, "type": item_type})
        except PermissionError:
            raise HTTPException(status_code=403, detail=f"Permission denied: {path}")

        # 排序：目录在前，文件在后
        entries.sort(key=lambda x: (x["type"] != "dir", x["name"]))

        return {"path": str(dir_path), "entries": entries}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list directory: {str(e)}"
        )


@router.get("/validate")
async def validate_path(path: str):
    """Validate if a path exists and is accessible"""
    try:
        dir_path = Path(path).resolve()

        # Note: Security checks removed, allowing access to any directory
        # Please add security checks as needed for production

        if not dir_path.exists():
            return {"valid": False, "reason": "Path does not exist"}

        if not dir_path.is_dir():
            return {"valid": False, "reason": "Not a directory"}

        return {
            "valid": True,
            "path": str(dir_path),
            "writable": os.access(dir_path, os.W_OK),
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to validate path: {str(e)}"
        )


@router.post("/save-config")
async def save_config(config: dict):
    """Save scan configuration to ~/.ts_sv/"""
    try:
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"config_{timestamp}.json"
        config_path = CONFIG_DIR / filename

        # Save config
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

        return {"success": True, "path": str(config_path), "filename": filename}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save config: {str(e)}")


@router.get("/list-configs")
async def list_configs():
    """List all saved configurations"""
    try:
        config_files = []
        for file_path in CONFIG_DIR.glob("config_*.json"):
            config_files.append(file_path.name)

        # Sort by filename (which includes timestamp)
        config_files.sort(reverse=True)

        return {"configs": config_files}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list configs: {str(e)}")


@router.get("/load-config")
async def load_config(filename: str):
    """Load a specific configuration"""
    try:
        config_path = CONFIG_DIR / filename

        if not config_path.exists():
            raise HTTPException(status_code=404, detail=f"Config not found: {filename}")

        with open(config_path, "r") as f:
            config = json.load(f)

        return config
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {str(e)}")


@router.delete("/delete-config")
async def delete_config(filename: str):
    """Delete a specific configuration"""
    try:
        config_path = CONFIG_DIR / filename

        if not config_path.exists():
            raise HTTPException(status_code=404, detail=f"Config not found: {filename}")

        config_path.unlink()

        return {"success": True, "message": f"Deleted {filename}"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete config: {str(e)}"
        )


@router.get("/serve-config/{filename}")
async def serve_config(filename: str):
    """Serve a config file for loading via fetch"""
    try:
        config_path = CONFIG_DIR / filename

        if not config_path.exists():
            raise HTTPException(status_code=404, detail=f"Config not found: {filename}")

        return FileResponse(config_path, media_type="application/json")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve config: {str(e)}")
