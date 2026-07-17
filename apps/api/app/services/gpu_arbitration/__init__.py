"""GPU arbitration domain package.

This package groups the Redis ledger (P1) and, later, the orchestration modules (P2).
The package root deliberately stays minimal and does not eager-import dispatch,
membership, rollout-control or other high-level modules.
"""
