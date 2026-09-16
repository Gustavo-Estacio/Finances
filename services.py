"""Regras de negocio, indicadores contabeis e agregacoes para os dashboards.

Convencoes contabeis usadas aqui:
  - "Despesas correntes" sao os gastos sem envelope (contas de rotina).
  - "Uso de envelope" e o gasto pago por um fundo/reserva: nao consome o
    orcamento corrente, consome o saldo carimbado.
  - Lancamentos com pagador "ambos" sao rateados 50/50 entre as pessoas.
  - Patrimonio e capitalizado a juros compostos mensais equivalentes a taxa
    anual informada: i_m = (1 + i_a) ** (1/12) - 1.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Tuple

from database import FinanceRepository

ROUTINE = "rotina"
ROUTINE_LABEL = "Contas de Rotina"
ROUTINE_COLOR = "#64748b"
RESERVES_COLOR = "#f59e0b"
PAYERS = ("ele", "ela", "ambos")
PAYER_LABELS = {"ele": "Ele", "ela": "Ela", "ambos": "Ambos (50/50)"}
MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
DEFAULT_RATE = 0.12
LOOKBACK = 6  # meses usados nas medias moveis


# ---------------------------------------------------------------- datas
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


def _month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def month_label(key: str) -> str:
    year, month = key.split("-")
    return f"{MONTH_NAMES[int(month) - 1]}/{year[2:]}"


def _shift(key: str, delta: int) -> str:
    year, month = (int(part) for part in key.split("-"))
    total = year * 12 + (month - 1) + delta
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _month_span(first: str, last: str) -> List[str]:
    keys, cursor = [], first
    while cursor <= last:
        keys.append(cursor)
        cursor = _shift(cursor, 1)
    return keys


def _last_months(today: date, count: int) -> List[str]:
    last = _month_key(today)
    return [_shift(last, -offset) for offset in range(count - 1, -1, -1)]


def in_range(tx: Dict[str, Any], start: Optional[date], end: date) -> bool:
    moment = _as_date(tx["date"])
    return (start is None or moment >= start) and moment <= end


def _days_in_month(moment: date) -> int:
    if moment.month == 12:
        return 31
    return (date(moment.year, moment.month + 1, 1) - date(moment.year, moment.month, 1)).days


def _scoped(repo: FinanceRepository, period: str, today: date):
    start, end = period_range(period, today)
    everything = repo.transactions()
    scoped = [tx for tx in everything if in_range(tx, start, end)]
    if start is None:
        dates = [_as_date(t["date"]) for t in everything] or [today]
        start = min(dates)
    months = _month_span(_month_key(start), _month_key(end))
    return everything, scoped, start, end, months


# ------------------------------------------------------------- envelopes
def _split_envelopes(repo: FinanceRepository):
    envelopes = repo.funds()
    funds = [e for e in envelopes if e.get("kind", "fund") == "fund"]
    reserves = [e for e in envelopes if e.get("kind") == "reserve"]
    return envelopes, funds, reserves


def envelope_balances(transactions: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    """Aportes, usos e saldo acumulado de cada fundo/reserva."""
    balances: Dict[str, Dict[str, float]] = {}
    for tx in transactions:
        env = tx.get("fund")
        if not env:
            continue
        entry = balances.setdefault(env, {"contributed": 0.0, "spent": 0.0})
        if tx["type"] == "contribution":
            entry["contributed"] += tx["amount"]
        elif tx["type"] == "expense":
            entry["spent"] += tx["amount"]
    return balances


def _monthly_essential_cost(repo: FinanceRepository, today: date, lookback: int = LOOKBACK) -> Dict[str, float]:
    """Custo de vida mensal medio (essencial, fixo e total) das despesas correntes."""
    categories = {c["id"]: c for c in repo.categories()}
    keys = _last_months(today, lookback + 1)[:-1] or _last_months(today, 1)  # ignora mes corrente incompleto
    totals = {"essential": 0.0, "fixed": 0.0, "total": 0.0}
    for tx in repo.transactions():
        if tx["type"] != "expense" or tx.get("fund"):
            continue
        if _month_key(_as_date(tx["date"])) not in keys:
            continue
        meta = categories.get(tx.get("category"), {})
        totals["total"] += tx["amount"]
        if meta.get("essential"):
            totals["essential"] += tx["amount"]
        if meta.get("nature") == "fixa":
            totals["fixed"] += tx["amount"]
    months = max(len(keys), 1)
    return {key: round(value / months, 2) for key, value in totals.items()}


# =====================================================================
# 1. Visao geral (dashboard)
# =====================================================================
def build_summary(repo: FinanceRepository, period: str = "month", today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    everything, scoped, start, end, months = _scoped(repo, period, today)
    envelopes, funds, reserves = _split_envelopes(repo)
    reserve_ids = {r["id"] for r in reserves}

    income = sum(t["amount"] for t in scoped if t["type"] == "income")
    expenses = sum(t["amount"] for t in scoped if t["type"] == "expense")
    contributions = sum(t["amount"] for t in scoped if t["type"] == "contribution")

    # Donut: pilares de destino do dinheiro no periodo
    buckets: Dict[str, float] = {f["id"]: 0.0 for f in funds}
    buckets["reservas"] = 0.0
    buckets[ROUTINE] = 0.0
    for tx in scoped:
        if tx["type"] == "income":
            continue
        env = tx.get("fund")
        if env in reserve_ids:
            buckets["reservas"] += tx["amount"]
        elif env in buckets:
            buckets[env] += tx["amount"]
        else:
            buckets[ROUTINE] += tx["amount"]

    donut = {
        "labels": [f["short"] for f in funds] + ["Reservas do Casal", ROUTINE_LABEL],
        "values": [round(buckets[f["id"]], 2) for f in funds]
        + [round(buckets["reservas"], 2), round(buckets[ROUTINE], 2)],
        "colors": [f["color"] for f in funds] + [RESERVES_COLOR, ROUTINE_COLOR],
        "icons": [f.get("icon", "") for f in funds] + ["🛟", "🧾"],
    }

    # Ele vs Ela vs Ambos
    payers = {key: {"expense": 0.0, "contribution": 0.0, "income": 0.0} for key in PAYERS}
    for tx in scoped:
        payers.setdefault(tx["payer"], {"expense": 0.0, "contribution": 0.0, "income": 0.0})
        payers[tx["payer"]][tx["type"]] += tx["amount"]
    payer_chart = {
        "labels": [PAYER_LABELS[k] for k in PAYERS],
        "expenses": [round(payers[k]["expense"], 2) for k in PAYERS],
        "contributions": [round(payers[k]["contribution"], 2) for k in PAYERS],
        "income": [round(payers[k]["income"], 2) for k in PAYERS],
    }

    # Evolucao do patrimonio (12 meses, sem juros — a pagina de patrimonio capitaliza)
    keys = _last_months(today, 12)
    monthly = {key: {"income": 0.0, "expense": 0.0, "delta": 0.0} for key in keys}
    running = 0.0
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
            monthly[key]["delta"] += delta
        elif key < keys[0]:
            running += delta
    patrimonio = []
    for key in keys:
        running += monthly[key]["delta"]
        patrimonio.append(round(running, 2))

    evolution = {
        "labels": [month_label(k) for k in keys],
        "patrimonio": patrimonio,
        "income": [round(monthly[k]["income"], 2) for k in keys],
        "expenses": [round(monthly[k]["expense"], 2) for k in keys],
    }

    balances = envelope_balances(everything)
    cards = []
    costs = _monthly_essential_cost(repo, today)
    for env in envelopes:
        entry = balances.get(env["id"], {"contributed": 0.0, "spent": 0.0})
        balance = entry["contributed"] - entry["spent"]
        goal = _resolve_goal(env, costs["essential"])
        cards.append(
            {
                **env,
                "contributed": round(entry["contributed"], 2),
                "spent": round(entry["spent"], 2),
                "balance": round(balance, 2),
                "goal": goal,
                "progress": round(max(min(balance / goal, 1.0), 0.0) * 100, 1) if goal else None,
                "period_contributed": round(
                    sum(t["amount"] for t in scoped
                        if t["type"] == "contribution" and t.get("fund") == env["id"]), 2
                ),
            }
        )

    total_reserved = sum(c["balance"] for c in cards if c.get("kind") == "reserve")
    return {
        "period": period,
        "range": {"start": start.isoformat(), "end": end.isoformat(), "months": len(months)},
        "kpis": {
            "income": round(income, 2),
            "expenses": round(expenses, 2),
            "contributions": round(contributions, 2),
            "free_balance": round(income - expenses - contributions, 2),
            "savings_rate": round(contributions / income * 100, 1) if income else 0.0,
            "transactions": len(scoped),
            "reserved_total": round(total_reserved, 2),
            "months_covered": round(total_reserved / costs["essential"], 1) if costs["essential"] else 0.0,
        },
        "donut": donut,
        "payers": payer_chart,
        "evolution": evolution,
        "funds": [c for c in cards if c.get("kind", "fund") == "fund"],
        "reserves": [c for c in cards if c.get("kind") == "reserve"],
        "envelopes": cards,
    }


def _resolve_goal(envelope: Dict[str, Any], essential_monthly: float) -> float:
    """Meta fixa, ou meta dinamica em 'N meses de custo essencial'."""
    if envelope.get("goal_mode") == "months_expenses":
        return round(essential_monthly * float(envelope.get("goal_months", 6)), 2)
    return float(envelope.get("goal") or 0.0)


# =====================================================================
# 2. Gastos — orcado vs realizado
# =====================================================================
def build_expenses(repo: FinanceRepository, period: str = "month", today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    everything, scoped, start, end, months = _scoped(repo, period, today)
    envelopes = {e["id"]: e for e in repo.funds()}
    categories = [c for c in repo.categories() if c.get("type") == "expense"]
    month_count = max(len(months), 1)

    routine = [t for t in scoped if t["type"] == "expense" and not t.get("fund")]
    envelope_spend = [t for t in scoped if t["type"] == "expense" and t.get("fund")]
    income = sum(t["amount"] for t in scoped if t["type"] == "income")

    rows = []
    for cat in categories:
        planned = float(cat.get("planned") or 0.0) * month_count
        actual = sum(t["amount"] for t in routine if t.get("category") == cat["id"])
        pct = (actual / planned * 100) if planned else None
        if pct is None:
            status = "sem-orcamento"
        elif pct <= 85:
            status = "ok"
        elif pct <= 100:
            status = "atencao"
        else:
            status = "estourou"
        rows.append(
            {
                "id": cat["id"],
                "name": cat["name"],
                "icon": cat.get("icon", ""),
                "nature": cat.get("nature", "variavel"),
                "essential": bool(cat.get("essential")),
                "planned": round(planned, 2),
                "planned_month": float(cat.get("planned") or 0.0),
                "actual": round(actual, 2),
                "diff": round(planned - actual, 2),
                "pct": round(pct, 1) if pct is not None else None,
                "status": status,
                "count": sum(1 for t in routine if t.get("category") == cat["id"]),
            }
        )

    # Categorias sem plano de contas (lancadas na mao)
    known = {c["id"] for c in categories}
    other = [t for t in routine if t.get("category") not in known]
    if other:
        rows.append(
            {
                "id": "outros",
                "name": "Outros (sem orçamento)",
                "icon": "❓",
                "nature": "variavel",
                "essential": False,
                "planned": 0.0,
                "planned_month": 0.0,
                "actual": round(sum(t["amount"] for t in other), 2),
                "diff": round(-sum(t["amount"] for t in other), 2),
                "pct": None,
                "status": "sem-orcamento",
                "count": len(other),
            }
        )
    rows.sort(key=lambda r: r["actual"], reverse=True)

    planned_total = sum(r["planned"] for r in rows)
    actual_total = sum(r["actual"] for r in rows)

    # Serie mensal: orcado (linha) vs realizado (barras)
    hist_keys = _last_months(today, 12)
    by_month = {key: 0.0 for key in hist_keys}
    for tx in everything:
        if tx["type"] != "expense" or tx.get("fund"):
            continue
        key = _month_key(_as_date(tx["date"]))
        if key in by_month:
            by_month[key] += tx["amount"]
    budget_month = sum(float(c.get("planned") or 0.0) for c in categories)

    # Natureza fixa x variavel
    nature = {"fixa": 0.0, "variavel": 0.0}
    essential_split = {"essencial": 0.0, "supérfluo": 0.0}
    for row in rows:
        nature[row["nature"]] = nature.get(row["nature"], 0.0) + row["actual"]
        essential_split["essencial" if row["essential"] else "supérfluo"] += row["actual"]

    # Uso de envelopes no periodo
    by_envelope: Dict[str, float] = {}
    for tx in envelope_spend:
        by_envelope[tx["fund"]] = by_envelope.get(tx["fund"], 0.0) + tx["amount"]
    envelope_rows = [
        {
            "id": env_id,
            "name": envelopes.get(env_id, {}).get("short", env_id),
            "icon": envelopes.get(env_id, {}).get("icon", ""),
            "color": envelopes.get(env_id, {}).get("color", ROUTINE_COLOR),
            "kind": envelopes.get(env_id, {}).get("kind", "fund"),
            "amount": round(value, 2),
        }
        for env_id, value in sorted(by_envelope.items(), key=lambda kv: kv[1], reverse=True)
    ]

    top = sorted(
        [t for t in scoped if t["type"] == "expense"], key=lambda t: t["amount"], reverse=True
    )[:8]
    top_rows = [
        {
            **t,
            "label": envelopes.get(t.get("fund"), {}).get("short")
            or next((c["name"] for c in categories if c["id"] == t.get("category")), t.get("category") or "—"),
        }
        for t in top
    ]

    # Projecao do mes corrente pelo ritmo de gasto (run-rate)
    projection = None
    if period == "month":
        days = _days_in_month(today)
        if today.day:
            projected = actual_total / today.day * days
            projection = {
                "days_elapsed": today.day,
                "days_total": days,
                "daily_average": round(actual_total / today.day, 2),
                "projected_close": round(projected, 2),
                "budget": round(budget_month, 2),
                "gap": round(budget_month - projected, 2),
            }

    costs = _monthly_essential_cost(repo, today)
    return {
        "period": period,
        "range": {"start": start.isoformat(), "end": end.isoformat(), "months": month_count},
        "rows": rows,
        "totals": {
            "planned": round(planned_total, 2),
            "actual": round(actual_total, 2),
            "diff": round(planned_total - actual_total, 2),
            "pct": round(actual_total / planned_total * 100, 1) if planned_total else 0.0,
            "envelope_spend": round(sum(by_envelope.values()), 2),
            "income": round(income, 2),
            "commitment": round(actual_total / income * 100, 1) if income else 0.0,
        },
        "series": {
            "labels": [month_label(k) for k in hist_keys],
            "actual": [round(by_month[k], 2) for k in hist_keys],
            "planned": [round(budget_month, 2) for k in hist_keys],
        },
        "nature": {"labels": ["Fixas", "Variáveis"], "values": [round(nature["fixa"], 2), round(nature["variavel"], 2)]},
        "essential": {
            "labels": ["Essencial", "Supérfluo"],
            "values": [round(essential_split["essencial"], 2), round(essential_split["supérfluo"], 2)],
        },
        "envelopes": envelope_rows,
        "top": top_rows,
        "projection": projection,
        "benchmarks": {
            "monthly_budget": round(budget_month, 2),
            "essential_monthly": costs["essential"],
            "fixed_monthly": costs["fixed"],
            "total_monthly": costs["total"],
        },
    }


# =====================================================================
# 3. Reservas
# =====================================================================
def build_reserves(repo: FinanceRepository, period: str = "month", today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    everything, scoped, start, end, months = _scoped(repo, period, today)
    _, _, reserves = _split_envelopes(repo)
    balances = envelope_balances(everything)
    costs = _monthly_essential_cost(repo, today)
    essential = costs["essential"] or 1.0

    recent = _last_months(today, LOOKBACK + 1)[:-1]

    cards = []
    for reserve in sorted(reserves, key=lambda r: r.get("priority", 99)):
        entry = balances.get(reserve["id"], {"contributed": 0.0, "spent": 0.0})
        balance = entry["contributed"] - entry["spent"]
        goal = _resolve_goal(reserve, costs["essential"])
        missing = max(goal - balance, 0.0)

        contributed_recent = sum(
            t["amount"] for t in everything
            if t["type"] == "contribution" and t.get("fund") == reserve["id"]
            and _month_key(_as_date(t["date"])) in recent
        )
        avg_monthly = contributed_recent / max(len(recent), 1)
        target_months = int(reserve.get("target_months") or 24)
        suggested = missing / target_months if target_months else 0.0
        eta = math.ceil(missing / avg_monthly) if avg_monthly > 0 and missing > 0 else (0 if missing <= 0 else None)

        if missing <= 0:
            status = "completa"
        elif avg_monthly <= 0:
            status = "parada"
        elif eta is not None and eta <= target_months:
            status = "no-ritmo"
        else:
            status = "atrasada"

        cards.append(
            {
                **reserve,
                "goal": goal,
                "balance": round(balance, 2),
                "contributed": round(entry["contributed"], 2),
                "used": round(entry["spent"], 2),
                "missing": round(missing, 2),
                "progress": round(max(min(balance / goal, 1.0), 0.0) * 100, 1) if goal else 0.0,
                "avg_monthly": round(avg_monthly, 2),
                "suggested_monthly": round(suggested, 2),
                "eta_months": eta,
                "target_months": target_months,
                "status": status,
                "period_contributed": round(
                    sum(t["amount"] for t in scoped
                        if t["type"] == "contribution" and t.get("fund") == reserve["id"]), 2),
                "period_used": round(
                    sum(t["amount"] for t in scoped
                        if t["type"] == "expense" and t.get("fund") == reserve["id"]), 2),
                "months_covered": round(balance / essential, 1),
            }
        )

    total_balance = sum(c["balance"] for c in cards)
    total_goal = sum(c["goal"] for c in cards)
    emergency = next((c for c in cards if c["id"] == "emergencia"), None)

    # Evolucao do saldo agregado das reservas (12 meses)
    hist_keys = _last_months(today, 12)
    reserve_ids = {r["id"] for r in reserves}
    deltas = {key: 0.0 for key in hist_keys}
    before = 0.0
    for tx in everything:
        if tx.get("fund") not in reserve_ids:
            continue
        key = _month_key(_as_date(tx["date"]))
        delta = tx["amount"] if tx["type"] == "contribution" else -tx["amount"]
        if key in deltas:
            deltas[key] += delta
        elif key < hist_keys[0]:
            before += delta
    running, series = before, []
    for key in hist_keys:
        running += deltas[key]
        series.append(round(running, 2))

    alerts = []
    if emergency:
        covered = emergency["months_covered"]
        target = float(emergency.get("goal_months", 6))
        if covered < target * 0.5:
            alerts.append({"level": "danger", "title": "Reserva de emergência crítica",
                           "text": f"Vocês têm {covered:.1f} meses de custo essencial guardados. "
                                   f"O piso recomendado é {target:.0f} meses — priorize este aporte antes dos demais."})
        elif covered < target:
            alerts.append({"level": "warn", "title": "Reserva de emergência em formação",
                           "text": f"Faltam {max(target - covered, 0):.1f} meses de cobertura para chegar aos "
                                   f"{target:.0f} meses. Aporte sugerido: {emergency['suggested_monthly']:,.2f}/mês."})
        else:
            alerts.append({"level": "ok", "title": "Reserva de emergência completa",
                           "text": f"Cobertura de {covered:.1f} meses de custo essencial. "
                                   "O excedente pode migrar para os fundos de investimento."})
    atrasadas = [c for c in cards if c["status"] == "atrasada"]
    if atrasadas:
        alerts.append({"level": "warn", "title": f"{len(atrasadas)} reserva(s) fora do ritmo",
                       "text": "No aporte médio atual, " + ", ".join(c["short"] for c in atrasadas)
                               + " não batem a meta no prazo definido."})
    paradas = [c for c in cards if c["status"] == "parada"]
    if paradas:
        alerts.append({"level": "danger", "title": "Reservas sem aporte recente",
                       "text": "Sem aportes nos últimos meses: " + ", ".join(c["short"] for c in paradas) + "."})

    return {
        "period": period,
        "range": {"start": start.isoformat(), "end": end.isoformat(), "months": len(months)},
        "reserves": cards,
        "summary": {
            "total_balance": round(total_balance, 2),
            "total_goal": round(total_goal, 2),
            "total_missing": round(max(total_goal - total_balance, 0), 2),
            "coverage": round(total_balance / total_goal * 100, 1) if total_goal else 0.0,
            "monthly_needed": round(sum(c["suggested_monthly"] for c in cards), 2),
            "monthly_current": round(sum(c["avg_monthly"] for c in cards), 2),
            "period_contributed": round(sum(c["period_contributed"] for c in cards), 2),
            "period_used": round(sum(c["period_used"] for c in cards), 2),
            "essential_monthly": costs["essential"],
            "months_covered": round(total_balance / essential, 1),
            "emergency_months": emergency["months_covered"] if emergency else 0.0,
            "emergency_target": float(emergency.get("goal_months", 6)) if emergency else 6.0,
        },
        "series": {"labels": [month_label(k) for k in hist_keys], "balance": series},
        "alerts": alerts,
    }


# =====================================================================
# 4. Individual — Ele x Ela
# =====================================================================
def build_individual(repo: FinanceRepository, period: str = "month", today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    everything, scoped, start, end, months = _scoped(repo, period, today)
    categories = {c["id"]: c for c in repo.categories()}
    envelopes = {e["id"]: e for e in repo.funds()}
    meta = repo.meta().get("couple", {"ele": "Ele", "ela": "Ela"})

    people = {
        key: {
            "key": key,
            "name": meta.get(key, PAYER_LABELS[key]),
            "income": 0.0, "income_direct": 0.0, "income_shared": 0.0,
            "expenses": 0.0, "expenses_direct": 0.0, "expenses_shared": 0.0,
            "contributions": 0.0, "contributions_direct": 0.0, "contributions_shared": 0.0,
            "categories": {}, "envelopes": {},
        }
        for key in ("ele", "ela")
    }

    def _allocate(tx: Dict[str, Any]):
        """Rateia o lancamento: direto para quem pagou, 50/50 quando 'ambos'."""
        if tx["payer"] == "ambos":
            return [("ele", tx["amount"] / 2, True), ("ela", tx["amount"] / 2, True)]
        if tx["payer"] in people:
            return [(tx["payer"], tx["amount"], False)]
        return []

    for tx in scoped:
        for who, value, shared in _allocate(tx):
            person = people[who]
            kind = tx["type"]
            if kind == "income":
                person["income"] += value
                person["income_shared" if shared else "income_direct"] += value
            elif kind == "expense":
                person["expenses"] += value
                person["expenses_shared" if shared else "expenses_direct"] += value
                label = envelopes.get(tx.get("fund"), {}).get("short") or \
                    categories.get(tx.get("category"), {}).get("name") or tx.get("category") or "Outros"
                icon = envelopes.get(tx.get("fund"), {}).get("icon") or \
                    categories.get(tx.get("category"), {}).get("icon") or "•"
                bucket = person["categories"].setdefault(label, {"label": label, "icon": icon, "value": 0.0})
                bucket["value"] += value
            else:
                person["contributions"] += value
                person["contributions_shared" if shared else "contributions_direct"] += value
                env = envelopes.get(tx.get("fund"), {})
                label = env.get("short", tx.get("fund") or "Fundo")
                bucket = person["envelopes"].setdefault(
                    label, {"label": label, "icon": env.get("icon", "•"), "color": env.get("color", "#7c3aed"), "value": 0.0}
                )
                bucket["value"] += value

    total_income = sum(p["income"] for p in people.values()) or 1.0
    hist_keys = _last_months(today, 6)

    for person in people.values():
        person["outflow"] = person["expenses"] + person["contributions"]
        person["balance"] = person["income"] - person["outflow"]
        person["savings_rate"] = round(person["contributions"] / person["income"] * 100, 1) if person["income"] else 0.0
        person["income_share"] = round(person["income"] / total_income * 100, 1)
        person["categories"] = sorted(person["categories"].values(), key=lambda c: c["value"], reverse=True)[:6]
        person["envelopes"] = sorted(person["envelopes"].values(), key=lambda c: c["value"], reverse=True)
        for key in ("income", "expenses", "contributions", "outflow", "balance",
                    "income_direct", "income_shared", "expenses_direct", "expenses_shared",
                    "contributions_direct", "contributions_shared"):
            person[key] = round(person[key], 2)
        for row in person["categories"] + person["envelopes"]:
            row["value"] = round(row["value"], 2)

    # Serie mensal por pessoa (renda x desembolso)
    series = {key: {"income": {k: 0.0 for k in hist_keys}, "outflow": {k: 0.0 for k in hist_keys}} for key in people}
    for tx in everything:
        key = _month_key(_as_date(tx["date"]))
        if key not in hist_keys:
            continue
        for who, value, _shared in _allocate(tx):
            slot = "income" if tx["type"] == "income" else "outflow"
            series[who][slot][key] += value

    # Acerto de contas: 50/50 vs proporcional a renda
    total_costs = sum(p["outflow"] for p in people.values())
    settle = {}
    for mode in ("proporcional", "igualitario"):
        fair = {}
        for key, person in people.items():
            share = (person["income"] / total_income) if mode == "proporcional" else 0.5
            fair[key] = round(total_costs * share, 2)
        diff_ele = round(people["ele"]["outflow"] - fair["ele"], 2)
        settle[mode] = {
            "fair": fair,
            "paid": {key: people[key]["outflow"] for key in people},
            "delta": {"ele": diff_ele, "ela": round(-diff_ele, 2)},
            "creditor": "ele" if diff_ele > 0 else ("ela" if diff_ele < 0 else None),
            "amount": round(abs(diff_ele), 2),
        }

    return {
        "period": period,
        "range": {"start": start.isoformat(), "end": end.isoformat(), "months": len(months)},
        "people": [people["ele"], people["ela"]],
        "couple": {
            "income": round(total_income, 2),
            "expenses": round(sum(p["expenses"] for p in people.values()), 2),
            "contributions": round(sum(p["contributions"] for p in people.values()), 2),
            "total_costs": round(total_costs, 2),
        },
        "series": {
            "labels": [month_label(k) for k in hist_keys],
            "ele": {"income": [round(series["ele"]["income"][k], 2) for k in hist_keys],
                    "outflow": [round(series["ele"]["outflow"][k], 2) for k in hist_keys]},
            "ela": {"income": [round(series["ela"]["income"][k], 2) for k in hist_keys],
                    "outflow": [round(series["ela"]["outflow"][k], 2) for k in hist_keys]},
        },
        "settlement": settle,
    }


# =====================================================================
# 5. Patrimonio — juros compostos
# =====================================================================
def build_patrimonio(
    repo: FinanceRepository,
    view: str = "months",
    rate: float = DEFAULT_RATE,
    horizon_years: int = 10,
    today: Optional[date] = None,
) -> Dict[str, Any]:
    today = today or date.today()
    everything = repo.transactions()
    costs = _monthly_essential_cost(repo, today)
    monthly_rate = (1 + rate) ** (1 / 12) - 1

    dates = [_as_date(t["date"]) for t in everything] or [today]
    first_key = _month_key(min(dates))
    last_key = _month_key(today)
    hist_keys = _month_span(first_key, last_key)

    net = {key: 0.0 for key in hist_keys}
    for tx in everything:
        if not tx.get("fund"):
            continue
        key = _month_key(_as_date(tx["date"]))
        if key in net:
            net[key] += tx["amount"] if tx["type"] == "contribution" else -tx["amount"]

    points: List[Dict[str, Any]] = []
    balance = contributed = 0.0
    for key in hist_keys:
        balance = balance * (1 + monthly_rate) + net[key]
        contributed += net[key]
        points.append({"key": key, "balance": balance, "contributed": contributed,
                       "interest": balance - contributed, "flow": net[key], "projected": False})

    recent = hist_keys[-(LOOKBACK + 1):-1] or hist_keys[-1:]
    avg_flow = max(sum(net[k] for k in recent) / max(len(recent), 1), 0.0)

    cursor = last_key
    for _ in range(horizon_years * 12):
        cursor = _shift(cursor, 1)
        balance = balance * (1 + monthly_rate) + avg_flow
        contributed += avg_flow
        points.append({"key": cursor, "balance": balance, "contributed": contributed,
                       "interest": balance - contributed, "flow": avg_flow, "projected": True})

    aggregated = _aggregate(points, view)

    current = points[len(hist_keys) - 1]
    milestones = []
    for years in (1, 3, 5, 10):
        index = len(hist_keys) - 1 + years * 12
        if index < len(points):
            snapshot = points[index]
            milestones.append({
                "label": f"{years} ano{'s' if years > 1 else ''}",
                "balance": round(snapshot["balance"], 2),
                "contributed": round(snapshot["contributed"], 2),
                "interest": round(snapshot["interest"], 2),
                "passive_income": round(snapshot["balance"] * monthly_rate, 2),
            })

    fi_target = costs["essential"] / monthly_rate if monthly_rate else 0.0
    months_to_fi = None
    for index in range(len(hist_keys) - 1, len(points)):
        if points[index]["balance"] >= fi_target > 0:
            months_to_fi = index - (len(hist_keys) - 1)
            break

    return {
        "view": view,
        "rate": rate,
        "monthly_rate": round(monthly_rate * 100, 4),
        "history_points": len([p for p in aggregated["points"] if not p["projected"]]),
        "chart": aggregated,
        "current": {
            "balance": round(current["balance"], 2),
            "contributed": round(current["contributed"], 2),
            "interest": round(current["interest"], 2),
            "interest_share": round(current["interest"] / current["balance"] * 100, 1) if current["balance"] else 0.0,
            "avg_monthly_flow": round(avg_flow, 2),
            "passive_income": round(current["balance"] * monthly_rate, 2),
            "essential_monthly": costs["essential"],
            "coverage_months": round(current["balance"] / costs["essential"], 1) if costs["essential"] else 0.0,
        },
        "milestones": milestones,
        "independence": {
            "target": round(fi_target, 2),
            "progress": round(min(current["balance"] / fi_target, 1) * 100, 1) if fi_target else 0.0,
            "months_to_target": months_to_fi,
            "years_to_target": round(months_to_fi / 12, 1) if months_to_fi is not None else None,
        },
    }


def _aggregate(points: List[Dict[str, Any]], view: str) -> Dict[str, Any]:
    """Patrimonio e um estoque: agregacoes usam o valor do fim do periodo."""
    if view == "years":
        groups: Dict[str, Dict[str, Any]] = {}
        for point in points:
            year = point["key"][:4]
            group = groups.setdefault(year, {"label": year, "flow": 0.0, "projected": True})
            group.update({k: point[k] for k in ("balance", "contributed", "interest")})
            group["flow"] += point["flow"]
            group["projected"] = group["projected"] and point["projected"]
        rows = list(groups.values())
    elif view == "bimesters":
        groups = {}
        for point in points:
            year, month = (int(part) for part in point["key"].split("-"))
            index = (month - 1) // 2 + 1
            key = f"{year}-{index}"
            group = groups.setdefault(key, {"label": f"{index}º bim/{str(year)[2:]}", "flow": 0.0, "projected": True})
            group.update({k: point[k] for k in ("balance", "contributed", "interest")})
            group["flow"] += point["flow"]
            group["projected"] = group["projected"] and point["projected"]
        rows = list(groups.values())
    else:
        rows = [
            {"label": month_label(p["key"]), "balance": p["balance"], "contributed": p["contributed"],
             "interest": p["interest"], "flow": p["flow"], "projected": p["projected"]}
            for p in points
        ]

    for row in rows:
        for key in ("balance", "contributed", "interest", "flow"):
            row[key] = round(row[key], 2)

    return {
        "labels": [r["label"] for r in rows],
        "balance": [r["balance"] for r in rows],
        "contributed": [r["contributed"] for r in rows],
        "interest": [r["interest"] for r in rows],
        "projected": [r["projected"] for r in rows],
        "points": rows,
    }
