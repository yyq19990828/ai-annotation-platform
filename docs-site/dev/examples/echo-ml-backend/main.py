"""Echo ML backend — 协议参考实现（最小可跑版）。

满足 ml-backend-protocol §1-3 的 4 个端点：/health、/setup、/versions、/predict。
所有 /predict 输出固定的 demo bbox，让平台端到端链路可以直接走通。
真实 backend 的 inference 替换到 predict() 内部即可。
"""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class TaskItem(BaseModel):
    id: str
    file_path: str


class PredictRequest(BaseModel):
    tasks: list[TaskItem]


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/setup")
async def setup():
    return {"name": "echo-backend", "labels": ["demo"], "is_interactive": False}


@app.get("/versions")
async def versions():
    return {"versions": ["v0.0.1"]}


@app.post("/predict")
async def predict(req: PredictRequest):
    results = []
    for t in req.tasks:
        results.append(
            {
                "task": t.id,
                "result": [
                    {
                        "type": "rectanglelabels",
                        "value": {
                            "x": 0.1,
                            "y": 0.1,
                            "width": 0.2,
                            "height": 0.2,
                            "rectanglelabels": ["demo"],
                        },
                        "score": 0.5,
                    }
                ],
                "score": 0.5,
                "model_version": "v0.0.1",
                "inference_time_ms": 1,
            }
        )
    return {"results": results}
