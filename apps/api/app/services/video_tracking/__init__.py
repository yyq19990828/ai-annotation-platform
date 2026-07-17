"""Video tracking domain package.

Groups the tracker adapters, job service and runner that were previously flat
``video_tracker_*.py`` modules. The package root stays minimal; callers import the
concrete submodule they need (e.g. ``from app.services.video_tracking.jobs import
create_tracker_job``).
"""
