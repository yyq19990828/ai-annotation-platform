"""
批量导入本地图片到 MinIO 并创建 Task 记录。

用法：
    cd apps/api
    uv run python scripts/import_images.py /path/to/images --project P-0001

参数：
    image_dir     本地图片文件夹路径
    --project     项目 display_id（默认 P-0001）
    --limit       最多导入几张（默认全部）

支持格式：jpg, jpeg, png, bmp, webp, tiff
"""

import argparse
import asyncio
import mimetypes
import uuid
from pathlib import Path

import boto3
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select

from app.config import settings
from app.db.models.project import Project
from app.db.models.task import Task

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff", ".tif"}

engine = create_async_engine(settings.database_url, echo=False)
Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def get_s3_client():
    scheme = "https" if settings.minio_use_ssl else "http"
    return boto3.client(
        "s3",
        endpoint_url=f"{scheme}://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
    )


def ensure_bucket(client, bucket: str):
    try:
        client.head_bucket(Bucket=bucket)
    except Exception:
        client.create_bucket(Bucket=bucket)
        print(f"  创建 bucket: {bucket}")


async def import_images(image_dir: str, project_display_id: str, limit: int | None) -> None:
    folder = Path(image_dir)
    if not folder.is_dir():
        print(f"错误: {image_dir} 不是有效的文件夹")
        return

    images = sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )
    if not images:
        print(f"错误: {image_dir} 中未找到图片文件")
        return

    if limit:
        images = images[:limit]

    print(f"\n找到 {len(images)} 张图片，开始导入...\n")

    s3 = get_s3_client()
    ensure_bucket(s3, settings.minio_bucket)

    async with Session() as db:
        project = await db.scalar(
            select(Project).where(Project.display_id == project_display_id)
        )
        if not project:
            print(f"错误: 项目 {project_display_id} 不存在，请先运行 seed.py")
            return

        print(f"项目: {project.name} ({project.display_id})")
        print(f"类别: {project.classes}\n")

        imported = 0
        for i, img_path in enumerate(images):
            task_id = uuid.uuid4()
            storage_key = f"{project.id}/{task_id}/{img_path.name}"
            content_type = mimetypes.guess_type(img_path.name)[0] or "image/jpeg"

            s3.upload_file(
                str(img_path),
                settings.minio_bucket,
                storage_key,
                ExtraArgs={"ContentType": content_type},
            )

            task = Task(
                id=task_id,
                project_id=project.id,
                display_id=f"T-{str(task_id)[:6].upper()}",
                file_name=img_path.name,
                file_path=storage_key,
                file_type="image",
                status="pending",
                sequence_order=i,
            )
            db.add(task)
            imported += 1
            print(f"  [{imported:>3}/{len(images)}] {img_path.name} → {storage_key}")

        project.total_tasks = (project.total_tasks or 0) + imported
        await db.commit()

    await engine.dispose()
    print(f"\n导入完成: {imported} 张图片已上传到 MinIO 并创建 Task 记录")
    print(f"项目 {project_display_id} 总任务数已更新")


def main():
    parser = argparse.ArgumentParser(description="批量导入本地图片到标注平台")
    parser.add_argument("image_dir", help="本地图片文件夹路径")
    parser.add_argument("--project", default="P-0001", help="项目 display_id (默认 P-0001)")
    parser.add_argument("--limit", type=int, default=None, help="最多导入几张")
    args = parser.parse_args()
    asyncio.run(import_images(args.image_dir, args.project, args.limit))


if __name__ == "__main__":
    main()
