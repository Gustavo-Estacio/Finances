"""Regras de negocio e agregacoes para dashboards e graficos."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Tuple

from database import FinanceRepository
from models import ROUTINE

ROUTINE_LABEL = "Contas de Rotina"
ROUTINE_COLOR = "#64748b"
PAYER_LABELS = {"ele": "Ele", "ela": "Ela", "ambos": "Ambos (50/50)"}


# --------------------------------------------------------------- periodos
def period_range(period: str, today: Optional[date] = None) -> Tuple[Optional[date], date]:
    """Converte o filtro rapido da UI em um intervalo de datas."""
    today = today or date.today()
    if period == "month":
        return date(today.year, today.month, 1), today
    if period == "quarter":
        first_month = 3 * ((today.month - 1) // 3) + 1
        return date(today.year, first_month, 1), today
    if period == "year":
        return date(today.year, 1, 1), today
    return None, today


def _as_date(value: str) -> date:
    return date.fromisoformat(value)


def in_range(tx: Dict[str, Any], start: Optional[date], end: date) -> bool:
    moment = _as_date(tx["date"])
    return (start is None or moment >= start) and moment <= end


def _month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_label(key: str) -> str:
    names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
    year, month = key.split("-")
    return f"{names[int(month) - 1]}/{year[2:]}"


def _last_months(today: date, count: int = 12) -> List[str]:
    keys: List[str] = []
    year, month = today.year, today.month
    for _ in range(count):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return list(reversed(keys))


# -------------------------------------------------------------- agregacoes
def fund_balances(transactions: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    """Saldo acumulado (aportes - gastos pagos pelo fundo) de cada fundo."""
    balances: Dict[str, Dict[str, float]] = {}
    for tx in transactions:
        fund_id = tx.get("fund")
        if not fund_id:
            continue
        entry = balances.setdefault(fund_id, {"contributed": 0.0, "spent": 0.0})
        if tx["type"] == "contribution":
            entry["contributed"] += tx["amount"]
        elif tx["type"] == "expense":
            entry["spent"] += tx["amount"]
    return balances


def build_summary(repo: FinanceRepository, period: str = "month", today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    start, end = period_range(period, today)
    everything = repo.transactions()
    scoped = [tx for tx in everything if in_range(tx, start, end)]
    funds = repo.funds()
    fund_index = {fund["id"]: fund for fund in funds}

    income = sum(t["amount"] for t in scoped if t["type"] == "income")
    expenses = sum(t["amount"] for t in scoped if t["type"] == "expense")
    contributions = sum(t["amount"] for t in scoped if t["type"] == "contribution")

    # --- Donut principal: para onde o dinheiro do casal foi no periodo
    pillars: Dict[str, float] = {fund["id"]: 0.0 for fund in funds}
    pillars[ROUTINE] = 0.0
    for tx in scoped:
        if tx["type"] == "income":
            continue
        key = tx.get("fund") or ROUTINE
        pillars[key] = pillars.get(key, 0.0) + tx["amount"]

    donut = {
        "labels": [fund["name"] for fund in funds] + [ROUTINE_LABEL],
        "values": [round(pillars.get(fund["id"], 0.0), 2) for fund in funds] + [round(pillars[ROUTINE], 2)],
        "colors": [fund["color"] for fund in funds] + [ROUTINE_COLOR],
        "icons": [fund.get("icon", "") for fund in funds] + ["🧾"],
    }

    # --- Ele vs Ela vs Ambos
    payers = {key: {"expense": 0.0, "contribution": 0.0, "income": 0.0} for key in PAYER_LABELS}
    for tx in scoped:
        bucket = payers.setdefault(tx["payer"], {"expense": 0.0, "contribution": 0.0, "income": 0.0})
        bucket[tx["type"]] += tx["amount"]
    payer_chart = {
        "labels": [PAYER_LABELS[key] for key in PAYER_LABELS],
        "expenses": [round(payers[key]["expense"], 2) for key in PAYER_LABELS],
        "contributions": [round(payers[key]["contribution"], 2) for key in PAYER_LABELS],
        "income": [round(payers[key]["income"], 2) for key in PAYER_LABELS],
    }

    # --- Evolucao mensal de patrimonio (acumulado em fundos)
    keys = _last_months(today, 12)
    monthly = {key: {"income": 0.0, "expense": 0.0, "net_worth_delta": 0.0} for key in keys}
    running = 0.0
    patrimonio: List[float] = []
    for tx in sorted(everything, key=lambda t: t["date"]):
        key = _month_key(_as_date(tx["date"]))
        delta = 0.0
        if tx.get("fund"):
            delta = tx["amount"] if tx["type"] == "contribution" else -tx["amount"]
        if key in monthly:
            if tx["type"] == "income":
                monthly[key]["income"] += tx["amount"]
            elif tx["type"] == "expense":
                monthly[key]["expense"] += tx["amount"]
            monthly[key]["net_worth_delta"] += delta
        elif key < keys[0]:
            running += delta
    for key in keys:
        running += monthly[key]["net_worth_delta"]
        patrimonio.append(round(running, 2))

    evolution = {
        "labels": [_month_label(key) for key in keys],
        "patrimonio": patrimonio,
        "income": [round(monthly[key]["income"], 2) for key in keys],
        "expenses": [round(monthly[key]["expense"], 2) for key in keys],
    }

    # --- Fundos com meta e progresso (saldo historico, nao do periodo)
    balances = fund_balances(everything)
    fund_cards = []
    for fund in funds:
        entry = balances.get(fund["id"], {"contributed": 0.0, "spent": 0.0})
        balance = entry["contributed"] - entry["spent"]
        goal = fund.get("goal") or 0.0
        fund_cards.append(
            {
                **fund,
                "contributed": round(entry["contributed"], 2),
                "spent": round(entry["spent"], 2),
                "balance": round(balance, 2),
                "goal": goal,
                "progress": round(min(balance / goal, 1.0) * 100, 1) if goal else None,
                "period_contributed": round(
                    sum(t["amount"] for t in scoped if t["type"] == "contribution" and t.get("fund") == fund["id"]), 2
                ),
            }
        )

    return {
        "period": period,
        "range": {"start": start.isoformat() if start else None, "end": end.isoformat()},
        "kpis": {
            "income": round(income, 2),
            "expenses": round(expenses, 2),
            "contributions": round(contributions, 2),
            "free_balance": round(income - expenses - contributions, 2),
            "savings_rate": round((contributions / income * 100), 1) if income else 0.0,
            "transactions": len(scoped),
        },
        "donut": donut,
        "payers": payer_chart,
        "evolution": evolution,
        "funds": fund_cards,
        "fund_index": {fid: f["name"] for fid, f in fund_index.items()},
    }
