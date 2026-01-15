# TS-SV Backend

CryoET Tilt Series 筛选与检查系统 - 后端 API

## 安装

```bash
cd backend
pip install -e .
```

## 开发依赖

```bash
pip install -e ".[dev]"
```

## 运行

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API 文档

启动服务后访问：

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 测试

```bash
pytest
```
