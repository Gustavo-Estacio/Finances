# Finances — App Financeiro de Casal

Aplicação web para gestão financeira compartilhada de um casal: fundos
(reforma, lazer, conquistas, investimentos), contas de rotina, receitas,
gastos e aportes, com atribuição de quem pagou (Ele / Ela / Ambos).

Visual "Dark Synth / SaaS Premium": tema escuro, glassmorphism, gráficos
animados (Chart.js) e microinterações.

## Stack

- **Backend**: Python + FastAPI, rotas REST modulares (`/api/summary`,
  `/api/transactions`, `/api/funds`).
- **Persistência**: `database.json`, encapsulado em `database.py`
  (Data Repository Pattern) — pronto para migrar para SQLite/PostgreSQL
  sem alterar as rotas.
- **Frontend**: SPA em HTML5 + CSS moderno (CSS Grid/Flexbox, CSS
  Variables, glassmorphism, `@keyframes`/`cubic-bezier`) + JavaScript
  Vanilla.
- **Gráficos**: Chart.js (donut do panorama geral, barras Ele vs Ela vs
  Ambos, evolução de patrimônio, progresso dos fundos).

## Estrutura

```
main.py            # API FastAPI + serve a SPA
database.py         # Repositório JSON (Data Repository Pattern)
services.py          # Agregações para dashboards/gráficos
models.py            # Schemas Pydantic
seed.py               # Gera database.json com dados mockados realistas
templates/index.html  # SPA
static/css/theme.css   # Tema Dark Synth/SaaS Premium
static/js/app.js        # Lógica de interface e chamadas à API
example/                # PDFs de referência (prompt original e uma fatura de exemplo)
```

## Como rodar localmente

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python seed.py            # (opcional) recria o database.json com dados mockados
uvicorn main:app --reload
```

Acesse `http://127.0.0.1:8000`.

## Fundos financeiros do casal

- 🛠️ **Reforma & Imprevistos da Casa**
- 🍷 **Curtir Rolê & Lazer**
- 🚗 **Conquistas** (meta visual, ex: carro novo)
- 📈 **Renda Passiva & Investimentos**
- 🧾 **Contas de Rotina** (fixas/variáveis, sem fundo dedicado)

Toda transação registra quem pagou: **Ele**, **Ela** ou **Ambos (50/50)**.
