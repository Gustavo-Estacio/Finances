"""Camada de persistencia (Data Repository Pattern).

Hoje os dados vivem em um arquivo JSON (`database.json`). Todo o backend fala
apenas com `FinanceRepository`, entao migrar para SQLite/PostgreSQL significa
trocar a implementacao desta classe sem tocar nas rotas da API.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(__file__).resolve().parent / "database.json"

DEFAULT_DB: Dict[str, Any] = {
    "meta": {"currency": "BRL", "couple": {"ele": "Ele", "ela": "Ela"}},
    "funds": [],
    "categories": [],
    "transactions": [],
}


class FinanceRepository:
    """Repositorio de dados financeiros do casal."""

    def __init__(self, path: Path = DB_PATH) -> None:
        self.path = path
        self._lock = threading.Lock()
        if not self.path.exists():
            self._write(DEFAULT_DB)

    # ------------------------------------------------------------------ io
    def _read(self) -> Dict[str, Any]:
        with self.path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _write(self, data: Dict[str, Any]) -> None:
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        tmp.replace(self.path)

    # ------------------------------------------------------------- leitura
    def meta(self) -> Dict[str, Any]:
        return self._read().get("meta", DEFAULT_DB["meta"])

    def funds(self) -> List[Dict[str, Any]]:
        return self._read().get("funds", [])

    def fund(self, fund_id: str) -> Optional[Dict[str, Any]]:
        return next((f for f in self.funds() if f["id"] == fund_id), None)

    def categories(self) -> List[Dict[str, Any]]:
        return self._read().get("categories", [])

    def transactions(self) -> List[Dict[str, Any]]:
        items = self._read().get("transactions", [])
        return sorted(items, key=lambda t: (t["date"], t.get("created_at", "")), reverse=True)

    def transaction(self, tx_id: str) -> Optional[Dict[str, Any]]:
        return next((t for t in self.transactions() if t["id"] == tx_id), None)

    # ------------------------------------------------------------- escrita
    def add_transaction(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            data = self._read()
            record = {
                "id": uuid.uuid4().hex[:12],
                "created_at": datetime.utcnow().isoformat(timespec="seconds"),
                **payload,
            }
            data.setdefault("transactions", []).append(record)
            self._write(data)
            return record

    def update_transaction(self, tx_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for index, item in enumerate(data.get("transactions", [])):
                if item["id"] == tx_id:
                    updated = {**item, **payload, "id": tx_id}
                    data["transactions"][index] = updated
                    self._write(data)
                    return updated
            return None

    def delete_transaction(self, tx_id: str) -> bool:
        with self._lock:
            data = self._read()
            items = data.get("transactions", [])
            remaining = [t for t in items if t["id"] != tx_id]
            if len(remaining) == len(items):
                return False
            data["transactions"] = remaining
            self._write(data)
            return True

    def update_fund(self, fund_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for index, item in enumerate(data.get("funds", [])):
                if item["id"] == fund_id:
                    updated = {**item, **{k: v for k, v in payload.items() if v is not None}}
                    data["funds"][index] = updated
                    self._write(data)
                    return updated
            return None


repository = FinanceRepository()
