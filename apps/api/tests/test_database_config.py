from app.config import Settings


def test_migration_database_url_defaults_to_runtime_connection():
    runtime_url = "postgresql+asyncpg://runtime:secret@db:5432/annotation"
    configured = Settings(
        _env_file=None,
        database_url=runtime_url,
        migration_database_url=None,
    )

    assert configured.effective_migration_database_url == runtime_url


def test_migration_database_url_can_use_schema_owner_connection():
    runtime_url = "postgresql+asyncpg://runtime:secret@db:5432/annotation"
    migration_url = "postgresql+asyncpg://owner:secret@db:5432/annotation"
    configured = Settings(
        _env_file=None,
        database_url=runtime_url,
        migration_database_url=migration_url,
    )

    assert configured.effective_migration_database_url == migration_url


def test_blank_migration_database_url_does_not_retain_owner_connection():
    runtime_url = "postgresql+asyncpg://runtime:secret@db:5432/annotation"
    configured = Settings(
        _env_file=None,
        database_url=runtime_url,
        migration_database_url="",
    )

    assert configured.migration_database_url == ""
    assert configured.effective_migration_database_url == runtime_url
