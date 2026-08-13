# TrackEval metric subset

`metrics.py` is adapted from TrackEval's HOTA, Identity and CLEAR metrics at
commit `12c8791b303e0a0b50f753af204249e622d0281a` under the bundled MIT license.

Only per-sequence evaluation is retained. Dataset adapters, plotting, CLI and
aggregation code are intentionally omitted. Deprecated NumPy scalar aliases
were replaced for NumPy 2 compatibility.
