/** Pagina: Reservas do casal. */
(() => {
  "use strict";
  const F = window.Finances;
  const { el, fmt, fmt0, pct, api } = F;

  let historyChart;
  const STATUS = {
    completa: { cls: "badge-ok", label: "Meta atingida" },
    "no-ritmo": { cls: "badge-info", label: "No ritmo" },
    atrasada: { cls: "badge-warn", label: "Atrasada" },
    parada: { cls: "badge-danger", label: "Sem aporte" },
  };

  function renderStats(s) {
    el("r-total").textContent = fmt(s.total_balance);
    el("r-total-foot").innerHTML = `equivale a <strong>${s.months_covered}</strong> meses de custo essencial (${fmt0(s.essential_monthly)}/mês)`;

    el("r-coverage").textContent = pct(s.coverage);
    el("r-coverage-foot").innerHTML = `faltam <strong>${fmt0(s.total_missing)}</strong> para completar ${fmt0(s.total_goal)} em metas`;

    const gap = s.emergency_target - s.emergency_months;
    el("r-emergency").textContent = `${s.emergency_months} / ${s.emergency_target} meses`;
    el("r-emergency").className = `stat-value small ${gap <= 0 ? "text-emerald" : gap > 3 ? "text-pink" : "text-amber"}`;
    el("r-emergency-foot").textContent = gap <= 0
      ? "colchão de segurança completo"
      : `faltam ${gap.toFixed(1)} meses de cobertura`;

    el("r-monthly").textContent = fmt(s.monthly_current);
    el("r-monthly-foot").innerHTML = `média dos últimos 6 meses · sugerido <strong>${fmt0(s.monthly_needed)}</strong> para cumprir todos os prazos`;
  }

  function renderAlerts(alerts) {
    const icons = { ok: "✅", warn: "⚠️", danger: "🚨" };
    el("r-alerts").innerHTML = alerts.map((a) => `
      <div class="insight insight-${a.level}">
        <div class="insight-icon">${icons[a.level] || "💡"}</div>
        <div>
          <div class="insight-title">${a.title}</div>
          <div class="insight-text">${a.text}</div>
        </div>
      </div>`).join("") || `<div class="text-muted">Sem alertas — todas as reservas estão em dia.</div>`;
  }

  function ring(progress, color, icon) {
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - Math.min(progress, 100) / 100);
    return `
      <div class="reserve-ring">
        <svg viewBox="0 0 62 62">
          <circle class="ring-bg" cx="31" cy="31" r="${radius}" fill="none" stroke-width="6"></circle>
          <circle class="ring-fill" cx="31" cy="31" r="${radius}" fill="none" stroke-width="6"
                  stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}" data-offset="${offset}"></circle>
        </svg>
        <div class="ring-emoji">${icon}</div>
      </div>`;
  }

  function renderCards(reserves) {
    el("r-grid").innerHTML = reserves.map((r) => {
      const status = STATUS[r.status] || STATUS.atrasada;
      const eta = r.eta_months === 0 ? "concluída"
        : r.eta_months == null ? "sem previsão"
        : `${r.eta_months} ${r.eta_months === 1 ? "mês" : "meses"}`;
      return `
        <article class="reserve-card" style="--fund-color:${r.color}">
          <div class="reserve-top">
            ${ring(r.progress, r.color, r.icon)}
            <div class="reserve-meta">
              <div class="reserve-name">${r.name}</div>
              <div class="reserve-desc">${r.description || ""}</div>
              <div style="margin-top:8px;"><span class="badge ${status.cls}">${status.label}</span>
                <span class="badge badge-muted">prioridade ${r.priority}</span></div>
            </div>
          </div>
          <div class="reserve-figures">
            <span class="reserve-balance">${fmt(r.balance)}</span>
            <span class="reserve-goal">de ${fmt0(r.goal)} · ${pct(r.progress)}</span>
          </div>
          <div class="reserve-rows">
            <div class="reserve-row"><div class="k">Falta</div><div class="v">${fmt0(r.missing)}</div></div>
            <div class="reserve-row"><div class="k">Aporte médio</div><div class="v">${fmt0(r.avg_monthly)}/mês</div></div>
            <div class="reserve-row"><div class="k">Sugerido</div><div class="v">${fmt0(r.suggested_monthly)}/mês</div></div>
            <div class="reserve-row"><div class="k">Previsão</div><div class="v">${eta}</div></div>
          </div>
          <div class="text-muted" style="font-size:.74rem;">
            No período: +${fmt0(r.period_contributed)} aportados${r.period_used ? ` · −${fmt0(r.period_used)} utilizados` : ""}
            ${r.goal_mode === "months_expenses" ? ` · meta dinâmica: ${r.goal_months}× custo essencial` : ""}
          </div>
        </article>`;
    }).join("");

    requestAnimationFrame(() => {
      F.qsa("#r-grid .ring-fill").forEach((c) => { c.style.strokeDashoffset = c.dataset.offset; });
    });
  }

  function renderPlan(reserves) {
    el("r-plan").innerHTML = reserves.map((r) => {
      const ok = r.avg_monthly >= r.suggested_monthly;
      return `
        <tr>
          <td><div class="cell-main"><span class="cell-icon" style="background:${r.color}22;">${r.icon}</span>${r.short}</div></td>
          <td class="num">${fmt0(r.missing)}</td>
          <td class="num">${fmt0(r.suggested_monthly)}</td>
          <td class="num ${ok ? "text-emerald" : "text-amber"}">${fmt0(r.avg_monthly)}</td>
          <td>${r.target_months} meses</td>
        </tr>`;
    }).join("");
  }

  function renderHistory(series) {
    const cfg = {
      labels: series.labels,
      datasets: [{
        label: "Saldo reservado", data: series.balance,
        borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,.16)",
        fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5,
      }],
    };
    if (historyChart) { historyChart.data = cfg; historyChart.update(); return; }
    historyChart = new Chart(el("r-history"), {
      type: "line", data: cfg,
      options: {
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: { x: F.catAxis(), y: F.moneyAxis() },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.parsed.y)}` } } },
      },
    });
  }

  F.start("reservas", {
    async load(period) {
      const data = await api(`/api/reserves?period=${period}`);
      F.setRangeHint(data.range);
      renderStats(data.summary);
      renderAlerts(data.alerts);
      renderCards(data.reserves);
      renderPlan(data.reserves);
      renderHistory(data.series);
    },
  });
})();
