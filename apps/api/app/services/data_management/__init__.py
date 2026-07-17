"""Data management domain package.

Groups the Data Manager service, task views, entity filters and shared query
primitives that were previously flat ``data_manager_*.py`` / ``task_views.py`` modules.
The package root stays minimal; callers import the concrete submodule they need.
"""
