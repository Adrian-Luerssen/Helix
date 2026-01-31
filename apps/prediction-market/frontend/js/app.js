/**
 * Prediction Market Agent - Frontend
 */

const API_BASE = window.location.origin;

// State
const state = {
    trades: [],
    strategies: [],
    performance: null,
};

// ============== API ==============

async function api(endpoint, options = {}) {
    const url = `${API_BASE}/api${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

// ============== TRADES ==============

async function loadTrades(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.strategy) params.set('strategy', filters.strategy);
        
        const endpoint = `/trades${params.toString() ? '?' + params.toString() : ''}`;
        state.trades = await api(endpoint);
        renderTrades();
        updateTradeStats();
    } catch (err) {
        console.error('Failed to load trades:', err);
        document.getElementById('trades-body').innerHTML = 
            '<tr><td colspan="9" class="loading">Failed to load trades</td></tr>';
    }
}

function renderTrades() {
    const tbody = document.getElementById('trades-body');
    
    if (!state.trades.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading">No trades yet</td></tr>';
        return;
    }
    
    tbody.innerHTML = state.trades.map(trade => `
        <tr data-id="${trade.id}">
            <td>${formatTime(trade.created_at)}</td>
            <td title="${trade.market_question}">${truncate(trade.market_question, 40)}</td>
            <td><span class="side-${trade.side}">${trade.side.toUpperCase()}</span></td>
            <td>${(trade.entry_price * 100).toFixed(0)}¢</td>
            <td>$${trade.amount.toFixed(2)}</td>
            <td>${formatStrategy(trade.strategy)}</td>
            <td class="${getStatusClass(trade.status)}">${formatStatus(trade.status)}</td>
            <td class="${trade.pnl > 0 ? 'positive' : trade.pnl < 0 ? 'negative' : ''}">${formatPnl(trade.pnl)}</td>
            <td class="${trade.clv > 0 ? 'clv-positive' : trade.clv < 0 ? 'clv-negative' : ''}">${formatClv(trade.clv)}</td>
        </tr>
    `).join('');
}

function updateTradeStats() {
    const total = state.trades.length;
    const open = state.trades.filter(t => t.status === 'open').length;
    const resolved = state.trades.filter(t => t.status !== 'open');
    const wins = resolved.filter(t => t.status === 'resolved_win').length;
    const pnl = resolved.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = resolved.length > 0 ? (wins / resolved.length * 100) : 0;
    
    document.getElementById('total-trades').textContent = total;
    document.getElementById('open-trades').textContent = open;
    
    const pnlEl = document.getElementById('total-pnl');
    pnlEl.textContent = `$${pnl.toFixed(2)}`;
    pnlEl.className = `stat-value ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`;
    
    document.getElementById('win-rate').textContent = `${winRate.toFixed(0)}%`;
}

// ============== STRATEGIES ==============

async function loadStrategies() {
    try {
        state.strategies = await api('/strategies');
        renderStrategies();
        populateStrategyFilter();
    } catch (err) {
        console.error('Failed to load strategies:', err);
    }
}

function renderStrategies() {
    const grid = document.getElementById('strategies-grid');
    
    if (!state.strategies.length) {
        grid.innerHTML = '<div class="loading">No strategies configured</div>';
        return;
    }
    
    grid.innerHTML = state.strategies.map(strategy => `
        <div class="strategy-card">
            <h3>
                ${getStrategyIcon(strategy.name)}
                ${formatStrategy(strategy.name)}
            </h3>
            <p>${strategy.description}</p>
            <div class="strategy-stats">
                <div class="stat">
                    <span class="stat-value">${strategy.config.enabled ? '✓' : '✗'}</span>
                    <span class="stat-label">Status</span>
                </div>
                <div class="stat">
                    <span class="stat-value">$${strategy.config.max_position_size}</span>
                    <span class="stat-label">Max Position</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${strategy.config.max_positions}</span>
                    <span class="stat-label">Max Count</span>
                </div>
            </div>
        </div>
    `).join('');
}

function populateStrategyFilter() {
    const select = document.getElementById('filter-strategy');
    select.innerHTML = '<option value="">All Strategies</option>' +
        state.strategies.map(s => `<option value="${s.name}">${formatStrategy(s.name)}</option>`).join('');
}

// ============== PERFORMANCE ==============

async function loadPerformance() {
    try {
        state.performance = await api('/performance');
        renderPerformance();
    } catch (err) {
        console.error('Failed to load performance:', err);
    }
}

function renderPerformance() {
    const container = document.getElementById('performance-summary');
    const p = state.performance;
    
    if (!p) {
        container.innerHTML = '<div class="loading">No performance data</div>';
        return;
    }
    
    container.innerHTML = `
        <h2>Overall Performance</h2>
        <div class="stats-row">
            <div class="stat">
                <span class="stat-value">${p.total_trades}</span>
                <span class="stat-label">Total Trades</span>
            </div>
            <div class="stat">
                <span class="stat-value">$${p.total_wagered.toFixed(2)}</span>
                <span class="stat-label">Total Wagered</span>
            </div>
            <div class="stat">
                <span class="stat-value ${p.total_pnl > 0 ? 'positive' : p.total_pnl < 0 ? 'negative' : ''}">
                    $${p.total_pnl.toFixed(2)}
                </span>
                <span class="stat-label">Total P&L</span>
            </div>
            <div class="stat">
                <span class="stat-value ${p.overall_roi > 0 ? 'positive' : p.overall_roi < 0 ? 'negative' : ''}">
                    ${p.overall_roi.toFixed(1)}%
                </span>
                <span class="stat-label">ROI</span>
            </div>
        </div>
        
        <h3 style="margin-top: 24px; margin-bottom: 16px;">By Strategy</h3>
        <div class="strategies-grid">
            ${Object.entries(p.strategies).map(([name, stats]) => `
                <div class="strategy-card">
                    <h3>${formatStrategy(name)}</h3>
                    <div class="strategy-stats">
                        <div class="stat">
                            <span class="stat-value">${stats.total_trades || 0}</span>
                            <span class="stat-label">Trades</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value ${(stats.roi || 0) > 0 ? 'positive' : (stats.roi || 0) < 0 ? 'negative' : ''}">
                                ${(stats.roi || 0).toFixed(1)}%
                            </span>
                            <span class="stat-label">ROI</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${((stats.clv_positive_rate || 0) * 100).toFixed(0)}%</span>
                            <span class="stat-label">CLV+ Rate</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============== ANALYSIS ==============

async function loadAnalysis() {
    try {
        // Load resolved trades
        const resolved = await api('/trades?status=resolved_win') 
            .then(wins => api('/trades?status=resolved_loss').then(losses => [...wins, ...losses]));
        renderAnalysis(resolved);
    } catch (err) {
        console.error('Failed to load analysis:', err);
    }
}

function renderAnalysis(trades) {
    const container = document.getElementById('analysis-list');
    
    if (!trades.length) {
        container.innerHTML = '<div class="loading">No resolved trades to analyze</div>';
        return;
    }
    
    container.innerHTML = trades.slice(0, 20).map(trade => `
        <div class="analysis-card ${trade.status === 'resolved_win' ? 'win' : 'loss'}">
            <div class="analysis-header">
                <span class="analysis-market">${truncate(trade.market_question, 60)}</span>
                <span class="analysis-pnl ${trade.pnl > 0 ? 'positive' : 'negative'}">
                    ${trade.pnl > 0 ? '+' : ''}$${(trade.pnl || 0).toFixed(2)}
                </span>
            </div>
            <div style="color: var(--text-secondary); font-size: 14px;">
                ${formatStrategy(trade.strategy)} · 
                ${trade.side.toUpperCase()} @ ${(trade.entry_price * 100).toFixed(0)}¢ · 
                CLV: ${formatClv(trade.clv)}
            </div>
            ${trade.lessons ? `
                <div class="analysis-lessons">
                    <h4>Lessons</h4>
                    <p>${trade.lessons}</p>
                </div>
            ` : ''}
        </div>
    `).join('');
}

// ============== HELPERS ==============

function formatTime(iso) {
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '...' : str;
}

function formatStrategy(name) {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getStrategyIcon(name) {
    const icons = {
        'nothing_ever_happens': '🙅',
        'yield_farming': '🌾',
        'arbitrage': '⚖️',
        'clv_tracker': '📊',
    };
    return icons[name] || '📈';
}

function formatStatus(status) {
    const labels = {
        'open': 'Open',
        'resolved_win': 'Won',
        'resolved_loss': 'Lost',
        'cancelled': 'Cancelled',
    };
    return labels[status] || status;
}

function getStatusClass(status) {
    const classes = {
        'open': 'status-open',
        'resolved_win': 'status-win',
        'resolved_loss': 'status-loss',
    };
    return classes[status] || '';
}

function formatPnl(pnl) {
    if (pnl === null || pnl === undefined) return '-';
    return (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
}

function formatClv(clv) {
    if (clv === null || clv === undefined) return '-';
    return (clv >= 0 ? '+' : '') + (clv * 100).toFixed(1) + '¢';
}

// ============== EVENTS ==============

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`${tabName}-tab`).classList.add('active');
            
            // Load data if needed
            if (tabName === 'strategies') loadStrategies();
            if (tabName === 'performance') loadPerformance();
            if (tabName === 'analysis') loadAnalysis();
        });
    });
    
    // Filters
    document.getElementById('filter-status').addEventListener('change', (e) => {
        loadTrades({ 
            status: e.target.value,
            strategy: document.getElementById('filter-strategy').value,
        });
    });
    
    document.getElementById('filter-strategy').addEventListener('change', (e) => {
        loadTrades({ 
            status: document.getElementById('filter-status').value,
            strategy: e.target.value,
        });
    });
    
    // Refresh
    document.getElementById('refresh-trades').addEventListener('click', () => {
        loadTrades({
            status: document.getElementById('filter-status').value,
            strategy: document.getElementById('filter-strategy').value,
        });
    });
}

// ============== INIT ==============

async function init() {
    setupEventListeners();
    await loadTrades();
    await loadStrategies();
}

document.addEventListener('DOMContentLoaded', init);
