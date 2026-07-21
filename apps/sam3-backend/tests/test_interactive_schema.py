from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas import Context


@pytest.mark.parametrize(
    "context",
    [
        {"type": "mask"},
        {"type": "scribble"},
        {"type": "point", "points": [[1.1, 0.5]], "labels": [1]},
        {"type": "point", "points": [[0.5, 0.5]], "labels": [True]},
        {"type": "interactive_box", "bbox": [0.4, 0.2, 0.4, 0.8]},
        {
            "type": "point",
            "points": [[0.5, 0.5]] * 513,
            "labels": [1] * 513,
        },
    ],
)
def test_invalid_interactive_prompt_is_rejected_by_schema(context: dict) -> None:
    with pytest.raises(ValidationError):
        Context.model_validate(context)
