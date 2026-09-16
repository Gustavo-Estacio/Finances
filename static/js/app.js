/**
 * Finances — SPA vanilla JS.
 * Consome /api/summary, /api/transactions e /api/funds; desenha os
 * gráficos com Chart.js e cuida de toda a interatividade da UI.
 */
(() => {
  "use strict";

  const fmtBRL = (value) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

  const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  const PAYER_LABEL = { ele: "Ele", ela: "Ela", ambos: "Ambos" };
  const PAYER_COLOR = { ele: "var(--ele)", ela: "var(--ela)", ambos: "var(--ambos)" };

  const state = {
    period: "month",
    funds: [],
    fundById: {},
    summary: null,
    transactions: [],
    hiddenLegend: new Set(),
    sort: { key: "date", dir: "desc" },
    filters: { search: "", type: "", fund: "", payer: "" },
    editingId: null,
  };

  const el = (id) => document.getElementById(id);
  const donutCanvas = el("donut-chart");
  const payerCanvas = el("payer-chart");
  const evolutionCanvas = el("evolution-chart");
  let donutChart, payerChart, evolutionChart;

  // ------------------------------------------------------------- toasts
  function toast(message, type = "success") {
    const stack = el("toast-stack");
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.innerHTML = `<span>${type === "success" ? "✅" : "⚠️"}</span><span>${message}</span>`;
    stack.appendChild(node);
    setTimeout(() => {
      node.style.transition = "opacity .3s ease, transform .3s ease";
      node.style.opacity = "0";
      node.style.transform = "translateX(30px)";
      setTimeout(() => node.remove(), 320);
    }, 3200);
  }

  // --------------------------------------------------------------- api
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      let detail = "Erro inesperado";
      try {
        const body = await res.json();
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      } catch (_) {}
      throw new Error(detail);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ------------------------------------------------------------- loading
  async function loadMeta() {
    const meta = await api("/api/meta");
    state.funds = meta.funds;
    state.fundById = Object.fromEntries(meta.funds.map((f) => [f.id, f]));
    populateFundSelects();
  }

  async function loadAll() {
    const [summary, transactions] = await Promise.all([
      api(`/api/summary?period=${state.period}`),
      api("/api/transactions"),
    ]);
    state.summary = summary;
    state.transactions = transactions;
    renderKpis();
    renderDonut();
    renderFunds();
    renderPayerChart();
    renderEvolutionChart();
    renderTable();
  }

  // ---------------------------------------------------------------- kpis
  function renderKpis() {
    const { kpis } = state.summary;
    el("kpi-income").textContent = fmtBRL(kpis.income);
    el("kpi-expense").textContent = fmtBRL(kpis.expenses);
    el("kpi-contrib").textContent = fmtBRL(kpis.contributions);
    el("kpi-free").textContent = fmtBRL(kpis.free_balance);
    el("kpi-income-foot").textContent = `${kpis.transactions} lançamentos no período`;
    el("kpi-expense-foot").textContent = kpis.income
      ? `${Math.round((kpis.expenses / kpis.income) * 100)}% da renda`
      : "sem renda no período";
    el("kpi-contrib-foot").textContent = `${kpis.savings_rate}% da renda guardada`;
    el("kpi-free-foot").textContent = kpis.free_balance >= 0 ? "no azul 💙" : "atenção: negativo";
  }

  // --------------------------------------------------------------- donut
  function renderDonut() {
    const { donut } = state.summary;
    const total = donut.values.reduce((a, b) => a + b, 0);
    el("donut-total").textContent = fmtBRL(total);

    const visibleValues = donut.values.map((v, i) => (state.hiddenLegend.has(i) ? 0 : v));

    if (donutChart) {
      donutChart.data.datasets[0].data = visibleValues;
      donutChart.update();
    } else {
      donutChart = new Chart(donutCanvas, {
        type: "doughnut",
        data: {
          labels: donut.labels,
          datasets: [
            {
              data: visibleValues,
              backgroundColor: donut.colors,
              borderColor: "#0d1117",
              borderWidth: 3,
              hoverOffset: 10,
            },
          ],
        },
        options: {
          cutout: "72%",
          animation: { animateRotate: true, animateScale: true, duration: 900, easing: "easeOutQuart" },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#161b22",
              borderColor: "rgba(255,255,255,.12)",
              borderWidth: 1,
              padding: 12,
              titleColor: "#f3f5f9",
              bodyColor: "#c4cad6",
              callbacks: {
                label: (ctx) => ` ${fmtBRL(ctx.parsed)}`,
              },
            },
          },
        },
      });
    }

    const legend = el("donut-legend");
    legend.innerHTML = "";
    donut.labels.forEach((label, i) => {
      const value = donut.values[i];
      const pct = total ? Math.round((value / total) * 100) : 0;
      const row = document.createElement("div");
      row.className = `legend-item${state.hiddenLegend.has(i) ? " off" : ""}`;
      row.innerHTML = `
        <span class="legend-dot" style="background:${donut.colors[i]}"></span>
        <span class="legend-name">${donut.icons[i] || ""} ${label}</span>
        <span class="legend-value">${fmtBRL(value)} · ${pct}%</span>
      `;
      row.addEventListener("click", () => {
        if (state.hiddenLegend.has(i)) state.hiddenLegend.delete(i);
        else state.hiddenLegend.add(i);
        renderDonut();
      });
      legend.appendChild(row);
    });
  }

  // ------------------------------------------------------------- fundos
  function renderFunds() {
    const grid = el("fund-grid");
    grid.innerHTML = "";
    state.summary.funds.forEach((fund) => {
      const card = document.createElement("div");
      card.className = "fund-card";
      card.style.setProperty("--fund-color", fund.color);
      const pct = fund.progress ?? 0;
      card.innerHTML = `
        <div class="fund-head">
          <div class="fund-icon">${fund.icon || "💠"}</div>
          <div>
            <div class="fund-name">${fund.short || fund.name}</div>
            <div class="fund-sub">+${fmtBRL(fund.period_contributed)} no período</div>
          </div>
        </div>
        <div class="fund-amounts">
          <span class="fund-balance">${fmtBRL(fund.balance)}</span>
          ${fund.goal ? `<span class="fund-goal">meta ${fmtBRL(fund.goal)}</span>` : ""}
        </div>
        ${
          fund.goal
            ? `<div class="progress-track"><div class="progress-fill" data-pct="${pct}"></div></div>
               <div class="progress-pct">${pct}% da meta</div>`
            : ""
        }
      `;
      grid.appendChild(card);
    });
    requestAnimationFrame(() => {
      grid.querySelectorAll(".progress-fill").forEach((bar) => {
        bar.style.width = `${bar.dataset.pct}%`;
      });
    });
  }

  // --------------------------------------------------------- ele/ela/ambos
  function renderPayerChart() {
    const { payers } = state.summary;
    const data = {
      labels: payers.labels,
      datasets: [
        {
          label: "Gastos",
          data: payers.expenses,
          backgroundColor: "#ec4899cc",
          borderRadius: 8,
          maxBarThickness: 38,
        },
        {
          label: "Aportes",
          data: payers.contributions,
          backgroundColor: "#2563ebcc",
          borderRadius: 8,
          maxBarThickness: 38,
        },
      ],
    };
    if (payerChart) {
      payerChart.data = data;
      payerChart.update();
      return;
    }
    payerChart = new Chart(payerCanvas, {
      type: "bar",
      data,
      options: {
        animation: { duration: 900, easing: "easeOutQuart" },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#c4cad6" } },
          y: {
            grid: { color: "rgba(255,255,255,.06)" },
            ticks: { color: "#7d8697", callback: (v) => fmtBRL(v).replace(",00", "") },
          },
        },
        plugins: {
          legend: { labels: { color: "#c4cad6", usePointStyle: true, pointStyle: "circle" } },
          tooltip: {
            backgroundColor: "#161b22",
            borderColor: "rgba(255,255,255,.12)",
            borderWidth: 1,
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}` },
          },
        },
      },
    });
  }

  // -------------------------------------------------------- evolucao
  function renderEvolutionChart() {
    const { evolution } = state.summary;
    const data = {
      labels: evolution.labels,
      datasets: [
        {
          label: "Patrimônio em fundos",
          data: evolution.patrimonio,
          borderColor: "#7c3aed",
          backgroundColor: "rgba(124,58,237,.18)",
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 5,
          borderWidth: 2.5,
        },
      ],
    };
    if (evolutionChart) {
      evolutionChart.data = data;
      evolutionChart.update();
      return;
    }
    evolutionChart = new Chart(evolutionCanvas, {
      type: "line",
      data,
      options: {
        animation: { duration: 1000, easing: "easeOutQuart" },
        interaction: { intersect: false, mode: "index" },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#7d8697" } },
          y: {
            grid: { color: "rgba(255,255,255,.06)" },
            ticks: { color: "#7d8697", callback: (v) => fmtBRL(v).replace(",00", "") },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#161b22",
            borderColor: "rgba(255,255,255,.12)",
            borderWidth: 1,
            callbacks: { label: (ctx) => ` ${fmtBRL(ctx.parsed.y)}` },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------- table
  function populateFundSelects() {
    const filterFund = el("filter-fund");
    const txFund = el("tx-fund");
    state.funds.forEach((fund) => {
      const opt1 = document.createElement("option");
      opt1.value = fund.id;
      opt1.textContent = `${fund.icon} ${fund.short || fund.name}`;
      filterFund.appendChild(opt1);

      const opt2 = opt1.cloneNode(true);
      txFund.appendChild(opt2);
    });
  }

  function typeMeta(type) {
    if (type === "income") return { label: "Receita", cls: "tag-income" };
    if (type === "contribution") return { label: "Aporte", cls: "tag-contribution" };
    return { label: "Gasto", cls: "tag-expense" };
  }

  function fundOrCategoryLabel(tx) {
    if (tx.fund && state.fundById[tx.fund]) {
      const fund = state.fundById[tx.fund];
      return `${fund.icon} ${fund.short || fund.name}`;
    }
    return tx.category || "Rotina";
  }

  function applyFilters(items) {
    const { search, type, fund, payer } = state.filters;
    return items.filter((tx) => {
      if (type && tx.type !== type) return false;
      if (payer && tx.payer !== payer) return false;
      if (fund && (tx.fund || "") !== fund) return false;
      if (search) {
        const needle = search.toLowerCase();
        const haystack = `${tx.description} ${tx.category || ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  function applySort(items) {
    const { key, dir } = state.sort;
    const sorted = [...items].sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (key === "category") {
        av = fundOrCategoryLabel(a);
        bv = fundOrCategoryLabel(b);
      }
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function renderTable() {
    const tbody = el("tx-tbody");
    const filtered = applySort(applyFilters(state.transactions));
    tbody.innerHTML = "";
    el("tx-empty").classList.toggle("hidden", filtered.length > 0);

    filtered.forEach((tx, index) => {
      const meta = typeMeta(tx.type);
      const isPositive = tx.type === "income";
      const row = document.createElement("tr");
      row.style.animationDelay = `${Math.min(index, 12) * 25}ms`;
      row.innerHTML = `
        <td>${fmtDate(tx.date)}</td>
        <td>
          <div>${tx.description}</div>
          <span class="tag ${meta.cls}">${meta.label}</span>
        </td>
        <td>${fundOrCategoryLabel(tx)}</td>
        <td>
          <span class="payer-pill">
            <span class="payer-dot" style="background:${PAYER_COLOR[tx.payer]}"></span>
            ${PAYER_LABEL[tx.payer] || tx.payer}
          </span>
        </td>
        <td class="amount-cell ${isPositive ? "positive" : "negative"}">
          ${isPositive ? "+" : "−"} ${fmtBRL(tx.amount)}
        </td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-edit="${tx.id}" title="Editar" aria-label="Editar">✎</button>
            <button class="icon-btn danger" data-delete="${tx.id}" title="Excluir" aria-label="Excluir">🗑</button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    });

    document.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openModalForEdit(btn.dataset.edit))
    );
    document.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
    );
  }

  // ------------------------------------------------------------- sorting
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { key, dir: "asc" };
      }
      document.querySelectorAll("th[data-sort]").forEach((h) => h.classList.remove("sorted", "asc"));
      th.classList.add("sorted");
      if (state.sort.dir === "asc") th.classList.add("asc");
      renderTable();
    });
  });

  // -------------------------------------------------------------- filtros
  el("search-input").addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    renderTable();
  });
  el("filter-type").addEventListener("change", (e) => {
    state.filters.type = e.target.value;
    renderTable();
  });
  el("filter-fund").addEventListener("change", (e) => {
    state.filters.fund = e.target.value;
    renderTable();
  });
  el("filter-payer").addEventListener("change", (e) => {
    state.filters.payer = e.target.value;
    renderTable();
  });

  // ------------------------------------------------------------ periodo
  el("period-filter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn) return;
    document.querySelectorAll("#period-filter button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.period = btn.dataset.period;
    loadAll().catch((err) => toast(err.message, "error"));
  });

  // -------------------------------------------------------------- modal
  const overlay = el("modal-overlay");
  const form = el("tx-form");
  let currentType = "income";
  let currentPayer = "ambos";

  function setModalType(type) {
    currentType = type;
    document.querySelectorAll("#type-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
    el("fund-field").classList.toggle("hidden", type === "income");
    el("category-field").classList.toggle("hidden", type === "contribution");
    if (type === "contribution") {
      el("tx-fund").required = true;
    } else {
      el("tx-fund").required = false;
    }
  }

  function setModalPayer(payer) {
    currentPayer = payer;
    document.querySelectorAll("#payer-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.payer === payer));
  }

  el("type-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (btn) setModalType(btn.dataset.type);
  });
  el("payer-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-payer]");
    if (btn) setModalPayer(btn.dataset.payer);
  });

  function openModalForCreate() {
    state.editingId = null;
    el("modal-title").textContent = "Novo Lançamento";
    el("modal-submit").textContent = "Salvar Lançamento";
    form.reset();
    el("tx-id").value = "";
    el("tx-date").value = new Date().toISOString().slice(0, 10);
    setModalType("income");
    setModalPayer("ambos");
    el("form-error").textContent = "";
    overlay.classList.add("open");
    setTimeout(() => el("tx-description").focus(), 150);
  }

  function openModalForEdit(id) {
    const tx = state.transactions.find((t) => t.id === id);
    if (!tx) return;
    state.editingId = id;
    el("modal-title").textContent = "Editar Lançamento";
    el("modal-submit").textContent = "Atualizar Lançamento";
    el("tx-id").value = id;
    el("tx-description").value = tx.description;
    el("tx-amount").value = tx.amount;
    el("tx-date").value = tx.date;
    el("tx-fund").value = tx.fund || "";
    el("tx-category").value = tx.category || "";
    setModalType(tx.type);
    setModalPayer(tx.payer);
    el("form-error").textContent = "";
    overlay.classList.add("open");
  }

  function closeModal() {
    overlay.classList.remove("open");
  }

  el("open-modal-btn").addEventListener("click", openModalForCreate);
  el("modal-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      type: currentType,
      amount: parseFloat(el("tx-amount").value),
      date: el("tx-date").value,
      description: el("tx-description").value.trim(),
      payer: currentPayer,
      category: el("tx-category").value.trim(),
      fund: currentType === "income" ? null : el("tx-fund").value || null,
    };

    if (currentType !== "income" && !payload.fund && currentType === "contribution") {
      el("form-error").textContent = "Selecione um fundo para o aporte.";
      return;
    }
    if (!payload.description || !(payload.amount > 0) || !payload.date) {
      el("form-error").textContent = "Preencha descrição, valor e data corretamente.";
      return;
    }

    const submitBtn = el("modal-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Salvando...";

    try {
      if (state.editingId) {
        await api(`/api/transactions/${state.editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        toast("Lançamento atualizado!");
      } else {
        await api("/api/transactions", { method: "POST", body: JSON.stringify(payload) });
        toast("Lançamento adicionado!");
      }
      closeModal();
      await loadAll();
    } catch (err) {
      el("form-error").textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = state.editingId ? "Atualizar Lançamento" : "Salvar Lançamento";
    }
  });

  async function handleDelete(id) {
    const tx = state.transactions.find((t) => t.id === id);
    const ok = confirm(`Excluir "${tx ? tx.description : "este lançamento"}"?`);
    if (!ok) return;
    try {
      await api(`/api/transactions/${id}`, { method: "DELETE" });
      toast("Lançamento excluído.");
      await loadAll();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // ---------------------------------------------------------------- boot
  (async function init() {
    try {
      await loadMeta();
      await loadAll();
    } catch (err) {
      toast(`Falha ao carregar dados: ${err.message}`, "error");
    }
  })();
})();
