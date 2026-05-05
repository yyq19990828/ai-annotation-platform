# How-to：新增 API 端点

## 完整流程（标准版）

```bash
# 1. 写路由 + 服务
apps/api/app/api/v1/<feature>.py
apps/api/app/services/<feature>_service.py
apps/api/app/schemas/<feature>.py

# 2. 写测试
apps/api/tests/test_<feature>.py

# 3. 跑测试
cd apps/api && uv run pytest tests/test_<feature>.py -v

# 4. 刷 OpenAPI snapshot
uv run python ../../scripts/export_openapi.py

# 5. 前端生成类型
cd ../web && pnpm codegen

# 6. 前端写包装
src/api/<feature>.ts

# 7. 提 PR：包含路由代码 + 测试 + snapshot 更新
```

## 1. 路由

```python
# apps/api/app/api/v1/widgets.py
from fastapi import APIRouter, Depends
from app.core.auth import current_user
from app.schemas.widgets import WidgetIn, WidgetOut
from app.services import widgets_service

router = APIRouter(prefix="/widgets", tags=["widgets"])


@router.post(
    "",
    response_model=WidgetOut,
    status_code=201,
    summary="创建 Widget",
    responses={
        400: {"description": "参数非法"},
        409: {"description": "重名冲突"},
    },
)
async def create_widget(
    payload: WidgetIn,
    user=Depends(current_user),
):
    """创建一个新的 Widget。

    业务规则：同一个 owner 下名字唯一；触发权限校验。
    """
    return await widgets_service.create(payload, owner_id=user.id)
```

要点：
- `summary` 一句话；`description` 是 docstring
- `responses={}` 显式声明非默认响应码 → OpenAPI 体现 → 前端类型完整

## 2. 服务

```python
# apps/api/app/services/widgets_service.py
async def create(payload: WidgetIn, *, owner_id: int) -> WidgetOut:
    async with db.session() as session:
        existing = await session.scalar(
            select(Widget).where(Widget.owner_id == owner_id, Widget.name == payload.name)
        )
        if existing:
            raise HTTPException(409, "name already exists")
        widget = Widget(owner_id=owner_id, **payload.model_dump())
        session.add(widget)
        await session.commit()
        return WidgetOut.model_validate(widget)
```

## 3. 测试

```python
# apps/api/tests/test_widgets.py
async def test_create_widget(httpx_client, project_admin):
    headers = {"Authorization": f"Bearer {project_admin['token']}"}
    res = await httpx_client.post(
        "/api/v1/widgets",
        json={"name": "demo", "color": "red"},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["name"] == "demo"


async def test_create_widget_conflict(httpx_client, project_admin):
    headers = {"Authorization": f"Bearer {project_admin['token']}"}
    payload = {"name": "dup", "color": "red"}
    await httpx_client.post("/api/v1/widgets", json=payload, headers=headers)
    res2 = await httpx_client.post("/api/v1/widgets", json=payload, headers=headers)
    assert res2.status_code == 409
```

## 4. snapshot 与前端类型

```bash
# 后端目录
cd apps/api
uv run python ../../scripts/export_openapi.py
# 验证 openapi 契约
uv run pytest tests/test_openapi_contract.py

# 前端目录
cd ../web
pnpm codegen
# generated/{types.gen.ts, sdk.gen.ts} 应包含新类型
```

## 5. 前端 wrapper

```ts
// apps/web/src/api/widgets.ts
import type { WidgetIn, WidgetOut } from "./generated/types.gen";
import { apiClient } from "./client";

export async function createWidget(payload: WidgetIn): Promise<WidgetOut> {
  const { data } = await apiClient.post<WidgetOut>("/api/v1/widgets", payload);
  return data;
}
```

## 6. PR 检查

- [ ] `pnpm openapi:check` 通过（snapshot 与代码一致）
- [ ] 后端测试覆盖正常路径 + 至少 1 个错误路径
- [ ] OpenAPI 中能看到新的 `summary` / `responses`
- [ ] 前端 generated 文件已提交
