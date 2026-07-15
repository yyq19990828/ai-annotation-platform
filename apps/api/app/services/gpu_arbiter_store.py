"""Redis-backed atomic runtime ledger for ADR-0049 GPU arbitration.

The store owns one async Redis client created in the current event loop. Callers must
close it before that loop exits; no client or connection pool is kept at module scope.
All scripts touch keys from one physical resource hash slot and never perform network
or database work while the atomic section is running.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import Enum
import hashlib
import json
import re
from typing import Any, Literal, TypeVar
import uuid

from redis.asyncio import Redis
from redis.exceptions import RedisError


_DEFAULT_NAMESPACE = "gpu-arbiter:v1"
_NAMESPACE_RE = re.compile(r"[A-Za-z0-9:._-]{1,160}\Z")
_CANONICAL_POSITIVE_INT64_RE = re.compile(r"[1-9][0-9]{0,18}\Z")
_MAX_POSITIVE_INT64 = 9_223_372_036_854_775_807
_MAX_REDIS_SAFE_INTEGER = 9_007_199_254_740_991
_LEDGER_REVISION_REBASE_THRESHOLD = _MAX_REDIS_SAFE_INTEGER - 2_000_000
_MAX_TTL_MS = 2_147_483_647
_MAX_GPU_BACKENDS_PER_RESOURCE = 64
_MAX_GPU_BACKEND_CONCURRENCY = 10_000
_MAX_GPU_QUEUE_LENGTH = 10_000
_REDIS_OPERATION_TIMEOUT_SECONDS = 1.0
_REDIS_CALL_DEADLINE_SECONDS = 2.0
_SNAPSHOT_MAX_ATTEMPTS = 32
_RedisResultT = TypeVar("_RedisResultT")
_COUNTED_ALLOCATION_STATES = frozenset(
    {
        "unknown",
        "reserving",
        "loading",
        "resident",
        "draining",
        "unloading",
    }
)


class GPUAllocationState(str, Enum):
    UNKNOWN = "unknown"
    UNLOADED = "unloaded"
    RESERVING = "reserving"
    LOADING = "loading"
    RESIDENT = "resident"
    DRAINING = "draining"
    UNLOADING = "unloading"
    CPU_FALLBACK = "cpu_fallback"


class GPURequestLeaseState(str, Enum):
    ACTIVE = "active"
    UNCERTAIN = "uncertain"
    STALE = "stale"


class GPUArbiterStoreError(RuntimeError):
    """The Redis ledger is unavailable, corrupt, or returned an invalid response."""


@dataclass(frozen=True)
class GPUArbiterKeys:
    resource_id: str
    resource_tag: str
    card: str
    allocations: str
    queue: str
    transition: str
    namespace: str

    def backend_queue(self, backend_id: str) -> str:
        return f"{self.namespace}:{{{self.resource_tag}}}:backend_queue:{backend_id}"

    def leases(self, backend_id: str) -> str:
        return f"{self.namespace}:{{{self.resource_tag}}}:leases:{backend_id}"


@dataclass(frozen=True)
class GPUAllocation:
    backend_id: str
    state: GPUAllocationState
    budget_mb: int
    generation: str
    eviction_priority: int
    evictable: bool
    max_concurrency: int
    reservation_lease_id: str | None
    reservation_owner_id: str | None
    last_used_at_ms: int

    @property
    def counted(self) -> bool:
        return self.state.value in _COUNTED_ALLOCATION_STATES


@dataclass(frozen=True)
class GPURequestLease:
    lease_id: str
    backend_id: str
    owner_id: str
    generation: str
    operation: str
    state: GPURequestLeaseState
    created_at_ms: int
    heartbeat_deadline_ms: int
    hard_deadline_ms: int


@dataclass(frozen=True)
class GPUAdmissionResult:
    status: Literal[
        "admitted",
        "not_ready",
        "capacity_unavailable",
        "concurrency_saturated",
        "concurrency_queued",
        "card_queued",
        "transition_in_progress",
        "stale_generation",
        "lease_conflict",
        "config_mismatch",
        "ledger_corrupt",
    ]
    reason: str
    committed_mb: int
    lease_count: int
    allocation_state: GPUAllocationState | None = None
    heartbeat_deadline_ms: int | None = None
    hard_deadline_ms: int | None = None
    idempotent: bool = False

    @property
    def admitted(self) -> bool:
        return self.status == "admitted"


@dataclass(frozen=True)
class GPUQueueResult:
    status: Literal[
        "queued",
        "cancelled",
        "missing",
        "full",
        "owner_mismatch",
        "ticket_conflict",
        "not_ready",
        "ledger_corrupt",
    ]
    ticket_id: str
    position: int | None = None
    expires_at_ms: int | None = None


@dataclass(frozen=True)
class GPUTransitionResult:
    status: Literal[
        "transitioned",
        "missing",
        "stale_generation",
        "invalid_transition",
        "active_leases",
        "owner_mismatch",
        "not_ready",
        "ledger_corrupt",
    ]
    state: GPUAllocationState | None
    generation: str | None
    committed_mb: int


@dataclass(frozen=True)
class GPUTransitionOwnerResult:
    status: Literal[
        "acquired",
        "renewed",
        "released",
        "busy",
        "missing",
        "owner_mismatch",
        "stale_generation",
        "operation_mismatch",
        "active_leases",
        "invalid_transition",
        "ledger_corrupt",
        "not_ready",
    ]
    owner_id: str | None = None
    generation: str | None = None
    expires_at_ms: int | None = None
    idempotent: bool = False


@dataclass(frozen=True)
class GPUReconcileLeaseCleanup:
    observed_idle_at_ms: int
    lease_ids: tuple[str, ...]


@dataclass(frozen=True)
class GPUReconcileResult:
    status: Literal[
        "reconciled",
        "not_ready",
        "stale_revision",
        "partial_state",
        "busy",
        "active_leases",
        "config_mismatch",
        "stale_generation",
        "ledger_corrupt",
    ]
    ready: bool
    ledger_revision: int
    ledger_incarnation: str
    committed_mb: int
    purged_leases: int = 0
    reason: str = ""
    idempotent: bool = False


@dataclass(frozen=True)
class GPULeaseMutationResult:
    status: Literal[
        "heartbeated",
        "uncertain",
        "released",
        "missing",
        "owner_mismatch",
        "stale_generation",
        "stale",
        "not_ready",
        "reservation_active",
    ]
    lease_state: GPURequestLeaseState | None = None
    heartbeat_deadline_ms: int | None = None
    hard_deadline_ms: int | None = None


@dataclass(frozen=True)
class GPUCardSnapshot:
    resource_id: str
    allocatable_mb: int
    ready: bool
    reconcile_deadline_ms: int
    ledger_revision: int
    ledger_incarnation: str
    committed_mb: int
    allocations: tuple[GPUAllocation, ...]
    leases: tuple[GPURequestLease, ...]


_MARK_CARD_NOT_READY_LUA = r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
if type(ARGV[5]) ~= 'string' or ARGV[5] == ''
   or string.len(ARGV[5]) > 128 then
  return cjson.encode({
    status='ledger_corrupt', reason='proposed_incarnation_invalid',
    ledger_revision=0, ledger_incarnation=''
  })
end
local existing_resource = redis.call('HGET', KEYS[1], 'resource_id')
local card_exists = redis.call('EXISTS', KEYS[1]) ~= 0
if existing_resource and existing_resource ~= ARGV[1] then
  return cjson.encode({
    status='ledger_corrupt', reason='resource_identity_mismatch',
    ledger_revision=0,
    ledger_incarnation=redis.call('HGET', KEYS[1], 'ledger_incarnation') or ''
  })
end
if card_exists and not existing_resource then
  return cjson.encode({
    status='ledger_corrupt', reason='resource_identity_missing',
    ledger_revision=0,
    ledger_incarnation=redis.call('HGET', KEYS[1], 'ledger_incarnation') or ''
  })
end
local revision_raw = redis.call('HGET', KEYS[1], 'ledger_revision')
if card_exists and not revision_raw then
  redis.call('HSET', KEYS[1],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_missing')
  return cjson.encode({
    status='ledger_corrupt', reason='ledger_revision_missing',
    ledger_revision=0,
    ledger_incarnation=redis.call('HGET', KEYS[1], 'ledger_incarnation') or ''
  })
end
if revision_raw and (not string.match(revision_raw, '^[1-9][0-9]*$')
    or string.len(revision_raw) > 16
    or (string.len(revision_raw) == 16
      and revision_raw > '9007199254740991')) then
  redis.call('HSET', KEYS[1],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_invalid')
  return cjson.encode({
    status='ledger_corrupt', reason='ledger_revision_invalid',
    ledger_revision=0,
    ledger_incarnation=redis.call('HGET', KEYS[1], 'ledger_incarnation') or ''
  })
end
local incarnation = redis.call('HGET', KEYS[1], 'ledger_incarnation')
if card_exists and (
    type(incarnation) ~= 'string' or incarnation == ''
    or string.len(incarnation) > 128) then
  redis.call('HSET', KEYS[1],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_incarnation_invalid')
  return cjson.encode({
    status='ledger_corrupt', reason='ledger_incarnation_invalid',
    ledger_revision=tonumber(revision_raw or '0') or 0,
    ledger_incarnation=''
  })
end
if revision_raw == '9007199254740991' then
  redis.call('HSET', KEYS[1],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_exhausted')
  return cjson.encode({
    status='ledger_corrupt', reason='ledger_revision_exhausted',
    ledger_revision=9007199254740991,
    ledger_incarnation=incarnation or ''
  })
end
local revision = redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
redis.call('HSET', KEYS[1],
  'resource_id', ARGV[1],
  'allocatable_mb', ARGV[2],
  'bootstrap_state', 'not_ready',
  'reconcile_deadline_ms', '0',
  'not_ready_reason', ARGV[3],
  'ledger_version', '1',
  'updated_at_ms', tostring(now_ms()))
redis.call('HSETNX', KEYS[1], 'committed_mb', '0')
redis.call('HSETNX', KEYS[1], 'backend_domain', '[]')
redis.call('HSETNX', KEYS[1], 'backend_domain_fingerprint', ARGV[4])
redis.call('HSETNX', KEYS[1], 'allocation_count', '0')
redis.call('HSETNX', KEYS[1], 'lease_counts', '{}')
redis.call('HSETNX', KEYS[1], 'card_queue_count', '0')
redis.call('HSETNX', KEYS[1], 'backend_queue_counts', '{}')
redis.call('HSETNX', KEYS[1], 'transition_mirror', '')
redis.call('HSETNX', KEYS[1], 'ledger_incarnation', ARGV[5])
return cjson.encode({
  status='not_ready', reason=ARGV[3], ledger_revision=revision,
  ledger_incarnation=redis.call('HGET', KEYS[1], 'ledger_incarnation'),
  committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0') or 0
})
"""


_RECONCILE_CARD_LUA = r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
end
local function valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end
local function generation_less(left, right)
  if string.len(left) ~= string.len(right) then
    return string.len(left) < string.len(right)
  end
  return left < right
end
local function valid_integer(value, minimum, maximum)
  return type(value) == 'number' and value == math.floor(value)
    and value >= minimum and value <= maximum
end
local valid_states = {
  unknown=true, unloaded=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true, cpu_fallback=true
}
local counted_states = {
  unknown=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true
}
local valid_lease_states = {active=true, uncertain=true, stale=true}
local function valid_lease(lease, lease_id, backend_id)
  return lease and lease.lease_id == lease_id and lease.backend_id == backend_id
    and type(lease.owner_id) == 'string' and lease.owner_id ~= ''
    and type(lease.operation) == 'string' and lease.operation ~= ''
    and valid_generation(lease.generation) and valid_lease_states[lease.state]
    and valid_integer(lease.created_at_ms, 1, 9007199254740991)
    and valid_integer(lease.heartbeat_deadline_ms, 1, 9007199254740991)
    and valid_integer(lease.hard_deadline_ms, 1, 9007199254740991)
    and lease.created_at_ms <= lease.heartbeat_deadline_ms
    and lease.heartbeat_deadline_ms <= lease.hard_deadline_ms
end
local function valid_allocation(item, backend_id)
  if type(item) ~= 'table' then return false end
  local reservation_state = item
    and (item.state == 'reserving' or item.state == 'loading')
  local has_reservation = item
    and type(item.reservation_lease_id) == 'string'
    and item.reservation_lease_id ~= ''
    and type(item.reservation_owner_id) == 'string'
    and item.reservation_owner_id ~= ''
  local reservation_present = item
    and (item.reservation_lease_id ~= nil
      or item.reservation_owner_id ~= nil)
  return item and item.backend_id == backend_id and valid_states[item.state]
    and valid_integer(item.budget_mb, 1, 9007199254740991)
    and valid_generation(item.generation)
    and valid_integer(item.eviction_priority, -9007199254740991, 9007199254740991)
    and type(item.evictable) == 'boolean'
    and valid_integer(item.max_concurrency, 1, 10000)
    and valid_integer(item.last_used_at_ms, 1, 9007199254740991)
    and (not reservation_state or has_reservation)
    and (reservation_state or not reservation_present)
end
local function read_queue(
    key, now, expected_kind, expected_backend_id, known_backends,
    expected_raw_count)
  local raw_count = redis.call('LLEN', key)
  if raw_count ~= expected_raw_count or raw_count > 10000 then
    return nil, raw_count
  end
  local entries = redis.call('LRANGE', key, 0, -1)
  local seen = {}
  local live_count = 0
  for _, raw in ipairs(entries) do
    local ticket = decode(raw)
    if not ticket
       or not valid_integer(ticket.expires_at_ms, 1, 9007199254740991)
       or not valid_integer(ticket.enqueued_at_ms, 1, 9007199254740991)
       or ticket.enqueued_at_ms > ticket.expires_at_ms
       or type(ticket.ticket_id) ~= 'string' or ticket.ticket_id == ''
       or type(ticket.owner_id) ~= 'string' or ticket.owner_id == ''
       or type(ticket.backend_id) ~= 'string' or ticket.backend_id == ''
       or ticket.kind ~= expected_kind
       or not known_backends[ticket.backend_id]
       or (expected_backend_id ~= ''
         and ticket.backend_id ~= expected_backend_id)
       or seen[ticket.ticket_id] then
      return nil, raw_count
    end
    seen[ticket.ticket_id] = true
    if ticket.expires_at_ms > now then live_count = live_count + 1 end
  end
  return live_count, raw_count
end

local function table_size(value)
  local count = 0
  for _, _ in pairs(value) do count = count + 1 end
  return count
end

local function allocations_equal(left, right)
  return left and right
    and left.backend_id == right.backend_id
    and left.state == right.state
    and left.budget_mb == right.budget_mb
    and left.generation == right.generation
    and left.eviction_priority == right.eviction_priority
    and left.evictable == right.evictable
    and left.max_concurrency == right.max_concurrency
    and left.reservation_lease_id == right.reservation_lease_id
    and left.reservation_owner_id == right.reservation_owner_id
    and left.last_used_at_ms == right.last_used_at_ms
end

local now = now_ms()
local requested_deadline = tonumber(ARGV[5])
local supplied_expected_revision = ARGV[2]
local supplied_expected_incarnation = ARGV[12]
local proposed_incarnation = ARGV[13]
local expected_revision = supplied_expected_revision
local expected_incarnation = supplied_expected_incarnation
local existing_resource = redis.call('HGET', KEYS[1], 'resource_id')
local current_incarnation = redis.call('HGET', KEYS[1], 'ledger_incarnation') or ''
local idempotent_retry = false
if type(proposed_incarnation) ~= 'string' or proposed_incarnation == ''
   or string.len(proposed_incarnation) > 128 then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, ledger_incarnation=current_incarnation, committed_mb=0, purged_leases=0, reason='proposed_incarnation_invalid'})
end
if (supplied_expected_revision == '') ~= (supplied_expected_incarnation == '') then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, ledger_incarnation=current_incarnation, committed_mb=0, purged_leases=0, reason='repair_cas_incomplete'})
end
if existing_resource == ARGV[1]
   and redis.call('HGET', KEYS[1], 'last_repair_id') == ARGV[6]
   and redis.call('HGET', KEYS[1], 'last_repair_fingerprint') == ARGV[9]
   and redis.call('HGET', KEYS[1], 'last_repair_expected_revision') == supplied_expected_revision
   and redis.call('HGET', KEYS[1], 'last_repair_expected_incarnation') == supplied_expected_incarnation then
  local marker_revision = redis.call('HGET', KEYS[1], 'last_repair_revision')
  local current_revision = redis.call('HGET', KEYS[1], 'ledger_revision')
  if not marker_revision or not string.match(marker_revision, '^[1-9][0-9]*$')
     or string.len(marker_revision) > 16
     or (string.len(marker_revision) == 16
       and marker_revision > '9007199254740991') then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, ledger_incarnation=current_incarnation, committed_mb=0, purged_leases=0, reason='last_repair_revision_invalid'})
  end
  if current_revision ~= marker_revision then
    return cjson.encode({status='stale_revision', ready=false, ledger_revision=tonumber(current_revision or '0') or 0, ledger_incarnation=current_incarnation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0') or 0, purged_leases=0, reason='ledger_changed_after_repair'})
  end
  if current_incarnation == '' or string.len(current_incarnation) > 128 then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(current_revision or '0') or 0, ledger_incarnation='', committed_mb=0, purged_leases=0, reason='ledger_incarnation_invalid'})
  end
  expected_revision = marker_revision
  expected_incarnation = current_incarnation
  idempotent_retry = true
end
if not idempotent_retry and expected_revision == '' then
  for i = 1, #KEYS do
    if redis.call('EXISTS', KEYS[i]) ~= 0 then
      return cjson.encode({status='partial_state', ready=false, ledger_revision=0, ledger_incarnation=current_incarnation, committed_mb=0, purged_leases=0, reason='bootstrap_keys_present'})
    end
  end
  current_incarnation = proposed_incarnation
end
if not idempotent_retry
   and (not valid_integer(requested_deadline, 1, 9007199254740991)
     or requested_deadline <= now or requested_deadline > now + 300000) then
  return cjson.encode({status='not_ready', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='reconcile_evidence_expired'})
end
if expected_revision ~= '' then
  if not existing_resource or existing_resource ~= ARGV[1] then
    return cjson.encode({status='not_ready', ready=false, ledger_revision=0, ledger_incarnation=current_incarnation, committed_mb=0, purged_leases=0, reason='card_missing_or_mismatched'})
  end
  local revision_raw = redis.call('HGET', KEYS[1], 'ledger_revision')
  if not revision_raw or not string.match(revision_raw, '^[1-9][0-9]*$')
     or string.len(revision_raw) > 16
     or (string.len(revision_raw) == 16
       and revision_raw > '9007199254740991') then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='ledger_revision_invalid'})
  end
  if revision_raw ~= expected_revision then
    return cjson.encode({status='stale_revision', ready=false, ledger_revision=tonumber(revision_raw), ledger_incarnation=current_incarnation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0'), purged_leases=0, reason='ledger_changed'})
  end
  if current_incarnation == '' or string.len(current_incarnation) > 128 then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(revision_raw), ledger_incarnation='', committed_mb=0, purged_leases=0, reason='ledger_incarnation_invalid'})
  end
  if current_incarnation ~= expected_incarnation then
    return cjson.encode({status='stale_revision', ready=false, ledger_revision=tonumber(revision_raw), ledger_incarnation=current_incarnation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0'), purged_leases=0, reason='ledger_incarnation_changed'})
  end
  local card_allocatable = tonumber(redis.call('HGET', KEYS[1], 'allocatable_mb') or '-1')
  local card_committed = tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '-1')
  local card_deadline = tonumber(redis.call('HGET', KEYS[1], 'reconcile_deadline_ms') or '-1')
  local card_updated_at = tonumber(redis.call('HGET', KEYS[1], 'updated_at_ms') or '-1')
  local allocation_count = tonumber(redis.call('HGET', KEYS[1], 'allocation_count') or '-1')
  local card_queue_count = tonumber(redis.call('HGET', KEYS[1], 'card_queue_count') or '-1')
  local bootstrap_state = redis.call('HGET', KEYS[1], 'bootstrap_state')
  if redis.call('HGET', KEYS[1], 'ledger_version') ~= '1'
     or not valid_integer(card_allocatable, 1, 9007199254740991)
     or not valid_integer(card_committed, 0, 9007199254740991)
     or not valid_integer(card_deadline, 0, 9007199254740991)
     or not valid_integer(card_updated_at, 1, 9007199254740991)
     or not valid_integer(allocation_count, 0, 9007199254740991)
     or not valid_integer(card_queue_count, 0, 9007199254740991)
     or (bootstrap_state ~= 'ready' and bootstrap_state ~= 'not_ready') then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(revision_raw), committed_mb=0, purged_leases=0, reason='card_schema_invalid'})
  end
end

local lease_keys = {}
local queue_keys = {}
local known_backends = {}
local initialize_domain = false
local key_index = 5
for i = 14, #ARGV do
  local backend_id = ARGV[i]
  if type(backend_id) ~= 'string' or backend_id == '' or known_backends[backend_id] then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='backend_domain_invalid'})
  end
  known_backends[backend_id] = true
  lease_keys[backend_id] = KEYS[key_index]
  queue_keys[backend_id] = KEYS[key_index + 1]
  key_index = key_index + 2
end
if key_index - 1 ~= #KEYS then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='backend_key_domain_invalid'})
end
local requested_domain = decode(ARGV[10])
if not requested_domain or #requested_domain > 64
   or #requested_domain ~= table_size(known_backends) then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='backend_domain_invalid'})
end
for index, backend_id in ipairs(requested_domain) do
  if ARGV[index + 13] ~= backend_id then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='backend_domain_invalid'})
  end
end
if expected_revision ~= '' then
  local stored_domain = redis.call('HGET', KEYS[1], 'backend_domain')
  local stored_fingerprint = redis.call('HGET', KEYS[1], 'backend_domain_fingerprint')
  initialize_domain = not idempotent_retry and ARGV[10] ~= '[]'
    and stored_domain == '[]'
    and redis.call('HGET', KEYS[1], 'bootstrap_state') == 'not_ready'
    and redis.call('HGET', KEYS[1], 'allocation_count') == '0'
    and redis.call('HGET', KEYS[1], 'committed_mb') == '0'
  if not initialize_domain
     and (stored_domain ~= ARGV[10] or stored_fingerprint ~= ARGV[11]) then
    return cjson.encode({status='config_mismatch', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=0, purged_leases=0, reason='backend_domain_changed'})
  end
  if initialize_domain then current_incarnation = proposed_incarnation end
end

local target_allocations = decode(ARGV[7])
local cleanup_evidence = decode(ARGV[8])
if not target_allocations or not cleanup_evidence then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='repair_payload_invalid'})
end
local target_by_backend = {}
local target_order = {}
for _, allocation in ipairs(target_allocations) do
  if type(allocation) ~= 'table'
     or not valid_allocation(allocation, allocation.backend_id)
     or not known_backends[allocation.backend_id]
     or target_by_backend[allocation.backend_id] then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='target_allocation_invalid'})
  end
  target_by_backend[allocation.backend_id] = allocation
  table.insert(target_order, allocation.backend_id)
end

local current_by_backend = {}
local current_count = 0
local current_committed = 0
if redis.call('HLEN', KEYS[2]) > 64 then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=0, purged_leases=0, reason='allocation_domain_exceeded'})
end
local allocation_entries = redis.call('HGETALL', KEYS[2])
for i = 1, #allocation_entries, 2 do
  local backend_id = allocation_entries[i]
  local allocation = decode(allocation_entries[i + 1])
  if not known_backends[backend_id]
     or not valid_allocation(allocation, backend_id) then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=0, purged_leases=0, reason='current_allocation_invalid'})
  end
  current_by_backend[backend_id] = allocation
  current_count = current_count + 1
  if counted_states[allocation.state] then
    current_committed = current_committed + allocation.budget_mb
  end
end
if expected_revision ~= '' then
  local cached_committed = tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '-1')
  local cached_count = tonumber(redis.call('HGET', KEYS[1], 'allocation_count') or '-1')
  if cached_committed ~= current_committed or cached_count ~= current_count then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='committed_cache_drift'})
  end
end

local leases_by_backend = {}
local lease_counts = {}
local cached_lease_counts = decode(redis.call('HGET', KEYS[1], 'lease_counts'))
if expected_revision ~= '' and not initialize_domain
   and (not cached_lease_counts or table_size(cached_lease_counts) ~= table_size(known_backends)) then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='lease_count_cache_invalid'})
end
for backend_id, lease_key in pairs(lease_keys) do
  local leases = {}
  local count = 0
  if redis.call('HLEN', lease_key) > 10000 then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='lease_domain_exceeded'})
  end
  local entries = redis.call('HGETALL', lease_key)
  for i = 1, #entries, 2 do
    local lease = decode(entries[i + 1])
    if not valid_lease(lease, entries[i], backend_id) then
      return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='lease_invalid'})
    end
    leases[entries[i]] = lease
    count = count + 1
  end
  if count > 0 and not current_by_backend[backend_id] then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='orphan_leases'})
  end
  if current_by_backend[backend_id]
     and count > current_by_backend[backend_id].max_concurrency then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='lease_domain_exceeded'})
  end
  leases_by_backend[backend_id] = leases
  lease_counts[backend_id] = count
  if expected_revision ~= '' and not initialize_domain
     and cached_lease_counts[backend_id] ~= count then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='lease_count_cache_drift'})
  end
end

local transition_raw = redis.call('GET', KEYS[4])
local transition_mirror = ''
if expected_revision ~= '' then
  transition_mirror = redis.call('HGET', KEYS[1], 'transition_mirror')
end
local transition_now = now_ms()
if expected_revision ~= '' and transition_mirror == false then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='transition_mirror_missing'})
end
if transition_raw then
  local transition = decode(transition_raw)
  if transition_raw ~= transition_mirror
     or not transition or transition.resource_id ~= ARGV[1]
     or not known_backends[transition.backend_id]
     or type(transition.owner_id) ~= 'string' or transition.owner_id == ''
     or not valid_generation(transition.generation)
     or type(transition.operation) ~= 'string' or transition.operation == ''
     or type(transition.require_idle) ~= 'boolean'
     or not valid_integer(transition.created_at_ms, 1, 9007199254740991)
     or not valid_integer(transition.expires_at_ms, 1, 9007199254740991) then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='transition_invalid'})
  end
  if transition.expires_at_ms > transition_now then
    local current_deadline = tonumber(
      redis.call('HGET', KEYS[1], 'reconcile_deadline_ms') or '0')
    local current_ready = redis.call('HGET', KEYS[1], 'bootstrap_state') == 'ready'
      and tonumber(expected_revision ~= '' and expected_revision or '0')
        < 9007199252740991
      and valid_integer(current_deadline, 1, 9007199254740991)
      and current_deadline > transition_now
      and current_deadline <= transition_now + 300000
    return cjson.encode({status='busy', ready=current_ready, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='transition_active'})
  end
elseif transition_mirror ~= '' then
  local mirrored_transition = decode(transition_mirror)
  if not mirrored_transition
     or not valid_integer(mirrored_transition.expires_at_ms, 1, 9007199254740991) then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='transition_mirror_invalid'})
  end
  if mirrored_transition.expires_at_ms > transition_now then
    return cjson.encode({status='partial_state', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='transition_key_missing_before_expiry'})
  end
end

local cached_card_queue_count = expected_revision ~= ''
  and tonumber(redis.call('HGET', KEYS[1], 'card_queue_count') or '-1') or 0
local cached_backend_queue_counts = expected_revision ~= ''
  and decode(redis.call('HGET', KEYS[1], 'backend_queue_counts')) or {}
if expected_revision ~= '' and not initialize_domain
   and (not cached_backend_queue_counts
     or table_size(cached_backend_queue_counts) ~= table_size(known_backends)) then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='backend_queue_count_cache_invalid'})
end
local total_queue_count = cached_card_queue_count
if not valid_integer(cached_card_queue_count, 0, 10000) then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='card_queue_count_invalid'})
end
for backend_id, _ in pairs(queue_keys) do
  local expected_count = (expected_revision == '' or initialize_domain) and 0
    or (cached_backend_queue_counts and cached_backend_queue_counts[backend_id])
  if not valid_integer(expected_count, 0, 10000) then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='backend_queue_count_invalid'})
  end
  total_queue_count = total_queue_count + expected_count
end
if total_queue_count > 10000 then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='queue_domain_exceeded'})
end

local card_queue_count, card_queue_raw_count = read_queue(
  KEYS[3], now, 'card', '', known_backends, cached_card_queue_count)
if card_queue_count == nil then
  return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='card_queue_invalid'})
end
if card_queue_count > 0 then
  local current_deadline = tonumber(
    redis.call('HGET', KEYS[1], 'reconcile_deadline_ms') or '0')
  local current_ready = redis.call('HGET', KEYS[1], 'bootstrap_state') == 'ready'
    and tonumber(expected_revision ~= '' and expected_revision or '0')
      < 9007199252740991
    and valid_integer(current_deadline, 1, 9007199254740991)
    and current_deadline > now and current_deadline <= now + 300000
  return cjson.encode({status='busy', ready=current_ready, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='card_queue_active'})
end
for backend_id, queue_key in pairs(queue_keys) do
  local expected_count = (expected_revision == '' or initialize_domain) and 0
    or cached_backend_queue_counts[backend_id]
  local queue_count, queue_raw_count = read_queue(
    queue_key, now, 'backend', backend_id, known_backends, expected_count)
  if queue_count == nil then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='backend_queue_invalid'})
  end
  if queue_count > 0 then
    local current_deadline = tonumber(
      redis.call('HGET', KEYS[1], 'reconcile_deadline_ms') or '0')
    local current_ready = redis.call('HGET', KEYS[1], 'bootstrap_state') == 'ready'
      and tonumber(expected_revision ~= '' and expected_revision or '0')
        < 9007199252740991
      and valid_integer(current_deadline, 1, 9007199254740991)
      and current_deadline > now and current_deadline <= now + 300000
    return cjson.encode({status='busy', ready=current_ready, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='backend_queue_active'})
  end
end

if idempotent_retry then
  if current_count ~= #target_order then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='idempotent_allocation_count_changed'})
  end
  for _, backend_id in ipairs(target_order) do
    if not allocations_equal(current_by_backend[backend_id], target_by_backend[backend_id]) then
      return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='idempotent_allocation_changed'})
    end
  end
  for backend_id, evidence in pairs(cleanup_evidence) do
    if not known_backends[backend_id] or type(evidence) ~= 'table'
       or type(evidence.lease_ids) ~= 'table' then
      return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='cleanup_evidence_invalid'})
    end
    for _, lease_id in ipairs(evidence.lease_ids) do
      if leases_by_backend[backend_id][lease_id] then
        return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision), committed_mb=current_committed, purged_leases=0, reason='idempotent_cleanup_not_applied'})
      end
    end
  end
  local deadline = tonumber(redis.call('HGET', KEYS[1], 'reconcile_deadline_ms') or '0')
  local effective_ready = redis.call('HGET', KEYS[1], 'bootstrap_state') == 'ready'
    and tonumber(expected_revision) < 9007199252740991
    and valid_integer(deadline, 1, 9007199254740991) and deadline > now
  return cjson.encode({
    status=effective_ready and 'reconciled' or 'not_ready', ready=effective_ready,
    ledger_revision=tonumber(expected_revision),
    ledger_incarnation=current_incarnation, committed_mb=current_committed,
    purged_leases=0, reason=effective_ready and '' or 'reconcile_expired',
    idempotent=true
  })
end

local purge_sets = {}
local purge_count = 0
for backend_id, evidence in pairs(cleanup_evidence) do
  if not known_backends[backend_id] or type(evidence) ~= 'table'
     or not valid_integer(evidence.observed_idle_at_ms, 1, 9007199254740991)
     or evidence.observed_idle_at_ms > now + 60000
     or type(evidence.lease_ids) ~= 'table' then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='cleanup_evidence_invalid'})
  end
  local purge_set = {}
  for _, lease_id in ipairs(evidence.lease_ids) do
    local lease = leases_by_backend[backend_id] and leases_by_backend[backend_id][lease_id]
    local allocation = current_by_backend[backend_id]
    if type(lease_id) ~= 'string' or lease_id == '' or purge_set[lease_id]
       or not lease or lease.state ~= 'stale'
       or lease.hard_deadline_ms > now
       or lease.hard_deadline_ms > evidence.observed_idle_at_ms
       or (allocation and (allocation.state == 'reserving' or allocation.state == 'loading')
           and allocation.reservation_lease_id == lease_id) then
      return cjson.encode({status='active_leases', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), committed_mb=current_committed, purged_leases=0, reason='lease_not_safe_to_purge'})
    end
    purge_set[lease_id] = true
    purge_count = purge_count + 1
    lease_counts[backend_id] = lease_counts[backend_id] - 1
  end
  purge_sets[backend_id] = purge_set
end

for backend_id, current in pairs(current_by_backend) do
  if not target_by_backend[backend_id] then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), committed_mb=current_committed, purged_leases=0, reason='allocation_removal_forbidden'})
  end
end

local committed = 0
for _, backend_id in ipairs(target_order) do
  local target = target_by_backend[backend_id]
  local current = current_by_backend[backend_id]
  if not current then
    if target.state ~= 'unknown' and target.state ~= 'unloaded'
       and target.state ~= 'cpu_fallback' then
      return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='unsafe_bootstrap_state'})
    end
  else
    if generation_less(target.generation, current.generation) then
      return cjson.encode({status='stale_generation', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), committed_mb=current_committed, purged_leases=0, reason='generation_regression'})
    end
    local config_changed = target.budget_mb ~= current.budget_mb
      or target.eviction_priority ~= current.eviction_priority
      or target.evictable ~= current.evictable
      or target.max_concurrency ~= current.max_concurrency
    if config_changed and counted_states[current.state] then
      return cjson.encode({status='config_mismatch', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), committed_mb=current_committed, purged_leases=0, reason='counted_allocation_config_changed'})
    end
    if target.last_used_at_ms < current.last_used_at_ms then
      return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), committed_mb=current_committed, purged_leases=0, reason='last_used_regression'})
    end
  end
  if target.state == 'unknown' and target.evictable then
    return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='unknown_cannot_be_evictable'})
  end
  if target.state == 'reserving' or target.state == 'loading' then
    local reservation = leases_by_backend[backend_id]
      and leases_by_backend[backend_id][target.reservation_lease_id]
    local purged = purge_sets[backend_id]
      and purge_sets[backend_id][target.reservation_lease_id]
    if not current or not reservation or purged
       or reservation.owner_id ~= target.reservation_owner_id
       or reservation.generation ~= target.generation then
      return cjson.encode({status='ledger_corrupt', ready=false, ledger_revision=0, committed_mb=current_committed, purged_leases=0, reason='reservation_lease_mismatch'})
    end
  end
  if not counted_states[target.state]
     and (lease_counts[backend_id] or 0) > 0 then
    return cjson.encode({status='active_leases', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), committed_mb=current_committed, purged_leases=0, reason='leases_prevent_release'})
  end
  if (lease_counts[backend_id] or 0) > target.max_concurrency then
    return cjson.encode({status='config_mismatch', ready=false, ledger_revision=tonumber(expected_revision ~= '' and expected_revision or '0'), ledger_incarnation=current_incarnation, committed_mb=current_committed, purged_leases=0, reason='lease_concurrency_exceeded'})
  end
  if counted_states[target.state] then committed = committed + target.budget_mb end
end

for backend_id, purge_set in pairs(purge_sets) do
  for lease_id, _ in pairs(purge_set) do
    redis.call('HDEL', lease_keys[backend_id], lease_id)
  end
end
for _, backend_id in ipairs(target_order) do
  redis.call('HSET', KEYS[2], backend_id, cjson.encode(target_by_backend[backend_id]))
end
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[4])
local backend_queue_counts = {}
for backend_id, queue_key in pairs(queue_keys) do
  redis.call('DEL', queue_key)
  backend_queue_counts[backend_id] = 0
end

local ready = ARGV[4] == '1'
local reason = ''
if committed > tonumber(ARGV[3]) then
  ready = false
  reason = 'committed_exceeds_allocatable'
end
local deadline = 0
if ready then deadline = requested_deadline end
local rebase_revision = expected_revision ~= ''
  and tonumber(expected_revision) >= 9007199252740990
local revision = 1
if rebase_revision then
  current_incarnation = proposed_incarnation
  redis.call('HSET', KEYS[1], 'ledger_revision', '1')
else
  revision = redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
end
redis.call('HSET', KEYS[1],
  'resource_id', ARGV[1],
  'allocatable_mb', ARGV[3],
  'bootstrap_state', ready and 'ready' or 'not_ready',
  'reconcile_deadline_ms', tostring(deadline),
  'not_ready_reason', reason,
  'ledger_version', '1',
  'ledger_incarnation', current_incarnation,
  'committed_mb', tostring(committed),
  'backend_domain', ARGV[10],
  'backend_domain_fingerprint', ARGV[11],
  'allocation_count', tostring(#target_order),
  'lease_counts', cjson.encode(lease_counts),
  'card_queue_count', '0',
  'backend_queue_counts', cjson.encode(backend_queue_counts),
  'transition_mirror', '',
  'last_repair_id', ARGV[6],
  'last_repair_fingerprint', ARGV[9],
  'last_repair_expected_revision', supplied_expected_revision,
  'last_repair_expected_incarnation', supplied_expected_incarnation,
  'last_repair_revision', tostring(revision),
  'updated_at_ms', tostring(now))
return cjson.encode({
  status=ready and 'reconciled' or 'not_ready', ready=ready,
  ledger_revision=revision, ledger_incarnation=current_incarnation,
  committed_mb=committed,
  purged_leases=purge_count, reason=reason, idempotent=idempotent_retry
})
"""


_LEDGER_INTEGRITY_LUA = r"""
local function integrity_now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
local function integrity_decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
end
local function integrity_valid_integer(value, minimum, maximum)
  return type(value) == 'number' and value == math.floor(value)
    and value >= minimum and value <= maximum
end
local function integrity_valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end
local function integrity_valid_revision(value)
  if type(value) ~= 'string'
     or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 16 then return true end
  if string.len(value) > 16 then return false end
  return value < '9007199254740991'
end
local function integrity_has_revision_headroom(value)
  return integrity_valid_revision(value)
    and tonumber(value) < 9007199252740991
end
local function integrity_allows_heartbeat(value)
  return integrity_valid_revision(value)
    and tonumber(value) < 9007199253990991
end
local integrity_valid_states = {
  unknown=true, unloaded=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true, cpu_fallback=true
}
local integrity_counted_states = {
  unknown=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true
}
local integrity_valid_lease_states = {active=true, uncertain=true, stale=true}
local function integrity_valid_allocation(item, backend_id)
  local reservation_state = item
    and (item.state == 'reserving' or item.state == 'loading')
  local has_reservation = item
    and type(item.reservation_lease_id) == 'string'
    and item.reservation_lease_id ~= ''
    and type(item.reservation_owner_id) == 'string'
    and item.reservation_owner_id ~= ''
  local reservation_present = item
    and (item.reservation_lease_id ~= nil
      or item.reservation_owner_id ~= nil)
  return item and item.backend_id == backend_id
    and integrity_valid_states[item.state]
    and integrity_valid_integer(item.budget_mb, 1, 9007199254740991)
    and integrity_valid_generation(item.generation)
    and integrity_valid_integer(item.eviction_priority, -9007199254740991, 9007199254740991)
    and type(item.evictable) == 'boolean'
    and integrity_valid_integer(item.max_concurrency, 1, 10000)
    and integrity_valid_integer(item.last_used_at_ms, 1, 9007199254740991)
    and (not reservation_state or has_reservation)
    and (reservation_state or not reservation_present)
end
local function integrity_valid_lease(lease, lease_id, backend_id)
  return lease and lease.lease_id == lease_id and lease.backend_id == backend_id
    and type(lease.owner_id) == 'string' and lease.owner_id ~= ''
    and type(lease.operation) == 'string' and lease.operation ~= ''
    and integrity_valid_generation(lease.generation)
    and integrity_valid_lease_states[lease.state]
    and integrity_valid_integer(lease.created_at_ms, 1, 9007199254740991)
    and integrity_valid_integer(lease.heartbeat_deadline_ms, 1, 9007199254740991)
    and integrity_valid_integer(lease.hard_deadline_ms, 1, 9007199254740991)
    and lease.created_at_ms <= lease.heartbeat_deadline_ms
    and lease.heartbeat_deadline_ms <= lease.hard_deadline_ms
end
local function integrity_table_size(value)
  local count = 0
  for _, _ in pairs(value) do count = count + 1 end
  return count
end
local function integrity_fault(resource_id, reason, now)
  if redis.call('HGET', KEYS[1], 'resource_id') == resource_id then
    local revision = redis.call('HGET', KEYS[1], 'ledger_revision')
    if integrity_valid_revision(revision) then
      redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
    end
    redis.call('HSET', KEYS[1],
      'bootstrap_state', 'not_ready',
      'reconcile_deadline_ms', '0',
      'not_ready_reason', reason,
      'updated_at_ms', tostring(now))
  end
end
local function integrity_valid_ticket(
    ticket, expected_kind, expected_backend_id, known_backends)
  return ticket
    and integrity_valid_integer(ticket.expires_at_ms, 1, 9007199254740991)
    and integrity_valid_integer(ticket.enqueued_at_ms, 1, 9007199254740991)
    and ticket.enqueued_at_ms <= ticket.expires_at_ms
    and type(ticket.ticket_id) == 'string' and ticket.ticket_id ~= ''
    and type(ticket.owner_id) == 'string' and ticket.owner_id ~= ''
    and type(ticket.backend_id) == 'string' and ticket.backend_id ~= ''
    and ticket.kind == expected_kind
    and known_backends[ticket.backend_id]
    and (expected_backend_id == '' or ticket.backend_id == expected_backend_id)
end
local function inspect_ledger(
    resource_id, domain_raw, domain_fingerprint, expected_incarnation,
    require_ready, focus_backend_id)
  local now = integrity_now_ms()
  if redis.call('HGET', KEYS[1], 'resource_id') ~= resource_id then
    return nil, 'not_ready', 'card_missing_or_mismatched'
  end
  local ledger_incarnation = redis.call('HGET', KEYS[1], 'ledger_incarnation')
  if type(ledger_incarnation) ~= 'string' or ledger_incarnation == ''
     or string.len(ledger_incarnation) > 128 then
    integrity_fault(resource_id, 'ledger_incarnation_invalid', now)
    return nil, 'ledger_corrupt', 'ledger_incarnation_invalid'
  end
  if ledger_incarnation ~= expected_incarnation then
    return nil, 'not_ready', 'ledger_incarnation_changed'
  end
  local domain = integrity_decode(domain_raw)
  if not domain or #domain > 64
     or redis.call('HGET', KEYS[1], 'backend_domain') ~= domain_raw
     or redis.call('HGET', KEYS[1], 'backend_domain_fingerprint') ~= domain_fingerprint
     or #KEYS ~= 4 + (#domain * 2) then
    integrity_fault(resource_id, 'backend_domain_invalid', now)
    return nil, 'ledger_corrupt', 'backend_domain_invalid'
  end
  local known_backends = {}
  local lease_keys = {}
  local queue_keys = {}
  for index, backend_id in ipairs(domain) do
    if type(backend_id) ~= 'string' or backend_id == ''
       or known_backends[backend_id] then
      integrity_fault(resource_id, 'backend_domain_invalid', now)
      return nil, 'ledger_corrupt', 'backend_domain_invalid'
    end
    known_backends[backend_id] = true
    lease_keys[backend_id] = KEYS[3 + (index * 2)]
    queue_keys[backend_id] = KEYS[4 + (index * 2)]
  end
  if integrity_table_size(known_backends) ~= #domain then
    integrity_fault(resource_id, 'backend_domain_invalid', now)
    return nil, 'ledger_corrupt', 'backend_domain_invalid'
  end

  local allocatable = tonumber(redis.call('HGET', KEYS[1], 'allocatable_mb') or '-1')
  local ledger_revision = redis.call('HGET', KEYS[1], 'ledger_revision')
  local cached_committed = tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '-1')
  local cached_allocation_count = tonumber(redis.call('HGET', KEYS[1], 'allocation_count') or '-1')
  local deadline = tonumber(redis.call('HGET', KEYS[1], 'reconcile_deadline_ms') or '-1')
  if redis.call('HGET', KEYS[1], 'ledger_version') ~= '1'
     or not integrity_valid_revision(ledger_revision)
     or not integrity_valid_integer(allocatable, 1, 9007199254740991)
     or not integrity_valid_integer(cached_committed, 0, 9007199254740991)
     or not integrity_valid_integer(cached_allocation_count, 0, 9007199254740991)
     or not integrity_valid_integer(deadline, 0, 9007199254740991) then
    integrity_fault(resource_id, 'card_schema_invalid', now)
    return nil, 'ledger_corrupt', 'card_schema_invalid'
  end
  if deadline > now + 300000 then
    integrity_fault(resource_id, 'reconcile_deadline_invalid', now)
    return nil, 'ledger_corrupt', 'reconcile_deadline_invalid'
  end
  if require_ready and (
      redis.call('HGET', KEYS[1], 'bootstrap_state') ~= 'ready'
      or deadline < 1 or deadline <= now) then
    return nil, 'not_ready', 'reconcile_expired'
  end

  local allocations = {}
  local committed = 0
  local allocation_count = 0
  if redis.call('HLEN', KEYS[2]) > 64 then
    integrity_fault(resource_id, 'allocation_domain_exceeded', now)
    return nil, 'ledger_corrupt', 'allocation_domain_exceeded'
  end
  local allocation_entries = redis.call('HGETALL', KEYS[2])
  for index = 1, #allocation_entries, 2 do
    local backend_id = allocation_entries[index]
    local allocation = integrity_decode(allocation_entries[index + 1])
    if not known_backends[backend_id]
       or not integrity_valid_allocation(allocation, backend_id) then
      integrity_fault(resource_id, 'allocation_invalid', now)
      return nil, 'ledger_corrupt', 'allocation_invalid'
    end
    allocations[backend_id] = allocation
    allocation_count = allocation_count + 1
    if integrity_counted_states[allocation.state] then
      committed = committed + allocation.budget_mb
    end
  end
  if allocation_count ~= cached_allocation_count
     or committed ~= cached_committed then
    integrity_fault(resource_id, 'allocation_cache_drift', now)
    return nil, 'ledger_corrupt', 'allocation_cache_drift'
  end

  local cached_lease_counts = integrity_decode(
    redis.call('HGET', KEYS[1], 'lease_counts'))
  if not cached_lease_counts
     or integrity_table_size(cached_lease_counts) ~= #domain then
    integrity_fault(resource_id, 'lease_count_cache_invalid', now)
    return nil, 'ledger_corrupt', 'lease_count_cache_invalid'
  end
  local leases = {}
  for _, backend_id in ipairs(domain) do
    local backend_leases = {}
    local lease_count = redis.call('HLEN', lease_keys[backend_id])
    if lease_count > 10000
       or (allocations[backend_id]
         and lease_count > allocations[backend_id].max_concurrency) then
      integrity_fault(resource_id, 'lease_domain_exceeded', now)
      return nil, 'ledger_corrupt', 'lease_domain_exceeded'
    end
    if backend_id == focus_backend_id then
      local lease_entries = redis.call('HGETALL', lease_keys[backend_id])
      for index = 1, #lease_entries, 2 do
        local lease = integrity_decode(lease_entries[index + 1])
        if not integrity_valid_lease(lease, lease_entries[index], backend_id) then
          integrity_fault(resource_id, 'lease_invalid', now)
          return nil, 'ledger_corrupt', 'lease_invalid'
        end
        backend_leases[lease_entries[index]] = lease
      end
    end
    if cached_lease_counts[backend_id] ~= lease_count
       or (lease_count > 0 and not allocations[backend_id]) then
      integrity_fault(resource_id, 'lease_count_cache_drift', now)
      return nil, 'ledger_corrupt', 'lease_count_cache_drift'
    end
    leases[backend_id] = backend_leases
  end
  for backend_id, allocation in pairs(allocations) do
    if allocation.state == 'reserving' or allocation.state == 'loading' then
      local reservation = leases[backend_id][allocation.reservation_lease_id]
        or integrity_decode(redis.call(
          'HGET', lease_keys[backend_id], allocation.reservation_lease_id))
      if not reservation
         or reservation.owner_id ~= allocation.reservation_owner_id
         or reservation.generation ~= allocation.generation then
        integrity_fault(resource_id, 'reservation_lease_mismatch', now)
        return nil, 'ledger_corrupt', 'reservation_lease_mismatch'
      end
    end
  end

  local cached_card_queue_count = tonumber(
    redis.call('HGET', KEYS[1], 'card_queue_count') or '-1')
  local card_queue_count = redis.call('LLEN', KEYS[3])
  local cached_backend_queue_counts = integrity_decode(
    redis.call('HGET', KEYS[1], 'backend_queue_counts'))
  if not integrity_valid_integer(card_queue_count, 0, 10000)
     or cached_card_queue_count ~= card_queue_count
     or not cached_backend_queue_counts
     or integrity_table_size(cached_backend_queue_counts) ~= #domain then
    integrity_fault(resource_id, 'queue_count_cache_drift', now)
    return nil, 'ledger_corrupt', 'queue_count_cache_drift'
  end
  local total_queue_count = card_queue_count
  for _, backend_id in ipairs(domain) do
    local queue_count = redis.call('LLEN', queue_keys[backend_id])
    if not integrity_valid_integer(queue_count, 0, 10000)
       or cached_backend_queue_counts[backend_id] ~= queue_count then
      integrity_fault(resource_id, 'queue_count_cache_drift', now)
      return nil, 'ledger_corrupt', 'queue_count_cache_drift'
    end
    total_queue_count = total_queue_count + queue_count
  end
  if total_queue_count > 10000 then
    integrity_fault(resource_id, 'queue_domain_exceeded', now)
    return nil, 'ledger_corrupt', 'queue_domain_exceeded'
  end

  local transition_raw = redis.call('GET', KEYS[4])
  local transition_mirror = redis.call('HGET', KEYS[1], 'transition_mirror')
  local transition = nil
  if transition_mirror == false then
    integrity_fault(resource_id, 'transition_mirror_missing', now)
    return nil, 'ledger_corrupt', 'transition_mirror_missing'
  end
  if transition_raw then
    transition = integrity_decode(transition_raw)
    if transition_raw ~= transition_mirror or not transition
       or transition.resource_id ~= resource_id
       or not known_backends[transition.backend_id]
       or type(transition.owner_id) ~= 'string' or transition.owner_id == ''
       or not integrity_valid_generation(transition.generation)
       or type(transition.operation) ~= 'string' or transition.operation == ''
       or type(transition.require_idle) ~= 'boolean'
       or not integrity_valid_integer(transition.created_at_ms, 1, 9007199254740991)
       or not integrity_valid_integer(transition.expires_at_ms, 1, 9007199254740991) then
      integrity_fault(resource_id, 'transition_mirror_mismatch', now)
      return nil, 'ledger_corrupt', 'transition_mirror_mismatch'
    end
    local transition_now = integrity_now_ms()
    if transition.expires_at_ms <= transition_now then transition = nil end
  elseif transition_mirror ~= '' then
    local mirrored = integrity_decode(transition_mirror)
    if not mirrored
       or not integrity_valid_integer(mirrored.expires_at_ms, 1, 9007199254740991) then
      integrity_fault(resource_id, 'transition_mirror_invalid', now)
      return nil, 'ledger_corrupt', 'transition_mirror_invalid'
    end
    if mirrored.expires_at_ms > integrity_now_ms() then
      integrity_fault(resource_id, 'transition_key_missing_before_expiry', now)
      return nil, 'ledger_corrupt', 'transition_key_missing_before_expiry'
    end
  end
  return {
    now=now, domain=domain, known_backends=known_backends,
    lease_keys=lease_keys, queue_keys=queue_keys,
    allocations=allocations, leases=leases,
    lease_counts=cached_lease_counts,
    backend_queue_counts=cached_backend_queue_counts,
    transition=transition, committed=committed,
    ledger_incarnation=ledger_incarnation,
    ledger_revision=tonumber(ledger_revision),
    total_queue_count=total_queue_count,
    allocation_count=allocation_count, allocatable=allocatable
  }, nil, nil
end
"""


_ADMIT_LUA = (
    _LEDGER_INTEGRITY_LUA
    + r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end

local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
end

local function valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end

local function generation_greater(left, right)
  if not valid_generation(left) or not valid_generation(right) then return false end
  if string.len(left) ~= string.len(right) then
    return string.len(left) > string.len(right)
  end
  return left > right
end
local function valid_integer(value, minimum, maximum)
  return type(value) == 'number' and value == math.floor(value)
    and value >= minimum and value <= maximum
end
local valid_lease_states = {active=true, uncertain=true, stale=true}
local function valid_lease(lease, lease_id, backend_id)
  return lease and lease.lease_id == lease_id and lease.backend_id == backend_id
    and type(lease.owner_id) == 'string' and lease.owner_id ~= ''
    and type(lease.operation) == 'string' and lease.operation ~= ''
    and valid_generation(lease.generation) and valid_lease_states[lease.state]
    and valid_integer(lease.created_at_ms, 1, 9007199254740991)
    and valid_integer(lease.heartbeat_deadline_ms, 1, 9007199254740991)
    and valid_integer(lease.hard_deadline_ms, 1, 9007199254740991)
    and lease.created_at_ms <= lease.heartbeat_deadline_ms
    and lease.heartbeat_deadline_ms <= lease.hard_deadline_ms
end

local counted = {
  unknown=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true
}
local valid = {
  unknown=true, unloaded=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true, cpu_fallback=true
}
local function calculate_committed(key)
  local committed = 0
  local entries = redis.call('HGETALL', key)
  for i = 1, #entries, 2 do
    local allocation = decode(entries[i + 1])
    local reservation_state = allocation
      and (allocation.state == 'reserving' or allocation.state == 'loading')
    local has_reservation = allocation
      and type(allocation.reservation_lease_id) == 'string'
      and allocation.reservation_lease_id ~= ''
      and type(allocation.reservation_owner_id) == 'string'
      and allocation.reservation_owner_id ~= ''
    local reservation_present = allocation
      and (allocation.reservation_lease_id ~= nil
        or allocation.reservation_owner_id ~= nil)
    if not allocation or not valid[allocation.state]
       or allocation.backend_id ~= entries[i]
       or not valid_integer(allocation.budget_mb, 1, 9007199254740991)
       or not valid_generation(allocation.generation)
       or not valid_integer(allocation.eviction_priority, -9007199254740991, 9007199254740991)
       or type(allocation.evictable) ~= 'boolean'
       or not valid_integer(allocation.max_concurrency, 1, 10000)
       or not valid_integer(allocation.last_used_at_ms, 1, 9007199254740991)
       or (reservation_state and not has_reservation)
       or (not reservation_state and reservation_present) then
      return nil
    end
    if counted[allocation.state] then
      committed = committed + tonumber(allocation.budget_mb)
    end
  end
  return committed
end

local function read_queue(key, now, expected_kind, expected_backend_id)
  local entries = redis.call('LRANGE', key, 0, -1)
  local live = {}
  local seen = {}
  for _, raw in ipairs(entries) do
    local ticket = decode(raw)
    if not ticket or not valid_integer(ticket.expires_at_ms, 1, 9007199254740991)
       or not valid_integer(ticket.enqueued_at_ms, 1, 9007199254740991)
       or ticket.enqueued_at_ms > ticket.expires_at_ms
       or type(ticket.ticket_id) ~= 'string' or ticket.ticket_id == ''
       or type(ticket.owner_id) ~= 'string' or ticket.owner_id == ''
       or type(ticket.backend_id) ~= 'string' or ticket.backend_id == ''
       or ticket.kind ~= expected_kind
       or (expected_backend_id ~= '' and ticket.backend_id ~= expected_backend_id)
       or seen[ticket.ticket_id] then
      return nil, nil, 'corrupt'
    end
    seen[ticket.ticket_id] = true
    if ticket.expires_at_ms > now then
      table.insert(live, {raw=raw, ticket=ticket})
    end
  end
  local head = nil
  if #live > 0 then head = live[1].ticket end
  return head, live, nil
end
local function rewrite_queue(key, live, consumed_ticket_id)
  redis.call('DEL', key)
  for _, item in ipairs(live) do
    if item.ticket.ticket_id ~= consumed_ticket_id then
      redis.call('RPUSH', key, item.raw)
    end
  end
end

local ledger, integrity_status, integrity_reason = inspect_ledger(
  ARGV[1], ARGV[15], ARGV[16], ARGV[17], true, ARGV[2])
if not ledger then
  return cjson.encode({
    status=integrity_status, reason=integrity_reason,
    committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0') or 0,
    lease_count=0
  })
end
if not ledger.known_backends[ARGV[2]] then
  return cjson.encode({status='config_mismatch', reason='backend_outside_domain', committed_mb=ledger.committed, lease_count=0})
end
local lease_key = ledger.lease_keys[ARGV[2]]
local backend_queue_key = ledger.queue_keys[ARGV[2]]

local resource_id = redis.call('HGET', KEYS[1], 'resource_id')
local bootstrap_state = redis.call('HGET', KEYS[1], 'bootstrap_state')
local allocatable = tonumber(redis.call('HGET', KEYS[1], 'allocatable_mb') or '-1')
if not resource_id or resource_id ~= ARGV[1] then
  return cjson.encode({status='not_ready', reason='card_missing_or_mismatched', committed_mb=0, lease_count=0})
end
if allocatable <= 0 then
  return cjson.encode({status='not_ready', reason='bootstrap_incomplete', committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0'), lease_count=0})
end

local now = now_ms()
local committed = calculate_committed(KEYS[2])
if not committed then
  return cjson.encode({status='ledger_corrupt', reason='allocation_decode_failed', committed_mb=0, lease_count=0})
end
if bootstrap_state ~= 'ready' then
  return cjson.encode({status='not_ready', reason='bootstrap_incomplete', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
end
local reconcile_deadline = tonumber(redis.call('HGET', KEYS[1], 'reconcile_deadline_ms') or '-1')
if not valid_integer(reconcile_deadline, 1, 9007199254740991)
   or reconcile_deadline <= now then
  return cjson.encode({status='not_ready', reason='reconcile_expired', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
end
if committed > allocatable then
  redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
  redis.call('HSET', KEYS[1], 'bootstrap_state', 'not_ready', 'committed_mb', tostring(committed), 'updated_at_ms', tostring(now))
  return cjson.encode({status='not_ready', reason='committed_exceeds_allocatable', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
end
local transition = ledger.transition
if transition and transition.backend_id == ARGV[2] then
  return cjson.encode({status='transition_in_progress', reason='transition_owner_active', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
end
local lease_count = 0
local lease_entries = redis.call('HGETALL', lease_key)
local decoded_leases = {}
local existing_lease = nil
for i = 1, #lease_entries, 2 do
  local lease = decode(lease_entries[i + 1])
  if not valid_lease(lease, lease_entries[i], ARGV[2]) then
    return cjson.encode({status='ledger_corrupt', reason='lease_decode_failed', committed_mb=0, lease_count=lease_count})
  end
  table.insert(decoded_leases, {id=lease_entries[i], lease=lease})
  lease_count = lease_count + 1
  if lease_entries[i] == ARGV[8] then existing_lease = lease end
end
if existing_lease then
  if existing_lease.owner_id == ARGV[9] and existing_lease.generation == ARGV[4] and existing_lease.backend_id == ARGV[2] then
    local allocation = decode(redis.call('HGET', KEYS[2], ARGV[2]))
    if not allocation then
      return cjson.encode({status='ledger_corrupt', reason='idempotent_allocation_missing', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
    end
    if allocation.state == 'reserving' or allocation.state == 'loading' then
      local reservation = decode(redis.call(
        'HGET', lease_key, allocation.reservation_lease_id))
      if not valid_lease(
          reservation, allocation.reservation_lease_id, allocation.backend_id)
         or reservation.owner_id ~= allocation.reservation_owner_id
         or reservation.generation ~= allocation.generation then
        return cjson.encode({status='ledger_corrupt', reason='reservation_lease_mismatch', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
      end
    end
    if allocation.generation ~= ARGV[4] then
      return cjson.encode({status='stale_generation', reason='idempotent_allocation_generation_changed', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
    end
    if tonumber(allocation.budget_mb) ~= tonumber(ARGV[3])
       or tonumber(allocation.eviction_priority) ~= tonumber(ARGV[5])
       or allocation.evictable ~= (ARGV[6] == '1')
       or tonumber(allocation.max_concurrency) ~= tonumber(ARGV[7]) then
      return cjson.encode({status='lease_conflict', reason='idempotent_config_mismatch', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
    end
    if allocation.state ~= 'reserving' and allocation.state ~= 'loading' and allocation.state ~= 'resident' then
      return cjson.encode({status='lease_conflict', reason='idempotent_allocation_not_admissible', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
    end
    if existing_lease.operation ~= ARGV[10] then
      return cjson.encode({status='lease_conflict', reason='idempotent_operation_mismatch', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
    end
    if existing_lease.state ~= 'active' or tonumber(existing_lease.heartbeat_deadline_ms) <= now or tonumber(existing_lease.hard_deadline_ms) <= now then
      existing_lease.state = 'stale'
      redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
      redis.call('HSET', lease_key, ARGV[8], cjson.encode(existing_lease))
      return cjson.encode({status='lease_conflict', reason='idempotent_lease_not_active', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
    end
    return cjson.encode({
      status='admitted', reason='idempotent_lease', idempotent=true,
      committed_mb=committed,
      lease_count=redis.call('HLEN', lease_key),
      allocation_state=allocation and allocation.state or cjson.null,
      heartbeat_deadline_ms=existing_lease.heartbeat_deadline_ms,
      hard_deadline_ms=existing_lease.hard_deadline_ms
    })
  end
  return cjson.encode({status='lease_conflict', reason='lease_id_collision', committed_mb=committed, lease_count=redis.call('HLEN', lease_key)})
end

if not integrity_has_revision_headroom(
    redis.call('HGET', KEYS[1], 'ledger_revision')) then
  redis.call('HSET', KEYS[1],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_rebase_required')
  return cjson.encode({
    status='not_ready', reason='ledger_revision_rebase_required',
    committed_mb=ledger.committed, lease_count=lease_count
  })
end

local allocation = decode(redis.call('HGET', KEYS[2], ARGV[2]))
local allocation_was_missing = allocation == nil
local increment = 0
local concurrency_limit = tonumber(ARGV[7])
if allocation then
  if allocation.state == 'reserving' or allocation.state == 'loading' then
    local reservation = decode(redis.call(
      'HGET', lease_key, allocation.reservation_lease_id))
    if not valid_lease(
        reservation, allocation.reservation_lease_id, allocation.backend_id)
       or reservation.owner_id ~= allocation.reservation_owner_id
       or reservation.generation ~= allocation.generation then
      return cjson.encode({status='ledger_corrupt', reason='reservation_lease_mismatch', committed_mb=committed, lease_count=lease_count})
    end
  end
  if tonumber(allocation.budget_mb) ~= tonumber(ARGV[3])
     or tonumber(allocation.eviction_priority) ~= tonumber(ARGV[5])
     or allocation.evictable ~= (ARGV[6] == '1')
     or tonumber(allocation.max_concurrency) ~= tonumber(ARGV[7]) then
    return cjson.encode({status='config_mismatch', reason='allocation_config_mismatch', committed_mb=committed, lease_count=lease_count})
  end
  concurrency_limit = tonumber(allocation.max_concurrency)
  if allocation.state == 'unknown' then
    return cjson.encode({status='not_ready', reason='allocation_unknown', committed_mb=committed, lease_count=lease_count})
  end
  if allocation.state == 'draining' or allocation.state == 'unloading' then
    return cjson.encode({status='transition_in_progress', reason='allocation_' .. allocation.state, committed_mb=committed, lease_count=lease_count})
  end
  if allocation.state == 'reserving' or allocation.state == 'loading' or allocation.state == 'resident' then
    if allocation.generation ~= ARGV[4] then
      return cjson.encode({status='stale_generation', reason='allocation_generation_mismatch', committed_mb=committed, lease_count=lease_count})
    end
  elseif allocation.state == 'unloaded' or allocation.state == 'cpu_fallback' then
    if not generation_greater(ARGV[4], allocation.generation) then
      return cjson.encode({status='stale_generation', reason='new_allocation_generation_not_monotonic', committed_mb=committed, lease_count=lease_count})
    end
    increment = tonumber(ARGV[3])
  else
    return cjson.encode({status='ledger_corrupt', reason='allocation_state_invalid', committed_mb=committed, lease_count=lease_count})
  end
else
  increment = tonumber(ARGV[3])
end

local backend_head, backend_live, backend_queue_error = read_queue(
  backend_queue_key, now, 'backend', ARGV[2])
if backend_queue_error then
  return cjson.encode({status='ledger_corrupt', reason='backend_queue_decode_failed', committed_mb=committed, lease_count=lease_count})
end
if backend_head and (
  ARGV[13] == '' or backend_head.ticket_id ~= ARGV[13]
  or backend_head.owner_id ~= ARGV[9] or backend_head.backend_id ~= ARGV[2]
) then
  return cjson.encode({status='concurrency_queued', reason='backend_fifo_wait', committed_mb=committed, lease_count=lease_count})
end
if lease_count >= concurrency_limit then
  return cjson.encode({status='concurrency_saturated', reason='max_concurrency_reached', committed_mb=committed, lease_count=lease_count})
end

local card_live = {}
local consumed_card_ticket = ''
if increment > 0 then
  local card_head, card_queue_error
  card_head, card_live, card_queue_error = read_queue(
    KEYS[3], now, 'card', '')
  if card_queue_error then
    return cjson.encode({status='ledger_corrupt', reason='card_queue_decode_failed', committed_mb=committed, lease_count=lease_count})
  end
  if card_head and (
    ARGV[14] == '' or card_head.ticket_id ~= ARGV[14]
    or card_head.owner_id ~= ARGV[9] or card_head.backend_id ~= ARGV[2]
  ) then
    return cjson.encode({status='card_queued', reason='card_fifo_wait', committed_mb=committed, lease_count=lease_count})
  end
  if committed + increment > allocatable then
    return cjson.encode({status='capacity_unavailable', reason='insufficient_capacity', committed_mb=committed, lease_count=lease_count})
  end
  allocation = {
    backend_id=ARGV[2], state='reserving', budget_mb=tonumber(ARGV[3]),
    generation=ARGV[4], eviction_priority=tonumber(ARGV[5]),
    evictable=(ARGV[6] == '1'), max_concurrency=tonumber(ARGV[7]),
    reservation_lease_id=ARGV[8], reservation_owner_id=ARGV[9],
    last_used_at_ms=now
  }
  committed = committed + increment
  if card_head and card_head.ticket_id == ARGV[14] then
    consumed_card_ticket = ARGV[14]
  end
else
  allocation.last_used_at_ms = now
end

redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
for _, item in ipairs(decoded_leases) do
  local lease = item.lease
  if lease.state == 'active' and tonumber(lease.heartbeat_deadline_ms) <= now then
    lease.state = 'stale'
    redis.call('HSET', lease_key, item.id, cjson.encode(lease))
  elseif lease.state == 'uncertain' and tonumber(lease.hard_deadline_ms) <= now then
    lease.state = 'stale'
    redis.call('HSET', lease_key, item.id, cjson.encode(lease))
  end
end
redis.call('HSET', KEYS[2], ARGV[2], cjson.encode(allocation))

local heartbeat_deadline = now + tonumber(ARGV[11])
local hard_deadline = now + tonumber(ARGV[12])
local lease = {
  lease_id=ARGV[8], backend_id=ARGV[2], owner_id=ARGV[9], generation=ARGV[4],
  operation=ARGV[10], state='active', created_at_ms=now,
  heartbeat_deadline_ms=heartbeat_deadline, hard_deadline_ms=hard_deadline
}
redis.call('HSET', lease_key, ARGV[8], cjson.encode(lease))
if increment > 0 then
  rewrite_queue(KEYS[3], card_live, consumed_card_ticket)
end
local consumed_backend_ticket = ''
if backend_head and backend_head.ticket_id == ARGV[13] then
  consumed_backend_ticket = ARGV[13]
end
rewrite_queue(backend_queue_key, backend_live, consumed_backend_ticket)
ledger.lease_counts[ARGV[2]] = ledger.lease_counts[ARGV[2]] + 1
ledger.backend_queue_counts[ARGV[2]] = #backend_live
if consumed_backend_ticket ~= '' then
  ledger.backend_queue_counts[ARGV[2]] = ledger.backend_queue_counts[ARGV[2]] - 1
end
local allocation_count = ledger.allocation_count
if allocation_was_missing then allocation_count = allocation_count + 1 end
redis.call('HSET', KEYS[1],
  'committed_mb', tostring(committed),
  'allocation_count', tostring(allocation_count),
  'lease_counts', cjson.encode(ledger.lease_counts),
  'backend_queue_counts', cjson.encode(ledger.backend_queue_counts),
  'updated_at_ms', tostring(now))
if increment > 0 then
  local card_queue_count = #card_live
  if consumed_card_ticket ~= '' then card_queue_count = card_queue_count - 1 end
  redis.call('HSET', KEYS[1], 'card_queue_count', tostring(card_queue_count))
end
return cjson.encode({
  status='admitted', reason=(increment > 0 and 'allocation_reserved' or 'allocation_reused'),
  idempotent=false, committed_mb=committed, lease_count=lease_count + 1,
  allocation_state=allocation.state,
  heartbeat_deadline_ms=heartbeat_deadline, hard_deadline_ms=hard_deadline
})
"""
)


_LEASE_LUA = r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
end
local function valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end
local function valid_integer(value)
  return type(value) == 'number' and value == math.floor(value)
    and value >= 1 and value <= 9007199254740991
end
local function valid_revision(value)
  if type(value) ~= 'string'
     or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 16 then return true end
  if string.len(value) > 16 then return false end
  return value < '9007199254740991'
end

if redis.call('HGET', KEYS[2], 'resource_id') ~= ARGV[6] then
  return cjson.encode({status='not_ready'})
end
local ledger_revision = redis.call('HGET', KEYS[2], 'ledger_revision')
if not valid_revision(ledger_revision) then
  redis.call('HSET', KEYS[2],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_invalid')
  return cjson.encode({status='not_ready'})
end
if tonumber(ledger_revision) >= 9007199253990991
   and ARGV[1] ~= 'release' then
  redis.call('HSET', KEYS[2],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_rebase_required')
  return cjson.encode({status='not_ready'})
end

local raw = redis.call('HGET', KEYS[1], ARGV[2])
if not raw then return cjson.encode({status='missing'}) end
local lease = decode(raw)
local valid_states = {active=true, uncertain=true, stale=true}
if not lease or lease.lease_id ~= ARGV[2]
   or lease.backend_id ~= ARGV[7]
   or type(lease.owner_id) ~= 'string' or lease.owner_id == ''
   or type(lease.operation) ~= 'string' or lease.operation == ''
   or not valid_generation(lease.generation) or not valid_states[lease.state]
   or not valid_integer(lease.created_at_ms)
   or not valid_integer(lease.heartbeat_deadline_ms)
   or not valid_integer(lease.hard_deadline_ms)
   or lease.created_at_ms > lease.heartbeat_deadline_ms
   or lease.heartbeat_deadline_ms > lease.hard_deadline_ms then
  return redis.error_reply('gpu arbiter lease decode failed')
end
if lease.owner_id ~= ARGV[3] then
  return cjson.encode({status='owner_mismatch', lease_state=lease.state, hard_deadline_ms=lease.hard_deadline_ms})
end
if lease.generation ~= ARGV[4] then
  return cjson.encode({status='stale_generation', lease_state=lease.state, hard_deadline_ms=lease.hard_deadline_ms})
end
local allocation_raw = redis.call('HGET', KEYS[3], ARGV[7])
local allocation = decode(allocation_raw)
local valid_allocation_states = {
  unknown=true, unloaded=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true, cpu_fallback=true
}
if not allocation or allocation.backend_id ~= ARGV[7]
   or not valid_allocation_states[allocation.state]
   or not valid_generation(allocation.generation) then
  return redis.error_reply('gpu arbiter allocation decode failed')
end

local lease_counts = decode(redis.call('HGET', KEYS[2], 'lease_counts'))
local actual_lease_count = redis.call('HLEN', KEYS[1])
local lease_count_mismatch = not lease_counts
  or type(lease_counts[ARGV[7]]) ~= 'number'
  or lease_counts[ARGV[7]] ~= actual_lease_count
if lease_count_mismatch then
  redis.call('HINCRBY', KEYS[2], 'ledger_revision', 1)
  redis.call('HSET', KEYS[2],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'lease_count_cache_drift')
  return cjson.encode({status='not_ready'})
end

local now = now_ms()
if ARGV[1] == 'heartbeat' then
  if lease.state ~= 'active' or now >= tonumber(lease.heartbeat_deadline_ms) or now >= tonumber(lease.hard_deadline_ms) then
    if lease.state ~= 'stale' then
      lease.state = 'stale'
      redis.call('HINCRBY', KEYS[2], 'ledger_revision', 1)
      redis.call('HSET', KEYS[1], ARGV[2], cjson.encode(lease))
    end
    return cjson.encode({status='stale', lease_state='stale', heartbeat_deadline_ms=lease.heartbeat_deadline_ms, hard_deadline_ms=lease.hard_deadline_ms})
  end
  local next_deadline = now + tonumber(ARGV[5])
  if next_deadline > tonumber(lease.hard_deadline_ms) then next_deadline = tonumber(lease.hard_deadline_ms) end
  lease.heartbeat_deadline_ms = next_deadline
  redis.call('HINCRBY', KEYS[2], 'ledger_revision', 1)
  redis.call('HSET', KEYS[1], ARGV[2], cjson.encode(lease))
  return cjson.encode({status='heartbeated', lease_state='active', heartbeat_deadline_ms=next_deadline, hard_deadline_ms=lease.hard_deadline_ms})
elseif ARGV[1] == 'uncertain' then
  if lease.state == 'stale' then
    return cjson.encode({status='stale', lease_state='stale', heartbeat_deadline_ms=lease.heartbeat_deadline_ms, hard_deadline_ms=lease.hard_deadline_ms})
  end
  if lease.state == 'active' then
    lease.state = 'uncertain'
    redis.call('HINCRBY', KEYS[2], 'ledger_revision', 1)
    redis.call('HSET', KEYS[1], ARGV[2], cjson.encode(lease))
  end
  return cjson.encode({status='uncertain', lease_state=lease.state, heartbeat_deadline_ms=lease.heartbeat_deadline_ms, hard_deadline_ms=lease.hard_deadline_ms})
elseif ARGV[1] == 'release' then
  if (allocation.state == 'reserving' or allocation.state == 'loading')
     and allocation.reservation_lease_id == ARGV[2] then
    return cjson.encode({status='reservation_active', lease_state=lease.state, heartbeat_deadline_ms=lease.heartbeat_deadline_ms, hard_deadline_ms=lease.hard_deadline_ms})
  end
  redis.call('HINCRBY', KEYS[2], 'ledger_revision', 1)
  redis.call('HDEL', KEYS[1], ARGV[2])
  if lease_counts and type(lease_counts[ARGV[7]]) == 'number' then
    lease_counts[ARGV[7]] = actual_lease_count - 1
    redis.call('HSET', KEYS[2], 'lease_counts', cjson.encode(lease_counts))
  end
  return cjson.encode({status='released'})
end
return redis.error_reply('unsupported gpu arbiter lease operation')
"""


_SWEEP_LEASES_LUA = r"""
local function valid_revision(value)
  if type(value) ~= 'string'
     or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 16 then return true end
  if string.len(value) > 16 then return false end
  return value < '9007199254740991'
end
local function valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end
local function valid_integer(value)
  return type(value) == 'number' and value == math.floor(value)
    and value >= 1 and value <= 9007199254740991
end

if redis.call('HGET', KEYS[2], 'resource_id') ~= ARGV[1] then
  return cjson.encode({status='not_ready', changed=0, total=0})
end
if not valid_revision(redis.call('HGET', KEYS[2], 'ledger_revision')) then
  redis.call('HSET', KEYS[2],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_invalid')
  return cjson.encode({status='not_ready', changed=0, total=0})
end
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local entries = redis.call('HGETALL', KEYS[1])
local changed = 0
local total = 0
local decoded = {}
for i = 1, #entries, 2 do
  local ok, lease = pcall(cjson.decode, entries[i + 1])
  local valid_states = {active=true, uncertain=true, stale=true}
  if not ok or type(lease) ~= 'table'
     or lease.lease_id ~= entries[i] or lease.backend_id ~= ARGV[2]
     or type(lease.owner_id) ~= 'string' or lease.owner_id == ''
     or type(lease.operation) ~= 'string' or lease.operation == ''
     or not valid_generation(lease.generation) or not valid_states[lease.state]
     or not valid_integer(lease.created_at_ms)
     or not valid_integer(lease.heartbeat_deadline_ms)
     or not valid_integer(lease.hard_deadline_ms)
     or lease.created_at_ms > lease.heartbeat_deadline_ms
     or lease.heartbeat_deadline_ms > lease.hard_deadline_ms then
    return redis.error_reply('gpu arbiter lease decode failed')
  end
  table.insert(decoded, {id=entries[i], lease=lease, changed=false})
end
for _, item in ipairs(decoded) do
  local lease = item.lease
  total = total + 1
  if lease.state == 'active' and tonumber(lease.heartbeat_deadline_ms) <= now then
    lease.state = 'stale'
    item.changed = true
    changed = changed + 1
  elseif lease.state == 'uncertain' and tonumber(lease.hard_deadline_ms) <= now then
    lease.state = 'stale'
    item.changed = true
    changed = changed + 1
  end
end
if changed > 0 then
  redis.call('HINCRBY', KEYS[2], 'ledger_revision', 1)
  for _, item in ipairs(decoded) do
    if item.changed then
      redis.call('HSET', KEYS[1], item.id, cjson.encode(item.lease))
    end
  end
end
return cjson.encode({status='swept', changed=changed, total=total})
"""


_QUEUE_LUA = (
    _LEDGER_INTEGRITY_LUA
    + r"""
local now = integrity_now_ms()
if redis.call('HGET', KEYS[1], 'resource_id') ~= ARGV[8] then
  return cjson.encode({status='not_ready', ticket_id=ARGV[2]})
end
local queue_incarnation = redis.call('HGET', KEYS[1], 'ledger_incarnation')
if type(queue_incarnation) ~= 'string' or queue_incarnation == ''
   or string.len(queue_incarnation) > 128 then
  integrity_fault(ARGV[8], 'ledger_incarnation_invalid', now)
  return cjson.encode({status='ledger_corrupt', ticket_id=ARGV[2]})
end
if queue_incarnation ~= ARGV[11] then
  return cjson.encode({status='not_ready', ticket_id=ARGV[2]})
end
if not integrity_valid_revision(
    redis.call('HGET', KEYS[1], 'ledger_revision')) then
  integrity_fault(ARGV[8], 'ledger_revision_invalid', now)
  return cjson.encode({status='ledger_corrupt', ticket_id=ARGV[2]})
end
local revision_bumped = false

local domain = integrity_decode(ARGV[9])
local queue_key = nil
local backend_queue_counts = integrity_decode(
  redis.call('HGET', KEYS[1], 'backend_queue_counts'))
if not domain or #domain > 64 or not backend_queue_counts
   or redis.call('HGET', KEYS[1], 'backend_domain') ~= ARGV[9]
   or redis.call('HGET', KEYS[1], 'backend_domain_fingerprint') ~= ARGV[10]
   or #KEYS ~= 4 + (#domain * 2) then
  integrity_fault(ARGV[8], 'backend_domain_invalid', now)
  return cjson.encode({status='ledger_corrupt', ticket_id=ARGV[2]})
end
local known_backends = {}
for index, backend_id in ipairs(domain) do
  if type(backend_id) ~= 'string' or backend_id == ''
     or known_backends[backend_id] then
    integrity_fault(ARGV[8], 'backend_domain_invalid', now)
    return cjson.encode({status='ledger_corrupt', ticket_id=ARGV[2]})
  end
  known_backends[backend_id] = true
  if ARGV[5] == 'backend' and backend_id == ARGV[3] then
    queue_key = KEYS[4 + (index * 2)]
  end
end
if not known_backends[ARGV[3]] then
  return cjson.encode({status='not_ready', ticket_id=ARGV[2]})
end
if ARGV[5] == 'card' then queue_key = KEYS[3] end
if not queue_key then
  integrity_fault(ARGV[8], 'backend_domain_invalid', now)
  return cjson.encode({status='ledger_corrupt', ticket_id=ARGV[2]})
end

local inspected_ledger = nil
if ARGV[1] == 'enqueue' then
  local ledger, integrity_status = inspect_ledger(
    ARGV[8], ARGV[9], ARGV[10], ARGV[11], true, ARGV[3])
  if not ledger then
    return cjson.encode({status=integrity_status, ticket_id=ARGV[2]})
  end
  inspected_ledger = ledger
else
  local cached_count = ARGV[5] == 'card'
    and tonumber(redis.call('HGET', KEYS[1], 'card_queue_count') or '-1')
    or backend_queue_counts[ARGV[3]]
  if cached_count ~= redis.call('LLEN', queue_key) then
    integrity_fault(ARGV[8], 'queue_count_cache_drift', now)
    return cjson.encode({status='ledger_corrupt', ticket_id=ARGV[2]})
  end
end

local function persist_queue_count(count)
  if not revision_bumped then
    redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
    revision_bumped = true
  end
  if ARGV[5] == 'card' then
    redis.call('HSET', KEYS[1], 'card_queue_count', tostring(count))
  else
    backend_queue_counts[ARGV[3]] = count
    redis.call('HSET', KEYS[1],
      'backend_queue_counts', cjson.encode(backend_queue_counts))
  end
end

local entries = redis.call('LRANGE', queue_key, 0, -1)
local live = {}
local existing_position = nil
local seen = {}
for _, raw in ipairs(entries) do
  local ticket = integrity_decode(raw)
  if not integrity_valid_ticket(ticket, ARGV[5],
      ARGV[5] == 'backend' and ARGV[3] or '', known_backends)
     or seen[ticket.ticket_id] then
    integrity_fault(ARGV[8], 'queue_invalid', now)
    return cjson.encode({status='ledger_corrupt', ticket_id=ARGV[2]})
  end
  seen[ticket.ticket_id] = true
  if ticket.expires_at_ms > now then
    table.insert(live, raw)
    if ticket.ticket_id == ARGV[2] then existing_position = #live end
  end
end
local pruned = #live ~= #entries
local function rewrite_live(excluded_ticket_id)
  redis.call('DEL', queue_key)
  local remaining = 0
  for _, raw in ipairs(live) do
    local ticket = integrity_decode(raw)
    if ticket.ticket_id ~= excluded_ticket_id then
      redis.call('RPUSH', queue_key, raw)
      remaining = remaining + 1
    end
  end
  persist_queue_count(remaining)
  return remaining
end

if ARGV[1] == 'enqueue' then
  if existing_position then
    local ticket = cjson.decode(live[existing_position])
    if ticket.owner_id ~= ARGV[4] or ticket.backend_id ~= ARGV[3]
       or ticket.kind ~= ARGV[5] then
      return cjson.encode({status='ticket_conflict', ticket_id=ARGV[2]})
    end
    if pruned then rewrite_live(nil) end
    return cjson.encode({status='queued', ticket_id=ARGV[2], position=existing_position, expires_at_ms=ticket.expires_at_ms})
  end
  if not integrity_has_revision_headroom(
      redis.call('HGET', KEYS[1], 'ledger_revision')) then
    redis.call('HSET', KEYS[1],
      'bootstrap_state', 'not_ready',
      'reconcile_deadline_ms', '0',
      'not_ready_reason', 'ledger_revision_rebase_required')
    return cjson.encode({status='not_ready', ticket_id=ARGV[2]})
  end
  local effective_total_queue_count = inspected_ledger.total_queue_count
    - #entries + #live
  if #live >= tonumber(ARGV[7]) or effective_total_queue_count >= 10000 then
    if pruned then rewrite_live(nil) end
    return cjson.encode({status='full', ticket_id=ARGV[2]})
  end
  local ticket = {
    ticket_id=ARGV[2], backend_id=ARGV[3], owner_id=ARGV[4], kind=ARGV[5],
    enqueued_at_ms=now, expires_at_ms=now + tonumber(ARGV[6])
  }
  if pruned then rewrite_live(nil) end
  redis.call('RPUSH', queue_key, cjson.encode(ticket))
  persist_queue_count(#live + 1)
  return cjson.encode({status='queued', ticket_id=ARGV[2], position=#live + 1, expires_at_ms=ticket.expires_at_ms})
elseif ARGV[1] == 'cancel' then
  if not existing_position then
    if pruned then rewrite_live(nil) end
    return cjson.encode({status='missing', ticket_id=ARGV[2]})
  end
  local existing_ticket = cjson.decode(live[existing_position])
  if existing_ticket.backend_id ~= ARGV[3]
     or existing_ticket.kind ~= ARGV[5] then
    if pruned then rewrite_live(nil) end
    return cjson.encode({status='ticket_conflict', ticket_id=ARGV[2], position=existing_position, expires_at_ms=existing_ticket.expires_at_ms})
  end
  if existing_ticket.owner_id ~= ARGV[4] then
    if pruned then rewrite_live(nil) end
    return cjson.encode({status='owner_mismatch', ticket_id=ARGV[2], position=existing_position, expires_at_ms=existing_ticket.expires_at_ms})
  end
  rewrite_live(ARGV[2])
  return cjson.encode({status='cancelled', ticket_id=ARGV[2]})
elseif ARGV[1] == 'position' then
  if not existing_position then
    if pruned then rewrite_live(nil) end
    return cjson.encode({status='missing', ticket_id=ARGV[2]})
  end
  local ticket = cjson.decode(live[existing_position])
  if ticket.backend_id ~= ARGV[3] or ticket.kind ~= ARGV[5] then
    if pruned then rewrite_live(nil) end
    return cjson.encode({status='ticket_conflict', ticket_id=ARGV[2], position=existing_position, expires_at_ms=ticket.expires_at_ms})
  end
  if pruned then rewrite_live(nil) end
  return cjson.encode({status='queued', ticket_id=ARGV[2], position=existing_position, expires_at_ms=ticket.expires_at_ms})
end
return redis.error_reply('unsupported gpu arbiter queue operation')
"""
)


_TRANSITION_OWNER_LUA = (
    _LEDGER_INTEGRITY_LUA
    + r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
end
local function valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end
local function generation_greater(left, right)
  if not valid_generation(left) or not valid_generation(right) then return false end
  if string.len(left) ~= string.len(right) then
    return string.len(left) > string.len(right)
  end
  return left > right
end

if redis.call('HGET', KEYS[1], 'resource_id') ~= ARGV[2] then
  return cjson.encode({status='not_ready'})
end
local now = now_ms()
local owner_incarnation = redis.call('HGET', KEYS[1], 'ledger_incarnation')
if type(owner_incarnation) ~= 'string' or owner_incarnation == ''
   or string.len(owner_incarnation) > 128 then
  integrity_fault(ARGV[2], 'ledger_incarnation_invalid', now)
  return cjson.encode({status='ledger_corrupt'})
end
if owner_incarnation ~= ARGV[11] then
  return cjson.encode({status='not_ready'})
end
if not integrity_valid_revision(
    redis.call('HGET', KEYS[1], 'ledger_revision')) then
  integrity_fault(ARGV[2], 'ledger_revision_invalid', now)
  return cjson.encode({status='ledger_corrupt'})
end
local ledger = nil
local target_lease_key = nil
if ARGV[1] == 'acquire' then
  local integrity_status
  ledger, integrity_status = inspect_ledger(
    ARGV[2], ARGV[9], ARGV[10], ARGV[11], true, ARGV[3])
  if not ledger then
    return cjson.encode({status=integrity_status})
  end
  if not ledger.known_backends[ARGV[3]] then
    return cjson.encode({status='not_ready'})
  end
  target_lease_key = ledger.lease_keys[ARGV[3]]
end
if ARGV[1] == 'heartbeat'
   and not integrity_allows_heartbeat(
     redis.call('HGET', KEYS[1], 'ledger_revision')) then
  redis.call('HSET', KEYS[1],
    'bootstrap_state', 'not_ready',
    'reconcile_deadline_ms', '0',
    'not_ready_reason', 'ledger_revision_rebase_required')
  return cjson.encode({status='not_ready'})
end

local raw = nil
local current = nil
if ARGV[1] == 'acquire' then
  current = ledger.transition
else
  raw = redis.call('GET', KEYS[4])
  current = decode(raw)
  if raw and not current then
    integrity_fault(ARGV[2], 'transition_invalid', now)
    return cjson.encode({status='ledger_corrupt'})
  end
  local mirror = redis.call('HGET', KEYS[1], 'transition_mirror')
  if mirror == false then
    integrity_fault(ARGV[2], 'transition_mirror_missing', now)
    return cjson.encode({status='ledger_corrupt'})
  end
  if raw and raw ~= mirror then
    integrity_fault(ARGV[2], 'transition_mirror_mismatch', now)
    return cjson.encode({status='ledger_corrupt'})
  elseif not raw and mirror and mirror ~= '' then
    local mirrored = decode(mirror)
    if not mirrored or type(mirrored.expires_at_ms) ~= 'number' then
      integrity_fault(ARGV[2], 'transition_mirror_invalid', now)
      return cjson.encode({status='ledger_corrupt'})
    end
    if mirrored.expires_at_ms > now_ms() then
      integrity_fault(ARGV[2], 'transition_key_missing_before_expiry', now)
      return cjson.encode({status='ledger_corrupt'})
    end
  end
end
if current and (
    current.resource_id ~= ARGV[2]
    or type(current.backend_id) ~= 'string' or current.backend_id == ''
    or type(current.owner_id) ~= 'string' or current.owner_id == ''
    or not valid_generation(current.generation)
    or type(current.operation) ~= 'string' or current.operation == ''
    or type(current.require_idle) ~= 'boolean'
    or type(current.created_at_ms) ~= 'number'
    or type(current.expires_at_ms) ~= 'number') then
  return redis.error_reply('gpu arbiter transition decode failed')
end
now = now_ms()
if current and current.expires_at_ms <= now then current = nil end

local function validate_acquire_target()
  local allocation_raw = redis.call('HGET', KEYS[2], ARGV[3])
  if not allocation_raw then return 'missing', nil end
  local allocation = decode(allocation_raw)
  if not allocation or allocation.backend_id ~= ARGV[3]
     or not valid_generation(allocation.generation)
     or type(allocation.state) ~= 'string' then
    return 'ledger_corrupt', nil
  end
  if ARGV[8] == '1' and allocation.state ~= 'resident' then
    return 'invalid_transition', allocation.generation
  end
  if allocation.state == 'resident' then
    if not generation_greater(ARGV[5], allocation.generation) then
      return 'stale_generation', allocation.generation
    end
  elseif allocation.state == 'draining' then
    if ARGV[5] ~= allocation.generation
       and not generation_greater(ARGV[5], allocation.generation) then
      return 'stale_generation', allocation.generation
    end
  elseif allocation.state == 'unloading' then
    if ARGV[5] ~= allocation.generation then
      return 'stale_generation', allocation.generation
    end
  else
    return 'invalid_transition', allocation.generation
  end
  if ARGV[8] == '1' and redis.call('HLEN', target_lease_key) > 0 then
    return 'active_leases', allocation.generation
  end
  return nil, allocation.generation
end

if ARGV[1] == 'acquire' then
  if current then
    if current.owner_id == ARGV[4] and current.backend_id == ARGV[3]
       and current.generation == ARGV[5] and current.operation == ARGV[6]
       and current.require_idle == (ARGV[8] == '1') then
      local target_error, target_generation = validate_acquire_target()
      if target_error then
        return cjson.encode({status=target_error, generation=target_generation})
      end
      if not integrity_has_revision_headroom(
          redis.call('HGET', KEYS[1], 'ledger_revision')) then
        return cjson.encode({status='acquired', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms, idempotent=true})
      end
      current.expires_at_ms = now + tonumber(ARGV[7])
      local encoded = cjson.encode(current)
      redis.call('SET', KEYS[4], encoded, 'PXAT',
        tostring(current.expires_at_ms + 1000))
      redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
      redis.call('HSET', KEYS[1], 'transition_mirror', encoded)
      return cjson.encode({status='acquired', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms, idempotent=true})
    end
    return cjson.encode({status='busy', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms})
  end
  if not integrity_has_revision_headroom(
      redis.call('HGET', KEYS[1], 'ledger_revision')) then
    redis.call('HSET', KEYS[1],
      'bootstrap_state', 'not_ready',
      'reconcile_deadline_ms', '0',
      'not_ready_reason', 'ledger_revision_rebase_required')
    return cjson.encode({status='not_ready'})
  end
  local target_error, target_generation = validate_acquire_target()
  if target_error then
    return cjson.encode({status=target_error, generation=target_generation})
  end
  local owner = {
    resource_id=ARGV[2], backend_id=ARGV[3], owner_id=ARGV[4],
    generation=ARGV[5], operation=ARGV[6],
    require_idle=(ARGV[8] == '1'),
    created_at_ms=now, expires_at_ms=now + tonumber(ARGV[7])
  }
  local encoded = cjson.encode(owner)
  redis.call('SET', KEYS[4], encoded, 'PXAT',
    tostring(owner.expires_at_ms + 1000))
  redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
  redis.call('HSET', KEYS[1], 'transition_mirror', encoded)
  return cjson.encode({status='acquired', owner_id=owner.owner_id, generation=owner.generation, expires_at_ms=owner.expires_at_ms, idempotent=false})
end

if not current then return cjson.encode({status='missing'}) end
if current.owner_id ~= ARGV[4] then
  return cjson.encode({status='owner_mismatch', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms})
end
if current.generation ~= ARGV[5] then
  return cjson.encode({status='stale_generation', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms})
end
if current.operation ~= ARGV[6] or current.backend_id ~= ARGV[3] then
  return cjson.encode({status='operation_mismatch', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms})
end

if ARGV[1] == 'heartbeat' then
  current.expires_at_ms = now + tonumber(ARGV[7])
  local encoded = cjson.encode(current)
  redis.call('SET', KEYS[4], encoded, 'PXAT',
    tostring(current.expires_at_ms + 1000))
  redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
  redis.call('HSET', KEYS[1], 'transition_mirror', encoded)
  return cjson.encode({status='renewed', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms})
elseif ARGV[1] == 'release' then
  redis.call('DEL', KEYS[4])
  redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
  redis.call('HSET', KEYS[1], 'transition_mirror', '')
  return cjson.encode({status='released', owner_id=current.owner_id, generation=current.generation})
end
return redis.error_reply('unsupported gpu arbiter transition owner operation')
"""
)


_TRANSITION_LUA = (
    _LEDGER_INTEGRITY_LUA
    + r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
end
local function valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end
local function generation_greater(left, right)
  if not valid_generation(left) or not valid_generation(right) then return false end
  if string.len(left) ~= string.len(right) then
    return string.len(left) > string.len(right)
  end
  return left > right
end
local function valid_integer(value, minimum, maximum)
  return type(value) == 'number' and value == math.floor(value)
    and value >= minimum and value <= maximum
end
local allowed = {
  reserving={loading=true, unknown=true, unloaded=true},
  loading={resident=true, unknown=true, unloaded=true, cpu_fallback=true},
  resident={draining=true},
  draining={resident=true, unknown=true, unloading=true},
  unloading={unloaded=true, unknown=true}
}
local counted = {
  unknown=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true
}
local valid = {
  unknown=true, unloaded=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true, cpu_fallback=true
}
local function valid_allocation(item, backend_id)
  local reservation_state = item
    and (item.state == 'reserving' or item.state == 'loading')
  local has_reservation = item
    and type(item.reservation_lease_id) == 'string'
    and item.reservation_lease_id ~= ''
    and type(item.reservation_owner_id) == 'string'
    and item.reservation_owner_id ~= ''
  local reservation_present = item
    and (item.reservation_lease_id ~= nil or item.reservation_owner_id ~= nil)
  return item and item.backend_id == backend_id and valid[item.state]
    and valid_integer(item.budget_mb, 1, 9007199254740991)
    and valid_generation(item.generation)
    and valid_integer(item.eviction_priority, -9007199254740991, 9007199254740991)
    and type(item.evictable) == 'boolean'
    and valid_integer(item.max_concurrency, 1, 10000)
    and valid_integer(item.last_used_at_ms, 1, 9007199254740991)
    and (not reservation_state or has_reservation)
    and (reservation_state or not reservation_present)
end
local valid_lease_states = {active=true, uncertain=true, stale=true}
local function valid_lease(lease, lease_id, backend_id)
  return lease and lease.lease_id == lease_id and lease.backend_id == backend_id
    and type(lease.owner_id) == 'string' and lease.owner_id ~= ''
    and type(lease.operation) == 'string' and lease.operation ~= ''
    and valid_generation(lease.generation) and valid_lease_states[lease.state]
    and valid_integer(lease.created_at_ms, 1, 9007199254740991)
    and valid_integer(lease.heartbeat_deadline_ms, 1, 9007199254740991)
    and valid_integer(lease.hard_deadline_ms, 1, 9007199254740991)
    and lease.created_at_ms <= lease.heartbeat_deadline_ms
    and lease.heartbeat_deadline_ms <= lease.hard_deadline_ms
end

local ledger, integrity_status = inspect_ledger(
  ARGV[1], ARGV[10], ARGV[11], ARGV[12], false, ARGV[2])
if not ledger then
  return cjson.encode({
    status=integrity_status,
    committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0') or 0
  })
end
if not ledger.known_backends[ARGV[2]] then
  return cjson.encode({status='not_ready', committed_mb=ledger.committed})
end
local lease_key = ledger.lease_keys[ARGV[2]]

local card_resource_id = redis.call('HGET', KEYS[1], 'resource_id')
if not card_resource_id or card_resource_id ~= ARGV[1] then
  return cjson.encode({status='not_ready', committed_mb=0})
end

local raw = redis.call('HGET', KEYS[2], ARGV[2])
if not raw then
  return cjson.encode({status='missing', committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end
local allocation = decode(raw)
if not valid_allocation(allocation, ARGV[2]) then
  return cjson.encode({status='ledger_corrupt', committed_mb=0})
end
if allocation.generation ~= ARGV[3] then
  return cjson.encode({status='stale_generation', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end
if not allowed[allocation.state] or not allowed[allocation.state][ARGV[4]] then
  return cjson.encode({status='invalid_transition', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end
local changes_generation = (allocation.state == 'resident' and ARGV[4] == 'draining')
  or (allocation.state == 'draining' and ARGV[4] == 'resident')
if ARGV[5] ~= '' and not changes_generation then
  return cjson.encode({status='invalid_transition', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end
if ARGV[5] ~= '' and not generation_greater(ARGV[5], allocation.generation) then
  return cjson.encode({status='stale_generation', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end
if changes_generation and ARGV[5] == '' then
  return cjson.encode({status='stale_generation', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end

local lease_count = 0
local lease_entries = redis.call('HGETALL', lease_key)
for i = 1, #lease_entries, 2 do
  local lease = decode(lease_entries[i + 1])
  if not valid_lease(lease, lease_entries[i], ARGV[2]) then
    return cjson.encode({status='ledger_corrupt', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
  end
  lease_count = lease_count + 1
end

local workload_owned = allocation.state == 'reserving' or allocation.state == 'loading'
local owner_lease = nil
if workload_owned then
  if ARGV[6] == '' or ARGV[7] == ''
     or allocation.reservation_lease_id ~= ARGV[6]
     or allocation.reservation_owner_id ~= ARGV[7] then
    return cjson.encode({status='owner_mismatch', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
  end
  owner_lease = decode(redis.call('HGET', lease_key, ARGV[6]))
  if not valid_lease(owner_lease, ARGV[6], ARGV[2])
     or owner_lease.owner_id ~= ARGV[7]
     or owner_lease.generation ~= allocation.generation then
    return cjson.encode({status='owner_mismatch', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
  end
end

local transition_owned = allocation.state == 'resident'
  or allocation.state == 'draining' or allocation.state == 'unloading'
if transition_owned then
  local transition = ledger.transition
  local owner_generation = allocation.generation
  if ARGV[5] ~= '' then owner_generation = ARGV[5] end
  if not transition or ARGV[8] == '' or ARGV[9] == ''
     or transition.resource_id ~= ARGV[1]
     or transition.backend_id ~= ARGV[2]
     or transition.owner_id ~= ARGV[8]
     or transition.operation ~= ARGV[9]
     or transition.generation ~= owner_generation then
    return cjson.encode({status='owner_mismatch', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
  end
end

if (allocation.state == 'draining' and ARGV[4] == 'unloading'
    or allocation.state == 'unloading' and ARGV[4] == 'unloaded')
   and lease_count > 0 then
  return cjson.encode({status='active_leases', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end
if workload_owned and (ARGV[4] == 'unloaded' or ARGV[4] == 'cpu_fallback')
   and lease_count ~= 1 then
  return cjson.encode({status='active_leases', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
end

local committed = 0
local entries = redis.call('HGETALL', KEYS[2])
for i = 1, #entries, 2 do
  local decoded_ok, item = pcall(cjson.decode, entries[i + 1])
  if not decoded_ok or not valid_allocation(item, entries[i]) then
    return cjson.encode({status='ledger_corrupt', committed_mb=committed})
  end
  if counted[item.state] then committed = committed + tonumber(item.budget_mb) end
end
local previous_state = allocation.state
allocation.state = ARGV[4]
if counted[previous_state] and not counted[allocation.state] then
  committed = committed - tonumber(allocation.budget_mb)
elseif not counted[previous_state] and counted[allocation.state] then
  committed = committed + tonumber(allocation.budget_mb)
end
if ARGV[5] ~= '' then allocation.generation = ARGV[5] end
if allocation.state ~= 'reserving' and allocation.state ~= 'loading' then
  allocation.reservation_lease_id = nil
  allocation.reservation_owner_id = nil
end
allocation.last_used_at_ms = now_ms()
redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
redis.call('HSET', KEYS[2], ARGV[2], cjson.encode(allocation))
redis.call('HSET', KEYS[1], 'committed_mb', tostring(committed), 'updated_at_ms', tostring(now_ms()))
return cjson.encode({status='transitioned', state=allocation.state, generation=allocation.generation, committed_mb=committed})
"""
)


def _validate_nonempty(value: str, field: str, *, max_length: int = 512) -> str:
    if not isinstance(value, str) or not value or len(value) > max_length:
        raise ValueError(f"{field} must be a non-empty string up to {max_length} chars")
    return value


def _validate_positive_int(value: int, field: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value <= 0
        or value > _MAX_REDIS_SAFE_INTEGER
    ):
        raise ValueError(f"{field} must be a positive Redis-safe integer")
    return value


def _validate_redis_safe_int(value: int, field: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or abs(value) > _MAX_REDIS_SAFE_INTEGER
    ):
        raise ValueError(f"{field} must be a Redis-safe integer")
    return value


def _validate_ttl_ms(value: int, field: str) -> int:
    value = _validate_positive_int(value, field)
    if value > _MAX_TTL_MS:
        raise ValueError(f"{field} must be at most {_MAX_TTL_MS} ms")
    return value


def _validate_generation(value: str) -> str:
    if (
        not isinstance(value, str)
        or _CANONICAL_POSITIVE_INT64_RE.fullmatch(value) is None
        or int(value) > _MAX_POSITIVE_INT64
    ):
        raise ValueError("generation must be a canonical positive int64 string")
    return value


def normalize_gpu_backend_max_concurrency(value: Any, *, default: int = 4) -> int:
    """Normalize the global Redis limit without accepting bool or invalid strings."""

    candidate = default if value is None else value
    if (
        isinstance(candidate, bool)
        or not isinstance(candidate, int)
        or candidate <= 0
        or candidate > _MAX_GPU_BACKEND_CONCURRENCY
    ):
        raise ValueError(
            "max_concurrency must be a positive integer no greater than "
            f"{_MAX_GPU_BACKEND_CONCURRENCY}"
        )
    return candidate


def gpu_arbiter_keys(
    resource_id: str, *, namespace: str = _DEFAULT_NAMESPACE
) -> GPUArbiterKeys:
    _validate_nonempty(resource_id, "resource_id")
    if not isinstance(namespace, str) or _NAMESPACE_RE.fullmatch(namespace) is None:
        raise ValueError("invalid GPU arbiter Redis namespace")
    # Raw resource ids may legally contain braces today. A stable digest keeps every
    # key for this exact resource in one brace-safe Cluster hash slot.
    resource_tag = hashlib.sha256(resource_id.encode("utf-8")).hexdigest()
    prefix = f"{namespace}:{{{resource_tag}}}"
    return GPUArbiterKeys(
        resource_id=resource_id,
        resource_tag=resource_tag,
        card=f"{prefix}:card",
        allocations=f"{prefix}:allocations",
        queue=f"{prefix}:queue",
        transition=f"{prefix}:transition",
        namespace=namespace,
    )


class GPUArbiterStore:
    """One event-loop-owned async Redis ledger client."""

    def __init__(
        self,
        redis: Redis,
        *,
        namespace: str = _DEFAULT_NAMESPACE,
    ) -> None:
        if not isinstance(namespace, str) or _NAMESPACE_RE.fullmatch(namespace) is None:
            raise ValueError("invalid GPU arbiter Redis namespace")
        self._redis = redis
        self.namespace = namespace
        self._closed = False
        self._mark_card_not_ready_script = redis.register_script(
            _MARK_CARD_NOT_READY_LUA
        )
        self._reconcile_card_script = redis.register_script(_RECONCILE_CARD_LUA)
        self._admit_script = redis.register_script(_ADMIT_LUA)
        self._lease_script = redis.register_script(_LEASE_LUA)
        self._sweep_leases_script = redis.register_script(_SWEEP_LEASES_LUA)
        self._queue_script = redis.register_script(_QUEUE_LUA)
        self._transition_owner_script = redis.register_script(_TRANSITION_OWNER_LUA)
        self._transition_script = redis.register_script(_TRANSITION_LUA)

    @classmethod
    def from_url(
        cls,
        redis_url: str,
        *,
        namespace: str = _DEFAULT_NAMESPACE,
    ) -> "GPUArbiterStore":
        client = Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=_REDIS_OPERATION_TIMEOUT_SECONDS,
            socket_timeout=_REDIS_OPERATION_TIMEOUT_SECONDS,
            retry_on_timeout=False,
        )
        return cls(client, namespace=namespace)

    async def __aenter__(self) -> "GPUArbiterStore":
        self._ensure_open()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        try:
            await self.aclose()
        except GPUArbiterStoreError:
            if exc is None:
                raise

    async def aclose(self) -> None:
        if self._closed:
            return
        try:
            async with asyncio.timeout(_REDIS_CALL_DEADLINE_SECONDS):
                await self._redis.aclose()
        except (RedisError, OSError, TimeoutError) as exc:
            raise GPUArbiterStoreError("gpu_arbiter_unavailable") from exc
        self._closed = True

    async def ping(self) -> bool:
        return bool(await self._call(self._redis.ping))

    def _ensure_open(self) -> None:
        if self._closed:
            raise GPUArbiterStoreError("GPU arbiter store is closed")

    async def _call(
        self, operation: Callable[[], Awaitable[_RedisResultT]]
    ) -> _RedisResultT:
        self._ensure_open()
        try:
            async with asyncio.timeout(_REDIS_CALL_DEADLINE_SECONDS):
                return await operation()
        except (RedisError, OSError, TimeoutError) as exc:
            raise GPUArbiterStoreError("gpu_arbiter_unavailable") from exc

    def keys(self, resource_id: str) -> GPUArbiterKeys:
        return gpu_arbiter_keys(resource_id, namespace=self.namespace)

    async def _ledger_domain(
        self, keys: GPUArbiterKeys
    ) -> tuple[str, str, tuple[str, ...], str]:
        _, incarnation, raw, _ = await self._call(
            lambda: self._redis.hmget(
                keys.card,
                "resource_id",
                "ledger_incarnation",
                "backend_domain",
                "backend_domain_fingerprint",
            )
        )
        incarnation = incarnation or ""
        if raw is None:
            return "", hashlib.sha256(b"").hexdigest(), (), incarnation
        fingerprint = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        try:
            decoded = json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            return raw, fingerprint, (), incarnation
        if (
            not isinstance(decoded, list)
            or len(decoded) > _MAX_GPU_BACKENDS_PER_RESOURCE
            or any(
                not isinstance(item, str) or not item or len(item) > 128
                for item in decoded
            )
            or decoded != sorted(set(decoded))
            or json.dumps(decoded, separators=(",", ":")) != raw
        ):
            return raw, fingerprint, (), incarnation
        return raw, fingerprint, tuple(decoded), incarnation

    @staticmethod
    def _ledger_keys(keys: GPUArbiterKeys, backend_ids: Sequence[str]) -> list[str]:
        return [
            keys.card,
            keys.allocations,
            keys.queue,
            keys.transition,
            *(
                key
                for backend_id in backend_ids
                for key in (
                    keys.leases(backend_id),
                    keys.backend_queue(backend_id),
                )
            ),
        ]

    async def configure_card(
        self,
        resource_id: str,
        allocatable_mb: int,
        *,
        ready: bool,
    ) -> int:
        if not isinstance(ready, bool):
            raise ValueError("ready must be a boolean")
        if ready:
            raise ValueError("ready cards must be committed by reconcile_card")
        result = await self.mark_card_not_ready(
            resource_id,
            allocatable_mb,
            reason="bootstrap_incomplete",
        )
        return result.committed_mb

    async def mark_card_not_ready(
        self,
        resource_id: str,
        allocatable_mb: int,
        *,
        reason: str,
    ) -> GPUReconcileResult:
        keys = self.keys(resource_id)
        allocatable_mb = _validate_positive_int(allocatable_mb, "allocatable_mb")
        _validate_nonempty(reason, "reason", max_length=256)
        raw = await self._call(
            lambda: self._mark_card_not_ready_script(
                keys=[keys.card],
                args=[
                    resource_id,
                    allocatable_mb,
                    reason,
                    hashlib.sha256(b"[]").hexdigest(),
                    uuid.uuid4().hex,
                ],
            )
        )
        payload = self._decode_result(raw)
        return GPUReconcileResult(
            status=payload["status"],
            ready=False,
            ledger_revision=int(payload.get("ledger_revision", 0)),
            ledger_incarnation=str(payload.get("ledger_incarnation", "")),
            committed_mb=int(payload.get("committed_mb", 0)),
            reason=str(payload.get("reason", reason)),
        )

    async def reconcile_card(
        self,
        resource_id: str,
        allocatable_mb: int,
        *,
        expected_ledger_revision: int | None,
        expected_ledger_incarnation: str | None,
        backend_ids: Sequence[str],
        allocations: Sequence[GPUAllocation],
        lease_cleanup: Mapping[str, GPUReconcileLeaseCleanup] | None,
        ready: bool,
        reconcile_deadline_ms: int,
        repair_id: str,
    ) -> GPUReconcileResult:
        """Atomically repair one resource from a durable closed-world domain.

        ``backend_ids`` must be authoritative and include current members plus retained
        membership tombstones. Active registry rows alone are not sufficient:
        omitting a retired backend can hide a surviving per-backend Redis child
        key after a partial flush. The P3c-2 reconciler is responsible for
        producing that durable domain evidence before enforce can call this
        primitive.
        """
        keys = self.keys(resource_id)
        allocatable_mb = _validate_positive_int(allocatable_mb, "allocatable_mb")
        reconcile_deadline_ms = _validate_positive_int(
            reconcile_deadline_ms, "reconcile_deadline_ms"
        )
        _validate_nonempty(repair_id, "repair_id", max_length=256)
        if not isinstance(ready, bool):
            raise ValueError("ready must be a boolean")
        if expected_ledger_revision is not None:
            if (
                isinstance(expected_ledger_revision, bool)
                or not isinstance(expected_ledger_revision, int)
                or expected_ledger_revision <= 0
                or expected_ledger_revision > _MAX_REDIS_SAFE_INTEGER
            ):
                raise ValueError(
                    "expected_ledger_revision must be a positive Redis-safe integer"
                )
        if (expected_ledger_revision is None) != (expected_ledger_incarnation is None):
            raise ValueError(
                "expected ledger revision and incarnation must be supplied together"
            )
        if expected_ledger_incarnation is not None:
            _validate_nonempty(
                expected_ledger_incarnation,
                "expected_ledger_incarnation",
                max_length=128,
            )

        domain: list[str] = []
        seen_backend_ids: set[str] = set()
        for backend_id in backend_ids:
            backend_id = _validate_nonempty(backend_id, "backend_id", max_length=128)
            if backend_id in seen_backend_ids:
                raise ValueError("backend_ids must not contain duplicates")
            seen_backend_ids.add(backend_id)
            domain.append(backend_id)
        domain.sort()
        if len(domain) > _MAX_GPU_BACKENDS_PER_RESOURCE:
            raise ValueError("backend_ids exceeds the per-resource safety limit")
        if ready and not domain:
            raise ValueError("ready reconciliation requires a backend domain")
        domain_json = json.dumps(domain, separators=(",", ":"))
        domain_fingerprint = hashlib.sha256(domain_json.encode("utf-8")).hexdigest()

        allocation_payloads: list[dict[str, Any]] = []
        seen_allocations: set[str] = set()
        for allocation in allocations:
            if not isinstance(allocation, GPUAllocation):
                raise ValueError("allocations must contain GPUAllocation values")
            if allocation.backend_id not in seen_backend_ids:
                raise ValueError("allocation backend is outside backend_ids")
            if allocation.backend_id in seen_allocations:
                raise ValueError("allocations must not contain duplicate backends")
            seen_allocations.add(allocation.backend_id)
            allocation_payloads.append(self._allocation_to_payload(allocation))
        allocation_payloads.sort(key=lambda item: item["backend_id"])

        cleanup_payload: dict[str, dict[str, Any]] = {}
        for backend_id, evidence in (lease_cleanup or {}).items():
            if backend_id not in seen_backend_ids:
                raise ValueError("lease cleanup backend is outside backend_ids")
            if not isinstance(evidence, GPUReconcileLeaseCleanup):
                raise ValueError(
                    "lease_cleanup values must be GPUReconcileLeaseCleanup"
                )
            observed_idle_at_ms = _validate_positive_int(
                evidence.observed_idle_at_ms, "observed_idle_at_ms"
            )
            lease_ids: list[str] = []
            seen_lease_ids: set[str] = set()
            for lease_id in evidence.lease_ids:
                lease_id = _validate_nonempty(lease_id, "lease_id", max_length=256)
                if lease_id in seen_lease_ids:
                    raise ValueError("lease cleanup ids must be unique")
                seen_lease_ids.add(lease_id)
                lease_ids.append(lease_id)
            cleanup_payload[backend_id] = {
                "observed_idle_at_ms": observed_idle_at_ms,
                "lease_ids": sorted(lease_ids),
            }

        repair_document = {
            "resource_id": resource_id,
            "allocatable_mb": allocatable_mb,
            "backend_ids": domain,
            "allocations": allocation_payloads,
            "lease_cleanup": cleanup_payload,
            "ready": ready,
            "reconcile_deadline_ms": reconcile_deadline_ms,
        }
        canonical_document = json.dumps(
            repair_document,
            sort_keys=True,
            separators=(",", ":"),
        )
        repair_fingerprint = hashlib.sha256(
            canonical_document.encode("utf-8")
        ).hexdigest()
        proposed_incarnation = uuid.uuid4().hex
        raw = await self._call(
            lambda: self._reconcile_card_script(
                keys=[
                    keys.card,
                    keys.allocations,
                    keys.queue,
                    keys.transition,
                    *(
                        key
                        for backend_id in domain
                        for key in (
                            keys.leases(backend_id),
                            keys.backend_queue(backend_id),
                        )
                    ),
                ],
                args=[
                    resource_id,
                    ""
                    if expected_ledger_revision is None
                    else str(expected_ledger_revision),
                    allocatable_mb,
                    "1" if ready else "0",
                    reconcile_deadline_ms,
                    repair_id,
                    json.dumps(
                        allocation_payloads,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                    json.dumps(
                        cleanup_payload,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                    repair_fingerprint,
                    domain_json,
                    domain_fingerprint,
                    expected_ledger_incarnation or "",
                    proposed_incarnation,
                    *domain,
                ],
            )
        )
        payload = self._decode_result(raw)
        return GPUReconcileResult(
            status=payload["status"],
            ready=bool(payload.get("ready", False)),
            ledger_revision=int(payload.get("ledger_revision", 0)),
            ledger_incarnation=str(payload.get("ledger_incarnation", "")),
            committed_mb=int(payload.get("committed_mb", 0)),
            purged_leases=int(payload.get("purged_leases", 0)),
            reason=str(payload.get("reason", "")),
            idempotent=bool(payload.get("idempotent", False)),
        )

    async def admit(
        self,
        resource_id: str,
        *,
        backend_id: str,
        budget_mb: int,
        generation: str,
        eviction_priority: int,
        evictable: bool,
        max_concurrency: int,
        lease_id: str,
        owner_id: str,
        operation: str,
        heartbeat_ttl_ms: int,
        hard_ttl_ms: int,
        backend_ticket_id: str | None = None,
        card_ticket_id: str | None = None,
    ) -> GPUAdmissionResult:
        keys = self.keys(resource_id)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        _validate_nonempty(lease_id, "lease_id", max_length=256)
        _validate_nonempty(owner_id, "owner_id", max_length=256)
        _validate_nonempty(operation, "operation", max_length=256)
        for ticket_id, field in (
            (backend_ticket_id, "backend_ticket_id"),
            (card_ticket_id, "card_ticket_id"),
        ):
            if ticket_id is not None:
                _validate_nonempty(ticket_id, field, max_length=256)
        budget_mb = _validate_positive_int(budget_mb, "budget_mb")
        generation = _validate_generation(generation)
        if isinstance(eviction_priority, bool) or not isinstance(
            eviction_priority, int
        ):
            raise ValueError("eviction_priority must be an integer")
        max_concurrency = normalize_gpu_backend_max_concurrency(max_concurrency)
        heartbeat_ttl_ms = _validate_ttl_ms(heartbeat_ttl_ms, "heartbeat_ttl_ms")
        hard_ttl_ms = _validate_ttl_ms(hard_ttl_ms, "hard_ttl_ms")
        if hard_ttl_ms < heartbeat_ttl_ms:
            raise ValueError("hard_ttl_ms must be >= heartbeat_ttl_ms")

        if not isinstance(evictable, bool):
            raise ValueError("evictable must be a boolean")
        eviction_priority = _validate_redis_safe_int(
            eviction_priority, "eviction_priority"
        )

        (
            domain_raw,
            domain_fingerprint,
            backend_ids,
            ledger_incarnation,
        ) = await self._ledger_domain(keys)

        raw = await self._call(
            lambda: self._admit_script(
                keys=self._ledger_keys(keys, backend_ids),
                args=[
                    resource_id,
                    backend_id,
                    budget_mb,
                    generation,
                    eviction_priority,
                    "1" if evictable else "0",
                    max_concurrency,
                    lease_id,
                    owner_id,
                    operation,
                    heartbeat_ttl_ms,
                    hard_ttl_ms,
                    backend_ticket_id or "",
                    card_ticket_id or "",
                    domain_raw,
                    domain_fingerprint,
                    ledger_incarnation,
                ],
            )
        )
        payload = self._decode_result(raw)
        state = payload.get("allocation_state")
        return GPUAdmissionResult(
            status=payload["status"],
            reason=str(payload.get("reason", "")),
            committed_mb=int(payload.get("committed_mb", 0)),
            lease_count=int(payload.get("lease_count", 0)),
            allocation_state=GPUAllocationState(state) if state else None,
            heartbeat_deadline_ms=self._optional_int(
                payload.get("heartbeat_deadline_ms")
            ),
            hard_deadline_ms=self._optional_int(payload.get("hard_deadline_ms")),
            idempotent=bool(payload.get("idempotent", False)),
        )

    async def heartbeat_lease(
        self,
        resource_id: str,
        *,
        backend_id: str,
        lease_id: str,
        owner_id: str,
        generation: str,
        heartbeat_ttl_ms: int,
    ) -> GPULeaseMutationResult:
        heartbeat_ttl_ms = _validate_ttl_ms(heartbeat_ttl_ms, "heartbeat_ttl_ms")
        return await self._mutate_lease(
            "heartbeat",
            resource_id,
            backend_id=backend_id,
            lease_id=lease_id,
            owner_id=owner_id,
            generation=generation,
            heartbeat_ttl_ms=heartbeat_ttl_ms,
        )

    async def mark_lease_uncertain(
        self,
        resource_id: str,
        *,
        backend_id: str,
        lease_id: str,
        owner_id: str,
        generation: str,
    ) -> GPULeaseMutationResult:
        return await self._mutate_lease(
            "uncertain",
            resource_id,
            backend_id=backend_id,
            lease_id=lease_id,
            owner_id=owner_id,
            generation=generation,
            heartbeat_ttl_ms=1,
        )

    async def release_lease(
        self,
        resource_id: str,
        *,
        backend_id: str,
        lease_id: str,
        owner_id: str,
        generation: str,
    ) -> GPULeaseMutationResult:
        return await self._mutate_lease(
            "release",
            resource_id,
            backend_id=backend_id,
            lease_id=lease_id,
            owner_id=owner_id,
            generation=generation,
            heartbeat_ttl_ms=1,
        )

    async def _mutate_lease(
        self,
        operation: Literal["heartbeat", "uncertain", "release"],
        resource_id: str,
        *,
        backend_id: str,
        lease_id: str,
        owner_id: str,
        generation: str,
        heartbeat_ttl_ms: int,
    ) -> GPULeaseMutationResult:
        keys = self.keys(resource_id)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        _validate_nonempty(lease_id, "lease_id", max_length=256)
        _validate_nonempty(owner_id, "owner_id", max_length=256)
        generation = _validate_generation(generation)
        raw = await self._call(
            lambda: self._lease_script(
                keys=[keys.leases(backend_id), keys.card, keys.allocations],
                args=[
                    operation,
                    lease_id,
                    owner_id,
                    generation,
                    heartbeat_ttl_ms,
                    resource_id,
                    backend_id,
                ],
            )
        )
        payload = self._decode_result(raw)
        lease_state = payload.get("lease_state")
        return GPULeaseMutationResult(
            status=payload["status"],
            lease_state=GPURequestLeaseState(lease_state) if lease_state else None,
            heartbeat_deadline_ms=self._optional_int(
                payload.get("heartbeat_deadline_ms")
            ),
            hard_deadline_ms=self._optional_int(payload.get("hard_deadline_ms")),
        )

    async def sweep_expired_leases(
        self, resource_id: str, *, backend_id: str
    ) -> tuple[int, int]:
        keys = self.keys(resource_id)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        raw = await self._call(
            lambda: self._sweep_leases_script(
                keys=[keys.leases(backend_id), keys.card],
                args=[resource_id, backend_id],
            )
        )
        payload = self._decode_result(raw)
        return int(payload.get("changed", 0)), int(payload.get("total", 0))

    async def enqueue_backend(
        self,
        resource_id: str,
        *,
        backend_id: str,
        ticket_id: str,
        owner_id: str,
        ttl_ms: int,
        max_queue_length: int = 10_000,
    ) -> GPUQueueResult:
        return await self._queue_operation(
            resource_id,
            "enqueue",
            ticket_id=ticket_id,
            backend_id=backend_id,
            owner_id=owner_id,
            kind="backend",
            ttl_ms=ttl_ms,
            max_queue_length=max_queue_length,
        )

    async def enqueue_card(
        self,
        resource_id: str,
        *,
        backend_id: str,
        ticket_id: str,
        owner_id: str,
        ttl_ms: int,
        max_queue_length: int = 10_000,
    ) -> GPUQueueResult:
        return await self._queue_operation(
            resource_id,
            "enqueue",
            ticket_id=ticket_id,
            backend_id=backend_id,
            owner_id=owner_id,
            kind="card",
            ttl_ms=ttl_ms,
            max_queue_length=max_queue_length,
        )

    async def queue_position(
        self,
        resource_id: str,
        *,
        backend_id: str,
        ticket_id: str,
        card_queue: bool,
    ) -> GPUQueueResult:
        return await self._queue_operation(
            resource_id,
            "position",
            ticket_id=ticket_id,
            backend_id=backend_id,
            owner_id="position",
            kind="card" if card_queue else "backend",
            ttl_ms=1,
            max_queue_length=1,
        )

    async def cancel_queue_ticket(
        self,
        resource_id: str,
        *,
        backend_id: str,
        ticket_id: str,
        owner_id: str,
        card_queue: bool,
    ) -> GPUQueueResult:
        return await self._queue_operation(
            resource_id,
            "cancel",
            ticket_id=ticket_id,
            backend_id=backend_id,
            owner_id=owner_id,
            kind="card" if card_queue else "backend",
            ttl_ms=1,
            max_queue_length=1,
        )

    async def _queue_operation(
        self,
        resource_id: str,
        operation: Literal["enqueue", "position", "cancel"],
        *,
        ticket_id: str,
        backend_id: str,
        owner_id: str,
        kind: Literal["backend", "card"],
        ttl_ms: int,
        max_queue_length: int,
    ) -> GPUQueueResult:
        _validate_nonempty(ticket_id, "ticket_id", max_length=256)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        _validate_nonempty(owner_id, "owner_id", max_length=256)
        ttl_ms = _validate_ttl_ms(ttl_ms, "ttl_ms")
        max_queue_length = _validate_positive_int(max_queue_length, "max_queue_length")
        if max_queue_length > _MAX_GPU_QUEUE_LENGTH:
            raise ValueError(
                f"max_queue_length must be at most {_MAX_GPU_QUEUE_LENGTH}"
            )
        keys = self.keys(resource_id)
        (
            domain_raw,
            domain_fingerprint,
            backend_ids,
            ledger_incarnation,
        ) = await self._ledger_domain(keys)
        raw = await self._call(
            lambda: self._queue_script(
                keys=self._ledger_keys(keys, backend_ids),
                args=[
                    operation,
                    ticket_id,
                    backend_id,
                    owner_id,
                    kind,
                    ttl_ms,
                    max_queue_length,
                    resource_id,
                    domain_raw,
                    domain_fingerprint,
                    ledger_incarnation,
                ],
            )
        )
        payload = self._decode_result(raw)
        return GPUQueueResult(
            status=payload["status"],
            ticket_id=payload.get("ticket_id", ticket_id),
            position=self._optional_int(payload.get("position")),
            expires_at_ms=self._optional_int(payload.get("expires_at_ms")),
        )

    async def acquire_transition_owner(
        self,
        resource_id: str,
        *,
        backend_id: str,
        owner_id: str,
        generation: str,
        operation: str,
        ttl_ms: int,
        require_idle: bool = False,
    ) -> GPUTransitionOwnerResult:
        if not isinstance(require_idle, bool):
            raise ValueError("require_idle must be a boolean")
        return await self._transition_owner_operation(
            "acquire",
            resource_id,
            backend_id=backend_id,
            owner_id=owner_id,
            generation=generation,
            operation_name=operation,
            ttl_ms=ttl_ms,
            require_idle=require_idle,
        )

    async def heartbeat_transition_owner(
        self,
        resource_id: str,
        *,
        backend_id: str,
        owner_id: str,
        generation: str,
        operation: str,
        ttl_ms: int,
    ) -> GPUTransitionOwnerResult:
        return await self._transition_owner_operation(
            "heartbeat",
            resource_id,
            backend_id=backend_id,
            owner_id=owner_id,
            generation=generation,
            operation_name=operation,
            ttl_ms=ttl_ms,
            require_idle=False,
        )

    async def release_transition_owner(
        self,
        resource_id: str,
        *,
        backend_id: str,
        owner_id: str,
        generation: str,
        operation: str,
    ) -> GPUTransitionOwnerResult:
        return await self._transition_owner_operation(
            "release",
            resource_id,
            backend_id=backend_id,
            owner_id=owner_id,
            generation=generation,
            operation_name=operation,
            ttl_ms=1,
            require_idle=False,
        )

    async def _transition_owner_operation(
        self,
        action: Literal["acquire", "heartbeat", "release"],
        resource_id: str,
        *,
        backend_id: str,
        owner_id: str,
        generation: str,
        operation_name: str,
        ttl_ms: int,
        require_idle: bool,
    ) -> GPUTransitionOwnerResult:
        keys = self.keys(resource_id)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        _validate_nonempty(owner_id, "owner_id", max_length=256)
        _validate_nonempty(operation_name, "operation", max_length=256)
        generation = _validate_generation(generation)
        ttl_ms = _validate_ttl_ms(ttl_ms, "ttl_ms")
        (
            domain_raw,
            domain_fingerprint,
            backend_ids,
            ledger_incarnation,
        ) = await self._ledger_domain(keys)
        raw = await self._call(
            lambda: self._transition_owner_script(
                keys=self._ledger_keys(keys, backend_ids),
                args=[
                    action,
                    resource_id,
                    backend_id,
                    owner_id,
                    generation,
                    operation_name,
                    ttl_ms,
                    "1" if require_idle else "0",
                    domain_raw,
                    domain_fingerprint,
                    ledger_incarnation,
                ],
            )
        )
        payload = self._decode_result(raw)
        return GPUTransitionOwnerResult(
            status=payload["status"],
            owner_id=payload.get("owner_id"),
            generation=payload.get("generation"),
            expires_at_ms=self._optional_int(payload.get("expires_at_ms")),
            idempotent=bool(payload.get("idempotent", False)),
        )

    async def transition_allocation(
        self,
        resource_id: str,
        *,
        backend_id: str,
        expected_generation: str,
        target_state: GPUAllocationState,
        next_generation: str | None = None,
        request_lease_id: str | None = None,
        request_owner_id: str | None = None,
        transition_owner_id: str | None = None,
        transition_operation: str | None = None,
    ) -> GPUTransitionResult:
        keys = self.keys(resource_id)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        expected_generation = _validate_generation(expected_generation)
        if next_generation is not None:
            next_generation = _validate_generation(next_generation)
        for value, field in (
            (request_lease_id, "request_lease_id"),
            (request_owner_id, "request_owner_id"),
            (transition_owner_id, "transition_owner_id"),
            (transition_operation, "transition_operation"),
        ):
            if value is not None:
                _validate_nonempty(value, field, max_length=256)
        (
            domain_raw,
            domain_fingerprint,
            backend_ids,
            ledger_incarnation,
        ) = await self._ledger_domain(keys)
        raw = await self._call(
            lambda: self._transition_script(
                keys=self._ledger_keys(keys, backend_ids),
                args=[
                    resource_id,
                    backend_id,
                    expected_generation,
                    target_state.value,
                    next_generation or "",
                    request_lease_id or "",
                    request_owner_id or "",
                    transition_owner_id or "",
                    transition_operation or "",
                    domain_raw,
                    domain_fingerprint,
                    ledger_incarnation,
                ],
            )
        )
        payload = self._decode_result(raw)
        state = payload.get("state")
        return GPUTransitionResult(
            status=payload["status"],
            state=GPUAllocationState(state) if state else None,
            generation=payload.get("generation"),
            committed_mb=int(payload.get("committed_mb", 0)),
        )

    async def snapshot(self, resource_id: str) -> GPUCardSnapshot:
        keys = self.keys(resource_id)
        for _ in range(_SNAPSHOT_MAX_ATTEMPTS):
            card_before = await self._call(lambda: self._redis.hgetall(keys.card))
            if not card_before or card_before.get("resource_id") != resource_id:
                raise GPUArbiterStoreError("gpu_arbiter_not_ready")
            try:
                revision_before = int(card_before["ledger_revision"])
                if revision_before <= 0 or revision_before > _MAX_REDIS_SAFE_INTEGER:
                    raise ValueError("ledger revision is invalid")
                incarnation_before = _validate_nonempty(
                    card_before["ledger_incarnation"],
                    "ledger_incarnation",
                    max_length=128,
                )
                domain_raw = card_before["backend_domain"]
                backend_ids = json.loads(domain_raw)
                if (
                    not isinstance(backend_ids, list)
                    or len(backend_ids) > _MAX_GPU_BACKENDS_PER_RESOURCE
                    or any(
                        not isinstance(item, str) or not item or len(item) > 128
                        for item in backend_ids
                    )
                    or backend_ids != sorted(set(backend_ids))
                    or json.dumps(backend_ids, separators=(",", ":")) != domain_raw
                    or hashlib.sha256(domain_raw.encode("utf-8")).hexdigest()
                    != card_before["backend_domain_fingerprint"]
                ):
                    raise ValueError("backend domain is invalid")
                allocation_count = int(
                    await self._call(lambda: self._redis.hlen(keys.allocations))
                )
                if allocation_count > _MAX_GPU_BACKENDS_PER_RESOURCE:
                    raise ValueError("allocation domain exceeds safety limit")
                allocation_items = await self._call(
                    lambda: self._redis.hgetall(keys.allocations)
                )
                allocations = tuple(
                    sorted(
                        (
                            self._allocation_from_json(
                                raw, expected_backend_id=backend_id
                            )
                            for backend_id, raw in allocation_items.items()
                        ),
                        key=lambda item: item.backend_id,
                    )
                )
                leases: list[GPURequestLease] = []
                lease_counts: dict[str, int] = {}
                backend_queue_counts: dict[str, int] = {}
                for backend_id in backend_ids:
                    lease_count = int(
                        await self._call(
                            lambda backend_id=backend_id: self._redis.hlen(
                                keys.leases(backend_id)
                            )
                        )
                    )
                    if lease_count > _MAX_GPU_BACKEND_CONCURRENCY:
                        raise ValueError("lease domain exceeds safety limit")
                    lease_items = await self._call(
                        lambda backend_id=backend_id: self._redis.hgetall(
                            keys.leases(backend_id)
                        )
                    )
                    lease_counts[backend_id] = len(lease_items)
                    for lease_id, raw in lease_items.items():
                        leases.append(
                            self._lease_from_json(
                                raw,
                                expected_backend_id=backend_id,
                                expected_lease_id=lease_id,
                            )
                        )
                    backend_queue_counts[backend_id] = int(
                        await self._call(
                            lambda backend_id=backend_id: self._redis.llen(
                                keys.backend_queue(backend_id)
                            )
                        )
                    )
                card_queue_count = int(
                    await self._call(lambda: self._redis.llen(keys.queue))
                )
                transition_raw = await self._call(
                    lambda: self._redis.get(keys.transition)
                )
                card_after = await self._call(lambda: self._redis.hgetall(keys.card))
                if not card_after or card_after.get("resource_id") != resource_id:
                    raise GPUArbiterStoreError("gpu_arbiter_not_ready")
                incarnation_after = card_after.get("ledger_incarnation")
                if (
                    card_after.get("ledger_revision") != str(revision_before)
                    or incarnation_before != incarnation_after
                ):
                    continue
                revision_after = int(card_after["ledger_revision"])
                if (
                    card_queue_count + sum(backend_queue_counts.values())
                    > _MAX_GPU_QUEUE_LENGTH
                ):
                    raise ValueError("queue domain exceeds safety limit")
                leases_by_owner = {
                    (lease.backend_id, lease.lease_id): lease for lease in leases
                }
                for allocation in allocations:
                    if allocation.state not in {
                        GPUAllocationState.RESERVING,
                        GPUAllocationState.LOADING,
                    }:
                        continue
                    reservation = leases_by_owner.get(
                        (allocation.backend_id, allocation.reservation_lease_id)
                    )
                    if (
                        reservation is None
                        or reservation.owner_id != allocation.reservation_owner_id
                        or reservation.generation != allocation.generation
                    ):
                        raise ValueError("allocation reservation lease mismatch")
                if (
                    card_after.get("backend_domain") != domain_raw
                    or card_after.get("backend_domain_fingerprint")
                    != card_before["backend_domain_fingerprint"]
                    or int(card_after["allocation_count"]) != len(allocations)
                    or json.loads(card_after["lease_counts"]) != lease_counts
                    or int(card_after["card_queue_count"]) != card_queue_count
                    or json.loads(card_after["backend_queue_counts"])
                    != backend_queue_counts
                ):
                    raise GPUArbiterStoreError(
                        "GPU ledger integrity cache drift detected"
                    )
                allocation_backends = {
                    allocation.backend_id for allocation in allocations
                }
                if any(lease.backend_id not in allocation_backends for lease in leases):
                    raise GPUArbiterStoreError("GPU orphan lease detected")

                committed = sum(
                    allocation.budget_mb
                    for allocation in allocations
                    if allocation.counted
                )
                cached_committed = int(card_after["committed_mb"])
                if committed != cached_committed:
                    raise GPUArbiterStoreError("GPU committed cache drift detected")
                allocatable_mb = _validate_positive_int(
                    int(card_after["allocatable_mb"]), "allocatable_mb"
                )
                reconcile_deadline_ms = int(card_after["reconcile_deadline_ms"])
                if (
                    reconcile_deadline_ms < 0
                    or reconcile_deadline_ms > _MAX_REDIS_SAFE_INTEGER
                ):
                    raise ValueError("reconcile deadline is invalid")
                redis_time = await self._call(self._redis.time)
                redis_now_ms = (int(redis_time[0]) * 1000) + (
                    int(redis_time[1]) // 1000
                )
                transition_mirror = card_after["transition_mirror"]
                if transition_raw is not None:
                    if transition_raw != transition_mirror:
                        raise GPUArbiterStoreError(
                            "GPU transition mirror drift detected"
                        )
                elif transition_mirror:
                    mirrored_transition = json.loads(transition_mirror)
                    if (
                        not isinstance(mirrored_transition, dict)
                        or int(mirrored_transition["expires_at_ms"]) > redis_now_ms
                    ):
                        raise GPUArbiterStoreError(
                            "GPU transition key missing before expiry"
                        )
                return GPUCardSnapshot(
                    resource_id=resource_id,
                    allocatable_mb=allocatable_mb,
                    ready=(
                        card_after.get("bootstrap_state") == "ready"
                        and revision_after < _LEDGER_REVISION_REBASE_THRESHOLD
                        and reconcile_deadline_ms > redis_now_ms
                        and reconcile_deadline_ms <= redis_now_ms + 300_000
                    ),
                    reconcile_deadline_ms=reconcile_deadline_ms,
                    ledger_revision=revision_after,
                    ledger_incarnation=incarnation_before,
                    committed_mb=committed,
                    allocations=allocations,
                    leases=tuple(sorted(leases, key=lambda item: item.lease_id)),
                )
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                raise GPUArbiterStoreError("GPU ledger decode failed") from exc
        raise GPUArbiterStoreError("GPU ledger changed during snapshot")

    async def key_ttls(self, resource_id: str, *, backend_id: str) -> tuple[int, int]:
        keys = self.keys(resource_id)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        return (
            int(await self._call(lambda: self._redis.ttl(keys.allocations))),
            int(await self._call(lambda: self._redis.ttl(keys.leases(backend_id)))),
        )

    @staticmethod
    def _allocation_to_payload(allocation: GPUAllocation) -> dict[str, Any]:
        backend_id = _validate_nonempty(
            allocation.backend_id, "backend_id", max_length=128
        )
        if not isinstance(allocation.state, GPUAllocationState):
            raise ValueError("allocation state is invalid")
        budget_mb = _validate_positive_int(allocation.budget_mb, "budget_mb")
        generation = _validate_generation(allocation.generation)
        eviction_priority = _validate_redis_safe_int(
            allocation.eviction_priority, "eviction_priority"
        )
        if not isinstance(allocation.evictable, bool):
            raise ValueError("allocation evictable must be a boolean")
        max_concurrency = normalize_gpu_backend_max_concurrency(
            allocation.max_concurrency
        )
        last_used_at_ms = _validate_positive_int(
            allocation.last_used_at_ms, "last_used_at_ms"
        )
        if (allocation.reservation_lease_id is None) != (
            allocation.reservation_owner_id is None
        ):
            raise ValueError("allocation reservation owner is incomplete")
        reservation_state = allocation.state in {
            GPUAllocationState.RESERVING,
            GPUAllocationState.LOADING,
        }
        if reservation_state != (allocation.reservation_lease_id is not None):
            raise ValueError("allocation reservation owner does not match state")
        payload: dict[str, Any] = {
            "backend_id": backend_id,
            "state": allocation.state.value,
            "budget_mb": budget_mb,
            "generation": generation,
            "eviction_priority": eviction_priority,
            "evictable": allocation.evictable,
            "max_concurrency": max_concurrency,
            "last_used_at_ms": last_used_at_ms,
        }
        if allocation.reservation_lease_id is not None:
            payload["reservation_lease_id"] = _validate_nonempty(
                allocation.reservation_lease_id,
                "reservation_lease_id",
                max_length=256,
            )
            payload["reservation_owner_id"] = _validate_nonempty(
                allocation.reservation_owner_id,
                "reservation_owner_id",
                max_length=256,
            )
        return payload

    @staticmethod
    def _decode_result(raw: Any) -> dict[str, Any]:
        try:
            payload = json.loads(raw)
        except (TypeError, json.JSONDecodeError) as exc:
            raise GPUArbiterStoreError("invalid Redis script response") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("status"), str):
            raise GPUArbiterStoreError("invalid Redis script payload")
        return payload

    @staticmethod
    def _optional_int(value: Any) -> int | None:
        return int(value) if value is not None else None

    @staticmethod
    def _allocation_from_json(raw: str, *, expected_backend_id: str) -> GPUAllocation:
        value = json.loads(raw)
        if (
            not isinstance(value, dict)
            or value.get("backend_id") != expected_backend_id
        ):
            raise ValueError("allocation identity mismatch")
        budget_mb = _validate_positive_int(value.get("budget_mb"), "budget_mb")
        priority = value.get("eviction_priority")
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise ValueError("allocation priority is invalid")
        priority = _validate_redis_safe_int(priority, "eviction_priority")
        evictable = value.get("evictable")
        if not isinstance(evictable, bool):
            raise ValueError("allocation evictable is invalid")
        last_used_at_ms = _validate_positive_int(
            value.get("last_used_at_ms"), "last_used_at_ms"
        )
        if "max_concurrency" not in value:
            raise ValueError("allocation max_concurrency is missing")
        max_concurrency = normalize_gpu_backend_max_concurrency(
            value["max_concurrency"]
        )
        reservation_lease_id = value.get("reservation_lease_id")
        reservation_owner_id = value.get("reservation_owner_id")
        if (reservation_lease_id is None) != (reservation_owner_id is None):
            raise ValueError("allocation reservation owner is incomplete")
        state = GPUAllocationState(value["state"])
        has_reservation = reservation_lease_id is not None
        if has_reservation != (
            state in {GPUAllocationState.RESERVING, GPUAllocationState.LOADING}
        ):
            raise ValueError("allocation reservation owner does not match state")
        if reservation_lease_id is not None:
            _validate_nonempty(
                reservation_lease_id, "reservation_lease_id", max_length=256
            )
            _validate_nonempty(
                reservation_owner_id, "reservation_owner_id", max_length=256
            )
        return GPUAllocation(
            backend_id=value["backend_id"],
            state=state,
            budget_mb=budget_mb,
            generation=_validate_generation(value["generation"]),
            eviction_priority=priority,
            evictable=evictable,
            max_concurrency=max_concurrency,
            reservation_lease_id=reservation_lease_id,
            reservation_owner_id=reservation_owner_id,
            last_used_at_ms=last_used_at_ms,
        )

    @staticmethod
    def _lease_from_json(
        raw: str,
        *,
        expected_backend_id: str,
        expected_lease_id: str,
    ) -> GPURequestLease:
        value = json.loads(raw)
        if (
            not isinstance(value, dict)
            or value.get("backend_id") != expected_backend_id
            or value.get("lease_id") != expected_lease_id
        ):
            raise ValueError("lease identity mismatch")
        owner_id = _validate_nonempty(value.get("owner_id"), "owner_id", max_length=256)
        operation = _validate_nonempty(
            value.get("operation"), "operation", max_length=256
        )
        created_at_ms = _validate_positive_int(
            value.get("created_at_ms"), "created_at_ms"
        )
        heartbeat_deadline_ms = _validate_positive_int(
            value.get("heartbeat_deadline_ms"), "heartbeat_deadline_ms"
        )
        hard_deadline_ms = _validate_positive_int(
            value.get("hard_deadline_ms"), "hard_deadline_ms"
        )
        if not created_at_ms <= heartbeat_deadline_ms <= hard_deadline_ms:
            raise ValueError("lease deadlines are invalid")
        return GPURequestLease(
            lease_id=value["lease_id"],
            backend_id=value["backend_id"],
            owner_id=owner_id,
            generation=_validate_generation(value["generation"]),
            operation=operation,
            state=GPURequestLeaseState(value["state"]),
            created_at_ms=created_at_ms,
            heartbeat_deadline_ms=heartbeat_deadline_ms,
            hard_deadline_ms=hard_deadline_ms,
        )


__all__ = [
    "GPUAdmissionResult",
    "GPUAllocation",
    "GPUAllocationState",
    "GPUArbiterKeys",
    "GPUArbiterStore",
    "GPUArbiterStoreError",
    "GPUCardSnapshot",
    "GPULeaseMutationResult",
    "GPUQueueResult",
    "GPUReconcileLeaseCleanup",
    "GPUReconcileResult",
    "GPURequestLease",
    "GPURequestLeaseState",
    "GPUTransitionResult",
    "GPUTransitionOwnerResult",
    "gpu_arbiter_keys",
    "normalize_gpu_backend_max_concurrency",
]
