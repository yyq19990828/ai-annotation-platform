"""头像图片读取端点。

``GET /api/v1/avatars/{token}`` 有意**免鉴权**:前端持 Bearer token(localStorage),
浏览器加载 ``<img src>`` 不会带 ``Authorization`` 头;而预签名 URL 会按时间窗变化,
不适合出现在几乎每个列表里的头像(会造成反复重下与解码)。

安全边界:URL 是 128 位随机 token 的「能力 URL」——持有 URL 即可读取该图片,但 token
不可枚举、URL 不含用户 ID 或任何 PII、响应只有图片字节、无写操作、不查库。头像本身对
全部登录用户可见,因此新增暴露面是「头像图片可被未登录者读取」,不是身份或权限泄露。
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request, Response

from app.services import avatar as avatar_service

router = APIRouter()

# 与 services/avatar.py 的 upload token 语法一致;不合法直接 404,不可能拼出其它 key。
_TOKEN_RE = re.compile(r"[0-9a-f]{32}")


@router.get("/{token}")
async def get_avatar(token: str, request: Request):
    if not _TOKEN_RE.fullmatch(token):
        raise HTTPException(status_code=404, detail="头像不存在")

    stored = avatar_service.read_avatar_object(token)
    if stored is None:
        raise HTTPException(status_code=404, detail="头像不存在")
    data, etag = stored

    if etag and request.headers.get("if-none-match") in {etag, f"W/{etag}"}:
        return Response(
            status_code=304,
            headers={
                "ETag": etag,
                "Cache-Control": avatar_service.AVATAR_CACHE_CONTROL,
            },
        )

    return Response(
        content=data,
        media_type="image/webp",
        headers={
            "Cache-Control": avatar_service.AVATAR_CACHE_CONTROL,
            **({"ETag": etag} if etag else {}),
        },
    )
