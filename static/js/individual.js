/** Pagina: Individual — Ele x Ela lado a lado, com acerto de contas. */
(() => {
  "use strict";
  const F = window.Finances;
  const { el, fmt, fmt0, pct, api } = F;

  let historyChart;
  let current = null;
  let mode = "proporcional";

  function personCard(person, other) {
    const avatar = person.key === "ele" ? "👨" : "👩";
    const maxCat = Math.max(...person.categories.map((c) => c.value), 1);
    const maxEnv = Math.max(...person.envelopes.map((c) => c.value), 1);
    return `
      <div class="person-head">
        <div class="person-avatar">${avatar}</div>
        <div>
          <div class="person-name">${person.name}</div>
          <div class="person-tag">${pct(person.income_share)} da renda do casal · taxa de poupança ${pct(person.savings_rate)}</div>
        </div>
      </div>

      <div class="mini-grid">
        <div class="mini-card"><div class="k">Renda</div><div class="v text-emerald">${fmt(person.income)}</div>
          <div class="s">${fmt0(person.income_direct)} própria + ${fmt0(person.income_shared)} conjunta</div></div>
        <div class="mini-card"><div class="k">Gastos</div><div class="v text-pink">${fmt(person.expenses)}</div>
          <div class="s">${fmt0(person.expenses_direct)} direto + ${fmt0(person.expenses_shared)} rateado</div></div>
        <div class="mini-card"><div class="k">Aportes</div><div class="v" style="color:var(--blue)">${fmt(person.contributions)}</div>
          <div class="s">${fmt0(person.contributions_direct)} direto + ${fmt0(person.contributions_shared)} rateado</div></div>
        <div class="mini-card"><div class="k">Sobra</div><div class="v ${person.balance >= 0 ? "text-emerald" : "text-pink"}">${fmt(person.balance)}</div>
          <div class="s">renda − desembolso de ${fmt0(person.outflow)}</div></div>
      </div>

      <div class="panel glass" style="padding:18px;">
        <div class="panel-title" style="font-size:.9rem;margin-bottom:12px;">Onde ${person.name.toLowerCase()} gastou</div>
        <div class="rank-list">
          ${person.categories.map((c) => `
            <div>
              <div class="rank-item">
                <span>${c.icon}</span>
                <span class="rank-label">${c.label}</span>
                <span class="rank-value">${fmt0(c.value)}</span>
              </div>
              <div class="rank-bar"><span data-w="${(c.value / maxCat) * 100}"></span></div>
            </div>`).join("") || `<div class="text-muted" style="font-size:.82rem;">Sem gastos no período.</div>`}
        </div>
      </div>

      <div class="panel glass" style="padding:18px;">
        <div class="panel-title" style="font-size:.9rem;margin-bottom:12px;">Aportes por envelope</div>
        <div class="rank-list">
          ${person.envelopes.map((c) => `
            <div>
              <div class="rank-item">
                <span>${c.icon}</span>
                <span class="rank-label">${c.label}</span>
                <span class="rank-value">${fmt0(c.value)}</span>
              </div>
              <div class="rank-bar"><span data-w="${(c.value / maxEnv) * 100}"></span></div>
            </div>`).join("") || `<div class="text-muted" style="font-size:.82rem;">Nenhum aporte no período.</div>`}
        </div>
      </div>

      <div class="insight ${person.savings_rate >= 20 ? "insight-ok" : person.savings_rate >= 10 ? "insight-warn" : "insight-danger"}">
        <div class="insight-icon">${person.savings_rate >= 20 ? "🌟" : person.savings_rate >= 10 ? "📌" : "⚠️"}</div>
        <div>
          <div class="insight-title">Taxa de poupança de ${pct(person.savings_rate)}</div>
          <div class="insight-text">
            ${person.savings_rate >= 20
              ? "Acima dos 20% recomendados para acumulação consistente."
              : person.savings_rate >= 10
                ? "Entre 10% e 20%: aceitável, mas abaixo do ideal de 20%."
                : "Abaixo de 10%: a acumulação fica lenta demais para as metas do casal."}
            ${other ? ` ${person.name} responde por ${pct(person.income_share)} da renda do casal contra ${pct(other.income_share)} de ${other.name}.` : ""}
          </div>
        </div>
      </div>`;
  }

  function renderSettlement() {
    const data = current.settlement[mode];
    const people = Object.fromEntries(current.people.map((p) => [p.key, p]));
    const creditor = data.creditor;

    el("s-value").textContent = data.amount ? fmt(data.amount) : "Tudo equilibrado";
    el("s-value").className = `settlement-value ${creditor ? "text-violet" : "text-emerald"}`;
    el("s-text").innerHTML = creditor
      ? `<strong>${people[creditor === "ele" ? "ela" : "ele"].name}</strong> deve <strong>${fmt(data.amount)}</strong> para <strong>${people[creditor].name}</strong> para equilibrar o período
         ${mode === "proporcional"
           ? "— divisão proporcional à renda de cada um, o critério mais usado quando as rendas são diferentes."
           : "— divisão meio a meio de todo o custo do casal."}`
      : "Nenhum acerto necessário: o desembolso de cada um já corresponde à divisão escolhida.";

    el("s-detail").innerHTML = current.people.map((p) => `
      <div class="mini-card">
        <div class="k">${p.name} pagou</div>
        <div class="v">${fmt(data.paid[p.key])}</div>
        <div class="s">deveria pagar ${fmt0(data.fair[p.key])}</div>
      </div>`).join("") + `
      <div class="mini-card">
        <div class="k">Custo total do casal</div>
        <div class="v">${fmt(current.couple.total_costs)}</div>
        <div class="s">gastos ${fmt0(current.couple.expenses)} + aportes ${fmt0(current.couple.contributions)}</div>
      </div>
      <div class="mini-card">
        <div class="k">Renda somada</div>
        <div class="v text-emerald">${fmt(current.couple.income)}</div>
        <div class="s">base do rateio proporcional</div>
      </div>`;
  }

  function renderHistory(series, people) {
    const cfg = {
      labels: series.labels,
      datasets: [
        { type: "bar", label: `Desembolso ${people[0].name}`, data: series.ele.outflow, backgroundColor: "#2563eb99", borderRadius: 6, maxBarThickness: 22 },
        { type: "bar", label: `Desembolso ${people[1].name}`, data: series.ela.outflow, backgroundColor: "#ec489999", borderRadius: 6, maxBarThickness: 22 },
        { type: "line", label: `Renda ${people[0].name}`, data: series.ele.income, borderColor: "#38bdf8", borderWidth: 2, pointRadius: 0, tension: .35 },
        { type: "line", label: `Renda ${people[1].name}`, data: series.ela.income, borderColor: "#f9a8d4", borderWidth: 2, pointRadius: 0, tension: .35 },
      ],
    };
    if (historyChart) { historyChart.data = cfg; historyChart.update(); return; }
    historyChart = new Chart(el("i-history"), {
      data: cfg,
      options: {
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: { x: F.catAxis(), y: F.moneyAxis() },
        plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } } },
      },
    });
  }

  F.qs("#split-mode").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-mode]");
    if (!btn || !current) return;
    F.qsa("#split-mode button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    mode = btn.dataset.mode;
    renderSettlement();
  });

  F.start("individual", {
    async load(period) {
      const data = await api(`/api/individual?period=${period}`);
      current = data;
      F.setRangeHint(data.range);
      const [ele, ela] = data.people;
      el("col-ele").innerHTML = personCard(ele, ela);
      el("col-ela").innerHTML = personCard(ela, ele);
      renderSettlement();
      renderHistory(data.series, data.people);
      requestAnimationFrame(() => {
        F.qsa(".rank-bar > span").forEach((bar) => { bar.style.width = `${bar.dataset.w}%`; });
      });
    },
  });
})();
