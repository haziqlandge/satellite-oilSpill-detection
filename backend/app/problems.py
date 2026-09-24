"""RFC 7807 problem details for every error the API returns (`INTERFACES.md` §3).

One exception: `insufficient-evidence` is a problem document at HTTP **200**. It
is the answer when nobody can be ranked -- a result, not a failure (C3) -- and
the client must render it prominently rather than as an empty list.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

MEDIA_TYPE = "application/problem+json"


class ProblemError(Exception):
    """Raise anywhere in a route to answer with a problem document."""

    def __init__(self, status: int, slug: str, title: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.slug = slug
        self.title = title
        self.detail = detail


def problem(status: int, slug: str, title: str, detail: str, instance: str | None = None) -> JSONResponse:
    body = {"type": f"/errors/{slug}", "title": title, "status": status, "detail": detail}
    if instance:
        body["instance"] = instance
    return JSONResponse(body, status_code=status, media_type=MEDIA_TYPE)


def install(app: FastAPI) -> None:
    @app.exception_handler(ProblemError)
    async def _problem(request: Request, error: ProblemError) -> JSONResponse:
        return problem(error.status, error.slug, error.title, error.detail, str(request.url.path))

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, error: StarletteHTTPException) -> JSONResponse:
        slug = {404: "not-found", 405: "method-not-allowed"}.get(error.status_code, "http-error")
        return problem(error.status_code, slug, str(error.detail), str(error.detail), str(request.url.path))

    @app.exception_handler(RequestValidationError)
    async def _invalid(request: Request, error: RequestValidationError) -> JSONResponse:
        detail = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in error.errors())
        return problem(422, "invalid-request", "The request is not valid", detail, str(request.url.path))
