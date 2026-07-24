from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas import Context


def test_native_mask_output_requires_prompt_revision() -> None:
    with pytest.raises(ValidationError, match="prompt_revision"):
        Context(
            type="point",
            points=[[0.5, 0.5]],
            output_geometry="mask",
        )

    context = Context(
        type="interactive_box",
        bbox=[0.1, 0.1, 0.9, 0.9],
        output_geometry="mask",
        prompt_revision="revision-1",
    )
    assert context.output_geometry == "mask"
