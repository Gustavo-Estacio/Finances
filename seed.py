"""Gera um `database.json` pre-populado com dados realistas do casal.

Uso: `python seed.py` (sobrescreve o database.json existente).

Modelo contabil:
  - `funds`  -> envelopes de destino do dinheiro, com dois tipos (`kind`):
                 "fund"    = pilares de alocacao (lazer, conquistas, investimentos)
                 "reserve" = reservas do casal (emergencia, reforma, saude, ...)
  - `categories` -> plano de contas das despesas correntes, com orcamento
                    mensal (`planned`), natureza (fixa/variavel) e se e
                    essencial (entra no calculo da reserva de emergencia).
"""

from __future__ import annotations

import json
import random
import uuid
from datetime import date, datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "database.json"
MONTHS_BACK = 13

FUNDS = [
    {
        "id": "lazer",
        "kind": "fund",
        "name": "Curtir Rolê & Lazer",
        "short": "Rolê & Lazer",
        "icon": "🍷",
        "color": "#ec4899",
        "goal": 8000.0,
        "priority": 3,
        "description": "Dinheiro carimbado para encontros, jantares, viagens e festas.",
    },
    {
        "id": "conquistas",
        "kind": "fund",
        "name": "Conquistas — Carro Novo",
        "short": "Conquistas",
        "icon": "🚗",
        "color": "#7c3aed",
        "goal": 65000.0,
        "priority": 2,
        "description": "Fundo de acúmulo com meta visual para a próxima grande conquista.",
    },
    {
        "id": "investimentos",
        "kind": "fund",
        "name": "Renda Passiva & Investimentos",
        "short": "Investimentos",
        "icon": "📈",
        "color": "#10b981",
        "goal": 120000.0,
        "priority": 1,
        "description": "Aportes focados na construção de patrimônio e renda passiva.",
    },
]

RESERVES = [
    {
        "id": "emergencia",
        "kind": "reserve",
        "name": "Reserva de Emergência",
        "short": "Emergência",
        "icon": "🛟",
        "color": "#f59e0b",
        "goal": None,
        "goal_mode": "months_expenses",
        "goal_months": 6,
        "priority": 1,
        "target_months": 24,
        "description": "Colchão de segurança: 6 meses de custo de vida essencial do casal.",
    },
    {
        "id": "reforma",
        "kind": "reserve",
        "name": "Reforma & Imprevistos da Casa",
        "short": "Reforma da Casa",
        "icon": "🛠️",
        "color": "#2563eb",
        "goal": 15000.0,
        "priority": 2,
        "target_months": 36,
        "description": "Reparos, manutenção, 'quebrei algo na casa' e melhorias do lar.",
    },
    {
        "id": "saude",
        "kind": "reserve",
        "name": "Saúde & Odontológico",
        "short": "Saúde",
        "icon": "🩺",
        "color": "#f43f5e",
        "goal": 9000.0,
        "priority": 3,
        "target_months": 30,
        "description": "Franquias, procedimentos odontológicos e imprevistos de saúde.",
    },
    {
        "id": "estudos",
        "kind": "reserve",
        "name": "Estudos & Carreira",
        "short": "Estudos",
        "icon": "🎓",
        "color": "#a78bfa",
        "goal": 12000.0,
        "priority": 4,
        "target_months": 36,
        "description": "Cursos, certificações e formação continuada dos dois.",
    },
    {
        "id": "auto",
        "kind": "reserve",
        "name": "Manutenção do Carro",
        "short": "Carro",
        "icon": "🚙",
        "color": "#38bdf8",
        "goal": 6000.0,
        "priority": 5,
        "target_months": 30,
        "description": "Revisões, pneus, seguro e imprevistos do veículo.",
    },
    {
        "id": "paisagismo",
        "kind": "reserve",
        "name": "Paisagismo & Jardim",
        "short": "Paisagismo",
        "icon": "🌿",
        "color": "#34d399",
        "goal": 7000.0,
        "priority": 6,
        "target_months": 42,
        "description": "Projeto de jardim, mudas, irrigação e área externa.",
    },
]

# Plano de contas das despesas correntes (fora dos fundos/reservas).
CATEGORIES = [
    {"id": "salario", "name": "Salário", "icon": "💼", "type": "income"},
    {"id": "freela", "name": "Freela / Extra", "icon": "⚡", "type": "income"},
    {"id": "dividendos", "name": "Dividendos", "icon": "🏦", "type": "income"},
    {"id": "moradia", "name": "Aluguel / Condomínio", "icon": "🏠", "type": "expense",
     "planned": 2100.0, "nature": "fixa", "essential": True},
    {"id": "mercado", "name": "Mercado & Feira", "icon": "🛒", "type": "expense",
     "planned": 1150.0, "nature": "variavel", "essential": True},
    {"id": "energia", "name": "Luz & Água", "icon": "💡", "type": "expense",
     "planned": 290.0, "nature": "fixa", "essential": True},
    {"id": "internet", "name": "Internet & Celular", "icon": "📶", "type": "expense",
     "planned": 210.0, "nature": "fixa", "essential": True},
    {"id": "transporte", "name": "Transporte & Combustível", "icon": "⛽", "type": "expense",
     "planned": 430.0, "nature": "variavel", "essential": True},
    {"id": "saude_corrente", "name": "Farmácia & Consultas", "icon": "💊", "type": "expense",
     "planned": 260.0, "nature": "variavel", "essential": True},
    {"id": "pets", "name": "Pet", "icon": "🐾", "type": "expense",
     "planned": 190.0, "nature": "variavel", "essential": True},
    {"id": "assinaturas", "name": "Assinaturas & Apps", "icon": "🎬", "type": "expense",
     "planned": 130.0, "nature": "fixa", "essential": False},
    {"id": "casa_extra", "name": "Casa & Utilidades", "icon": "🧽", "type": "expense",
     "planned": 180.0, "nature": "variavel", "essential": False},
]

ROUTINE_TEMPLATES = [
    ("moradia", "Aluguel + condomínio", (2100, 2100), "ambos", 5),
    ("mercado", "Mercado do mês", (620, 980), "ambos", 9),
    ("mercado", "Feira e hortifruti", (110, 230), "ela", 18),
    ("energia", "Conta de luz e água", (190, 340), "ele", 12),
    ("internet", "Internet fibra + celulares", (189, 229), "ele", 14),
    ("transporte", "Combustível e apps", (230, 470), "ele", 20),
    ("saude_corrente", "Farmácia e consultas", (90, 300), "ela", 23),
    ("pets", "Ração e petshop", (120, 230), "ambos", 16),
    ("assinaturas", "Streamings e apps", (89, 159), "ela", 7),
    ("casa_extra", "Utilidades e limpeza", (80, 260), "ambos", 21),
]

# Gastos pagos direto de um fundo/reserva (uso do dinheiro carimbado).
ENVELOPE_EXPENSES = [
    ("reforma", "Conserto do chuveiro", (180, 430), 0.30),
    ("reforma", "Tinta e material do quarto", (300, 950), 0.22),
    ("lazer", "Jantar a dois", (140, 330), 0.70),
    ("lazer", "Rolê com os amigos", (90, 270), 0.50),
    ("lazer", "Cinema e sobremesa", (70, 170), 0.38),
    ("saude", "Dentista — canal e limpeza", (350, 900), 0.18),
    ("auto", "Revisão e pneus", (400, 1200), 0.16),
    ("estudos", "Curso e certificação", (300, 900), 0.20),
    ("paisagismo", "Mudas e terra adubada", (120, 380), 0.18),
]

# Aportes mensais por envelope: (id, faixa, chance de acontecer no mes)
CONTRIBUTIONS = [
    ("emergencia", (900, 1300), 1.0),
    ("investimentos", (1100, 1900), 1.0),
    ("conquistas", (900, 1600), 1.0),
    ("lazer", (420, 700), 1.0),
    ("reforma", (350, 600), 0.95),
    ("saude", (180, 300), 0.9),
    ("estudos", (250, 420), 0.9),
    ("auto", (150, 240), 0.9),
    ("paisagismo", (120, 260), 0.75),
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


def _tx(kind, amount, moment, description, payer, category, fund=None):
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
    envelopes = {e["id"]: e for e in FUNDS + RESERVES}
    saldo = {env_id: 0.0 for env_id in envelopes}  # caixa de cada envelope
    transactions: list[dict] = []

    for months_ago in range(MONTHS_BACK, -1, -1):
        month = _month_start(today, months_ago)
        if month > today:
            continue
        progress = (MONTHS_BACK - months_ago) / max(MONTHS_BACK, 1)
        partial = months_ago == 0  # mes corrente ainda em andamento

        # ---------------------------------------------------------- rendas
        transactions.append(_tx("income", rng.uniform(7400, 8200) + progress * 700,
                                _day(month, 5, today), "Salário — Ele", "ele", "salario"))
        transactions.append(_tx("income", rng.uniform(6100, 6900) + progress * 800,
                                _day(month, 5, today), "Salário — Ela", "ela", "salario"))
        if rng.random() < 0.45:
            transactions.append(_tx("income", rng.uniform(700, 2200), _day(month, 17, today),
                                    "Freela de fim de semana", rng.choice(["ele", "ela"]), "freela"))
        if months_ago < 9 and rng.random() < 0.65:
            transactions.append(_tx("income", rng.uniform(60, 380), _day(month, 22, today),
                                    "Dividendos e juros", "ambos", "dividendos"))

        # ------------------------------------------------- contas de rotina
        for category, label, (low, high), payer, day in ROUTINE_TEMPLATES:
            if rng.random() < 0.07:
                continue
            if partial and day > today.day:
                continue
            transactions.append(_tx("expense", rng.uniform(low, high),
                                    _day(month, day, today), label, payer, category))

        # ---------------------------------------- aportes em fundos/reservas
        for env_id, (low, high), chance in CONTRIBUTIONS:
            if rng.random() > chance:
                continue
            boost = progress * 500 if env_id in ("investimentos", "conquistas") else 0
            payer = rng.choice(["ele", "ela", "ambos", "ambos"])
            name = envelopes[env_id]["short"]
            value = rng.uniform(low, high) + boost
            saldo[env_id] += value
            transactions.append(_tx("contribution", value, _day(month, 6, today),
                                    f"Aporte mensal — {name}", payer, env_id, env_id))

        # --------------------------------- uso do dinheiro carimbado
        for env_id, label, (low, high), chance in ENVELOPE_EXPENSES:
            if rng.random() >= chance:
                continue
            day = rng.randint(8, 27)
            if partial and day > today.day:
                continue
            # o envelope so paga ate onde tem caixa (nunca fica negativo)
            value = min(rng.uniform(low, high), saldo[env_id])
            if value < 50:
                continue
            saldo[env_id] -= value
            payer = rng.choice(["ele", "ela", "ambos"])
            transactions.append(_tx("expense", value, _day(month, day, today),
                                    label, payer, env_id, env_id))

    transactions.sort(key=lambda t: t["date"])
    return {
        "meta": {
            "currency": "BRL",
            "app": "Finances — Casal",
            "couple": {"ele": "Ele", "ela": "Ela"},
            "emergency_months": 6,
            "annual_rate": 0.12,
            "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        },
        "funds": FUNDS + RESERVES,
        "categories": CATEGORIES,
        "transactions": transactions,
    }


if __name__ == "__main__":
    data = build()
    DB_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"database.json gerado com {len(data['transactions'])} lançamentos.")
