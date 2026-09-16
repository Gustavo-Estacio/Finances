/** Pagina: Visao Geral. */
(() => {
  "use strict";
  const F = window.Finances;
  const { el, qsa, fmt, fmt0, api, fmtDate } = F;

  let donutChart, payerChart, evolutionChart;
  const state = {
    summary: null,
    transactions: [],
    hiddenLegend: new Set(),
    sort: { key: "date", dir: "desc" },
    filters: { search: "", type: "", fund: "", payer: "" },
    envelopeById: {},
  };

  function renderKpis() {
    const { kpis } = state.summary;
    el("kpi-income").textContent = fmt(kpis.income);
    el("kpi-expense").textContent = fmt(kpis.expenses);
    el("kpi-contrib").textContent = fmt(kpis.contributions);
    el("kpi-free").textContent = fmt(kpis.free_balance);
    el("kpi-income-foot").textContent = `${kpis.transactions} lançamentos no período`;
    el("kpi-expense-foot").textContent = kpis.income
      ? `${Math.round((kpis.expenses / kpis.income) * 100)}% da renda comprometida`
      : "sem renda no período";
    el("kpi-contrib-foot").textContent = `taxa de poupança de ${F.pct(kpis.savings_rate)}`;
    el("kpi-free-foot").innerHTML = kpis.free_balance >= 0
      ? `sobrou caixa livre · reservado <strong>${fmt0(kpis.reserved_total)}</strong>`
      : "⚠️ período fechou negativo";
  }

  function renderDonut() {
    const { donut } = state.summary;
    const total = donut.values.reduce((a, b) => a + b, 0);
    el("donut-total").textContent = fmt0(total);
    const visible = donut.values.map((v, i) => (state.hiddenLegend.has(i) ? 0 : v));

    if (donutChart) {
      donutChart.data.labels = donut.labels;
      donutChart.data.datasets[0].data = visible;
      donutChart.data.datasets[0].backgroundColor = donut.colors;
      donutChart.update();
    } else {
      donutChart = new Chart(el("donut-chart"), {
        type: "doughnut",
        data: { labels: donut.labels, datasets: [{ data: visible, backgroundColor: donut.colors, borderColor: "#0d1117", borderWidth: 3, hoverOffset: 12 }] },
        options: {
          cutout: "72%",
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.parsed)}` } },
          },
        },
      });
    }

    const legend = el("donut-legend");
    legend.innerHTML = "";
    donut.labels.forEach((label, i) => {
      const value = donut.values[i];
      const share = total ? Math.round((value / total) * 100) : 0;
      const row = document.createElement("div");
      row.className = `legend-item${state.hiddenLegend.has(i) ? " off" : ""}`;
      row.innerHTML = `
        <span class="legend-dot" style="background:${donut.colors[i]}"></span>
        <span class="legend-name">${donut.icons[i] || ""} ${label}</span>
        <span class="legend-value">${fmt0(value)} · ${share}%</span>`;
      row.addEventListener("click", () => {
        state.hiddenLegend.has(i) ? state.hiddenLegend.delete(i) : state.hiddenLegend.add(i);
        renderDonut();
      });
      legend.appendChild(row);
    });
  }

  function renderIncomeSplit() {
    const k = state.summary.kpis;
    const income = k.income || 0;
    const share = (value) => (income ? (value / income) * 100 : 0);
    const gastos = share(k.expenses);
    const aportes = share(k.contributions);
    const livre = Math.max(share(k.free_balance), 0);
    const saving = k.savings_rate;
    const verdict = saving >= 20
      ? { cls: "text-emerald", text: "acima dos 20% recomendados" }
      : saving >= 10
        ? { cls: "text-amber", text: "abaixo dos 20% recomendados" }
        : { cls: "text-pink", text: "muito abaixo dos 20% recomendados" };

    el("income-split").innerHTML = `
      <div class="split-title">Distribuição da renda no período</div>
      <div class="split-sub">Referência clássica 50/30/20: até 50% em essenciais, 30% em estilo de vida e ao menos 20% poupado.</div>
      <div class="split-bar">
        <span style="width:${gastos}%;background:#ec4899"></span>
        <span style="width:${aportes}%;background:#2563eb"></span>
        <span style="width:${livre}%;background:#10b981"></span>
      </div>
      <div class="split-rows">
        <div class="split-row">
          <div class="k"><i style="width:9px;height:9px;border-radius:3px;background:#ec4899;display:inline-block;"></i> Gastos</div>
          <div class="v text-pink">${F.pct(gastos)}</div>
          <div class="s">${fmt0(k.expenses)}</div>
        </div>
        <div class="split-row">
          <div class="k"><i style="width:9px;height:9px;border-radius:3px;background:#2563eb;display:inline-block;"></i> Aportes</div>
          <div class="v" style="color:var(--blue)">${F.pct(aportes)}</div>
          <div class="s">${fmt0(k.contributions)}</div>
        </div>
        <div class="split-row">
          <div class="k"><i style="width:9px;height:9px;border-radius:3px;background:#10b981;display:inline-block;"></i> Livre</div>
          <div class="v text-emerald">${F.pct(livre)}</div>
          <div class="s">${fmt0(k.free_balance)}</div>
        </div>
      </div>
      <div class="insight ${saving >= 20 ? "insight-ok" : saving >= 10 ? "insight-warn" : "insight-danger"}" style="margin-top:14px;">
        <div class="insight-icon">${saving >= 20 ? "🌟" : "📌"}</div>
        <div>
          <div class="insight-title">Taxa de poupança de ${F.pct(saving)}</div>
          <div class="insight-text">O casal direcionou <strong>${fmt0(k.contributions)}</strong> para fundos e reservas — <span class="${verdict.cls}">${verdict.text}</span>.</div>
        </div>
      </div>`;
  }

  function renderEnvelopes() {
    const grid = el("fund-grid");
    const items = state.summary.funds;
    const cards = items.map((env) => {
      const progress = env.progress ?? 0;
      return `
        <div class="fund-card" style="--fund-color:${env.color}">
          <div class="fund-head">
            <div class="fund-icon">${env.icon || "💠"}</div>
            <div>
              <div class="fund-name">${env.short || env.name}</div>
              <div class="fund-sub">${env.kind === "reserve" ? "Reserva" : "Fundo"} · +${fmt0(env.period_contributed)} no período</div>
            </div>
          </div>
          <div class="fund-amounts">
            <span class="fund-balance">${fmt(env.balance)}</span>
            ${env.goal ? `<span class="fund-goal">meta ${fmt0(env.goal)}</span>` : ""}
          </div>
          ${env.goal ? `<div class="progress-track"><div class="progress-fill" data-pct="${progress}"></div></div>
                        <div class="progress-pct">${F.pct(progress)} da meta</div>` : ""}
        </div>`;
    });

    // Card agregado das reservas — o detalhe fica na pagina Reservas
    const reserves = state.summary.reserves;
    const reserved = reserves.reduce((sum, r) => sum + r.balance, 0);
    const goals = reserves.reduce((sum, r) => sum + (r.goal || 0), 0);
    const coverage = goals ? (reserved / goals) * 100 : 0;
    const periodContributed = reserves.reduce((sum, r) => sum + r.period_contributed, 0);
    cards.push(`
      <div class="fund-card" style="--fund-color:#f59e0b">
        <div class="fund-head">
          <div class="fund-icon">🛟</div>
          <div>
            <div class="fund-name">Reservas do Casal</div>
            <div class="fund-sub">${reserves.length} reservas · +${fmt0(periodContributed)} no período</div>
          </div>
        </div>
        <div class="fund-amounts">
          <span class="fund-balance">${fmt(reserved)}</span>
          <span class="fund-goal">meta ${fmt0(goals)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" data-pct="${Math.min(coverage, 100)}"></div></div>
        <div class="progress-pct">${F.pct(coverage)} das metas · ${state.summary.kpis.months_covered} meses de custo</div>
      </div>`);

    grid.innerHTML = cards.join("");
    requestAnimationFrame(() => {
      qsa(".progress-fill", grid).forEach((bar) => { bar.style.width = `${bar.dataset.pct}%`; });
    });
  }

  function renderPayerChart() {
    const { payers } = state.summary;
    const data = {
      labels: payers.labels,
      datasets: [
        { label: "Gastos", data: payers.expenses, backgroundColor: "#ec4899cc", borderRadius: 8, maxBarThickness: 40 },
        { label: "Aportes", data: payers.contributions, backgroundColor: "#2563ebcc", borderRadius: 8, maxBarThickness: 40 },
      ],
    };
    if (payerChart) { payerChart.data = data; payerChart.update(); return; }
    payerChart = new Chart(el("payer-chart"), {
      type: "bar", data,
      options: {
        maintainAspectRatio: false,
        scales: { x: F.catAxis(), y: F.moneyAxis() },
        plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } } },
      },
    });
  }

  function renderEvolution() {
    const { evolution } = state.summary;
    const data = {
      labels: evolution.labels,
      datasets: [{
        label: "Patrimônio", data: evolution.patrimonio,
        borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,.18)",
        fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5,
      }],
    };
    if (evolutionChart) { evolutionChart.data = data; evolutionChart.update(); return; }
    evolutionChart = new Chart(el("evolution-chart"), {
      type: "line", data,
      options: {
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: { x: F.catAxis(), y: F.moneyAxis() },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.parsed.y)}` } } },
      },
    });
  }

  // ------------------------------------------------------------- tabela
  function envelopeLabel(tx) {
    const env = state.envelopeById[tx.fund];
    if (env) return `${env.icon} ${env.short || env.name}`;
    const cat = (F.meta().categories || []).find((c) => c.id === tx.category);
    return cat ? `${cat.icon} ${cat.name}` : (tx.category || "Rotina");
  }

  function typeMeta(type) {
    if (type === "income") return { label: "Receita", cls: "tag-income" };
    if (type === "contribution") return { label: "Aporte", cls: "tag-contribution" };
    return { label: "Gasto", cls: "tag-expense" };
  }

  function renderTable() {
    const { search, type, fund, payer } = state.filters;
    let items = state.transactions.filter((tx) => {
      if (type && tx.type !== type) return false;
      if (payer && tx.payer !== payer) return false;
      if (fund && (tx.fund || "") !== fund) return false;
      if (search && !`${tx.description} ${tx.category || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    const { key, dir } = state.sort;
    items = [...items].sort((a, b) => {
      let av = key === "category" ? envelopeLabel(a) : a[key];
      let bv = key === "category" ? envelopeLabel(b) : b[key];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    }).slice(0, 120);

    el("tx-empty").classList.toggle("hidden", items.length > 0);
    el("tx-tbody").innerHTML = items.map((tx, index) => {
      const meta = typeMeta(tx.type);
      const positive = tx.type === "income";
      const sign = positive ? "+" : tx.type === "contribution" ? "→" : "−";
      const amountClass = positive ? "positive" : tx.type === "contribution" ? "neutral" : "negative";
      return `
        <tr style="animation-delay:${Math.min(index, 12) * 22}ms">
          <td>${fmtDate(tx.date)}</td>
          <td><div>${tx.description}</div><span class="tag ${meta.cls}">${meta.label}</span></td>
          <td>${envelopeLabel(tx)}</td>
          <td><span class="payer-pill"><span class="payer-dot" style="background:${F.PAYER_COLOR[tx.payer]}"></span>${F.PAYER_LABEL[tx.payer]}</span></td>
          <td class="amount-cell ${amountClass}">${sign} ${fmt(tx.amount)}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-edit="${tx.id}" title="Editar">✎</button>
            <button class="icon-btn danger" data-delete="${tx.id}" title="Excluir">🗑</button>
          </div></td>
        </tr>`;
    }).join("");

    qsa("[data-edit]").forEach((btn) => btn.addEventListener("click", () => {
      const tx = state.transactions.find((t) => t.id === btn.dataset.edit);
      if (tx) F.openModal(tx);
    }));
    qsa("[data-delete]").forEach((btn) => btn.addEventListener("click", () => {
      const tx = state.transactions.find((t) => t.id === btn.dataset.delete);
      if (tx) F.removeTransaction(tx);
    }));
  }

  function bindTableControls() {
    el("search-input").addEventListener("input", (e) => { state.filters.search = e.target.value; renderTable(); });
    el("filter-type").addEventListener("change", (e) => { state.filters.type = e.target.value; renderTable(); });
    el("filter-fund").addEventListener("change", (e) => { state.filters.fund = e.target.value; renderTable(); });
    el("filter-payer").addEventListener("change", (e) => { state.filters.payer = e.target.value; renderTable(); });
    qsa("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.sort = state.sort.key === key
        ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" };
      qsa("th[data-sort]").forEach((h) => h.classList.remove("sorted", "asc"));
      th.classList.add("sorted");
      if (state.sort.dir === "asc") th.classList.add("asc");
      renderTable();
    }));
  }

  let bound = false;
  F.start("dashboard", {
    async load(period) {
      const [summary, transactions] = await Promise.all([
        api(`/api/summary?period=${period}`),
        api("/api/transactions?limit=500"),
      ]);
      state.summary = summary;
      state.transactions = transactions;
      state.envelopeById = Object.fromEntries((F.meta().envelopes || []).map((e) => [e.id, e]));

      if (!bound) {
        const select = el("filter-fund");
        (F.meta().envelopes || []).forEach((env) => {
          select.insertAdjacentHTML("beforeend", `<option value="${env.id}">${env.icon} ${env.short || env.name}</option>`);
        });
        bindTableControls();
        bound = true;
      }

      F.setRangeHint(summary.range);
      renderKpis();
      renderDonut();
      renderIncomeSplit();
      renderEnvelopes();
      renderPayerChart();
      renderEvolution();
      renderTable();
    },
  });
})();
