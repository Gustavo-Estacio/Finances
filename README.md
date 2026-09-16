# Finances — App Financeiro de Casal

Aplicação web para gestão financeira compartilhada de um casal, com visual
"Dark Synth / SaaS Premium": tema escuro, glassmorphism, gráficos animados
(Chart.js) e microinterações.

## Páginas

| Página | Rota | O que entrega |
| --- | --- | --- |
| **Visão Geral** | `/` | KPIs do período, donut de destino do dinheiro, distribuição da renda (referência 50/30/20), fundos e reservas, Ele × Ela × Ambos, evolução do patrimônio e tabela de lançamentos com CRUD. |
| **Gastos** | `/gastos` | Orçado × realizado por categoria, leitura automática de contador, projeção de fechamento do mês (run-rate), fixas × variáveis, essencial × supérfluo, maiores gastos e uso de fundos/reservas. |
| **Reservas** | `/reservas` | Reserva de emergência, reforma, saúde, estudos, carro e paisagismo: saldo, meta, progresso, aporte sugerido, previsão de conclusão e diagnóstico por prioridade. |
| **Individual** | `/individual` | Tela dividida ao meio — ele de um lado, ela do outro — com renda, gastos, aportes, taxa de poupança e **acerto de contas** (proporcional à renda ou 50/50). |
| **Patrimônio** | `/patrimonio` | Acumulação com juros compostos (8/10/12/15% a.a.), visualização por **meses, bimestres e anos**, projeção de 10 anos, marcos por horizonte e progresso rumo à independência financeira. |

O filtro de período (Mês Atual / Trimestre / Ano / Tudo) fica dentro de cada
página e é lembrado entre elas.

## Critérios contábeis adotados

- **Despesas correntes** (contas de rotina) consomem o orçamento mensal do
  plano de contas; **gastos pagos por um fundo/reserva** consomem o saldo
  carimbado daquele envelope, não o orçamento corrente.
- **Reserva de emergência** tem meta dinâmica: `6 × custo de vida essencial
  mensal`, calculado pela média dos últimos 6 meses fechados.
- **Rateio**: lançamentos com pagador "Ambos" entram 50/50 nas análises
  individuais.
- **Acerto de contas**: divisão proporcional à renda (padrão quando as rendas
  são diferentes) ou 50/50, sempre mostrando quem pagou a mais.
- **Juros compostos**: taxa mensal equivalente `i_m = (1 + i_a)^(1/12) − 1`,
  aplicada mês a mês sobre o saldo antes de somar o aporte do período.
- **Independência financeira**: patrimônio cujo rendimento mensal cobre o
  custo essencial, isto é `custo_essencial / i_m`.

## Stack

- **Backend**: Python + FastAPI, rotas REST (`/api/summary`, `/api/expenses`,
  `/api/reserves`, `/api/individual`, `/api/patrimonio`, `/api/transactions`).
- **Persistência**: `database.json` encapsulado em `database.py`
  (Data Repository Pattern) — pronto para migrar para SQLite/PostgreSQL sem
  alterar as rotas.
- **Frontend**: HTML5 semântico + CSS moderno (Grid/Flexbox, CSS Variables,
  glassmorphism, `@keyframes`, `cubic-bezier`) + JavaScript Vanilla.
- **Gráficos**: Chart.js servido localmente em `static/vendor/` (funciona sem
  internet).

## Estrutura

```
main.py                 # Rotas das páginas + API FastAPI
database.py             # Repositório JSON (Data Repository Pattern)
services.py             # Indicadores e agregações de cada página
models.py               # Schemas Pydantic
seed.py                 # Gera database.json com dados mockados realistas
templates/              # index, gastos, reservas, individual, patrimonio
static/css/theme.css    # Tema Dark Synth / SaaS Premium
static/css/pages.css    # Layout multi-página e componentes de relatório
static/js/core.js       # Sidebar, filtro de período, modal, API, formatação
static/js/*.js          # Um script por página
static/vendor/          # Chart.js local
example/                # PDFs de referência
```

## Como rodar localmente

```bash
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate # Linux/macOS

pip install -r requirements.txt
python seed.py               # (opcional) recria o database.json
python -m uvicorn main:app --reload
```

Acesse `http://127.0.0.1:8000`.

> Use Python 3.11–3.13. No Python 3.14 algumas dependências ainda não têm
> wheel pré-compilada no Windows e o pip tenta compilar do zero.
