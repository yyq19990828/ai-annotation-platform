from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.v1.router import api_router
from app.api.v1.ws import router as ws_router
from app.middleware.audit import AuditMiddleware
from app.services.storage import storage_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage_service.ensure_all_buckets()
    yield


app = FastAPI(title=settings.app_name, version="0.4.7", lifespan=lifespan)

# 中间件注册顺序：先注册 → 后执行（dispatch 包装）。
# AuditMiddleware 在 CORS 之后注册，保证 CORS preflight 不被审计。
app.add_middleware(AuditMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.4.7"}
