"""One OpenOil run, forward or backward (PHASE-04).

The transport engine underneath the origin field. A slick observed at position X
was released *somewhere else, earlier*; without transport physics there is no
principled way to turn an observation into a search region, and P003 is the
cautionary example of joining two pipelines with an unspecified "correlation"
box instead.

**Backward running is a negative `time_step`, and it is verified, not assumed.**
OpenDrift documents the mechanism but PHASE-04 requires it be checked
empirically before anything is built on it. Measured on this install
(opendrift 1.14.11), constant current, zero diffusivity, 12 h out and back over
13.60 km:

    round-trip error   mean 0.38 m   max 0.89 m

That is ~7e-5 relative — integrator error, not physics. `test_advection_is_
reversible_without_diffusion` pins it.

**Two settings are chosen deliberately here rather than inherited.**

*Diffusion is OpenDrift's, never ours (C6).* Nordam 2019 showed naive random-walk
schemes accumulate particles spuriously where eddy diffusivity varies with
depth, and in a **backward** run those artefacts become false, confident-looking
origin locations. `horizontal_diffusivity` is a parameter passed to the model;
nothing in this repository integrates a random walk.

*Coastline action is set explicitly.* The default is `stranding`, and PHASE-04
names land-stranding of backward particles near the Mississippi delta as a known
failure. A stranded backward particle is not evidence that the slick originated
onshore -- it is a particle that hit the coastline mask and stopped. `previous`
lets it slide along instead, which is the honest default for a hindcast; pass
`coastline_action="stranding"` when running *forward*, where beaching is a real
outcome worth modelling.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import numpy as np

# Ten minutes. Short enough that advection error stays negligible over a 48 h
# horizon (measured above), long enough that an ensemble member is seconds
# rather than minutes -- PHASE-04 caps a whole ensemble at 5 minutes.
DEFAULT_TIME_STEP_S = 600

# P004's backward horizon. Beyond roughly this the field is too diffuse to
# discriminate, which `convergence.py` reports rather than papers over (C3).
DEFAULT_HORIZON_H = 48

# OpenDrift's own default oil. Held constant across ensemble members so the
# spread measures forcing and parameter uncertainty, not oil chemistry.
DEFAULT_OIL = "GENERIC MEDIUM CRUDE"


class DriftError(RuntimeError):
    """A drift run could not be performed as specified."""


@dataclass(frozen=True, slots=True)
class Forcing:
    """Constant-value forcing, for tests and for a cache miss with no network.

    Real runs attach CMEMS and ERA5 readers instead. This exists so the engine,
    the origin field and the reversibility check can all be exercised without a
    network or an account -- which is what makes PHASE-04 buildable before the
    CMEMS credentials arrive.
    """

    u_current: float = 0.0
    v_current: float = 0.0
    u_wind: float = 0.0
    v_wind: float = 0.0

    def as_reader(self) -> Any:
        from opendrift.readers import reader_constant

        return reader_constant.Reader(
            {
                "x_sea_water_velocity": self.u_current,
                "y_sea_water_velocity": self.v_current,
                "x_wind": self.u_wind,
                "y_wind": self.v_wind,
                "land_binary_mask": 0,
            }
        )


@dataclass(frozen=True, slots=True)
class DriftResult:
    """Particle positions at the end of a run, plus the history."""

    lon: np.ndarray
    lat: np.ndarray
    times: tuple[datetime, ...]
    # (timestep, particle) history, for building a time-resolved origin field.
    lon_history: np.ndarray
    lat_history: np.ndarray
    backward: bool
    seed_lon: float | np.ndarray = field(default=0.0)
    seed_lat: float | np.ndarray = field(default=0.0)

    @property
    def particle_count(self) -> int:
        return int(self.lon.size)


def run_drift(
    *,
    lon: float | np.ndarray,
    lat: float | np.ndarray,
    start: datetime,
    hours: int = DEFAULT_HORIZON_H,
    backward: bool = True,
    number: int = 500,
    radius_m: float = 0.0,
    forcing: Forcing | None = None,
    readers: list[Any] | None = None,
    horizontal_diffusivity: float = 0.0,
    wind_drift_factor: float = 0.03,
    time_step_s: int = DEFAULT_TIME_STEP_S,
    oil_type: str = DEFAULT_OIL,
    coastline_action: str | None = None,
    vertical_mixing: bool = False,
) -> DriftResult:
    """Run one OpenOil simulation and return its particle history.

    `backward=True` negates the time step; `hours` is always a positive
    duration.

    Two properties of the returned history, both measured rather than assumed,
    because the origin field is built directly on them:

    * **`times` DESCENDS for a backward run.** `times[0]` is the observation and
      `times[-1]` is the earliest reconstructed instant. Code that assumes an
      ascending axis will build the origin field back to front.
    * **History is stored as float32**, so `history[0]` matches the seed to
      about 1e-5, not to machine epsilon. A tighter comparison than that fails
      for no real reason.
    """

    if hours <= 0:
        raise DriftError(f"hours must be positive, got {hours}")
    if number < 1:
        raise DriftError(f"number must be at least 1, got {number}")
    if horizontal_diffusivity < 0:
        raise DriftError(f"diffusivity must be non-negative, got {horizontal_diffusivity}")

    from opendrift.models.openoil import OpenOil

    model = OpenOil(loglevel=50, weathering_model="noaa")

    for reader in readers or []:
        model.add_reader(reader)
    if forcing is not None:
        model.add_reader(forcing.as_reader())
    if not readers and forcing is None:
        raise DriftError("a drift run needs forcing: pass `forcing` or `readers`")

    # C6: diffusion is OpenDrift's. This sets its parameter; it does not
    # implement a random walk here.
    model.set_config("environment:constant:horizontal_diffusivity", horizontal_diffusivity)
    model.set_config("drift:vertical_mixing", vertical_mixing)
    model.set_config("seed:oil_type", oil_type)
    model.set_config("seed:wind_drift_factor", wind_drift_factor)

    """See the module docstring. A stranded *backward* particle is an artefact of
    the coastline mask rather than evidence of an onshore origin -- but `none`,
    which this used to pass, is the wrong way to say so: it removes coastline
    interaction entirely, so a backward parcel walks inland and the
    reconstruction then asserts the onshore origin the setting exists to avoid.
    Measured on the three real scenes with `none`, 11.8%, 21.2% and 33.3% of
    rendered parcels ended on dry ground.

    `previous` is what the docstring above has always specified: the parcel
    holds its last water position instead of crossing the shore, which states
    "it came from at least here" and stops there."""
    model.set_config("general:use_auto_landmask", False)
    model.set_config(
        "general:coastline_action", coastline_action or ("previous" if backward else "stranding")
    )

    model.seed_elements(lon=lon, lat=lat, number=number, time=start, radius=radius_m)

    step = -abs(time_step_s) if backward else abs(time_step_s)
    model.run(duration=timedelta(hours=hours), time_step=step, time_step_output=step)

    history = model.get_property("lon")[0], model.get_property("lat")[0]
    lon_history = np.ma.filled(np.asarray(history[0], dtype=float), np.nan)
    lat_history = np.ma.filled(np.asarray(history[1], dtype=float), np.nan)

    return DriftResult(
        lon=np.asarray(model.elements.lon, dtype=float).copy(),
        lat=np.asarray(model.elements.lat, dtype=float).copy(),
        times=tuple(model.get_time_array()[0]),
        lon_history=lon_history,
        lat_history=lat_history,
        backward=backward,
        seed_lon=lon,
        seed_lat=lat,
    )
