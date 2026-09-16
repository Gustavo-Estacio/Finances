"""Gera um `database.json` pre-populado com dados realistas do casal.

Uso: `python seed.py` (sobrescreve o database.json existente).
"""

from __future__ import annotations

import json
import random
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "database.json"
MONTHS_BACK = 11

FUNDS = [
    {
        "id": "reforma",
        "name": "Reforma & Imprevistos da Casa",
        "short": "Reforma & Casa",
        "icon": "🛠️",
        "color": "#2563eb",
        "goal": 15000.0,
        "description": "Reparos, manutencao, 'quebrei algo na casa' e melhorias do lar.",
    },
    {
        "id": "lazer",
        "name": "Curtir Rolê & Lazer",
        "short": "Rolê & Lazer",
        "icon": "🍷",
        "color": "#ec4899",
        "goal": 8000.0,
        "description": "Dinheiro carimbado para encontros, jantares, viagens e festas.",
    },
    {
        "id": "conquistas",
        "name": "Conquistas — Carro Novo",
        "short": "Conquistas",
        "icon": "🚗",
        "color": "#7c3aed",
        "goal": 65000.0,
        "description": "Fundo de acumulo com meta visual para a proxima grande conquista.",
    },
    {
        "id": "investimentos",
        "name": "Renda Passiva & Investimentos",
        "short": "Investimentos",
        "icon": "📈",
        "color": "#10b981",
        "goal": 120000.0,
        "description": "Aportes focados na construcao de patrimonio e renda passiva.",
    },
]

CATEGORIES = [
    {"id": "salario", "name": "Salário", "icon": "💼", "type": "income"},
    {"id": "freela", "name": "Freela / Extra", "icon": "⚡", "type": "income"},
    {"id": "dividendos", "name": "Dividendos", "icon": "🏦", "type": "income"},
    {"id": "mercado", "name": "Mercado", "icon": "🛒", "type": "expense"},
    {"id": "moradia", "name": "Aluguel / Condomínio", "icon": "🏠", "type": "expense"},
    {"id": "energia", "name": "Luz & Água", "icon": "💡", "type": "expense"},
    {"id": "internet", "name": "Internet & Celular", "icon": "📶", "type": "expense"},
    {"id": "assinaturas", "name": "Assinaturas", "icon": "🎬", "type": "expense"},
    {"id": "transporte", "name": "Transporte", "icon": "⛽", "type": "expense"},
    {"id": "saude", "name": "Saúde & Farmácia", "icon": "💊", "type": "expense"},
    {"id": "pets", "name": "Pet", "icon": "🐾", "type": "expense"},
]

ROUTINE_TEMPLATES = [
    ("mercado", "Mercado do mês", (620, 980), "ambos", 9),
    ("mercado", "Feira e hortifruti", (110, 210), "ela", 18),
    ("moradia", "Aluguel + condomínio", (2100, 2100), "ambos", 5),
    ("energia", "Conta de luz e água", (180, 320), "ele", 12),
    ("internet", "Internet fibra + celulares", (189, 219), "ele", 14),
    ("assinaturas", "Streamings e apps", (89, 129), "ela", 7),
    ("transporte", "Combustível e apps", (230, 420), "ele", 20),
    ("saude", "Farmácia e consultas", (90, 260), "ela", 23),
    ("pets", "Ração e petshop", (120, 210), "ambos", 16),
]

FUND_EXPENSES = [
    ("reforma", "Conserto do chuveiro", (180, 420), 0.35),
    ("reforma", "Tinta e material do quarto", (300, 900), 0.25),
    ("lazer", "Jantar a dois", (140, 320), 0.7),
    ("lazer", "Rolê com os amigos", (90, 260), 0.5),
    ("lazer", "Cinema e sobremesa", (70, 160), 0.4),
]


def _month_start(reference: date, months_ago: int) -> date:
    year, month = reference.year, reference.month - months_ago
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


def _day(month: date, day: int, today: date) -> date:
    last = 28 if month.month == 2 else 30
    moment = date(month.year, month.month, min(day, last))
    return min(moment, today)


def _tx(kind: str, amount: float, moment: date, description: str, payer: str, category: str, fund=None):
    return {
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.combine(moment, datetime.min.time()).isoformat(timespec="seconds"),
        "type": kind,
        "amount": round(amount, 2),
        "date": moment.isoformat(),
        "description": description,
        "payer": payer,
        "category": category,
        "fund": fund,
    }


def build(today: date | None = None) -> dict:
    rng = random.Random(2026)
    today = today or date.today()
    transactions: list[dict] = []

    for months_ago in range(MONTHS_BACK, -1, -1):
        month = _month_start(today, months_ago)
        if month > today:
            continue
        progress = (MONTHS_BACK - months_ago) / max(MONTHS_BACK, 1)

        # Rendas
        transactions.append(_tx("income", rng.uniform(7400, 8200) + progress * 600, _day(month, 5, today), "Salário — Ele", "ele", "salario"))
        transactions.append(_tx("income", rng.uniform(6100, 6900) + progress * 700, _day(month, 5, today), "Salário — Ela", "ela", "salario"))
        if rng.random() < 0.45:
            transactions.append(_tx("income", rng.uniform(700, 2200), _day(month, 17, today), "Freela de fim de semana", rng.choice(["ele", "ela"]), "freela"))
        if months_ago < 8 and rng.random() < 0.6:
            transactions.append(_tx("income", rng.uniform(60, 340), _day(month, 22, today), "Dividendos e juros", "ambos", "dividendos"))

        # Contas de rotina
        for category, label, (low, high), payer, day in ROUTINE_TEMPLATES:
            if rng.random() < 0.08:
                continue
            transactions.append(_tx("expense", rng.uniform(low, high), _day(month, day, today), label, payer, category))

        # Aportes nos fundos
        aportes = {
            "reforma": rng.uniform(380, 620),
            "lazer": rng.uniform(420, 700),
            "conquistas": rng.uniform(900, 1600) + progress * 500,
            "investimentos": rng.uniform(1100, 1900) + progress * 700,
        }
        for fund_id, value in aportes.items():
            payer = rng.choice(["ele", "ela", "ambos", "ambos"])
            name = next(f["short"] for f in FUNDS if f["id"] == fund_id)
            transactions.append(_tx("contribution", value, _day(month, 6, today), f"Aporte mensal — {name}", payer, fund_id, fund_id))

        # Gastos pagos direto do fundo
        for fund_id, label, (low, high), chance in FUND_EXPENSES:
            if rng.random() < chance:
                day = rng.randint(8, 27)
                payer = rng.choice(["ele", "ela", "ambos"])
                transactions.append(_tx("expense", rng.uniform(low, high), _day(month, day, today), label, payer, fund_id, fund_id))

    transactions.sort(key=lambda t: t["date"])
    return {
        "meta": {
            "currency": "BRL",
            "app": "Finances — Casal",
            "couple": {"ele": "Ele", "ela": "Ela"},
            "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        },
        "funds": FUNDS,
        "categories": CATEGORIES,
        "transactions": transactions,
    }


if __name__ == "__main__":
    data = build()
    DB_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"database.json gerado com {len(data['transactions'])} lançamentos.")
