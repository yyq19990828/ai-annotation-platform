from fastapi import APIRouter

router = APIRouter()


@router.get("/{task_id}")
async def get_task(task_id: str):
    return {"id": task_id, "status": "pending"}


@router.get("/{task_id}/annotations")
async def get_annotations(task_id: str):
    return []


@router.post("/{task_id}/annotations")
async def create_annotation(task_id: str, data: dict):
    return {"id": "new-annotation", "task_id": task_id}


@router.post("/{task_id}/submit")
async def submit_task(task_id: str):
    return {"status": "submitted", "task_id": task_id}
