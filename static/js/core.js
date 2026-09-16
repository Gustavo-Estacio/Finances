/**
 * Finances — nucleo compartilhado entre as paginas.
 * Responsavel por: sidebar, filtro de periodo, modal de lancamento,
 * chamadas de API, formatacao (pt-BR) e defaults do Chart.js.
 */
(() => {
  "use strict";

  const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmt = (v) => BRL.format(v || 0);
  const fmt0 = (v) => BRL0.format(v || 0);
  const num = (v) => NUM.format(v || 0);
  const pct = (v, digits = 1) => `${(v ?? 0).toFixed(digits).replace(".", ",")}%`;
  const fmtCompact = (v) => {
    const abs = Math.abs(v || 0);
    if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1).replace(".", ",")}M`;
    if (abs >= 1e4) return `R$ ${(v / 1e3).toFixed(0)}k`;
    if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(1).replace(".", ",")}k`;
    return fmt0(v);
  };
  const fmtDate = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const el = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const PERIOD_LABELS = { month: "Mês Atual", quarter: "Trimestre", year: "Ano", all: "Todo o período" };
  const PAYER_LABEL = { ele: "Ele", ela: "Ela", ambos: "Ambos" };
  const PAYER_COLOR = { ele: "#2563eb", ela: "#ec4899", ambos: "#10b981" };

  const NAV = [
    { href: "/", icon: "📊", label: "Visão Geral", key: "dashboard" },
    { href: "/gastos", icon: "🧾", label: "Gastos", key: "gastos" },
    { href: "/reservas", icon: "🛟", label: "Reservas", key: "reservas" },
    { href: "/individual", icon: "👥", label: "Individual", key: "individual" },
    { href: "/patrimonio", icon: "📈", label: "Patrimônio", key: "patrimonio" },
  ];

  // ------------------------------------------------------------------ api
  async function api(path, options = {}) {
    const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
    if (!res.ok) {
      let detail = `Erro ${res.status}`;
      try {
        const body = await res.json();
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      } catch (_) { /* resposta sem corpo JSON */ }
      throw new Error(detail);
    }
    return res.status === 204 ? null : res.json();
  }

  // ---------------------------------------------------------------- toast
  function toast(message, type = "success") {
    let stack = el("toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      stack.id = "toast-stack";
      document.body.appendChild(stack);
    }
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.innerHTML = `<span>${type === "success" ? "✅" : "⚠️"}</span><span>${message}</span>`;
    stack.appendChild(node);
    setTimeout(() => {
      node.style.transition = "opacity .3s ease, transform .3s ease";
      node.style.opacity = "0";
      node.style.transform = "translateX(30px)";
      setTimeout(() => node.remove(), 320);
    }, 3400);
  }

  // -------------------------------------------------------------- sidebar
  function renderSidebar(activeKey) {
    const aside = qs("#sidebar");
    if (!aside) return;
    aside.className = "sidebar";
    aside.innerHTML = `
      <div class="brand">
        <div class="brand-mark">💜</div>
        <div class="brand-text">
          <div class="brand-title">Finances</div>
          <div class="brand-sub">Painel do Casal</div>
        </div>
      </div>
      <nav class="nav-group">
        <div class="nav-label">Navegação</div>
        ${NAV.map((item) => `
          <a class="nav-item${item.key === activeKey ? " active" : ""}" href="${item.href}">
            <span class="nav-icon">${item.icon}</span><span>${item.label}</span>
          </a>`).join("")}
      </nav>
      <div class="sidebar-foot">
        <button class="btn-primary" id="open-modal-btn" style="width:100%;justify-content:center;">
          <span aria-hidden="true">＋</span> Novo Lançamento
        </button>
        <div class="sidebar-tip">
          💡 Lançamentos com pagador <strong>Ambos</strong> são rateados 50/50 nas análises individuais.
        </div>
      </div>`;
    const btn = el("open-modal-btn");
    if (btn) btn.addEventListener("click", () => openModal());
  }

  // -------------------------------------------------------- filtro periodo
  function getPeriod() {
    try {
      return localStorage.getItem("finances.period") || "month";
    } catch (_) {
      return "month";
    }
  }
  function setPeriod(value) {
    try { localStorage.setItem("finances.period", value); } catch (_) { /* modo privado */ }
  }

  function mountPeriodFilter(onChange) {
    const slot = qs("[data-period-filter]");
    if (!slot) return;
    const current = getPeriod();
    slot.className = "period-filter";
    slot.innerHTML = Object.entries(PERIOD_LABELS)
      .map(([key, label]) => `<button data-period="${key}"${key === current ? ' class="active"' : ""}>${label}</button>`)
      .join("");
    slot.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-period]");
      if (!btn) return;
      qsa("button", slot).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setPeriod(btn.dataset.period);
      onChange(btn.dataset.period);
    });
  }

  function setRangeHint(range) {
    const hint = qs("[data-range-hint]");
    if (!hint || !range) return;
    const months = range.months ? `${range.months} ${range.months > 1 ? "meses" : "mês"}` : "";
    hint.textContent = `📅 ${fmtDate(range.start)} → ${fmtDate(range.end)}${months ? ` · ${months}` : ""}`;
  }

  // ---------------------------------------------------------------- modal
  const MODAL_HTML = `
    <div class="modal-overlay" id="modal-overlay">
      <form class="modal-card glass" id="tx-form" novalidate>
        <div class="modal-head">
          <div class="modal-title" id="modal-title">Novo Lançamento</div>
          <button type="button" class="modal-close" id="modal-close" aria-label="Fechar">✕</button>
        </div>
        <div class="type-toggle" id="type-toggle">
          <button type="button" data-type="income" class="active">💰 Receita</button>
          <button type="button" data-type="expense">🧾 Gasto</button>
          <button type="button" data-type="contribution">🏦 Aporte</button>
        </div>
        <div class="field">
          <label for="tx-description">Descrição</label>
          <input id="tx-description" type="text" maxlength="120" placeholder="Ex: Mercado do mês" required />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="tx-amount">Valor (R$)</label>
            <input id="tx-amount" type="number" step="0.01" min="0.01" placeholder="0,00" required />
          </div>
          <div class="field">
            <label for="tx-date">Data</label>
            <input id="tx-date" type="date" required />
          </div>
        </div>
        <div class="field" id="fund-field">
          <label for="tx-fund">Fundo / Reserva</label>
          <select id="tx-fund"></select>
        </div>
        <div class="field" id="category-field">
          <label for="tx-category">Categoria</label>
          <select id="tx-category"></select>
        </div>
        <div class="field">
          <label>Quem pagou?</label>
          <div class="payer-toggle" id="payer-toggle">
            <button type="button" data-payer="ele">Ele</button>
            <button type="button" data-payer="ela">Ela</button>
            <button type="button" data-payer="ambos" class="active">Ambos (50/50)</button>
          </div>
        </div>
        <div class="field-error" id="form-error"></div>
        <button type="submit" class="modal-submit" id="modal-submit">Salvar Lançamento</button>
      </form>
    </div>`;

  let modalState = { type: "income", payer: "ambos", editingId: null };
  let metaCache = null;

  async function loadMeta() {
    if (!metaCache) metaCache = await api("/api/meta");
    return metaCache;
  }

  function buildModal(meta) {
    if (el("modal-overlay")) return;
    document.body.insertAdjacentHTML("beforeend", MODAL_HTML);

    const fundSelect = el("tx-fund");
    const groups = [
      ["Fundos", meta.funds],
      ["Reservas", meta.reserves],
    ];
    fundSelect.innerHTML =
      `<option value="">— nenhum (conta de rotina) —</option>` +
      groups
        .map(([label, items]) =>
          `<optgroup label="${label}">` +
          items.map((f) => `<option value="${f.id}">${f.icon} ${f.short || f.name}</option>`).join("") +
          `</optgroup>`)
        .join("");

    const catSelect = el("tx-category");
    const income = meta.categories.filter((c) => c.type === "income");
    const expense = meta.categories.filter((c) => c.type === "expense");
    catSelect.dataset.income = JSON.stringify(income);
    catSelect.dataset.expense = JSON.stringify(expense);

    el("type-toggle").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-type]");
      if (btn) setModalType(btn.dataset.type);
    });
    el("payer-toggle").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-payer]");
      if (btn) setModalPayer(btn.dataset.payer);
    });
    el("modal-close").addEventListener("click", closeModal);
    el("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
    el("tx-form").addEventListener("submit", submitModal);
  }

  function fillCategories(type) {
    const select = el("tx-category");
    const source = type === "income" ? select.dataset.income : select.dataset.expense;
    const items = JSON.parse(source || "[]");
    select.innerHTML = items.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
  }

  function setModalType(type) {
    modalState.type = type;
    qsa("#type-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
    el("fund-field").classList.toggle("hidden", type === "income");
    el("category-field").classList.toggle("hidden", type === "contribution");
    fillCategories(type);
  }

  function setModalPayer(payer) {
    modalState.payer = payer;
    qsa("#payer-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.payer === payer));
  }

  function openModal(tx = null) {
    if (!el("modal-overlay")) return;
    const form = el("tx-form");
    form.reset();
    el("form-error").textContent = "";
    modalState.editingId = tx ? tx.id : null;
    el("modal-title").textContent = tx ? "Editar Lançamento" : "Novo Lançamento";
    el("modal-submit").textContent = tx ? "Atualizar Lançamento" : "Salvar Lançamento";
    setModalType(tx ? tx.type : "income");
    setModalPayer(tx ? tx.payer : "ambos");
    el("tx-date").value = tx ? tx.date : new Date().toISOString().slice(0, 10);
    if (tx) {
      el("tx-description").value = tx.description;
      el("tx-amount").value = tx.amount;
      el("tx-fund").value = tx.fund || "";
      if (tx.type !== "contribution") el("tx-category").value = tx.category || "";
    }
    el("modal-overlay").classList.add("open");
    setTimeout(() => el("tx-description").focus(), 140);
  }

  function closeModal() {
    const overlay = el("modal-overlay");
    if (overlay) overlay.classList.remove("open");
  }

  async function submitModal(event) {
    event.preventDefault();
    const type = modalState.type;
    const payload = {
      type,
      amount: parseFloat(el("tx-amount").value),
      date: el("tx-date").value,
      description: el("tx-description").value.trim(),
      payer: modalState.payer,
      category: type === "contribution" ? "" : el("tx-category").value,
      fund: type === "income" ? null : el("tx-fund").value || null,
    };
    if (type === "contribution" && !payload.fund) {
      el("form-error").textContent = "Selecione o fundo ou reserva de destino do aporte.";
      return;
    }
    if (!payload.description || !(payload.amount > 0) || !payload.date) {
      el("form-error").textContent = "Preencha descrição, valor e data corretamente.";
      return;
    }
    const button = el("modal-submit");
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Salvando...";
    try {
      if (modalState.editingId) {
        await api(`/api/transactions/${modalState.editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        toast("Lançamento atualizado!");
      } else {
        await api("/api/transactions", { method: "POST", body: JSON.stringify(payload) });
        toast("Lançamento adicionado!");
      }
      closeModal();
      await Finances.reload();
    } catch (err) {
      el("form-error").textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function removeTransaction(tx) {
    if (!confirm(`Excluir "${tx.description}"?`)) return;
    try {
      await api(`/api/transactions/${tx.id}`, { method: "DELETE" });
      toast("Lançamento excluído.");
      await Finances.reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // --------------------------------------------------------- chart.js base
  function applyChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = "#7d8697";
    Chart.defaults.font.family = "Inter, Segoe UI, system-ui, sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.animation.duration = 900;
    Chart.defaults.animation.easing = "easeOutQuart";
    Chart.defaults.plugins.tooltip = {
      ...Chart.defaults.plugins.tooltip,
      backgroundColor: "#161b22",
      borderColor: "rgba(255,255,255,.14)",
      borderWidth: 1,
      padding: 12,
      titleColor: "#f3f5f9",
      bodyColor: "#c4cad6",
      cornerRadius: 10,
      displayColors: true,
      boxPadding: 4,
    };
    Chart.defaults.plugins.legend.labels = {
      ...Chart.defaults.plugins.legend.labels,
      color: "#c4cad6",
      usePointStyle: true,
      pointStyle: "circle",
      padding: 16,
    };
  }

  const moneyAxis = (options = {}) => ({
    grid: { color: "rgba(255,255,255,.06)", drawBorder: false },
    ticks: { callback: (value) => fmtCompact(value) },
    ...options,
  });

  const catAxis = (options = {}) => ({
    grid: { display: false },
    ...options,
  });

  // ----------------------------------------------------------------- boot
  const Finances = {
    fmt, fmt0, num, pct, fmtCompact, fmtDate, el, qs, qsa, api, toast,
    PAYER_LABEL, PAYER_COLOR, PERIOD_LABELS,
    moneyAxis, catAxis,
    openModal, removeTransaction, setRangeHint, getPeriod,
    meta: () => metaCache,
    page: null,
    async reload() {
      if (Finances.page && typeof Finances.page.load === "function") {
        await Finances.page.load(getPeriod());
      }
    },
    async start(pageKey, page) {
      Finances.page = page;
      applyChartDefaults();
      renderSidebar(pageKey);
      try {
        const meta = await loadMeta();
        buildModal(meta);
        mountPeriodFilter((period) => {
          page.load(period).catch((err) => toast(err.message, "error"));
        });
        await page.load(getPeriod());
      } catch (err) {
        toast(`Falha ao carregar: ${err.message}`, "error");
        console.error(err);
      }
    },
  };

  window.Finances = Finances;
})();
