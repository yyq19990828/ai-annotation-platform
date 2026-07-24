from __future__ import annotations

import pytest

from scripts.prepare_e2e_db import _validated_target_url


@pytest.mark.parametrize("database_name", ["annotation_e2e", "ANNOTATION_TEST"])
def test_validated_target_url_accepts_isolated_postgres_database(
    database_name: str,
):
    url = _validated_target_url(
        f"postgresql+asyncpg://user:pass@localhost:5432/{database_name}"
    )

    assert url.database == database_name


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+asyncpg://user:pass@localhost:5432/annotation",
        "postgresql+asyncpg://user:pass@localhost:5432/annotation_test_copy",
        "postgresql+asyncpg://user:pass@localhost:5432/",
        "postgresqlfake://user:pass@localhost:5432/annotation_test",
        "sqlite+aiosqlite:///annotation_test",
    ],
)
def test_validated_target_url_rejects_non_isolated_target(database_url: str):
    with pytest.raises(ValueError):
        _validated_target_url(database_url)
