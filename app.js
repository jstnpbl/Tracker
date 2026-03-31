const STORAGE_KEY = "budget_app";
const STORAGE_HISTORY_KEY = "budget_app_history";

// Utility: Show message
function showMessage(msg, type = "error") {
  const alertDiv = document.getElementById("alert");
  const className = type === "error" ? "alert" : type === "success" ? "alert success" : "alert";
  alertDiv.innerHTML = `<div class="${className}">${msg}</div>`;
  if (type !== "error") {
    setTimeout(() => alertDiv.innerHTML = '', 3000);
  }
}

// Load or init data
function getData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Phase 4: Get cutoff history
function getCutoffHistory() {
  return JSON.parse(localStorage.getItem(STORAGE_HISTORY_KEY)) || [];
}

function saveCutoffHistory(history) {
  localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history));
}

// Phase 5: Behavior Learning & Pattern Detection
function analyzeBehaviorPatterns() {
  const history = getCutoffHistory();
  if (history.length < 2) return null;

  // Calculate average spending per category across history
  const categoryStats = { survival: [], stability: [], wants: [], future: [] };
  const categoryBudgets = { survival: [], stability: [], wants: [], future: [] };

  history.forEach(cutoff => {
    ["survival", "stability", "wants", "future"].forEach(cat => {
      const budgetAlloc = cutoff.totalBudget > 0
        ? (Object.values(cutoff.expenses || []).filter(e => e.category === cat).reduce((sum, e) => sum + e.amount, 0))
        : 0;
      categoryStats[cat].push(budgetAlloc);
    });
  });

  // Find which categories user consistently overspends in
  const patterns = {};
  Object.entries(categoryStats).forEach(([cat, amounts]) => {
    if (amounts.length > 0) {
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const variance = amounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / amounts.length;
      patterns[cat] = {
        avgSpend: avg,
        variance: Math.sqrt(variance),
        trend: amounts[amounts.length - 1] > avg ? "increasing" : "stable"
      };
    }
  });

  return patterns;
}

// Phase 5: Generate smart reduction suggestions
function generateSmartSuggestions(data) {
  const suggestions = [];
  const pace = analyzeSpendingPace(data);
  const daysLeft = getDaysRemaining(data.endDate);

  if (!pace || pace.onTrack) return suggestions;

  // If projected to overspend, suggest where to cut
  if (pace.overspendBy > 0) {
    const wantsSpent = data.budgets.wants - data.remaining.wants;
    const wantsPct = (wantsSpent / data.budgets.wants) * 100;

    // If wants is a priority to reduce
    if (data.remaining.wants > 0 && wantsPct >= 50) {
      const dailyWants = wantsSpent / Math.max(1, Math.ceil((new Date() - new Date(data.startDate)) / (1000 * 60 * 60 * 24)));
      const safeWantsDaily = data.remaining.wants / daysLeft;
      const needToSave = dailyWants - safeWantsDaily;

      if (needToSave > 50) {
        suggestions.push({
          type: "reduction",
          icon: "✂️",
          title: `Cut wants spending`,
          message: `Reduce daily wants by ₱${(needToSave * 0.7).toFixed(0)} to stay within budget`,
          severity: "caution"
        });
      }
    }

    // Suggest survival adjustment if critical
    const survivalRatio = data.remaining.survival / data.budgets.survival;
    if (survivalRatio < 0.2 && data.remaining.wants > 0) {
      const canShift = Math.min(data.remaining.wants * 0.3, pace.overspendBy);
      if (canShift > 0) {
        suggestions.push({
          type: "action",
          icon: "🔄",
          title: `Shift from wants to survival`,
          message: `Move ₱${canShift.toFixed(0)} from entertainment to essentials`,
          severity: "danger"
        });
      }
    }
  }

  // Pattern-based suggestions from history
  const patterns = analyzeBehaviorPatterns();
  if (patterns) {
    Object.entries(patterns).forEach(([cat, stat]) => {
      if (stat.trend === "increasing" && cat !== "future") {
        suggestions.push({
          type: "awareness",
          icon: "📈",
          title: `${cat.toUpperCase()} spending increasing`,
          message: `Your ${cat} spending is trending up (avg: ₱${stat.avgSpend.toFixed(0)})`,
          severity: "caution"
        });
      }
    });
  }

  return suggestions;
}

// Phase 5: Detect anomalies (spending spikes)
function detectAnomalies(data) {
  if (data.expenses.length < 3) return null;

  // Calculate average expense amount
  const avgExpense = data.expenses.reduce((sum, e) => sum + e.amount, 0) / data.expenses.length;
  const stdDev = Math.sqrt(
    data.expenses.reduce((sum, e) => sum + Math.pow(e.amount - avgExpense, 2), 0) / data.expenses.length
  );

  // Find anomalies (expenses > 2 std devs above average)
  const threshold = avgExpense + (2 * stdDev);
  const anomalies = data.expenses.filter(e => e.amount > threshold);

  if (anomalies.length > 0) {
    return {
      count: anomalies.length,
      avgAnomalyValue: anomalies.reduce((sum, e) => sum + e.amount, 0) / anomalies.length,
      examples: anomalies.slice(-2) // Last 2 anomalies
    };
  }

  return null;
}

// Phase 5: Adaptive budget reallocation based on history
function suggestBudgetReallocation(data) {
  const history = getCutoffHistory();
  if (history.length < 2) return null;

  // Calculate actual spending percentages from history
  const avgSpendByCategory = { survival: 0, stability: 0, wants: 0, future: 0 };
  history.forEach(cutoff => {
    ["survival", "stability", "wants", "future"].forEach(cat => {
      const catExpenses = (cutoff.expenses || []).filter(e => e.category === cat);
      const catSpent = catExpenses.reduce((sum, e) => sum + e.amount, 0);
      avgSpendByCategory[cat] += (catSpent / cutoff.totalBudget) * 100;
    });
  });

  Object.keys(avgSpendByCategory).forEach(cat => {
    avgSpendByCategory[cat] = avgSpendByCategory[cat] / history.length;
  });

  // Current allocation
  const total = data.budgets.survival + data.budgets.stability + data.budgets.wants + data.budgets.future;
  const currentAlloc = {
    survival: (data.budgets.survival / total) * 100,
    stability: (data.budgets.stability / total) * 100,
    wants: (data.budgets.wants / total) * 100,
    future: (data.budgets.future / total) * 100
  };

  const suggestions = [];
  const threshold = 10; // 10% variance threshold

  Object.keys(avgSpendByCategory).forEach(cat => {
    const diff = avgSpendByCategory[cat] - currentAlloc[cat];
    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        suggestions.push({
          cat: cat,
          direction: "increase",
          amount: Math.ceil(diff),
          reason: `You're consistently spending ${diff.toFixed(0)}% more than allocated`
        });
      } else {
        suggestions.push({
          cat: cat,
          direction: "decrease",
          amount: Math.ceil(Math.abs(diff)),
          reason: `You're spending ${Math.abs(diff).toFixed(0)}% less, could reduce and save`
        });
      }
    }
  });

  return suggestions.length > 0 ? suggestions : null;
}

// Phase 5: Generate improvement indicator
function generateProgressIndicator(data) {
  const history = getCutoffHistory();
  if (history.length < 2) return null;

  const last = history[history.length - 1];
  const prev = history[history.length - 2];

  const lastSavingsRate = (last.saved / last.income) * 100;
  const prevSavingsRate = (prev.saved / prev.income) * 100;
  const improvement = lastSavingsRate - prevSavingsRate;

  return {
    lastRate: lastSavingsRate,
    prevRate: prevSavingsRate,
    improvement: improvement,
    trend: improvement > 0 ? "improving" : improvement < 0 ? "declining" : "stable"
  };
}

// Phase 6: Generate category breakdown for visualization
function generateCategoryBreakdown(data) {
  const breakdown = { survival: 0, stability: 0, wants: 0, future: 0 };

  data.expenses.forEach(exp => {
    if (breakdown.hasOwnProperty(exp.category)) {
      breakdown[exp.category] += exp.amount;
    }
  });

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const percentages = {};

  Object.keys(breakdown).forEach(cat => {
    percentages[cat] = total > 0 ? (breakdown[cat] / total) * 100 : 0;
  });

  return { breakdown, percentages, total };
}

// Phase 6: Create simple text-based category breakdown
function createCategoryBreakdownHtml(data) {
  const { breakdown, percentages } = generateCategoryBreakdown(data);
  const icons = { survival: "🍔", stability: "🛡️", wants: "🎮", future: "🚀" };
  const colors = { survival: "#ff9800", stability: "#2196f3", wants: "#9c27b0", future: "#4caf50" };

  const items = Object.entries(breakdown)
    .filter(([cat, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amount]) => `
      <div style="margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px;">
          <span>${icons[cat]} ${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
          <span style="font-weight: 500;">₱${amount.toFixed(0)} (${percentages[cat].toFixed(0)}%)</span>
        </div>
        <div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
          <div style="width: ${percentages[cat]}%; height: 100%; background: ${colors[cat]}; border-radius: 3px;"></div>
        </div>
      </div>
    `)
    .join("");

  return items.length > 0 ? `
    <div style="background: #f9f9f9; padding: 10px 12px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #e0e0e0; font-size: 12px;">
      <div style="font-weight: 500; margin-bottom: 8px;">📊 Spending Breakdown</div>
      ${items}
    </div>
  ` : "";
}

// Phase 4: Archive completed cutoff
function archiveCurrentCutoff(data) {
  if (!data) return;
  const history = getCutoffHistory();
  const total = data.budgets.survival + data.budgets.stability + data.budgets.wants + data.budgets.future;
  const spent = total - (data.remaining.survival + data.remaining.stability + data.remaining.wants + data.remaining.future);

  history.push({
    startDate: data.startDate,
    endDate: data.endDate,
    income: data.income,
    totalBudget: total,
    totalSpent: spent,
    saved: total - spent,
    expenses: data.expenses,
    timestamp: new Date().toISOString()
  });

  saveCutoffHistory(history);
}

// Initialize cutoff — accepts optional startDate
function createCutoff(income, startDate) {
  const start = startDate ? new Date(startDate) : new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 15);

  let survival, stability, wants, future;

  if (income < 4000) {
    survival = 0.8;
    stability = 0.15;
    wants = 0.05;
    future = 0;
  } else {
    survival = 0.5;
    stability = 0.2;
    wants = 0.25;
    future = 0.05;
  }

  // FIX BUG #1: Round to 2 decimals to prevent floating point precision issues
  const round2 = (val) => Math.round(val * 100) / 100;

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    income,
    budgets: {
      survival: round2(income * survival),
      stability: round2(income * stability),
      wants: round2(income * wants),
      future: round2(income * future)
    },
    remaining: {
      survival: round2(income * survival),
      stability: round2(income * stability),
      wants: round2(income * wants),
      future: round2(income * future)
    },
    expenses: [],
    auditLog: []
  };
}

// Add income
function addIncome() {
  const amount = parseFloat(document.getElementById("incomeInput").value);
  if (!amount || amount <= 0) return showMessage("Enter valid income amount", "error");

  // Read optional cutoff start date
  const dateInput = document.getElementById("cutoffStartDate");
  let startDate = null;
  if (dateInput && dateInput.value) {
    startDate = dateInput.value; // YYYY-MM-DD string
  }

  const existing = getData();
  if (existing) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(existing.endDate);
    end.setHours(0, 0, 0, 0);
    if (today < end) {
      return showMessage("Current cutoff active until " + end.toLocaleDateString() + ". Reset it first.", "error");
    } else {
      archiveCurrentCutoff(existing);
    }
  }

  const data = createCutoff(amount, startDate);
  saveData(data);
  document.getElementById("incomeInput").value = "";
  if (dateInput) dateInput.value = "";
  const startFormatted = new Date(data.startDate).toLocaleDateString();
  showMessage(`✓ Cutoff started ${startFormatted} with ₱${amount.toFixed(2)}`, "success");
  document.getElementById("expenseAmount").focus();
  render();
}

// Helper: Get Parent Category
function getParentCategory(catName) {
  const parentMap = {
    "Food": "survival", "Transpo": "survival",
    "Needs": "stability", "Wants": "wants", "Misc": "future",
    "survival": "survival", "stability": "stability", "wants": "wants", "future": "future"
  };
  return parentMap[catName] || "future";
}

// Helper: Levenshtein distance for fuzzy matching offline
function levenshteinCost(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b.charAt(i - 1) == a.charAt(j - 1) ? m[i - 1][j - 1] : Math.min(
        m[i - 1][j - 1] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j] + 1
      );
    }
  }
  return m[b.length][a.length];
}

// Category detection
function smartDetectCategory(note) {
  note = note.toLowerCase();

  const rules = {
    Food: ["karinderya", "fast food", "eatery"],
    Transpo: ["pamasahe", "fare", "jeep", "sasakyan", "bus", "taxi", "grab", "uber", "oil", "fuel"],
    Wants: ["comshop", "nesneth", "laro", "dates", "hangout"],
    Needs: ["self care", "personal food", "medicine", "utilities", "hygiene", "cleaning"],
    Misc: ["gift", "stationery", "other", "random", "purchase"]
  };

  // Exact substring match
  for (let cat in rules) {
    if (rules[cat].some(kw => note.includes(kw.toLowerCase()))) {
      return cat;
    }
  }

  // Fuzzy match (distance <= 2)
  const words = note.split(/\s+/);
  for (let cat in rules) {
    for (let kw of rules[cat]) {
      const kwLower = kw.toLowerCase();
      if (kwLower.includes(' ')) continue; // strict exact-only for phrases
      for (let word of words) {
        if (word.length >= 4 && levenshteinCost(word, kwLower) <= 2) {
          return cat;
        }
      }
    }
  }

  return "Misc";
}

// Add expense
function addExpense() {
  const amount = parseFloat(document.getElementById("expenseAmount").value);
  const note = document.getElementById("expenseNote").value.trim();
  let category = document.getElementById("expenseCategory").value;

  if (!amount || amount <= 0) return showMessage("Enter valid expense amount", "error");
  if (!note) return showMessage("Enter expense description", "error");

  const data = getData();
  if (!data) return showMessage("Add income first", "error");

  // FIX BUG #2: Use proper date comparison (compare midnight times to avoid timezone issues)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(data.endDate);
  end.setHours(0, 0, 0, 0);
  if (today > end) {
    return showMessage("Cutoff expired. Add new income to start fresh cutoff.", "error");
  }

  // Auto-detect if not overridden
  if (!category) {
    category = smartDetectCategory(note);
  }

  const parentBudget = getParentCategory(category);

  if (data.remaining[parentBudget] < amount) {
    const available = data.remaining[parentBudget].toFixed(2);
    const label = parentBudget !== category ? `${parentBudget} (detected ${category})` : parentBudget;
    return showMessage(`Not enough in ${label}. Available: ₱${available}`, "error");
  }

  data.remaining[parentBudget] -= amount;

  data.expenses.push({
    amount,
    note,
    category,
    date: new Date().toISOString()
  });

  saveData(data);
  document.getElementById("expenseAmount").value = "";
  document.getElementById("expenseNote").value = "";
  // Hide category preview
  const preview = document.getElementById('categoryPreview');
  if (preview) preview.classList.remove('visible');

  showMessage(`✓ Expense added to ${category}`, "success");

  // Auto-collapse Quick Add panel so user can see expenses
  const panel = document.getElementById('expenseInputSection');
  if (panel) panel.classList.add('collapsed');

  render();
  triggerPulse();

  // Scroll to newest expense and highlight it
  setTimeout(() => {
    const list = document.getElementById('expenseList');
    if (list && list.lastElementChild) {
      list.lastElementChild.classList.add('new-entry');
      list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 50);
}

// Subtle pulse animation on hero card for feedback
function triggerPulse() {
  const hero = document.querySelector('.hero-card');
  if (hero) {
    hero.classList.remove('pulse');
    void hero.offsetWidth;
    hero.classList.add('pulse');
  }
}

// Safe daily spend
function getSafeDaily(data) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(data.endDate);
  end.setHours(0, 0, 0, 0);

  // FIX BUG #3: Use Math.floor instead of ceil to be conservative
  // This prevents showing unrealistic safe daily amounts
  let daysLeft = Math.floor((end - today) / (1000 * 60 * 60 * 24));

  // FIX BUG #4: If less than 1 day remains, show 1 day (user must finish today)
  if (daysLeft < 1) daysLeft = 1;

  return data.remaining.survival / daysLeft;
}

// Get days remaining
function getDaysRemaining(endDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  // FIX BUG #3: Use Math.floor for consistent accurate days counting
  let daysLeft = Math.floor((end - today) / (1000 * 60 * 60 * 24));
  // If we're past midnight on end date, could be negative, show 0
  return Math.max(0, daysLeft);
}

// Reset cutoff (allow fresh start)
function resetCutoff() {
  const data = getData();
  if (!data) return showMessage("No active cutoff to reset", "error");

  if (confirm("Reset current cutoff? This will archive it in history.")) {
    archiveCurrentCutoff(data);
    saveData(null);
    document.getElementById("alert").innerHTML = "";
    showMessage("✓ Cutoff archived. Add income to start new cutoff.", "success");
    render();
  }
}

// Helper: Get progress color based on percentage
function getProgressColor(used, budgeted) {
  if (budgeted === 0) return "";
  const remainingPct = budgeted > 0 ? ((budgeted - used) / budgeted) * 100 : 0;
  if (remainingPct < 20) return "danger";
  if (remainingPct <= 50) return "warning";
  return "";
}

// Helper: Analyze spending pace
function analyzeSpendingPace(data) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(data.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(data.endDate);
  end.setHours(0, 0, 0, 0);

  const daysElapsed = Math.ceil((today - start) / (1000 * 60 * 60 * 24));
  const daysTotal = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  const daysLeft = getDaysRemaining(data.endDate);

  if (daysElapsed <= 0) return null;

  const totalSpent = data.budgets.survival - data.remaining.survival +
    data.budgets.stability - data.remaining.stability +
    data.budgets.wants - data.remaining.wants +
    data.budgets.future - data.remaining.future;

  const avgDailySpend = totalSpent / daysElapsed;
  const projectedTotal = avgDailySpend * daysTotal;
  const budget = data.budgets.survival + data.budgets.stability + data.budgets.wants + data.budgets.future;

  return {
    avgDailySpend,
    projectedTotal,
    budget,
    onTrack: projectedTotal <= budget,
    overspendBy: Math.max(0, projectedTotal - budget),
    pacePercentage: (projectedTotal / budget) * 100
  };
}

// Helper: Predict category run-out date
function predictCategoryRunOut(data) {
  const today = new Date();
  const daysLeft = getDaysRemaining(data.endDate);
  const runOuts = [];

  ["survival", "stability", "wants"].forEach(cat => {
    if (data.expenses.length === 0) return;

    // Calculate daily spend for this category
    const spent = data.budgets[cat] - data.remaining[cat];
    const daysPassed = Math.max(1, Math.ceil((today - new Date(data.startDate)) / (1000 * 60 * 60 * 24)));
    const dailySpend = spent / daysPassed;

    if (dailySpend > 0 && data.remaining[cat] > 0) {
      const daysUntilRunOut = Math.floor(data.remaining[cat] / dailySpend);
      if (daysUntilRunOut < daysLeft && daysUntilRunOut >= 0) {
        runOuts.push({
          category: cat,
          daysUntilRunOut: Math.max(0, daysUntilRunOut),
          dailySpend: dailySpend
        });
      }
    }
  });

  return runOuts.sort((a, b) => a.daysUntilRunOut - b.daysUntilRunOut);
}

// Phase 3: Generate spending insights
function generateSpendingInsights(data) {
  if (data.expenses.length === 0) return null;

  // Calculate category spending breakdown
  const categoryTotals = { survival: 0, stability: 0, wants: 0, future: 0 };
  const categoryCount = { survival: 0, stability: 0, wants: 0, future: 0 };

  data.expenses.forEach(exp => {
    categoryTotals[exp.category] += exp.amount;
    categoryCount[exp.category] += 1;
  });

  // Find highest spending category
  let highestCat = null;
  let highestAmount = 0;
  Object.entries(categoryTotals).forEach(([cat, amt]) => {
    if (amt > highestAmount) {
      highestAmount = amt;
      highestCat = cat;
    }
  });

  // Calculate spending rate
  const daysPassed = Math.max(1, Math.ceil((new Date() - new Date(data.startDate)) / (1000 * 60 * 60 * 24)));
  const totalSpent = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const avgDaily = totalSpent / daysPassed;

  return {
    highestCat,
    highestAmount,
    totalSpent,
    avgDaily,
    daysPassed,
    categoryTotals,
    categoryCount
  };
}

// Helper: Generate smart warnings
function generateSmartWarnings(data) {
  const warnings = [];
  const safe = getSafeDaily(data);
  const daysLeft = getDaysRemaining(data.endDate);
  const pace = analyzeSpendingPace(data);

  // Warning 1: Low survival budget
  if (data.remaining.survival < safe * 2 && data.remaining.survival > 0) {
    warnings.push({
      type: "caution",
      icon: "⚠️",
      message: `Survival budget low. Only ${(data.remaining.survival / safe).toFixed(1)} days of safe spending left.`
    });
  }

  // Warning 2: Overspending trajectory
  if (pace && !pace.onTrack) {
    warnings.push({
      type: "danger",
      icon: "🚨",
      message: `Spending pace high! Projected overspend: ₱${pace.overspendBy.toFixed(2)}`
    });
  }

  // Warning 3: Very low time
  if (daysLeft <= 1 && daysLeft > 0) {
    warnings.push({
      type: "danger",
      icon: "⏰",
      message: `Last day of cutoff! Create new income tomorrow.`
    });
  }

  // Warning 4: Category run-out prediction
  const runOuts = predictCategoryRunOut(data);
  if (runOuts.length > 0) {
    const earliest = runOuts[0];
    const catName = earliest.category.charAt(0).toUpperCase() + earliest.category.slice(1);
    if (earliest.daysUntilRunOut === 0) {
      warnings.push({
        type: "danger",
        icon: "🔴",
        message: `${catName} budget runs out TODAY! (₱${data.remaining[earliest.category].toFixed(2)} left)`
      });
    } else if (earliest.daysUntilRunOut <= 2) {
      warnings.push({
        type: "danger",
        icon: "🔴",
        message: `${catName} budget runs out in ${earliest.daysUntilRunOut} day${earliest.daysUntilRunOut === 1 ? "" : "s"}`
      });
    } else if (earliest.daysUntilRunOut <= 5) {
      warnings.push({
        type: "caution",
        icon: "🟡",
        message: `${catName} budget runs out in ${earliest.daysUntilRunOut} days`
      });
    }
  }

  // Warning 5: Category pressure detection (spending too fast relative to remaining days)
  const categories = ["survival", "stability", "wants"];
  categories.forEach(cat => {
    const spent = data.budgets[cat] - data.remaining[cat];
    const percentage = (spent / data.budgets[cat]) * 100;

    if (percentage >= 85 && percentage < 95) {
      warnings.push({
        type: "caution",
        icon: "⚡",
        message: `${cat.charAt(0).toUpperCase() + cat.slice(1)} spending accelerating (${percentage.toFixed(0)}% used)`
      });
    } else if (percentage >= 95 && percentage < 100) {
      warnings.push({
        type: "danger",
        icon: "🔥",
        message: `${cat.charAt(0).toUpperCase() + cat.slice(1)} budget almost full (${percentage.toFixed(0)}%)`
      });
    }
  });


  return warnings;
}

// Helper: Create progress bar HTML
function createProgressBar(parentCat, remaining, budgeted, expenses) {
  const spent = budgeted - remaining;
  const percentage = budgeted > 0 ? (spent / budgeted) * 100 : 0;
  const color = getProgressColor(spent, budgeted);
  const icons = { survival: "🍔", stability: "🛡️", wants: "🎮", future: "🚀" };
  const widthPct = Math.min(percentage, 100);

  // Summarize sub-categories for this parent
  const subCatTotals = {};
  for (let exp of expenses) {
    const pCat = getParentCategory(exp.category);
    if (pCat === parentCat || (exp.parentBudget && exp.parentBudget === parentCat)) {
      subCatTotals[exp.category] = (subCatTotals[exp.category] || 0) + exp.amount;
    }
  }

  // Format subcat text e.g. "Food: ₱100 | Transpo: ₱50"
  const subcatHtml = Object.keys(subCatTotals).length > 0
    ? Object.entries(subCatTotals).map(([k, v]) => `${k}: ₱${v.toFixed(2)}`).join(" | ")
    : "No expenses";

  return `
    <div class="budget-item">
      <div class="budget-header">
        <div class="budget-label">
          <span>${icons[parentCat]}</span>
          <span style="display:flex; flex-direction:column;">
             <span>${parentCat.charAt(0).toUpperCase() + parentCat.slice(1)}</span>
             <span style="font-size: 10px; color:#777; font-weight:normal;">${subcatHtml}</span>
          </span>
        </div>
        <div>
          <span class="budget-amount">₱${remaining.toFixed(2)}</span>
          <span class="budget-percentage">${percentage.toFixed(0)}% used</span>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${color} animate-bar" data-width="${widthPct}%" style="width: 0%"></div>
      </div>
    </div>
  `;
}

// Render UI
function render() {
  const data = getData();
  const inputSection = document.getElementById("expenseInputSection");
  if (!data) {
    if (inputSection) inputSection.classList.remove("show");
    document.getElementById("summary").innerHTML = `<p style="color: #666;">No active cutoff. Add income to start.</p>`;
    document.getElementById("expenseList").innerHTML = "";
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(data.endDate);
  end.setHours(0, 0, 0, 0);

  if (today > end) {
    if (inputSection) inputSection.classList.remove("show");
    const total = data.budgets.survival + data.budgets.stability + data.budgets.wants + data.budgets.future;
    const spent = total - (data.remaining.survival + data.remaining.stability + data.remaining.wants + data.remaining.future);

    document.getElementById("summary").innerHTML = `
      <div class="review-screen">
        <div class="review-emoji">🏁</div>
        <div class="review-title">Cutoff Completed!</div>
        <div style="margin-bottom: 24px;">
          <div class="review-stat"><span>Total Budget:</span> <b>₱${total.toFixed(2)}</b></div>
          <div class="review-stat"><span>Total Spent:</span> <b>₱${spent.toFixed(2)}</b></div>
          <div class="review-stat" style="color: #2e7d32;"><span>Total Saved:</span> <b>₱${(total - spent).toFixed(2)}</b></div>
        </div>
        <div class="review-new-income">
          <div style="font-weight: 600; font-size: 15px; margin-bottom: 12px; color: #333;">Ready for the next cycle?</div>
          <p style="font-size: 12px; color: #666; margin-bottom: 0;">Add your new income below to start exactly where you left off. This cutoff will archive automatically.</p>
        </div>
      </div>
    `;
    document.getElementById("expenseList").innerHTML = "";
    return;
  }

  if (inputSection) inputSection.classList.add("show");

  const safe = getSafeDaily(data);
  const daysLeft = getDaysRemaining(data.endDate);
  const endDate = new Date(data.endDate);
  const total = data.budgets.survival + data.budgets.stability + data.budgets.wants + data.budgets.future;
  const spent = total - (data.remaining.survival + data.remaining.stability + data.remaining.wants + data.remaining.future);
  const totalRemaining = data.remaining.survival + data.remaining.stability + data.remaining.wants + data.remaining.future;

  // Get smart warnings
  const warnings = generateSmartWarnings(data);
  const pace = analyzeSpendingPace(data);

  let warningHtml = "";
  if (daysLeft <= 3 && daysLeft > 0) {
    warningHtml = `<div class="days-warning">⏰ Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left in this cutoff</div>`;
  }

  // Add smart warnings
  let smartWarningsHtml = "";
  if (warnings.length > 0) {
    smartWarningsHtml = warnings.map(w => {
      const bgColor = w.type === "danger" ? "#ffebee" : "#fff8e1";
      const textColor = w.type === "danger" ? "#c62828" : "#f57f17";
      return `<div style="background: ${bgColor}; color: ${textColor}; padding: 10px 12px; border-radius: 4px; margin-bottom: 8px; font-size: 13px; display: flex; align-items: center; gap: 8px;">
        <span>${w.icon}</span>
        <span>${w.message}</span>
      </div>`;
    }).join("");
  }

  const progressBars = `
    ${createProgressBar("survival", data.remaining.survival, data.budgets.survival, data.expenses)}
    ${createProgressBar("stability", data.remaining.stability, data.budgets.stability, data.expenses)}
    ${createProgressBar("wants", data.remaining.wants, data.budgets.wants, data.expenses)}
    ${createProgressBar("future", data.remaining.future, data.budgets.future, data.expenses)}
  `;

  // Spending pace info
  let paceHtml = "";
  if (pace) {
    const statusEmoji = pace.onTrack ? "✅" : "⚠️";
    const statusColor = pace.onTrack ? "#2e7d32" : "#d32f2f";
    paceHtml = `
      <div style="background: white; padding: 12px 16px; border-radius: 6px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
          <span style="font-weight: 500;">Spending Pace</span>
          <span style="color: ${statusColor}; font-weight: bold;">${statusEmoji} ${pace.pacePercentage.toFixed(0)}%</span>
        </div>
        <div style="font-size: 11px; color: #666; margin-top: 4px;">
          Avg: ₱${pace.avgDailySpend.toFixed(2)}/day • Projected: ₱${pace.projectedTotal.toFixed(2)}
        </div>
      </div>
    `;
  }

  // Spending insights (Phase 3)
  let insightsHtml = "";
  const insights = generateSpendingInsights(data);
  if (insights && insights.daysPassed >= 1 && data.expenses.length >= 3) {
    const icons = { survival: "🍔", stability: "🛡️", wants: "🎮", future: "🚀" };
    const catName = insights.highestCat.charAt(0).toUpperCase() + insights.highestCat.slice(1);
    const insight1 = `Most spending in ${catName} (₱${insights.highestAmount.toFixed(2)})`;
    const insight2 = `Avg daily: ₱${insights.avgDaily.toFixed(2)}`;

    insightsHtml = `
      <div style="background: #f0f7ff; padding: 10px 12px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid #1976d2; font-size: 12px;">
        <div style="font-weight: 500; color: #1565c0; margin-bottom: 4px;">💡 Insights</div>
        <div style="color: #555; line-height: 1.4;">
          ${icons[insights.highestCat]} ${insight1}<br>
          📊 ${insight2}
        </div>
      </div>
    `;
  }

  // Phase 6: Category breakdown chart
  let breakdownHtml = createCategoryBreakdownHtml(data);

  // Phase 4: Past performance display
  let pastPerfHtml = "";
  const pastPerf = getPastPerformanceSummary();
  if (pastPerf && pastPerf.totalCutoffs > 0) {
    pastPerfHtml = `
      <div style="background: #e8f5e9; padding: 10px 12px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid #4caf50; font-size: 12px;">
        <div style="font-weight: 500; color: #2e7d32; margin-bottom: 4px;">📈 Past Performance</div>
        <div style="color: #555; line-height: 1.4;">
          Cutoffs: ${pastPerf.totalCutoffs} • Total Saved: ₱${pastPerf.totalHistorySavings.toFixed(2)}<br>
          Avg Savings/Cutoff: ₱${pastPerf.avgSavings.toFixed(2)} • Last: ₱${pastPerf.lastSaved.toFixed(2)}
        </div>
      </div>
    `;
  }

  // Phase 5: Progress indicator (are you improving?)
  let progressIndHtml = "";
  const progressInd = generateProgressIndicator(data);
  if (progressInd) {
    let trendEmoji = "→";
    let trendColor = "#ff9800";
    if (progressInd.trend === "improving") {
      trendEmoji = "📈";
      trendColor = "#4caf50";
    } else if (progressInd.trend === "declining") {
      trendEmoji = "📉";
      trendColor = "#d32f2f";
    }

    progressIndHtml = `
      <div style="background: #f3e5f5; border-left: 3px solid ${trendColor}; padding: 10px 12px; border-radius: 4px; margin-bottom: 8px; font-size: 12px;">
        <div style="font-weight: 500; margin-bottom: 3px;">${trendEmoji} Your Trend: ${progressInd.trend.toUpperCase()}</div>
        <div style="color: #333; font-size: 11px;">
          Last savings rate: ${progressInd.lastRate.toFixed(0)}% | Previous: ${progressInd.prevRate.toFixed(0)}% | Change: ${progressInd.improvement > 0 ? "+" : ""}${progressInd.improvement.toFixed(1)}%
        </div>
      </div>
    `;
  }

  // Phase 5: Smart suggestions display 
  let suggestionsHtml = "";
  const suggestions = generateSmartSuggestions(data);
  if (suggestions.length > 0) {
    suggestionsHtml = suggestions.map(sug => {
      let bgColor = "#fff8e1";
      let borderColor = "#f57f17";
      if (sug.severity === "danger") {
        bgColor = "#ffebee";
        borderColor = "#c62828";
      }
      return `
        <div style="background: ${bgColor}; border-left: 3px solid ${borderColor}; padding: 10px 12px; border-radius: 4px; margin-bottom: 8px; font-size: 12px;">
          <div style="font-weight: 500; margin-bottom: 3px;">${sug.icon} ${sug.title}</div>
          <div style="color: #333; font-size: 11px;">${sug.message}</div>
        </div>
      `;
    }).join("");
  }

  // Phase 5: Anomaly detection display
  let anomalyHtml = "";
  const anomalies = detectAnomalies(data);
  if (anomalies && anomalies.count > 0) {
    anomalyHtml = `
      <div style="background: #fce4ec; border-left: 3px solid #f50057; padding: 10px 12px; border-radius: 4px; margin-bottom: 8px; font-size: 12px;">
        <div style="font-weight: 500; margin-bottom: 3px;">🔍 Unusual Spending</div>
        <div style="color: #333; font-size: 11px;">Found ${anomalies.count} spike${anomalies.count > 1 ? 's' : ''} (avg: ₱${anomalies.avgAnomalyValue.toFixed(0)})</div>
      </div>
    `;
  }

  document.getElementById("summary").innerHTML = `
    ${warningHtml}
    ${smartWarningsHtml}
    ${suggestionsHtml}
    ${anomalyHtml}
    ${progressIndHtml}
    ${(() => {
      const survivalPct = data.budgets.survival > 0 ? (data.remaining.survival / data.budgets.survival) * 100 : 0;
      let safeDailyClass = "status-green";
      let progressColor = "var(--accent-green)";
      if (survivalPct < 20) { safeDailyClass = "status-red"; progressColor = "var(--accent-red)"; }
      else if (survivalPct <= 50) { safeDailyClass = "status-yellow"; progressColor = "var(--accent-yellow)"; }

      const startD = new Date(data.startDate);
      startD.setHours(0, 0, 0, 0);
      const dayNum = Math.floor((today - startD) / (1000 * 60 * 60 * 24)) + 1;

      return `
        <div class="hero-card ${safeDailyClass}">
          <div class="hero-label">Safe to Spend Today</div>
          <div class="hero-amount">₱${safe.toFixed(2)}</div>
          <div class="hero-meta">
            <span>📅 Day ${dayNum} of 15</span>
            <span>💰 ₱${data.remaining.survival.toFixed(2)} rem.</span>
          </div>
          <div class="hero-progress">
             <div class="hero-progress-fill" style="width: ${Math.max(0, Math.min(survivalPct, 100))}%; background: ${progressColor};"></div>
          </div>
        </div>
      `;
    })()}
    
    <div class="total-remaining" style="margin-top: 16px;">
      <div class="total-remaining-label">Total Remaining (All Budgets)</div>
      <div class="total-remaining-amount">₱${totalRemaining.toFixed(2)}</div>
      <div class="total-remaining-subtext">Spent: ₱${spent.toFixed(2)} / ₱${total.toFixed(2)}</div>
    </div>
    
    <div style="font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; margin-top: 20px;">
        🎯 Category Breakdown
    </div>
    ${insightsHtml}
    ${breakdownHtml}
    ${progressBars}
    ${(() => {
      // Audit log rendering
      let listHtml = "";
      if (!data.auditLog || data.auditLog.length === 0) {
        listHtml = `<div class="audit-item" style="text-align: center; font-style: italic;">No recent revisions</div>`;
      } else {
        const recentAudits = data.auditLog.slice(-5).reverse();
        listHtml = recentAudits.map(log => {
          const typeLabel = log.action === "DELETE" ? "🗑️ Del" : "✏️ Edit";
          const dateStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          let diffText = "";
          if (log.action === "DELETE") {
            diffText = `${log.originalValue.note} (₱${log.originalValue.amount.toFixed(2)})`;
          } else {
            diffText = `${log.originalValue.note} ₱${log.originalValue.amount.toFixed(2)} → ₱${log.newValue.amount.toFixed(2)}`;
          }
          return `<div class="audit-item"><b>${typeLabel}</b> [${dateStr}]: ${diffText}</div>`;
        }).join("");
      }
      return `
        <div class="audit-log">
          <div class="audit-title">📋 Expense Audit Log</div>
          ${listHtml}
        </div>
      `;
    })()}
  `;

  // Trigger animations
  setTimeout(() => {
    document.querySelectorAll('.animate-bar').forEach(el => {
      el.style.width = el.getAttribute('data-width');
    });
  }, 10);

  const list = document.getElementById("expenseList");
  if (data.expenses.length === 0) {
    list.innerHTML = `<li style="color: #999; text-align: center;">No expenses yet</li>`;
    return;
  }

  list.innerHTML = "";
  data.expenses.forEach((exp, idx) => {
    const li = document.createElement("li");
    const date = new Date(exp.date);
    const icons = { survival: "🍔", stability: "🛡️", wants: "🎮", future: "🚀" };
    const categoryLabel = exp.category.toUpperCase();

    li.innerHTML = `
      <div class="expense-info">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span>${icons[exp.category] || "💳"}</span>
          <span style="font-weight: 500;">${exp.note}</span>
          <span class="category-badge">${categoryLabel}</span>
        </div>
        <div style="font-size: 12px; color: #999;">${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <div class="expense-actions">
        <button onclick="editExpense(${idx})" style="background: #1976d2; color: white; border: none; padding: 6px 10px; border-radius: 3px; font-size: 11px; cursor: pointer; font-weight: 500;">✏️ Edit</button>
        <button onclick="deleteExpense(${idx})" style="background: #d32f2f; color: white; border: none; padding: 6px 10px; border-radius: 3px; font-size: 11px; cursor: pointer; font-weight: 500;">🗑️ Delete</button>
      </div>
      <span class="expense-amount">₱${exp.amount.toFixed(2)}</span>
    `;
    list.appendChild(li);
  });
}

// Delete expense
function deleteExpense(index) {
  const data = getData();
  if (!data) return showMessage("No data to delete", "error");

  const exp = data.expenses[index];
  if (!exp) return showMessage("Expense not found", "error");

  if (confirm(`Delete: ${exp.note} - ₱${exp.amount.toFixed(2)}?`)) {
    // Refund the amount back to the parent category
    data.remaining[getParentCategory(exp.category)] += exp.amount;

    if (!data.auditLog) data.auditLog = [];
    data.auditLog.push({
      action: "DELETE",
      timestamp: new Date().toISOString(),
      originalValue: { ...exp }
    });

    // Remove expense
    data.expenses.splice(index, 1);

    saveData(data);
    showMessage(`✓ Deleted expense: ${exp.note}`, "success");
    render();
  }
}

// Edit expense
function editExpense(index) {
  const data = getData();
  if (!data) return showMessage("No data to edit", "error");

  const exp = data.expenses[index];
  if (!exp) return showMessage("Expense not found", "error");

  // Get new values from user
  const newAmount = parseFloat(prompt(`Edit amount (current: ₱${exp.amount.toFixed(2)}):`, exp.amount));
  if (newAmount === null || isNaN(newAmount) || newAmount <= 0) return;

  const newNote = prompt(`Edit note (current: ${exp.note}):`, exp.note);
  if (newNote === null || !newNote.trim()) return;

  const newCategory = prompt(`Edit category (current: ${exp.category}). Enter: Food, Transpo, Wants, Needs, or Misc:`, exp.category);
  if (newCategory === null || !["Food", "Transpo", "Needs", "Wants", "Misc", "survival", "stability", "wants", "future"].includes(newCategory)) return;

  // Calculate difference
  const amountDiff = newAmount - exp.amount;
  const oldParent = getParentCategory(exp.category);
  const newParent = getParentCategory(newCategory);

  // Check if new category has enough budget for the new amount
  if (oldParent !== newParent) {
    // Refund from old category
    data.remaining[oldParent] += exp.amount;

    // Check new category
    if (data.remaining[newParent] < newAmount) {
      data.remaining[oldParent] -= exp.amount; // Undo refund
      return showMessage(`Not enough in parent ${newParent} for ₱${newAmount.toFixed(2)}`, "error");
    }

    // Deduct from new category
    data.remaining[newParent] -= newAmount;
  } else {
    // Same parent category, check amount difference
    if (amountDiff > 0 && data.remaining[oldParent] < amountDiff) {
      return showMessage(`Not enough budget for additional ₱${amountDiff.toFixed(2)}`, "error");
    }
    data.remaining[oldParent] -= amountDiff;
  }

  // Update expense
  if (!data.auditLog) data.auditLog = [];
  data.auditLog.push({
    action: "EDIT",
    timestamp: new Date().toISOString(),
    originalValue: { amount: exp.amount, note: exp.note, category: exp.category },
    newValue: { amount: newAmount, note: newNote.trim(), category: newCategory }
  });

  exp.amount = newAmount;
  exp.note = newNote.trim();
  exp.category = newCategory;

  saveData(data);
  showMessage(`✓ Updated expense: ${exp.note}`, "success");
  render();
}

// Phase 4: Generate past performance insights
function getPastPerformanceSummary() {
  const history = getCutoffHistory();
  if (history.length === 0) return null;

  const lastCutoff = history[history.length - 1];
  return {
    lastSaved: lastCutoff.saved,
    lastSpent: lastCutoff.totalSpent,
    lastIncome: lastCutoff.income,
    totalCutoffs: history.length,
    avgSavings: history.reduce((sum, c) => sum + c.saved, 0) / history.length,
    totalHistorySavings: history.reduce((sum, c) => sum + c.saved, 0)
  };
}

// Export data with performance insights
function exportData() {
  const data = getData();
  if (!data || data.expenses.length === 0) {
    return showMessage("No data to export", "error");
  }

  // Create CSV headers
  const headers = ["Date", "Time", "Category", "Description", "Amount"];
  const rows = data.expenses.map(exp => {
    const date = new Date(exp.date);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return [
      dateStr,
      timeStr,
      exp.category,
      `"${exp.note.replace(/"/g, '""')}"`,
      exp.amount.toFixed(2)
    ];
  });

  // Create CSV content
  const csvContent = [
    headers.join(","),
    ...rows.map(r => r.join(","))
  ].join("\n");

  // Add summary
  const total = data.budgets.survival + data.budgets.stability + data.budgets.wants + data.budgets.future;
  const spent = total - (data.remaining.survival + data.remaining.stability + data.remaining.wants + data.remaining.future);

  // Get past performance if available
  const past = getPastPerformanceSummary();
  let perfSummary = "";
  if (past) {
    perfSummary = `\n\n=== PAST PERFORMANCE ===\nTotal Cutoffs,${past.totalCutoffs}\nTotal Savings (All Cutoffs),₱${past.totalHistorySavings.toFixed(2)}\nAverage Savings/Cutoff,₱${past.avgSavings.toFixed(2)}\nLast Cutoff Saved,₱${past.lastSaved.toFixed(2)}`;
  }

  const summary = `\n\n=== CURRENT CUTOFF SUMMARY ===\nIncome,${data.income.toFixed(2)}\nCutoff Start,${new Date(data.startDate).toLocaleDateString()}\nCutoff End,${new Date(data.endDate).toLocaleDateString()}\nTotal Budget,${total.toFixed(2)}\nTotal Spent,${spent.toFixed(2)}\nTotal Remaining,${(total - spent).toFixed(2)}\nSurvival Remaining,${data.remaining.survival.toFixed(2)}\nStability Remaining,${data.remaining.stability.toFixed(2)}\nWants Remaining,${data.remaining.wants.toFixed(2)}\nFuture Remaining,${data.remaining.future.toFixed(2)}`;

  const fullCSV = csvContent + summary + perfSummary;

  // Create blob and download
  const blob = new Blob([fullCSV], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  const endDate = new Date(data.endDate).toISOString().split("T")[0];
  link.setAttribute("href", url);
  link.setAttribute("download", `budget-${endDate}.csv`);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showMessage("✓ Data exported successfully", "success");
}

// Phase 2: Quick category button handler
function setQuickCategory(cat) {
  document.getElementById("expenseCategory").value = cat;
  if (cat) saveLastCategory();
  // Update preview to reflect manual override
  const preview = document.getElementById('categoryPreview');
  if (preview) {
    if (cat) {
      preview.classList.remove('visible');
    } else {
      updateCategoryPreview();
    }
  }
  document.getElementById("expenseAmount").focus();
}

// Toggle Quick Add panel collapse
function toggleQuickAdd() {
  const panel = document.getElementById('expenseInputSection');
  if (panel) {
    panel.classList.toggle('collapsed');
    // Focus amount input when expanding
    if (!panel.classList.contains('collapsed')) {
      setTimeout(() => document.getElementById('expenseAmount').focus(), 260);
    }
  }
}

// Real-time category preview as user types
function updateCategoryPreview() {
  const note = document.getElementById('expenseNote').value.trim();
  const manualCat = document.getElementById('expenseCategory').value;
  const preview = document.getElementById('categoryPreview');
  const previewName = document.getElementById('previewCatName');

  if (!preview || !previewName) return;

  // Only show preview when auto-detect is active and note has content
  if (manualCat || !note) {
    preview.classList.remove('visible');
    return;
  }

  const detected = smartDetectCategory(note);
  previewName.textContent = detected;

  // Apply color class based on detected category
  preview.className = 'category-preview visible ' + detected.toLowerCase();
}

// Phase 2: Input Friction Reduction
// Remember last category used
function loadLastCategory() {
  const lastCat = sessionStorage.getItem("lastCategory");
  if (lastCat) {
    document.getElementById("expenseCategory").value = lastCat;
  }
}

function saveLastCategory() {
  const cat = document.getElementById("expenseCategory").value;
  if (cat) sessionStorage.setItem("lastCategory", cat);
}

// Auto-focus on expense amount + Enter key submit
function initializeInputHandlers() {
  const amountInput = document.getElementById("expenseAmount");
  const noteInput = document.getElementById("expenseNote");
  const categorySelect = document.getElementById("expenseCategory");
  const incomeInput = document.getElementById("incomeInput");
  const dateInput = document.getElementById("cutoffStartDate");

  // Default date to today
  if (dateInput) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  // Auto-focus on amount after page load
  amountInput.focus();

  // Enter key to submit expense
  amountInput.addEventListener("keypress", e => {
    if (e.key === "Enter") {
      if (amountInput.value && noteInput.value) {
        addExpense();
      } else {
        noteInput.focus();
      }
    }
  });

  noteInput.addEventListener("keypress", e => {
    if (e.key === "Enter") {
      addExpense();
    }
  });

  // Save last category whenever it changes + hide preview
  categorySelect.addEventListener("change", () => {
    saveLastCategory();
    updateCategoryPreview();
  });

  // Enter key on income input
  incomeInput.addEventListener("keypress", e => {
    if (e.key === "Enter") {
      addIncome();
    }
  });
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('✓ Service Worker registered'))
    .catch(err => console.log('✗ Service Worker error:', err));
}

// Offline mode listeners
function updateOfflineStatus() {
  const banner = document.getElementById("offlineBanner");
  if (banner) {
    banner.style.display = navigator.onLine ? "none" : "block";
  }
}
window.addEventListener("online", updateOfflineStatus);
window.addEventListener("offline", updateOfflineStatus);
updateOfflineStatus();

// Initial render & setup
loadLastCategory();
initializeInputHandlers();
render();
if (typeof switchTab === 'function') switchTab('Dashboard');
