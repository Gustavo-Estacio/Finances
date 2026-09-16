"""API FastAPI do app financeiro do casal.

Rotas REST enxutas (`/api/summary`, `/api/transactions`, `/api/funds`) sobre o
repositorio JSON, mais a entrega da SPA em `templates/index.html`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from database import repository
from models import FundUpdate, TransactionIn
from services import build_summary

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="Finances — App Financeiro de Casal",
    description="Gestao financeira compartilhada com fundos, aportes e dashboards.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index(request: Request) -> HTMLResponse:
    return FileResponse(BASE_DIR / "templates" / "index.html", media_type="text/html")


@app.get("/api/meta")
async def get_meta() -> Dict[str, Any]:
    return {
        "meta": repository.meta(),
        "funds": repository.funds(),
        "categories": repository.categories(),
    }


@app.get("/api/summary")
async def get_summary(period: str = Query("month", pattern="^(month|quarter|year|all)$")) -> Dict[str, Any]:
    return build_summary(repository, period)


@app.get("/api/funds")
async def get_funds() -> List[Dict[str, Any]]:
    return build_summary(repository, "all")["funds"]


@app.put("/api/funds/{fund_id}")
async def put_fund(fund_id: str, payload: FundUpdate) -> Dict[str, Any]:
    updated = repository.update_fund(fund_id, payload.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Fundo nao encontrado")
    return updated


@app.get("/api/transactions")
async def list_transactions(
    type: Optional[str] = None,
    fund: Optional[str] = None,
    payer: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
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
        items = [t for t in items if needle in t["description"].lower() or needle in (t.get("category") or "").lower()]
    return items[:limit]


def _validated(payload: TransactionIn) -> Dict[str, Any]:
    try:
        normalized = payload.normalized()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if normalized.fund and not repository.fund(normalized.fund):
        raise HTTPException(status_code=422, detail="Fundo inexistente")
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
        raise HTTPException(status_code=404, detail="Lancamento nao encontrado")
    return updated


@app.delete("/api/transactions/{tx_id}", status_code=204, response_class=JSONResponse)
async def delete_transaction(tx_id: str) -> JSONResponse:
    if not repository.delete_transaction(tx_id):
        raise HTTPException(status_code=404, detail="Lancamento nao encontrado")
    return JSONResponse(status_code=204, content=None)


@app.exception_handler(ValidationError)
async def validation_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": exc.errors()})
