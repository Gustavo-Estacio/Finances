/** Pagina: Patrimonio — juros compostos, projecao e independencia financeira. */
(() => {
  "use strict";
  const F = window.Finances;
  const { el, fmt, fmt0, pct, api } = F;

  let chart;
  const state = { view: "months", rate: 0.12, scope: "history", points: [] };

  function renderStats(c, rate, monthlyRate) {
    el("p-balance").textContent = fmt(c.balance);
    el("p-balance-foot").innerHTML = `capitalizado a <strong>${(rate * 100).toFixed(0)}% a.a.</strong> (${monthlyRate.toFixed(4).replace(".", ",")}% a.m.)`;

    el("p-contributed").textContent = fmt(c.contributed);
    el("p-contributed-foot").innerHTML = `aporte médio de <strong>${fmt0(c.avg_monthly_flow)}/mês</strong> nos últimos 6 meses`;

    el("p-interest").textContent = fmt(c.interest);
    el("p-interest-foot").innerHTML = `<strong>${pct(c.interest_share)}</strong> do patrimônio já vem de rendimento, não de aporte`;

    el("p-passive").textContent = `${fmt(c.passive_income)}/mês`;
    el("p-passive-foot").innerHTML = `cobre <strong>${pct(c.essential_monthly ? (c.passive_income / c.essential_monthly) * 100 : 0)}</strong> do custo essencial de ${fmt0(c.essential_monthly)}`;
  }

  function renderChart(data) {
    const { labels, balance, contributed, interest, projected } = data;
    const cut = projected.findIndex(Boolean);
    const split = cut === -1 ? labels.length : cut;
    const mask = (series, wantProjected) =>
      series.map((v, i) => {
        const isProj = projected[i];
        if (wantProjected) return i >= split - 1 ? v : null;
        return isProj ? null : v;
      });

    const cfg = {
      labels,
      datasets: [
        { label: "Patrimônio", data: mask(balance, false), borderColor: "#10b981", backgroundColor: "rgba(16,185,129,.16)", fill: true, tension: .35, pointRadius: 0, borderWidth: 2.8 },
        { label: "Patrimônio (projetado)", data: mask(balance, true), borderColor: "#10b981", borderDash: [6, 5], fill: false, tension: .35, pointRadius: 0, borderWidth: 2 },
        { label: "Total aportado", data: mask(contributed, false), borderColor: "#2563eb", fill: false, tension: .35, pointRadius: 0, borderWidth: 2 },
        { label: "Aportado (projetado)", data: mask(contributed, true), borderColor: "#2563eb", borderDash: [6, 5], fill: false, tension: .35, pointRadius: 0, borderWidth: 1.6 },
        { label: "Juros acumulados", data: interest, borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,.12)", fill: true, tension: .35, pointRadius: 0, borderWidth: 1.6 },
      ],
    };
    if (chart) { chart.data = cfg; chart.update(); return; }
    chart = new Chart(el("p-chart"), {
      type: "line", data: cfg,
      options: {
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: { x: F.catAxis({ ticks: { maxTicksLimit: 14, autoSkip: true } }), y: F.moneyAxis() },
        plugins: {
          legend: { labels: { filter: (item) => !item.text.includes("projetado") } },
          tooltip: { callbacks: { label: (ctx) => (ctx.parsed.y == null ? null : ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`) } },
        },
      },
    });
  }

  function renderMilestones(milestones) {
    el("p-milestones").innerHTML = milestones.map((m) => `
      <div class="milestone">
        <div class="k">Em ${m.label}</div>
        <div class="v text-emerald">${fmt0(m.balance)}</div>
        <div class="s">aportado ${fmt0(m.contributed)} · juros <strong class="text-violet">${fmt0(m.interest)}</strong><br>
          renda passiva ${fmt0(m.passive_income)}/mês</div>
      </div>`).join("");
  }

  function renderIndependence(fi, current) {
    const eta = fi.years_to_target != null
      ? `Mantendo o aporte médio atual, o casal chega lá em <strong>${fi.years_to_target} anos</strong> (${fi.months_to_target} meses).`
      : "No ritmo atual de aportes, a meta não é alcançada dentro do horizonte projetado — aumente o aporte mensal ou reduza o custo essencial.";
    el("p-fi").innerHTML = `
      <div class="stat-value" style="font-size:1.9rem;">${pct(fi.progress)}</div>
      <div class="fi-bar"><span data-w="${fi.progress}"></span></div>
      <div class="text-muted" style="font-size:.82rem;line-height:1.6;">
        Patrimônio necessário: <strong class="text-emerald">${fmt0(fi.target)}</strong> — valor cujo rendimento mensal
        (${fmt0(current.essential_monthly)}) cobre o custo de vida essencial do casal sem consumir o principal.<br><br>
        ${eta}<br><br>
        Hoje o patrimônio equivale a <strong>${current.coverage_months}</strong> meses de custo essencial.
      </div>`;
    requestAnimationFrame(() => {
      const bar = F.qs("#p-fi .fi-bar > span");
      if (bar) bar.style.width = `${bar.dataset.w}%`;
    });
  }

  function renderTable(points) {
    state.points = points;
    const filtered = state.scope === "all"
      ? points
      : points.filter((p) => (state.scope === "projection" ? p.projected : !p.projected));
    const rows = [...filtered].reverse();
    el("p-tbody").innerHTML = rows.map((p) => {
      const share = p.balance ? (p.interest / p.balance) * 100 : 0;
      return `
        <tr class="${p.projected ? "projected" : ""}">
          <td>${p.label} ${p.projected ? '<span class="badge badge-muted">projeção</span>' : ""}</td>
          <td class="num">${fmt0(p.flow)}</td>
          <td class="num">${fmt0(p.contributed)}</td>
          <td class="num text-violet">${fmt0(p.interest)}</td>
          <td class="num"><strong>${fmt0(p.balance)}</strong></td>
          <td><div class="bar-mini" style="--bar-color:var(--violet)"><span data-w="${share}"></span></div>
              <div class="text-muted" style="font-size:.7rem;margin-top:3px;">${pct(share)} de juros</div></td>
        </tr>`;
    }).join("");
    requestAnimationFrame(() => {
      F.qsa("#p-tbody .bar-mini > span").forEach((bar) => { bar.style.width = `${bar.dataset.w}%`; });
    });
  }

  async function load() {
    const data = await api(`/api/patrimonio?view=${state.view}&rate=${state.rate}`);
    renderStats(data.current, data.rate, data.monthly_rate);
    renderChart(data.chart);
    renderMilestones(data.milestones);
    renderIndependence(data.independence, data.current);
    renderTable(data.chart.points);
    el("p-chart-sub").textContent =
      `${data.history_points} períodos de histórico real + projeção de 10 anos com aporte médio de ${fmt0(data.current.avg_monthly_flow)}/mês`;
  }

  F.qs("#p-scope").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-scope]");
    if (!btn) return;
    F.qsa("#p-scope button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.scope = btn.dataset.scope;
    renderTable(state.points);
  });

  F.qs("#p-view").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-view]");
    if (!btn) return;
    F.qsa("#p-view button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.view = btn.dataset.view;
    load().catch((err) => F.toast(err.message, "error"));
  });

  el("p-rate").addEventListener("change", (event) => {
    state.rate = parseFloat(event.target.value);
    load().catch((err) => F.toast(err.message, "error"));
  });

  F.start("patrimonio", { load });
})();
