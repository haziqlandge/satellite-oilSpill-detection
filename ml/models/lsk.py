"""Large Selective Kernel (LSK) attention — Li et al. 2023.

The module P004 §2.5 adds to YOLO, and the thing PHASE-02's ablation measures.
Its purpose here is shape discrimination: an operational discharge is long and
linear, a natural slick is irregular, and telling them apart needs a receptive
field large enough to see the whole feature — but *selectively*, because a
uniformly large kernel blurs the thin structures that make a discharge
recognisable.

P004 defers the module's description to its Supporting Text S1, which we do not
have, so this follows **Li et al.'s own LSKNet formulation** rather than a
paraphrase of it. `RESEARCH/CITATION_GRAPH` lists that paper Tier 1 for exactly
this reason.

The mechanism, in order:

1. Two depthwise convolutions give two receptive fields — a 5x5, and a 7x7
   dilated by 3 (an effective 19x19) applied *to the first branch's output*, so
   the second sees a genuinely larger context rather than a parallel view of the
   same one.
2. Each is projected to half the channels and concatenated.
3. The two are pooled **across channels** by both mean and max, giving a 2-channel
   spatial descriptor.
4. A 7x7 convolution over that descriptor produces one sigmoid weight per branch
   **per spatial position** — this is the "selective" part: the kernel size is
   chosen per pixel, not per layer.
5. The branches are mixed by those weights and projected back.
6. The result **gates the input** (`x * attn`). It is a modulation, never a
   replacement, so an untrained LSK degrades towards a no-op rather than towards
   noise.

Point 6 is why inserting this into a pretrained backbone is safe, and it is what
`test_lsk_is_a_gate_not_a_replacement` pins.
"""

from __future__ import annotations

import torch
from torch import nn

# Li et al.'s defaults, held constant across every ablation run exactly as P004
# did ("LSK used the original paper's default parameters"). Changing one makes
# our Table 1 incomparable to theirs, which is the point of reproducing it.
SPATIAL_KERNEL = 5
LARGE_KERNEL = 7
LARGE_DILATION = 3
SQUEEZE_KERNEL = 7
BRANCHES = 2


class LSKBlock(nn.Module):
    """Spatial selective-kernel attention over a feature map.

    Shape-preserving: `(N, C, H, W) -> (N, C, H, W)`. `channels` must be even,
    since each branch is projected to `channels // 2` before concatenation.
    """

    def __init__(self, channels: int) -> None:
        super().__init__()
        if channels < BRANCHES or channels % BRANCHES:
            raise ValueError(
                f"LSKBlock needs an even channel count of at least {BRANCHES}, got {channels}"
            )

        half = channels // BRANCHES

        # Depthwise: groups=channels. A dense conv here would add parameters
        # quadratic in channel count for no gain -- the selection is spatial.
        self.conv_spatial_small = nn.Conv2d(
            channels, channels, SPATIAL_KERNEL, padding=SPATIAL_KERNEL // 2, groups=channels
        )
        # Dilated, and fed the *small* branch's output, so its effective window
        # is 19x19 rather than a second independent 7x7.
        self.conv_spatial_large = nn.Conv2d(
            channels,
            channels,
            LARGE_KERNEL,
            stride=1,
            padding=((LARGE_KERNEL - 1) // 2) * LARGE_DILATION,
            groups=channels,
            dilation=LARGE_DILATION,
        )

        self.project_small = nn.Conv2d(channels, half, 1)
        self.project_large = nn.Conv2d(channels, half, 1)

        # Input is the 2-channel (mean, max) descriptor; output is one weight
        # per branch per position.
        self.squeeze = nn.Conv2d(BRANCHES, BRANCHES, SQUEEZE_KERNEL, padding=SQUEEZE_KERNEL // 2)
        self.expand = nn.Conv2d(half, channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        small = self.conv_spatial_small(x)
        large = self.conv_spatial_large(small)

        small = self.project_small(small)
        large = self.project_large(large)

        combined = torch.cat([small, large], dim=1)

        # Pool across channels, not space: the descriptor has to stay spatial or
        # the selection collapses to one weight for the whole map.
        average = torch.mean(combined, dim=1, keepdim=True)
        maximum, _ = torch.max(combined, dim=1, keepdim=True)
        descriptor = torch.cat([average, maximum], dim=1)

        weights = self.squeeze(descriptor).sigmoid()

        mixed = small * weights[:, 0:1, :, :] + large * weights[:, 1:2, :, :]
        attention = self.expand(mixed)
        gated: torch.Tensor = x * attention
        return gated


class LSKAttention(nn.Module):
    """`LSKBlock` wrapped in the projection and residual Li et al. use.

    The residual matters for the same reason the gate does: at initialisation
    the branch contributes little, so dropping this into a pretrained YOLO
    backbone perturbs it gently instead of destroying its features.
    """

    def __init__(self, channels: int | None = None) -> None:
        """`channels=None` defers construction until the first forward pass.

        Ultralytics resolves a YAML module through `globals()` and, for anything
        outside its `base_modules` set, passes the args verbatim with **no**
        channel injection (`nn/tasks.py`: `c2 = ch[f]`, `m(*args)`). A fixed
        channel count in the YAML would therefore be wrong at every scale but
        one, because the width multiplier changes it -- `n` and `x` differ by 6x.

        Inferring the count from the first input avoids hardcoding it and keeps
        this module decoupled from ultralytics' internals. Ultralytics runs a
        dummy forward while building the model, to compute strides, so the
        parameters exist well before the optimiser or any checkpoint is created.
        """

        super().__init__()
        self.project_in: nn.Conv2d | None = None
        self.activation = nn.GELU()
        self.attention: LSKBlock | None = None
        self.project_out: nn.Conv2d | None = None
        if channels is not None:
            self._build(channels)

    def _build(self, channels: int) -> None:
        self.project_in = nn.Conv2d(channels, channels, 1)
        self.attention = LSKBlock(channels)
        self.project_out = nn.Conv2d(channels, channels, 1)

    @property
    def is_built(self) -> bool:
        return self.attention is not None

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if not self.is_built:
            self._build(int(x.shape[1]))
            self.to(device=x.device, dtype=x.dtype)

        assert self.project_in is not None
        assert self.attention is not None
        assert self.project_out is not None

        residual = x
        out = self.project_in(x)
        out = self.activation(out)
        out = self.attention(out)
        out = self.project_out(out)
        combined: torch.Tensor = out + residual
        return combined
