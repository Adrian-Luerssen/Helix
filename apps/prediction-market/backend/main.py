"""Prediction Market Agent - FastAPI Backend."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from .config import settings
from .db.database import get_db, init_db, AsyncSessionLocal
from .models.trade import Trade, TradeCreate, TradeUpdate, TradeDB, TradeStatus
from .models.market import Market, MarketOpportunity
from .models.performance import StrategyPerformance, OverallPerformance
from .strategies import NothingEverHappensStrategy, YieldFarmingStrategy
from .trading import trading_engine, Position, ExposureReport, RiskCheckResult, TradeResult


# Strategy registry
STRATEGIES = {
    "nothing_ever_happens": NothingEverHappensStrategy,
    "yield_farming": YieldFarmingStrategy,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize on startup."""
    await init_db()
    settings.log_path.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="Prediction Market Agent",
    description="Self-improving prediction market trading agent",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== TRADES API ==============

@app.post("/api/trades", response_model=Trade)
async def create_trade(trade: TradeCreate, db: AsyncSession = Depends(get_db)):
    """Log a new trade."""
    trade_id = str(uuid.uuid4())
    now = datetime.utcnow()
    
    # Calculate shares
    shares = trade.amount / trade.entry_price if trade.entry_price > 0 else 0
    
    db_trade = TradeDB(
        id=trade_id,
        created_at=now,
        updated_at=now,
        platform=trade.platform,
        market_id=trade.market_id,
        market_question=trade.market_question,
        market_category=trade.market_category,
        market_end_date=trade.market_end_date,
        side=trade.side.value,
        entry_price=trade.entry_price,
        amount=trade.amount,
        shares=shares,
        strategy=trade.strategy,
        entry_context=json.dumps(trade.entry_context) if trade.entry_context else None,
        status=TradeStatus.OPEN.value,
    )
    
    db.add(db_trade)
    await db.commit()
    await db.refresh(db_trade)
    
    # Append to JSONL log
    log_entry = {
        "timestamp": now.isoformat(),
        "action": "trade_created",
        "trade_id": trade_id,
        "data": trade.model_dump(mode="json"),
    }
    with open(settings.trade_log_path, "a") as f:
        f.write(json.dumps(log_entry) + "\n")
    
    return _db_to_trade(db_trade)


@app.get("/api/trades", response_model=list[Trade])
async def list_trades(
    status: Optional[str] = None,
    strategy: Optional[str] = None,
    platform: Optional[str] = None,
    limit: int = Query(default=100, le=1000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """List trades with optional filters."""
    query = select(TradeDB).order_by(TradeDB.created_at.desc())
    
    if status:
        query = query.where(TradeDB.status == status)
    if strategy:
        query = query.where(TradeDB.strategy == strategy)
    if platform:
        query = query.where(TradeDB.platform == platform)
    
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    trades = result.scalars().all()
    
    return [_db_to_trade(t) for t in trades]


@app.get("/api/trades/{trade_id}", response_model=Trade)
async def get_trade(trade_id: str, db: AsyncSession = Depends(get_db)):
    """Get a specific trade."""
    result = await db.execute(select(TradeDB).where(TradeDB.id == trade_id))
    trade = result.scalar_one_or_none()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    return _db_to_trade(trade)


@app.put("/api/trades/{trade_id}", response_model=Trade)
async def update_trade(
    trade_id: str, 
    update: TradeUpdate, 
    db: AsyncSession = Depends(get_db)
):
    """Update a trade (e.g., resolution)."""
    result = await db.execute(select(TradeDB).where(TradeDB.id == trade_id))
    trade = result.scalar_one_or_none()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    
    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(trade, key, value)
    
    # Calculate P&L if resolution provided
    if update.resolution_outcome and trade.pnl is None:
        trade.pnl = _calculate_pnl(trade, update.resolution_outcome)
        trade.roi = (trade.pnl / trade.amount) * 100 if trade.amount > 0 else 0
    
    # Calculate CLV if closing price provided
    if update.closing_price and trade.clv is None:
        trade.clv = trade.entry_price - update.closing_price
        trade.was_good_trade = trade.clv > 0
    
    trade.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(trade)
    
    # Log update
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "action": "trade_updated",
        "trade_id": trade_id,
        "data": update_data,
    }
    with open(settings.trade_log_path, "a") as f:
        f.write(json.dumps(log_entry) + "\n")
    
    return _db_to_trade(trade)


# ============== STRATEGIES API ==============

@app.get("/api/strategies")
async def list_strategies():
    """List available strategies."""
    result = []
    for name, strategy_cls in STRATEGIES.items():
        strategy = strategy_cls()
        result.append({
            "name": name,
            "description": strategy.description,
            "config": strategy.config.model_dump(),
        })
    return result


@app.get("/api/strategies/{name}")
async def get_strategy(name: str, db: AsyncSession = Depends(get_db)):
    """Get strategy details and performance."""
    if name not in STRATEGIES:
        raise HTTPException(status_code=404, detail="Strategy not found")
    
    strategy = STRATEGIES[name]()
    performance = await _get_strategy_performance(db, name)
    
    return {
        "name": name,
        "description": strategy.description,
        "config": strategy.config.model_dump(),
        "performance": performance,
    }


@app.post("/api/strategies/{name}/scan")
async def scan_with_strategy(name: str, markets: list[Market]):
    """Scan markets with a specific strategy."""
    if name not in STRATEGIES:
        raise HTTPException(status_code=404, detail="Strategy not found")
    
    strategy = STRATEGIES[name]()
    opportunities = await strategy.scan_markets(markets)
    return opportunities


# ============== PERFORMANCE API ==============

@app.get("/api/performance")
async def get_overall_performance(
    period: str = "all_time",
    db: AsyncSession = Depends(get_db),
):
    """Get overall performance metrics."""
    return await _calculate_overall_performance(db, period)


@app.get("/api/performance/{strategy}")
async def get_strategy_performance(
    strategy: str,
    period: str = "all_time",
    db: AsyncSession = Depends(get_db),
):
    """Get performance for a specific strategy."""
    return await _get_strategy_performance(db, strategy, period)


# ============== ANALYSIS API ==============

@app.post("/api/analyze/trade/{trade_id}")
async def analyze_trade(trade_id: str, db: AsyncSession = Depends(get_db)):
    """Analyze a resolved trade for learning."""
    result = await db.execute(select(TradeDB).where(TradeDB.id == trade_id))
    trade = result.scalar_one_or_none()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    
    if trade.status == TradeStatus.OPEN.value:
        raise HTTPException(status_code=400, detail="Trade not yet resolved")
    
    analysis = {
        "trade_id": trade_id,
        "strategy": trade.strategy,
        "won": trade.status == TradeStatus.RESOLVED_WIN.value,
        "pnl": trade.pnl,
        "roi": trade.roi,
        "entry_price": trade.entry_price,
        "closing_price": trade.closing_price,
        "clv": trade.clv,
        "beat_closing_line": trade.was_good_trade,
        "analysis": _generate_trade_analysis(trade),
    }
    
    return analysis


# ============== TRADING API ==============

@app.get("/api/trading/status")
async def get_trading_status():
    """Get trading engine status."""
    return trading_engine.get_status()


@app.post("/api/trading/execute", response_model=TradeResult)
async def execute_opportunity(
    opportunity: MarketOpportunity,
    force: bool = Query(default=False, description="Skip risk checks (use with caution!)"),
    db: AsyncSession = Depends(get_db),
):
    """Execute a trading opportunity."""
    result = await trading_engine.execute_opportunity(
        opportunity=opportunity,
        db=db,
        force=force,
    )
    return result


@app.post("/api/trading/check-risk", response_model=RiskCheckResult)
async def check_risk_limits(
    opportunity: MarketOpportunity,
    db: AsyncSession = Depends(get_db),
):
    """Check if an opportunity passes risk limits without executing."""
    return await trading_engine.check_risk_limits(opportunity, db)


@app.get("/api/trading/positions", response_model=list[Position])
async def get_positions(db: AsyncSession = Depends(get_db)):
    """Get all open positions."""
    return await trading_engine.get_positions(db)


@app.get("/api/trading/exposure", response_model=ExposureReport)
async def get_exposure(db: AsyncSession = Depends(get_db)):
    """Get current exposure report."""
    return await trading_engine.get_exposure(db)


# ============== HELPERS ==============

def _db_to_trade(db_trade: TradeDB) -> Trade:
    """Convert DB model to Pydantic model."""
    return Trade(
        id=db_trade.id,
        created_at=db_trade.created_at,
        updated_at=db_trade.updated_at,
        platform=db_trade.platform,
        market_id=db_trade.market_id,
        market_question=db_trade.market_question,
        market_category=db_trade.market_category,
        market_end_date=db_trade.market_end_date,
        side=db_trade.side,
        entry_price=db_trade.entry_price,
        amount=db_trade.amount,
        shares=db_trade.shares,
        strategy=db_trade.strategy,
        entry_context=json.loads(db_trade.entry_context) if db_trade.entry_context else None,
        status=db_trade.status,
        resolution_date=db_trade.resolution_date,
        resolution_outcome=db_trade.resolution_outcome,
        closing_price=db_trade.closing_price,
        pnl=db_trade.pnl,
        roi=db_trade.roi,
        clv=db_trade.clv,
        was_good_trade=db_trade.was_good_trade,
        lessons=db_trade.lessons,
        quality_rating=db_trade.quality_rating,
    )


def _calculate_pnl(trade: TradeDB, outcome: str) -> float:
    """Calculate profit/loss for a trade."""
    # If we bet YES and outcome is YES, we win
    # If we bet NO and outcome is NO, we win
    won = (trade.side == "yes" and outcome == "yes") or \
          (trade.side == "no" and outcome == "no")
    
    if won:
        # Win: shares * $1 - amount_paid
        return trade.shares - trade.amount if trade.shares else 0
    else:
        # Loss: lose entire amount
        return -trade.amount


async def _get_strategy_performance(
    db: AsyncSession, 
    strategy: str,
    period: str = "all_time"
) -> dict:
    """Calculate performance metrics for a strategy."""
    query = select(TradeDB).where(TradeDB.strategy == strategy)
    result = await db.execute(query)
    trades = result.scalars().all()
    
    if not trades:
        return {"trades": 0, "message": "No trades found"}
    
    open_trades = [t for t in trades if t.status == TradeStatus.OPEN.value]
    resolved = [t for t in trades if t.status != TradeStatus.OPEN.value]
    wins = [t for t in resolved if t.status == TradeStatus.RESOLVED_WIN.value]
    
    total_wagered = sum(t.amount for t in trades)
    total_pnl = sum(t.pnl or 0 for t in resolved)
    
    clv_trades = [t for t in resolved if t.clv is not None]
    avg_clv = sum(t.clv for t in clv_trades) / len(clv_trades) if clv_trades else 0
    clv_positive = len([t for t in clv_trades if t.clv > 0])
    
    return {
        "strategy": strategy,
        "period": period,
        "total_trades": len(trades),
        "open_trades": len(open_trades),
        "resolved_trades": len(resolved),
        "wins": len(wins),
        "losses": len(resolved) - len(wins),
        "win_rate": len(wins) / len(resolved) if resolved else 0,
        "total_wagered": total_wagered,
        "total_pnl": total_pnl,
        "roi": (total_pnl / total_wagered * 100) if total_wagered > 0 else 0,
        "avg_clv": avg_clv,
        "clv_positive_rate": clv_positive / len(clv_trades) if clv_trades else 0,
    }


async def _calculate_overall_performance(db: AsyncSession, period: str) -> dict:
    """Calculate overall performance across all strategies."""
    strategies = {}
    for name in STRATEGIES.keys():
        strategies[name] = await _get_strategy_performance(db, name, period)
    
    all_trades = sum(s.get("total_trades", 0) for s in strategies.values())
    total_wagered = sum(s.get("total_wagered", 0) for s in strategies.values())
    total_pnl = sum(s.get("total_pnl", 0) for s in strategies.values())
    
    return {
        "period": period,
        "total_trades": all_trades,
        "total_wagered": total_wagered,
        "total_pnl": total_pnl,
        "overall_roi": (total_pnl / total_wagered * 100) if total_wagered > 0 else 0,
        "strategies": strategies,
    }


def _generate_trade_analysis(trade: TradeDB) -> dict:
    """Generate analysis and lessons for a trade."""
    analysis = {
        "what_went_right": [],
        "what_went_wrong": [],
        "suggestions": [],
    }
    
    won = trade.status == TradeStatus.RESOLVED_WIN.value
    
    if won:
        analysis["what_went_right"].append("Trade was profitable")
        if trade.was_good_trade:
            analysis["what_went_right"].append("Beat the closing line (good entry timing)")
    else:
        analysis["what_went_wrong"].append("Trade resulted in loss")
    
    if trade.clv is not None:
        if trade.clv < 0:
            analysis["what_went_wrong"].append(f"Did not beat closing line (CLV: {trade.clv:.3f})")
            analysis["suggestions"].append("Consider waiting for better entry prices")
        elif trade.clv > 0.05:
            analysis["what_went_right"].append(f"Excellent entry timing (CLV: {trade.clv:.3f})")
    
    return analysis


# ============== STATIC FILES ==============

# Serve frontend
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    # Mount CSS and JS at their expected paths
    css_path = frontend_path / "css"
    js_path = frontend_path / "js"
    
    if css_path.exists():
        app.mount("/css", StaticFiles(directory=str(css_path)), name="css")
    if js_path.exists():
        app.mount("/js", StaticFiles(directory=str(js_path)), name="js")
    
    @app.get("/")
    async def serve_frontend():
        return FileResponse(str(frontend_path / "index.html"))
