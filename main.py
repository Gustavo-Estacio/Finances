"""API FastAPI do app financeiro do casal.

Paginas (SPA multi-pagina servidas de `templates/`):
    /            visao geral        /reservas     reservas do casal
    /gastos      orcado vs realizado /individual   Ele x Ela
    /patrimonio  projecao com juros compostos

API REST (`/api/...`) sobre o repositorio JSON.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from database import repository
from models import FundUpdate, TransactionIn
from services import (
    build_expenses,
    build_individual,
    build_patrimonio,
    build_reserves,
    build_summary,
)

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES = BASE_DIR / "templates"
PERIOD = Query("month", pattern="^(month|quarter|year|all)$")

app = FastAPI(
    title="Finances — App Financeiro de Casal",
    description="Gestao financeira compartilhada: gastos, reservas, individual e patrimonio.",
    version="2.0.0",
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def _page(name: str) -> FileResponse:
    return FileResponse(TEMPLATES / name, media_type="text/html")


# ------------------------------------------------------------------ paginas
@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def page_index() -> FileResponse:
    return _page("index.html")


@app.get("/gastos", response_class=HTMLResponse, include_in_schema=False)
async def page_gastos() -> FileResponse:
    return _page("gastos.html")


@app.get("/reservas", response_class=HTMLResponse, include_in_schema=False)
async def page_reservas() -> FileResponse:
    return _page("reservas.html")


@app.get("/individual", response_class=HTMLResponse, include_in_schema=False)
async def page_individual() -> FileResponse:
    return _page("individual.html")


@app.get("/patrimonio", response_class=HTMLResponse, include_in_schema=False)
async def page_patrimonio() -> FileResponse:
    return _page("patrimonio.html")


# ---------------------------------------------------------------- API: meta
@app.get("/api/meta")
async def get_meta() -> Dict[str, Any]:
    envelopes = repository.funds()
    return {
        "meta": repository.meta(),
        "funds": [e for e in envelopes if e.get("kind", "fund") == "fund"],
        "reserves": [e for e in envelopes if e.get("kind") == "reserve"],
        "envelopes": envelopes,
        "categories": repository.categories(),
    }


# ------------------------------------------------------------ API: paineis
@app.get("/api/summary")
async def get_summary(period: str = PERIOD) -> Dict[str, Any]:
    return build_summary(repository, period)


@app.get("/api/expenses")
async def get_expenses(period: str = PERIOD) -> Dict[str, Any]:
    return build_expenses(repository, period)


@app.get("/api/reserves")
async def get_reserves(period: str = PERIOD) -> Dict[str, Any]:
    return build_reserves(repository, period)


@app.get("/api/individual")
async def get_individual(period: str = PERIOD) -> Dict[str, Any]:
    return build_individual(repository, period)


@app.get("/api/patrimonio")
async def get_patrimonio(
    view: str = Query("months", pattern="^(months|bimesters|years)$"),
    rate: float = Query(0.12, ge=0.0, le=0.5),
    horizon: int = Query(10, ge=1, le=30),
) -> Dict[str, Any]:
    return build_patrimonio(repository, view=view, rate=rate, horizon_years=horizon)


# ------------------------------------------------------------- API: fundos
@app.get("/api/funds")
async def get_funds() -> List[Dict[str, Any]]:
    return build_summary(repository, "all")["envelopes"]


@app.put("/api/funds/{fund_id}")
async def put_fund(fund_id: str, payload: FundUpdate) -> Dict[str, Any]:
    updated = repository.update_fund(fund_id, payload.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Fundo não encontrado")
    return updated


# -------------------------------------------------------- API: lancamentos
@app.get("/api/transactions")
async def list_transactions(
    type: Optional[str] = None,
    fund: Optional[str] = None,
    payer: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(500, ge=1, le=5000),
) -> List[Dict[str, Any]]:
    items = repository.transactions()
    if type:
        items = [t for t in items if t["type"] == type]
    if fund:
        items = [t for t in items if (t.get("fund") or "rotina") == fund]
    if payer:
        items = [t for t in items if t["payer"] == payer]
    if search:
        needle = search.lower().strip()
        items = [t for t in items
                 if needle in t["description"].lower() or needle in (t.get("category") or "").lower()]
    return items[:limit]


def _validated(payload: TransactionIn) -> Dict[str, Any]:
    try:
        normalized = payload.normalized()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if normalized.fund and not repository.fund(normalized.fund):
        raise HTTPException(status_code=422, detail="Fundo ou reserva inexistente")
    data = normalized.model_dump()
    data["date"] = normalized.date.isoformat()
    data["amount"] = round(float(normalized.amount), 2)
    return data


@app.post("/api/transactions", status_code=201)
async def create_transaction(payload: TransactionIn) -> Dict[str, Any]:
    return repository.add_transaction(_validated(payload))


@app.put("/api/transactions/{tx_id}")
async def update_transaction(tx_id: str, payload: TransactionIn) -> Dict[str, Any]:
    updated = repository.update_transaction(tx_id, _validated(payload))
    if not updated:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    return updated


@app.delete("/api/transactions/{tx_id}", status_code=204, response_class=JSONResponse)
async def delete_transaction(tx_id: str) -> JSONResponse:
    if not repository.delete_transaction(tx_id):
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    return JSONResponse(status_code=204, content=None)


@app.exception_handler(ValidationError)
async def validation_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": exc.errors()})
