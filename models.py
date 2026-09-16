"""Schemas Pydantic da aplicacao financeira do casal."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

TransactionType = Literal["income", "expense", "contribution"]
Payer = Literal["ele", "ela", "ambos"]
Period = Literal["month", "quarter", "year", "all"]

ROUTINE = "rotina"


class TransactionIn(BaseModel):
    """Payload de criacao/edicao de um lancamento."""

    type: TransactionType
    amount: float = Field(gt=0, description="Valor em reais, sempre positivo")
    date: date
    description: str = Field(min_length=1, max_length=120)
    payer: Payer
    category: str = Field(default="", max_length=60)
    fund: Optional[str] = Field(default=None, description="Id do fundo (aportes e gastos de fundo)")

    @field_validator("description", "category")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("fund")
    @classmethod
    def _empty_fund_is_none(cls, value: Optional[str]) -> Optional[str]:
        return value or None

    def normalized(self) -> "TransactionIn":
        """Garante coerencia entre tipo, fundo e categoria."""
        data = self.model_dump()
        if data["type"] == "income":
            data["fund"] = None
            data["category"] = data["category"] or "renda"
        elif data["type"] == "contribution":
            if not data["fund"]:
                raise ValueError("Aportes precisam de um fundo de destino")
            data["category"] = data["fund"]
        else:
            data["category"] = data["category"] or (data["fund"] or ROUTINE)
        return TransactionIn(**data)


class Transaction(TransactionIn):
    id: str
    created_at: datetime


class FundUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=60)
    goal: Optional[float] = Field(default=None, ge=0)
