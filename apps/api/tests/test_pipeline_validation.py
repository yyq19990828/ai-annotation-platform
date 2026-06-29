"""v0.19.3 WS3 · 能力判据跨端契约 (后端侧) + pipeline_validation 纯函数单测。

与前端 vitest (apps/web/src/pages/AIPreAnnotate/utils/capabilityContract.test.ts) 共读同一份
fixture (apps/web/src/__fixtures__/capability-validation-cases.json)。本测喂
check_capability_violations 断言违例码序列与 expect_codes 一致。后端判据漂移 → 本测红。
"""

import json
from pathlib import Path

import pytest

from app.services.pipeline_validation import check_capability_violations

# fixture 落在前端包内 (vitest 受 tsconfig include=src 约束只能 import src 下文件);
# pytest 读任意路径无碍, 故走仓库根的文件路径常量。parents[3] = 仓库根。
_FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "apps/web/src/__fixtures__/capability-validation-cases.json"
)


def _cases():
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return data["cases"]


def test_fixture_exists_and_nonempty():
    assert _FIXTURE.exists(), f"契约 fixture 缺失: {_FIXTURE}"
    assert len(_cases()) > 0


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
def test_capability_contract(case):
    violations = check_capability_violations(
        case["model_caps"],
        where="stage 1 ",
        model_id="m",
        writes_attributes=case["writes_attributes"],
    )
    codes = [v.code for v in violations]
    # 序列断言 (强于集合): 后端 append 顺序 batchable → class, 与 fixture expect_codes 一致。
    assert codes == case["expect_codes"]


def test_violation_detail_carries_context():
    """detail 成句带 where 前缀 + model_id (派发期 422 文案不漂移)。"""
    [v] = check_capability_violations(
        {"resource_profile": {"batchable": False}},
        where="源阶段",
        model_id="seg-x",
        writes_attributes=False,
    )
    assert v.code == "not_batchable"
    assert "源阶段" in v.detail
    assert "batchable=false" in v.detail
    assert "'seg-x'" in v.detail
