/** Pagina: Gastos — orcado vs realizado, com leitura de contador. */
(() => {
  "use strict";
  const F = window.Finances;
  const { el, fmt, fmt0, pct, api, fmtDate } = F;

  let historyChart, natureChart;
  const STATUS = {
    ok: { cls: "badge-ok", label: "No orçamento", color: "#10b981" },
    atencao: { cls: "badge-warn", label: "No limite", color: "#f59e0b" },
    estourou: { cls: "badge-danger", label: "Estourou", color: "#f43f5e" },
    "sem-orcamento": { cls: "badge-muted", label: "Sem orçamento", color: "#64748b" },
  };

  function renderStats(data) {
    const t = data.totals;
    el("g-planned").textContent = fmt(t.planned);
    el("g-planned-foot").innerHTML = `orçamento mensal de <strong>${fmt0(data.benchmarks.monthly_budget)}</strong> × ${data.range.months} ${data.range.months > 1 ? "meses" : "mês"}`;

    el("g-actual").textContent = fmt(t.actual);
    el("g-actual-foot").innerHTML = `+ <strong>${fmt0(t.envelope_spend)}</strong> pagos por fundos/reservas`;

    const positive = t.diff >= 0;
    el("g-diff").textContent = `${positive ? "+" : "−"} ${fmt(Math.abs(t.diff))}`;
    el("g-diff").className = `stat-value ${positive ? "text-emerald" : "text-pink"}`;
    el("g-diff-foot").textContent = positive
      ? `economia de ${pct(100 - t.pct)} sobre o orçado`
      : `excesso de ${pct(t.pct - 100)} sobre o orçado`;

    el("g-commitment").textContent = pct(t.commitment);
    el("g-commitment").className = `stat-value ${t.commitment > 70 ? "text-pink" : t.commitment > 55 ? "text-amber" : "text-emerald"}`;
    el("g-commitment-foot").innerHTML = `gastos correntes sobre renda de <strong>${fmt0(t.income)}</strong>`;
  }

  function renderInsights(data) {
    const t = data.totals;
    const b = data.benchmarks;
    const items = [];

    if (data.projection) {
      const p = data.projection;
      const over = p.projected_close > p.budget;
      items.push({
        level: over ? "warn" : "ok",
        icon: over ? "📈" : "🎯",
        title: over ? "Projeção estoura o orçamento do mês" : "Projeção dentro do orçamento",
        text: `Com ${p.days_elapsed} de ${p.days_total} dias corridos e média de ${fmt(p.daily_average)}/dia, o mês fecha em <strong>${fmt(p.projected_close)}</strong> contra orçamento de ${fmt(p.budget)} — ${over ? "excesso" : "folga"} projetada de <strong>${fmt(Math.abs(p.gap))}</strong>.`,
      });
    }

    const worst = data.rows.filter((r) => r.status === "estourou").sort((a, b2) => a.diff - b2.diff).slice(0, 3);
    if (worst.length) {
      items.push({
        level: "danger",
        icon: "🚨",
        title: `${worst.length} categoria(s) acima do orçado`,
        text: worst.map((r) => `<strong>${r.name}</strong> ${pct(r.pct)} (${fmt(Math.abs(r.diff))} acima)`).join(" · ")
          + ". Reveja estas contas antes de aumentar aportes.",
      });
    }

    const fixedShare = t.actual ? (data.nature.values[0] / t.actual) * 100 : 0;
    items.push({
      level: fixedShare > 60 ? "warn" : "ok",
      icon: "🏛️",
      title: `Custos fixos representam ${pct(fixedShare)} do gasto`,
      text: `Fixas ${fmt(data.nature.values[0])} · variáveis ${fmt(data.nature.values[1])}. Custo fixo médio mensal de <strong>${fmt(b.fixed_monthly)}</strong>. ${fixedShare > 60 ? "Acima de 60% o orçamento fica rígido — sobra pouca margem de manobra em meses ruins." : "Boa margem de manobra: a maior parte do gasto é ajustável."}`,
    });

    items.push({
      level: "ok",
      icon: "🛟",
      title: "Custo de vida essencial",
      text: `Média dos últimos 6 meses: <strong>${fmt(b.essential_monthly)}/mês</strong> de despesas essenciais. É este o número que dimensiona a reserva de emergência (6× = ${fmt(b.essential_monthly * 6)}).`,
    });

    if (t.commitment > 0) {
      const level = t.commitment > 70 ? "danger" : t.commitment > 55 ? "warn" : "ok";
      items.push({
        level,
        icon: "⚖️",
        title: `Comprometimento da renda em ${pct(t.commitment)}`,
        text: level === "ok"
          ? "Abaixo de 55% — há espaço saudável para aportes e reservas."
          : level === "warn"
            ? "Entre 55% e 70% — atenção: o espaço para poupar está apertando."
            : "Acima de 70% — risco alto. Corte primeiro as categorias variáveis não essenciais.",
      });
    }

    el("g-insights").innerHTML = items.map((i) => `
      <div class="insight insight-${i.level}">
        <div class="insight-icon">${i.icon}</div>
        <div>
          <div class="insight-title">${i.title}</div>
          <div class="insight-text">${i.text}</div>
        </div>
      </div>`).join("");
  }

  function renderTable(data) {
    const rows = data.rows.map((r) => {
      const status = STATUS[r.status];
      const width = Math.min(r.pct ?? 0, 100);
      return `
        <tr>
          <td><div class="cell-main"><span class="cell-icon">${r.icon}</span>
            <div>${r.name}<div class="text-muted" style="font-size:.72rem;font-weight:500;">${r.count} lançamento${r.count === 1 ? "" : "s"}${r.essential ? " · essencial" : ""}</div></div></div></td>
          <td><span class="badge ${r.nature === "fixa" ? "badge-info" : "badge-muted"}">${r.nature === "fixa" ? "Fixa" : "Variável"}</span></td>
          <td class="num">${r.planned ? fmt(r.planned) : "—"}</td>
          <td class="num">${fmt(r.actual)}</td>
          <td class="num ${r.diff >= 0 ? "text-emerald" : "text-pink"}">${r.planned ? `${r.diff >= 0 ? "+" : "−"} ${fmt(Math.abs(r.diff))}` : "—"}</td>
          <td><div class="bar-mini" style="--bar-color:${status.color}"><span data-w="${width}"></span></div>
              <div class="text-muted" style="font-size:.71rem;margin-top:4px;">${r.pct != null ? pct(r.pct) : "—"}</div></td>
          <td><span class="badge ${status.cls}">${status.label}</span></td>
        </tr>`;
    }).join("");

    const t = data.totals;
    el("g-tbody").innerHTML = rows + `
      <tr class="is-total">
        <td><div class="cell-main"><span class="cell-icon">Σ</span> Total de despesas correntes</div></td>
        <td></td>
        <td class="num">${fmt(t.planned)}</td>
        <td class="num">${fmt(t.actual)}</td>
        <td class="num ${t.diff >= 0 ? "text-emerald" : "text-pink"}">${t.diff >= 0 ? "+" : "−"} ${fmt(Math.abs(t.diff))}</td>
        <td class="num">${pct(t.pct)}</td>
        <td></td>
      </tr>`;

    requestAnimationFrame(() => {
      F.qsa("#g-tbody .bar-mini > span").forEach((bar) => { bar.style.width = `${bar.dataset.w}%`; });
    });
  }

  function renderHistory(data) {
    const cfg = {
      labels: data.series.labels,
      datasets: [
        { type: "bar", label: "Realizado", data: data.series.actual, backgroundColor: "#ec4899bb", borderRadius: 7, maxBarThickness: 26, order: 2 },
        { type: "line", label: "Orçamento mensal", data: data.series.planned, borderColor: "#38bdf8", borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: 0, order: 1 },
      ],
    };
    if (historyChart) { historyChart.data = cfg; historyChart.update(); return; }
    historyChart = new Chart(el("g-history"), {
      data: cfg,
      options: {
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: { x: F.catAxis(), y: F.moneyAxis() },
        plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } } },
      },
    });
  }

  function renderNature(data) {
    const cfg = {
      labels: ["Fixas", "Variáveis", "Essencial", "Supérfluo"],
      datasets: [{
        label: "Valor",
        data: [...data.nature.values, ...data.essential.values],
        backgroundColor: ["#2563ebcc", "#ec4899cc", "#10b981cc", "#f59e0bcc"],
        borderRadius: 8,
        maxBarThickness: 44,
      }],
    };
    if (natureChart) { natureChart.data = cfg; natureChart.update(); return; }
    natureChart = new Chart(el("g-nature"), {
      type: "bar", data: cfg,
      options: {
        maintainAspectRatio: false,
        scales: { x: F.catAxis(), y: F.moneyAxis() },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.parsed.y)}` } } },
      },
    });
  }

  function renderSideTables(data) {
    el("g-top").innerHTML = data.top.map((t) => `
      <tr>
        <td><div style="font-weight:600;">${t.description}</div><div class="text-muted" style="font-size:.72rem;">${fmtDate(t.date)}</div></td>
        <td>${t.label}</td>
        <td><span class="payer-pill"><span class="payer-dot" style="background:${F.PAYER_COLOR[t.payer]}"></span>${F.PAYER_LABEL[t.payer]}</span></td>
        <td class="num text-pink">${fmt(t.amount)}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="text-muted">Sem gastos no período.</td></tr>`;

    el("g-envelopes").innerHTML = data.envelopes.map((e) => `
      <tr>
        <td><div class="cell-main"><span class="cell-icon" style="background:${e.color}22;">${e.icon}</span>${e.name}</div></td>
        <td><span class="badge ${e.kind === "reserve" ? "badge-warn" : "badge-info"}">${e.kind === "reserve" ? "Reserva" : "Fundo"}</span></td>
        <td class="num">${fmt(e.amount)}</td>
      </tr>`).join("") || `<tr><td colspan="3" class="text-muted">Nenhum fundo ou reserva foi utilizado no período.</td></tr>`;
  }

  F.start("gastos", {
    async load(period) {
      const data = await api(`/api/expenses?period=${period}`);
      F.setRangeHint(data.range);
      renderStats(data);
      renderInsights(data);
      renderTable(data);
      renderHistory(data);
      renderNature(data);
      renderSideTables(data);
    },
  });
})();
