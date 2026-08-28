# SAR pre-processing container.
#
# ESA SNAP is installed here rather than natively because esa_snappy on Windows
# is a known install hazard (PLAN/CONSTRAINTS.md). This image owns the PHASE-01
# SNAP chain: calibrate -> Refined Lee -> land mask -> terrain correction.
#
# Filled in during PHASE-01; kept minimal here so PHASE-00 has no unused build.

FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    SNAP_HOME=/opt/snap

RUN apt-get update && apt-get install -y --no-install-recommends \
        default-jre-headless \
        gdal-bin libgdal-dev \
        wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# TODO(PHASE-01): install ESA SNAP + esa_snappy, and raise the JVM heap in
# gpt.vmoptions -- large IW scenes exhaust the default (-Xmx).

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e . || true

CMD ["python", "-m", "backend.cli", "doctor"]
