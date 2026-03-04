# 🧊 CryoET Tilt Series Viewer

A modern, full-stack web application for **Cryo-ET tilt series filtering, inspection, and visualization**.
Built with **SvelteKit + DaisyUI** on the frontend and **FastAPI** on the backend.

![Frontend](https://img.shields.io/badge/frontend-SvelteKit%20%2B%20DaisyUI-blue)
![Backend](https://img.shields.io/badge/backend-FastAPI-green)
![License](https://img.shields.io/badge/license-MIT-orange)

---

## ✨ Features

- **🔍 Tilt Series Curation**
  Browse, inspect, and curate Cryo-ET tilt series interactively.

- **🧠 Frame-level Selection**
  Select, invert, batch-apply, and persist frame selections.

- **🚀 Modern UI**
  Clean, responsive UI powered by DaisyUI + TailwindCSS.

- **⚡ High Performance**
  PNG caching, lazy loading, and efficient image encoding.

---

## 🚀 Quick Start

### Prerequisites

#### System Requirements

- **Node.js** 18+
- **Python** 3.12+
- **bun** – frontend package manager
  [https://bun.sh](https://bun.sh)
- **uv** – Python dependency & virtual environment manager
  [https://docs.astral.sh/uv/](https://docs.astral.sh/uv/)

> ⚠️ `deploy.sh` will **auto-check and install project dependencies**, but system tools (`bun`, `uv`, `python`) must already be installed.

---

### Clone the Repository

```bash
git clone https://github.com/elemeng/ts_go.git
cd ts_go
```

---

## 🧠 Smart Deployment Script (Recommended)

This project ships with a **single-file smart launcher** that manages:

- Frontend & backend processes
- Dependency installation
- Virtual environments (via `uv`)
- Safe restarts & shutdowns
- Logs and status inspection

### Show Help

```bash
sh deploy.sh -h
```

Output:

```
CryoET Tilt Series Viewer - Smart Service Management

Usage:
  deploy.sh [COMMAND] [SERVICE]

Commands:
  start [frontend|backend|all]    Start services (idempotent)
  stop  [frontend|backend|all]    Stop services (only if running)
  restart [frontend|backend|all]  Restart or start services
  status                          Show service status
  logs [frontend|backend|all]     View logs
  help                            Show this help

Smart Features:
  - Skips already-running services
  - Auto dependency installation
  - uv-managed virtual environment
  - Graceful shutdown & restart

Environment Variables:
  FRONTEND_PORT   (default: 5173)
  BACKEND_PORT    (default: 8000)
```

---

## ▶️ Start the Application

```bash
sh deploy.sh start
```

This will:

- Install frontend dependencies (via `bun`)
- Sync backend dependencies (via `uv`)
- Start backend API
- Start frontend Web UI

---

## 🌐 Access the Web UI

Once started, open your browser and visit:

```
http://localhost:5173
```

This is the **CryoET Tilt Series Viewer Web Interface**, where you can:

- Browse tilt series
- Inspect frames and angles
- Perform batch selections
- Apply and save curation results
---

### 🌐 Remote Access & WSL

**GPU Cluster / Remote Server:**  
When deploying on a remote GPU cluster and accessing from your local desktop:

Then access via the server's IP:
```
http://<server-ip>:5173
```
IF failed, check if backend/frontend are runing! IF true, check if Firewall allows ports for frontend/backend (default: `5173` and `8000`) 

**WSL2 Specific Notes:**
- **From Windows browser (same machine)**: `http://localhost:5173` works directly (Windows auto-forwards to WSL)
- **From another PC on the network**: Use the **Windows host IP address** (`http://<windows-ip>:5173`), not `localhost`.  
  > ⚠️ Ensure Windows Firewall allows inbound connections on ports `5173` and `8000`, and that your backend/frontend are bound to `0.0.0.0` as shown above.

### 🔁 Custom Ports

You can override default ports using environment variables:

```bash
FRONTEND_PORT=3000 BACKEND_PORT=9000 sh deploy.sh start
```

Then access the UI at:

```
http://localhost:3000
```

---

### 📚 Backend API & Docs

The backend API runs at:

```
http://localhost:8000
```

Interactive API documentation is available at:

```
http://localhost:8000/docs
```

(or your custom `BACKEND_PORT`)

---

## 🔄 Common Commands

### Restart Everything

```bash
sh deploy.sh restart
```

### Stop All Services

```bash
sh deploy.sh stop
```

### Check Status

```bash
sh deploy.sh status
```

### View Logs

```bash
sh deploy.sh logs frontend
sh deploy.sh logs backend
sh deploy.sh logs all
```

---

## 🎨 Development

### Frontend

```bash
# Type checking
bun run check

# Format code
bun run format

# Lint
bun run lint
```

---

### Backend (Manual Dev Mode)

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

---

## 📂 Project Structure

```
ts_go/
├── src/
│   ├── lib/
│   │   ├── components/     # Reusable Svelte components
│   │   ├── stores/         # Application state
│   │   └── assets/         # Static assets
│   └── routes/             # SvelteKit routes
│
├── backend/
│   ├── app/
│   │   ├── api/            # API endpoints
│   │   ├── cache/          # LRU cache
│   │   ├── image/          # Image processing
│   │   ├── matcher/        # Frame matching
│   │   ├── mdoc/           # MDOC parsing & writing
│   │   └── models/         # Pydantic models
│   ├── pyproject.toml
│   └── uv.lock
│
├── e2e/                    # End-to-end tests
└── deploy.sh               # Smart deployment script
```

---

## 🔧 Configuration

### Frontend

- `svelte.config.js` – SvelteKit configuration
- `vite.config.ts` – Vite build configuration
- `tailwind.config.js` – TailwindCSS & DaisyUI
- `playwright.config.ts` – E2E tests

### Backend

- `pyproject.toml` – Python dependencies
- `uv.lock` – Locked dependency graph (reproducible builds)

---

## 📚 API Overview

| Method | Endpoint                  | Description    |
| ------ | ------------------------- | -------------- |
| GET    | `/api/projects`           | List projects  |
| POST   | `/api/projects`           | Create project |
| GET    | `/api/files/{project_id}` | List files     |
| GET    | `/api/mdoc/{file_id}`     | MDOC metadata  |
| GET    | `/api/frame/{file_id}`    | Frame data     |
| GET    | `/api/preview/{file_id}`  | Image preview  |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch

   ```bash
   git checkout -b feature/my-feature
   ```

3. Commit changes

   ```bash
   git commit -m "Add amazing feature"
   ```

4. Push and open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](https://github.com/elemeng/ts_go/LICENSE) file for details.

---

## 🙏 Acknowledgments

- [SvelteKit](https://kit.svelte.dev/)
- [FastAPI](https://fastapi.tiangolo.com/)
- [DaisyUI](https://daisyui.com/)
- [TailwindCSS](https://tailwindcss.com/)
- [MDOC File](https://github.com/teamtomo/mdocfile)
- [MRC File](https://github.com/ccpem/mrcfile)

---

## 📞 Support

For bugs, questions, or ideas, please open an issue.
Contributions are welcome.

---

**Made with ❤️ for the Cryo-EM community**

---
