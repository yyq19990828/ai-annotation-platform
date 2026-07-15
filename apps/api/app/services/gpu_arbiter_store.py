"""Redis-backed atomic runtime ledger for ADR-0049 GPU arbitration.

The store owns one async Redis client created in the current event loop. Callers must
close it before that loop exits; no client or connection pool is kept at module scope.
All scripts touch keys from one physical resource hash slot and never perform network
or database work while the atomic section is running.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import Enum
import hashlib
import json
import re
from typing import Any, Literal, TypeVar

from redis.asyncio import Redis
from redis.exceptions import RedisError


_DEFAULT_NAMESPACE = "gpu-arbiter:v1"
_NAMESPACE_RE = re.compile(r"[A-Za-z0-9:._-]{1,160}\Z")
_CANONICAL_POSITIVE_INT64_RE = re.compile(r"[1-9][0-9]{0,18}\Z")
_MAX_POSITIVE_INT64 = 9_223_372_036_854_775_807
_MAX_REDIS_SAFE_INTEGER = 9_007_199_254_740_991
_MAX_TTL_MS = 2_147_483_647
_REDIS_OPERATION_TIMEOUT_SECONDS = 1.0
_REDIS_CALL_DEADLINE_SECONDS = 2.0
_SNAPSHOT_MAX_ATTEMPTS = 8
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
    ledger_revision: int
    committed_mb: int
    allocations: tuple[GPUAllocation, ...]
    leases: tuple[GPURequestLease, ...]


_CONFIGURE_CARD_LUA = r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
local function valid_generation(value)
  if type(value) ~= 'string' or not string.match(value, '^[1-9][0-9]*$') then
    return false
  end
  if string.len(value) < 19 then return true end
  if string.len(value) > 19 then return false end
  return value <= '9223372036854775807'
end
local function valid_integer(value, minimum, maximum)
  return type(value) == 'number' and value == math.floor(value)
    and value >= minimum and value <= maximum
end
local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
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

local existing_resource = redis.call('HGET', KEYS[1], 'resource_id')
if existing_resource and existing_resource ~= ARGV[1] then
  return cjson.encode({status='ledger_corrupt', reason='resource_identity_mismatch'})
end

local counted = {
  unknown=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true
}
local valid = {
  unknown=true, unloaded=true, reserving=true, loading=true, resident=true,
  draining=true, unloading=true, cpu_fallback=true
}
local committed = 0
local lease_keys = {}
for i = 3, #KEYS do lease_keys[ARGV[i + 1]] = KEYS[i] end
local allocation_entries = redis.call('HGETALL', KEYS[2])
for i = 1, #allocation_entries, 2 do
  local ok, allocation = pcall(cjson.decode, allocation_entries[i + 1])
  local reservation_state = ok and type(allocation) == 'table'
    and (allocation.state == 'reserving' or allocation.state == 'loading')
  local has_reservation = ok and type(allocation) == 'table'
    and type(allocation.reservation_lease_id) == 'string'
    and allocation.reservation_lease_id ~= ''
    and type(allocation.reservation_owner_id) == 'string'
    and allocation.reservation_owner_id ~= ''
  local reservation_present = ok and type(allocation) == 'table'
    and (allocation.reservation_lease_id ~= nil
      or allocation.reservation_owner_id ~= nil)
  if not ok or type(allocation) ~= 'table'
     or not valid[allocation.state]
     or not valid_integer(allocation.budget_mb, 1, 9007199254740991)
     or not valid_generation(allocation.generation)
     or not valid_integer(allocation.eviction_priority, -9007199254740991, 9007199254740991)
     or type(allocation.evictable) ~= 'boolean'
     or not valid_integer(allocation.max_concurrency, 1, 2147483647)
     or not valid_integer(allocation.last_used_at_ms, 1, 9007199254740991)
     or allocation.backend_id ~= allocation_entries[i]
     or (reservation_state and not has_reservation)
     or (not reservation_state and reservation_present) then
    return cjson.encode({status='ledger_corrupt', reason='allocation_decode_failed'})
  end
  if reservation_state then
    local lease_key = lease_keys[allocation.backend_id]
    local reservation = lease_key
      and decode(redis.call('HGET', lease_key, allocation.reservation_lease_id))
    if not valid_lease(
        reservation, allocation.reservation_lease_id, allocation.backend_id)
       or reservation.owner_id ~= allocation.reservation_owner_id
       or reservation.generation ~= allocation.generation then
      return cjson.encode({status='ledger_corrupt', reason='reservation_lease_mismatch'})
    end
  end
  if counted[allocation.state] then
    committed = committed + tonumber(allocation.budget_mb)
  end
end

local allocatable = tonumber(ARGV[2])
if committed > allocatable then
  redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
  redis.call('HSET', KEYS[1],
    'resource_id', ARGV[1],
    'allocatable_mb', ARGV[2],
    'bootstrap_state', 'not_ready',
    'committed_mb', tostring(committed),
    'updated_at_ms', tostring(now_ms()))
  return cjson.encode({status='not_ready', reason='committed_exceeds_allocatable', committed_mb=committed})
end

redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
redis.call('HSET', KEYS[1],
  'resource_id', ARGV[1],
  'allocatable_mb', ARGV[2],
  'bootstrap_state', ARGV[3],
  'ledger_version', '1',
  'committed_mb', tostring(committed),
  'updated_at_ms', tostring(now_ms()))
return cjson.encode({status='configured', committed_mb=committed})
"""


_ADMIT_LUA = r"""
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
       or not valid_integer(allocation.max_concurrency, 1, 2147483647)
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
  return cjson.encode({status='not_ready', reason='bootstrap_incomplete', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
end
if committed > allocatable then
  redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
  redis.call('HSET', KEYS[1], 'bootstrap_state', 'not_ready', 'committed_mb', tostring(committed), 'updated_at_ms', tostring(now))
  return cjson.encode({status='not_ready', reason='committed_exceeds_allocatable', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
end
local transition_raw = redis.call('GET', KEYS[6])
if transition_raw then
  local transition = decode(transition_raw)
  if not transition or transition.resource_id ~= ARGV[1]
     or type(transition.backend_id) ~= 'string' or transition.backend_id == ''
     or type(transition.owner_id) ~= 'string' or transition.owner_id == ''
     or not valid_generation(transition.generation)
     or type(transition.operation) ~= 'string' or transition.operation == '' then
    return cjson.encode({status='ledger_corrupt', reason='transition_decode_failed', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
  end
  if transition.backend_id == ARGV[2] then
    return cjson.encode({status='transition_in_progress', reason='transition_owner_active', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
  end
end
local lease_count = 0
local lease_entries = redis.call('HGETALL', KEYS[3])
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
      return cjson.encode({status='ledger_corrupt', reason='idempotent_allocation_missing', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
    end
    if allocation.state == 'reserving' or allocation.state == 'loading' then
      local reservation = decode(redis.call(
        'HGET', KEYS[3], allocation.reservation_lease_id))
      if not valid_lease(
          reservation, allocation.reservation_lease_id, allocation.backend_id)
         or reservation.owner_id ~= allocation.reservation_owner_id
         or reservation.generation ~= allocation.generation then
        return cjson.encode({status='ledger_corrupt', reason='reservation_lease_mismatch', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
      end
    end
    if allocation.generation ~= ARGV[4] then
      return cjson.encode({status='stale_generation', reason='idempotent_allocation_generation_changed', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
    end
    if tonumber(allocation.budget_mb) ~= tonumber(ARGV[3])
       or tonumber(allocation.eviction_priority) ~= tonumber(ARGV[5])
       or allocation.evictable ~= (ARGV[6] == '1')
       or tonumber(allocation.max_concurrency) ~= tonumber(ARGV[7]) then
      return cjson.encode({status='lease_conflict', reason='idempotent_config_mismatch', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
    end
    if allocation.state ~= 'reserving' and allocation.state ~= 'loading' and allocation.state ~= 'resident' then
      return cjson.encode({status='lease_conflict', reason='idempotent_allocation_not_admissible', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
    end
    if existing_lease.operation ~= ARGV[10] then
      return cjson.encode({status='lease_conflict', reason='idempotent_operation_mismatch', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
    end
    if existing_lease.state ~= 'active' or tonumber(existing_lease.heartbeat_deadline_ms) <= now or tonumber(existing_lease.hard_deadline_ms) <= now then
      existing_lease.state = 'stale'
      redis.call('HINCRBY', KEYS[1], 'ledger_revision', 1)
      redis.call('HSET', KEYS[3], ARGV[8], cjson.encode(existing_lease))
      return cjson.encode({status='lease_conflict', reason='idempotent_lease_not_active', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
    end
    return cjson.encode({
      status='admitted', reason='idempotent_lease', idempotent=true,
      committed_mb=committed,
      lease_count=redis.call('HLEN', KEYS[3]),
      allocation_state=allocation and allocation.state or cjson.null,
      heartbeat_deadline_ms=existing_lease.heartbeat_deadline_ms,
      hard_deadline_ms=existing_lease.hard_deadline_ms
    })
  end
  return cjson.encode({status='lease_conflict', reason='lease_id_collision', committed_mb=committed, lease_count=redis.call('HLEN', KEYS[3])})
end

local allocation = decode(redis.call('HGET', KEYS[2], ARGV[2]))
local increment = 0
local concurrency_limit = tonumber(ARGV[7])
if allocation then
  if allocation.state == 'reserving' or allocation.state == 'loading' then
    local reservation = decode(redis.call(
      'HGET', KEYS[3], allocation.reservation_lease_id))
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
  KEYS[4], now, 'backend', ARGV[2])
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
    KEYS[5], now, 'card', '')
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
    redis.call('HSET', KEYS[3], item.id, cjson.encode(lease))
  elseif lease.state == 'uncertain' and tonumber(lease.hard_deadline_ms) <= now then
    lease.state = 'stale'
    redis.call('HSET', KEYS[3], item.id, cjson.encode(lease))
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
redis.call('HSET', KEYS[3], ARGV[8], cjson.encode(lease))
if increment > 0 then
  rewrite_queue(KEYS[5], card_live, consumed_card_ticket)
end
local consumed_backend_ticket = ''
if backend_head and backend_head.ticket_id == ARGV[13] then
  consumed_backend_ticket = ARGV[13]
end
rewrite_queue(KEYS[4], backend_live, consumed_backend_ticket)
redis.call('HSET', KEYS[1], 'committed_mb', tostring(committed), 'updated_at_ms', tostring(now))
return cjson.encode({
  status='admitted', reason=(increment > 0 and 'allocation_reserved' or 'allocation_reused'),
  idempotent=false, committed_mb=committed, lease_count=lease_count + 1,
  allocation_state=allocation.state,
  heartbeat_deadline_ms=heartbeat_deadline, hard_deadline_ms=hard_deadline
})
"""


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

if redis.call('HGET', KEYS[2], 'resource_id') ~= ARGV[6] then
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
  return cjson.encode({status='released'})
end
return redis.error_reply('unsupported gpu arbiter lease operation')
"""


_SWEEP_LEASES_LUA = r"""
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


_QUEUE_LUA = r"""
local function now_ms()
  local t = redis.call('TIME')
  return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end
local function valid_integer(value)
  return type(value) == 'number' and value == math.floor(value)
    and value >= 1 and value <= 9007199254740991
end
if redis.call('HGET', KEYS[2], 'resource_id') ~= ARGV[8] then
  return cjson.encode({status='not_ready', ticket_id=ARGV[2]})
end
local now = now_ms()
local entries = redis.call('LRANGE', KEYS[1], 0, -1)
local live = {}
local existing_position = nil
local seen = {}
for _, raw in ipairs(entries) do
  local ok, ticket = pcall(cjson.decode, raw)
  if not ok or type(ticket) ~= 'table'
     or not valid_integer(ticket.expires_at_ms)
     or not valid_integer(ticket.enqueued_at_ms)
     or ticket.enqueued_at_ms > ticket.expires_at_ms
     or type(ticket.ticket_id) ~= 'string' or ticket.ticket_id == ''
     or type(ticket.owner_id) ~= 'string' or ticket.owner_id == ''
     or type(ticket.backend_id) ~= 'string' or ticket.backend_id == ''
     or ticket.kind ~= ARGV[5]
     or (ARGV[5] == 'backend' and ticket.backend_id ~= ARGV[3])
     or seen[ticket.ticket_id] then
    return redis.error_reply('gpu arbiter queue decode failed')
  end
  seen[ticket.ticket_id] = true
  if tonumber(ticket.expires_at_ms) > now then
    table.insert(live, raw)
    if ticket.ticket_id == ARGV[2] then existing_position = #live end
  end
end
redis.call('DEL', KEYS[1])
for _, raw in ipairs(live) do redis.call('RPUSH', KEYS[1], raw) end

if ARGV[1] == 'enqueue' then
  if existing_position then
    local ticket = cjson.decode(live[existing_position])
    if ticket.owner_id ~= ARGV[4] or ticket.backend_id ~= ARGV[3] or ticket.kind ~= ARGV[5] then
      return cjson.encode({status='ticket_conflict', ticket_id=ARGV[2]})
    end
    return cjson.encode({status='queued', ticket_id=ARGV[2], position=existing_position, expires_at_ms=ticket.expires_at_ms})
  end
  if #live >= tonumber(ARGV[7]) then
    return cjson.encode({status='full', ticket_id=ARGV[2]})
  end
  local ticket = {
    ticket_id=ARGV[2], backend_id=ARGV[3], owner_id=ARGV[4], kind=ARGV[5],
    enqueued_at_ms=now, expires_at_ms=now + tonumber(ARGV[6])
  }
  redis.call('RPUSH', KEYS[1], cjson.encode(ticket))
  return cjson.encode({status='queued', ticket_id=ARGV[2], position=#live + 1, expires_at_ms=ticket.expires_at_ms})
elseif ARGV[1] == 'cancel' then
  if not existing_position then return cjson.encode({status='missing', ticket_id=ARGV[2]}) end
  local existing_ticket = cjson.decode(live[existing_position])
  if existing_ticket.backend_id ~= ARGV[3] or existing_ticket.kind ~= ARGV[5] then
    return cjson.encode({status='ticket_conflict', ticket_id=ARGV[2], position=existing_position, expires_at_ms=existing_ticket.expires_at_ms})
  end
  if existing_ticket.owner_id ~= ARGV[4] then
    return cjson.encode({status='owner_mismatch', ticket_id=ARGV[2], position=existing_position, expires_at_ms=existing_ticket.expires_at_ms})
  end
  redis.call('DEL', KEYS[1])
  local position = 0
  for _, raw in ipairs(live) do
    local ticket = cjson.decode(raw)
    if ticket.ticket_id ~= ARGV[2] then
      redis.call('RPUSH', KEYS[1], raw)
      position = position + 1
    end
  end
  return cjson.encode({status='cancelled', ticket_id=ARGV[2]})
elseif ARGV[1] == 'position' then
  if not existing_position then return cjson.encode({status='missing', ticket_id=ARGV[2]}) end
  local ticket = cjson.decode(live[existing_position])
  if ticket.backend_id ~= ARGV[3] or ticket.kind ~= ARGV[5] then
    return cjson.encode({status='ticket_conflict', ticket_id=ARGV[2], position=existing_position, expires_at_ms=ticket.expires_at_ms})
  end
  return cjson.encode({status='queued', ticket_id=ARGV[2], position=existing_position, expires_at_ms=ticket.expires_at_ms})
end
return redis.error_reply('unsupported gpu arbiter queue operation')
"""


_TRANSITION_OWNER_LUA = r"""
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

if redis.call('HGET', KEYS[2], 'resource_id') ~= ARGV[2] then
  return cjson.encode({status='not_ready'})
end

local raw = redis.call('GET', KEYS[1])
local current = decode(raw)
if raw and not current then return redis.error_reply('gpu arbiter transition decode failed') end
if current and (
    current.resource_id ~= ARGV[2]
    or type(current.backend_id) ~= 'string' or current.backend_id == ''
    or type(current.owner_id) ~= 'string' or current.owner_id == ''
    or type(current.generation) ~= 'string'
    or type(current.operation) ~= 'string' or current.operation == ''
    or type(current.require_idle) ~= 'boolean'
    or type(current.created_at_ms) ~= 'number'
    or type(current.expires_at_ms) ~= 'number') then
  return redis.error_reply('gpu arbiter transition decode failed')
end

local function validate_acquire_target()
  local allocation_raw = redis.call('HGET', KEYS[3], ARGV[3])
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
  if ARGV[8] == '1' and redis.call('HLEN', KEYS[4]) > 0 then
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
      redis.call('PEXPIRE', KEYS[1], ARGV[7])
      current.expires_at_ms = now_ms() + tonumber(ARGV[7])
      redis.call('SET', KEYS[1], cjson.encode(current), 'PX', ARGV[7])
      return cjson.encode({status='acquired', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms, idempotent=true})
    end
    return cjson.encode({status='busy', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms})
  end
  local target_error, target_generation = validate_acquire_target()
  if target_error then
    return cjson.encode({status=target_error, generation=target_generation})
  end
  local owner = {
    resource_id=ARGV[2], backend_id=ARGV[3], owner_id=ARGV[4],
    generation=ARGV[5], operation=ARGV[6],
    require_idle=(ARGV[8] == '1'),
    created_at_ms=now_ms(), expires_at_ms=now_ms() + tonumber(ARGV[7])
  }
  redis.call('SET', KEYS[1], cjson.encode(owner), 'PX', ARGV[7])
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
  current.expires_at_ms = now_ms() + tonumber(ARGV[7])
  redis.call('SET', KEYS[1], cjson.encode(current), 'PX', ARGV[7])
  return cjson.encode({status='renewed', owner_id=current.owner_id, generation=current.generation, expires_at_ms=current.expires_at_ms})
elseif ARGV[1] == 'release' then
  redis.call('DEL', KEYS[1])
  return cjson.encode({status='released', owner_id=current.owner_id, generation=current.generation})
end
return redis.error_reply('unsupported gpu arbiter transition owner operation')
"""


_TRANSITION_LUA = r"""
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
    and valid_integer(item.max_concurrency, 1, 2147483647)
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
local lease_entries = redis.call('HGETALL', KEYS[3])
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
  owner_lease = decode(redis.call('HGET', KEYS[3], ARGV[6]))
  if not valid_lease(owner_lease, ARGV[6], ARGV[2])
     or owner_lease.owner_id ~= ARGV[7]
     or owner_lease.generation ~= allocation.generation then
    return cjson.encode({status='owner_mismatch', state=allocation.state, generation=allocation.generation, committed_mb=tonumber(redis.call('HGET', KEYS[1], 'committed_mb') or '0')})
  end
end

local transition_owned = allocation.state == 'resident'
  or allocation.state == 'draining' or allocation.state == 'unloading'
if transition_owned then
  local transition = decode(redis.call('GET', KEYS[4]))
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
        or candidate > 2_147_483_647
    ):
        raise ValueError("max_concurrency must be a positive integer")
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
        self._configure_card_script = redis.register_script(_CONFIGURE_CARD_LUA)
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

    async def configure_card(
        self,
        resource_id: str,
        allocatable_mb: int,
        *,
        ready: bool,
    ) -> int:
        keys = self.keys(resource_id)
        allocatable_mb = _validate_positive_int(allocatable_mb, "allocatable_mb")
        if not isinstance(ready, bool):
            raise ValueError("ready must be a boolean")
        backend_ids = await self._call(
            lambda: self._redis.hkeys(keys.allocations)
        )
        raw = await self._call(
            lambda: self._configure_card_script(
                keys=[
                    keys.card,
                    keys.allocations,
                    *(keys.leases(backend_id) for backend_id in backend_ids),
                ],
                args=[
                    resource_id,
                    allocatable_mb,
                    "ready" if ready else "not_ready",
                    *backend_ids,
                ],
            )
        )
        payload = self._decode_result(raw)
        if payload.get("status") not in {"configured", "not_ready"}:
            raise GPUArbiterStoreError(str(payload.get("reason", "card configure failed")))
        return int(payload.get("committed_mb", 0))

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
        if isinstance(eviction_priority, bool) or not isinstance(eviction_priority, int):
            raise ValueError("eviction_priority must be an integer")
        max_concurrency = normalize_gpu_backend_max_concurrency(max_concurrency)
        heartbeat_ttl_ms = _validate_ttl_ms(
            heartbeat_ttl_ms, "heartbeat_ttl_ms"
        )
        hard_ttl_ms = _validate_ttl_ms(hard_ttl_ms, "hard_ttl_ms")
        if hard_ttl_ms < heartbeat_ttl_ms:
            raise ValueError("hard_ttl_ms must be >= heartbeat_ttl_ms")

        if not isinstance(evictable, bool):
            raise ValueError("evictable must be a boolean")
        eviction_priority = _validate_redis_safe_int(
            eviction_priority, "eviction_priority"
        )

        raw = await self._call(
            lambda: self._admit_script(
                keys=[
                    keys.card,
                    keys.allocations,
                    keys.leases(backend_id),
                    keys.backend_queue(backend_id),
                    keys.queue,
                    keys.transition,
                ],
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
        heartbeat_ttl_ms = _validate_ttl_ms(
            heartbeat_ttl_ms, "heartbeat_ttl_ms"
        )
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
        keys = self.keys(resource_id)
        return await self._queue_operation(
            keys.backend_queue(backend_id),
            keys.card,
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
        keys = self.keys(resource_id)
        return await self._queue_operation(
            keys.queue,
            keys.card,
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
        keys = self.keys(resource_id)
        queue_key = keys.queue if card_queue else keys.backend_queue(backend_id)
        return await self._queue_operation(
            queue_key,
            keys.card,
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
        keys = self.keys(resource_id)
        queue_key = keys.queue if card_queue else keys.backend_queue(backend_id)
        return await self._queue_operation(
            queue_key,
            keys.card,
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
        queue_key: str,
        card_key: str,
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
        max_queue_length = _validate_positive_int(
            max_queue_length, "max_queue_length"
        )
        raw = await self._call(
            lambda: self._queue_script(
                keys=[queue_key, card_key],
                args=[
                    operation,
                    ticket_id,
                    backend_id,
                    owner_id,
                    kind,
                    ttl_ms,
                    max_queue_length,
                    resource_id,
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
        raw = await self._call(
            lambda: self._transition_owner_script(
                keys=[
                    keys.transition,
                    keys.card,
                    keys.allocations,
                    keys.leases(backend_id),
                ],
                args=[
                    action,
                    resource_id,
                    backend_id,
                    owner_id,
                    generation,
                    operation_name,
                    ttl_ms,
                    "1" if require_idle else "0",
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
        raw = await self._call(
            lambda: self._transition_script(
                keys=[
                    keys.card,
                    keys.allocations,
                    keys.leases(backend_id),
                    keys.transition,
                ],
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
                for allocation in allocations:
                    lease_items = await self._call(
                        lambda allocation=allocation: self._redis.hgetall(
                            keys.leases(allocation.backend_id)
                        )
                    )
                    for lease_id, raw in lease_items.items():
                        leases.append(
                            self._lease_from_json(
                                raw,
                                expected_backend_id=allocation.backend_id,
                                expected_lease_id=lease_id,
                            )
                        )
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
                card_after = await self._call(
                    lambda: self._redis.hgetall(keys.card)
                )
                if not card_after or card_after.get("resource_id") != resource_id:
                    raise GPUArbiterStoreError("gpu_arbiter_not_ready")
                revision_after = int(card_after["ledger_revision"])
                if revision_before != revision_after:
                    continue

                committed = sum(
                    allocation.budget_mb
                    for allocation in allocations
                    if allocation.counted
                )
                cached_committed = int(card_after["committed_mb"])
                if committed != cached_committed:
                    raise GPUArbiterStoreError(
                        "GPU committed cache drift detected"
                    )
                allocatable_mb = _validate_positive_int(
                    int(card_after["allocatable_mb"]), "allocatable_mb"
                )
                if revision_after < 0:
                    raise ValueError("ledger revision is invalid")
                return GPUCardSnapshot(
                    resource_id=resource_id,
                    allocatable_mb=allocatable_mb,
                    ready=card_after.get("bootstrap_state") == "ready",
                    ledger_revision=revision_after,
                    committed_mb=committed,
                    allocations=allocations,
                    leases=tuple(sorted(leases, key=lambda item: item.lease_id)),
                )
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                raise GPUArbiterStoreError("GPU ledger decode failed") from exc
        raise GPUArbiterStoreError("GPU ledger changed during snapshot")

    async def key_ttls(
        self, resource_id: str, *, backend_id: str
    ) -> tuple[int, int]:
        keys = self.keys(resource_id)
        _validate_nonempty(backend_id, "backend_id", max_length=128)
        return (
            int(await self._call(lambda: self._redis.ttl(keys.allocations))),
            int(
                await self._call(
                    lambda: self._redis.ttl(keys.leases(backend_id))
                )
            ),
        )

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
    def _allocation_from_json(
        raw: str, *, expected_backend_id: str
    ) -> GPUAllocation:
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get("backend_id") != expected_backend_id:
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
    "GPURequestLease",
    "GPURequestLeaseState",
    "GPUTransitionResult",
    "GPUTransitionOwnerResult",
    "gpu_arbiter_keys",
    "normalize_gpu_backend_max_concurrency",
]
