from fastapi import APIRouter

from app.api.v1.dashboard import admin, annotator, reviewer

# 各受众子 router 在此聚合;/dashboard 前缀与 dashboard tag 仍在 router.py 的
# include_router 施加(对外路径/方法/response_model 与拆分前完全一致)。
router = APIRouter()
router.include_router(admin.router)
router.include_router(reviewer.router)
router.include_router(annotator.router)

__all__ = ["router"]
