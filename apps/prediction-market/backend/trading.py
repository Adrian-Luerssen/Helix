"""Trading execution layer for the prediction market agent."""

import json
import uuid
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .config import settings
from .models.trade import Trade, TradeCreate, TradeDB, TradeStatus, TradeSide
from .models.market import MarketOpportunity


class Position(BaseModel):
    """Represents an open position."""
    trade_id: str
    platform: str
    market_id: str
    market_question: str
    side: str
    entry_price: float
    amount: float
    shares: float
    current_value: float  # Current mark-to-market value
    unrealized_pnl: float
    strategy: str
    opened_at: datetime


class ExposureReport(BaseModel):
    """Current exposure across all positions."""
    total_exposure: float  # Total $ at risk
    available_capital: float  # How much more we can risk
    position_count: int
    by_platform: dict[str, float] = Field(default_factory=dict)
    by_strategy: dict[str, float] = Field(default_factory=dict)
    daily_traded: float = 0  # How much traded today
    daily_limit: float = 0  # Daily trading limit
    daily_remaining: float = 0


class RiskCheckResult(BaseModel):
    """Result of risk limit checks."""
    allowed: bool
    reason: str
    details: dict = Field(default_factory=dict)


class TradeResult(BaseModel):
    """Result of trade execution."""
    success: bool
    trade: Optional[Trade] = None
    error: Optional[str] = None
    paper_trade: bool = True


class RiskManager:
    """Manages risk limits and checks."""
    
    def __init__(
        self,
        max_position_size: float = settings.max_position_size,
        max_total_exposure: float = settings.max_total_exposure,
        max_daily_volume: Optional[float] = None,
        max_positions_per_market: int = 1,
    ):
        self.max_position_size = max_position_size
        self.max_total_exposure = max_total_exposure
        self.max_daily_volume = max_daily_volume or max_total_exposure * 2
        self.max_positions_per_market = max_positions_per_market
    
    async def check_limits(
        self,
        opportunity: MarketOpportunity,
        current_exposure: ExposureReport,
        existing_positions: list[Position],
        db: AsyncSession,
    ) -> RiskCheckResult:
        """Check all risk limits before executing a trade."""
        
        trade_amount = opportunity.recommended_amount
        
        # Check 1: Position size limit
        if trade_amount > self.max_position_size:
            return RiskCheckResult(
                allowed=False,
                reason=f"Trade amount ${trade_amount:.2f} exceeds max position size ${self.max_position_size:.2f}",
                details={"limit": "max_position_size", "requested": trade_amount, "max": self.max_position_size}
            )
        
        # Check 2: Total exposure limit
        new_total = current_exposure.total_exposure + trade_amount
        if new_total > self.max_total_exposure:
            return RiskCheckResult(
                allowed=False,
                reason=f"Trade would exceed max total exposure. Current: ${current_exposure.total_exposure:.2f}, After: ${new_total:.2f}, Max: ${self.max_total_exposure:.2f}",
                details={"limit": "max_total_exposure", "current": current_exposure.total_exposure, "after": new_total, "max": self.max_total_exposure}
            )
        
        # Check 3: Daily volume limit
        new_daily = current_exposure.daily_traded + trade_amount
        if new_daily > self.max_daily_volume:
            return RiskCheckResult(
                allowed=False,
                reason=f"Trade would exceed daily limit. Today: ${current_exposure.daily_traded:.2f}, After: ${new_daily:.2f}, Limit: ${self.max_daily_volume:.2f}",
                details={"limit": "daily_volume", "today": current_exposure.daily_traded, "after": new_daily, "max": self.max_daily_volume}
            )
        
        # Check 4: Max positions per market
        market_positions = [
            p for p in existing_positions
            if p.platform == opportunity.market.platform and p.market_id == opportunity.market.market_id
        ]
        if len(market_positions) >= self.max_positions_per_market:
            return RiskCheckResult(
                allowed=False,
                reason=f"Already have {len(market_positions)} position(s) in this market (max: {self.max_positions_per_market})",
                details={"limit": "positions_per_market", "current": len(market_positions), "max": self.max_positions_per_market}
            )
        
        # All checks passed
        return RiskCheckResult(
            allowed=True,
            reason="All risk checks passed",
            details={
                "trade_amount": trade_amount,
                "new_total_exposure": new_total,
                "new_daily_volume": new_daily,
            }
        )


class PositionManager:
    """Manages open positions and calculates exposure."""
    
    async def get_positions(self, db: AsyncSession) -> list[Position]:
        """Get all open positions."""
        result = await db.execute(
            select(TradeDB).where(TradeDB.status == TradeStatus.OPEN.value)
        )
        trades = result.scalars().all()
        
        positions = []
        for trade in trades:
            # For paper trading, current value = entry value (no live price updates)
            current_value = trade.amount
            unrealized_pnl = 0.0
            
            positions.append(Position(
                trade_id=trade.id,
                platform=trade.platform,
                market_id=trade.market_id,
                market_question=trade.market_question,
                side=trade.side,
                entry_price=trade.entry_price,
                amount=trade.amount,
                shares=trade.shares or 0,
                current_value=current_value,
                unrealized_pnl=unrealized_pnl,
                strategy=trade.strategy,
                opened_at=trade.created_at,
            ))
        
        return positions
    
    async def get_exposure(self, db: AsyncSession) -> ExposureReport:
        """Calculate current exposure report."""
        positions = await self.get_positions(db)
        
        total_exposure = sum(p.amount for p in positions)
        by_platform: dict[str, float] = {}
        by_strategy: dict[str, float] = {}
        
        for p in positions:
            by_platform[p.platform] = by_platform.get(p.platform, 0) + p.amount
            by_strategy[p.strategy] = by_strategy.get(p.strategy, 0) + p.amount
        
        # Calculate daily traded volume
        today = date.today()
        today_start = datetime.combine(today, datetime.min.time())
        
        result = await db.execute(
            select(TradeDB).where(TradeDB.created_at >= today_start)
        )
        today_trades = result.scalars().all()
        daily_traded = sum(t.amount for t in today_trades)
        
        daily_limit = settings.max_total_exposure * 2  # Allow 2x exposure per day
        
        return ExposureReport(
            total_exposure=total_exposure,
            available_capital=max(0, settings.max_total_exposure - total_exposure),
            position_count=len(positions),
            by_platform=by_platform,
            by_strategy=by_strategy,
            daily_traded=daily_traded,
            daily_limit=daily_limit,
            daily_remaining=max(0, daily_limit - daily_traded),
        )


class PaperTrader:
    """Simulated trading that logs trades without real execution."""
    
    def __init__(self):
        self.position_manager = PositionManager()
    
    async def execute_trade(
        self,
        opportunity: MarketOpportunity,
        db: AsyncSession,
    ) -> TradeResult:
        """Execute a paper trade - logs to database without real execution."""
        
        trade_id = str(uuid.uuid4())
        now = datetime.utcnow()
        
        # Calculate shares based on entry price
        entry_price = opportunity.market.yes_price if opportunity.recommended_side == "yes" else opportunity.market.no_price
        if entry_price is None or entry_price <= 0:
            return TradeResult(
                success=False,
                error=f"Invalid entry price: {entry_price}",
                paper_trade=True,
            )
        
        shares = opportunity.recommended_amount / entry_price
        
        # Create the trade record
        db_trade = TradeDB(
            id=trade_id,
            created_at=now,
            updated_at=now,
            platform=opportunity.market.platform,
            market_id=opportunity.market.market_id,
            market_question=opportunity.market.question,
            market_category=opportunity.market.category,
            market_end_date=opportunity.market.end_date,
            side=opportunity.recommended_side,
            entry_price=entry_price,
            amount=opportunity.recommended_amount,
            shares=shares,
            strategy=opportunity.strategy,
            entry_context=json.dumps({
                "signal_strength": opportunity.signal_strength,
                "expected_value": opportunity.expected_value,
                "reasoning": opportunity.reasoning,
                "market_yes_price": opportunity.market.yes_price,
                "market_no_price": opportunity.market.no_price,
                "market_volume": opportunity.market.volume,
                "execution_mode": "paper",
            }),
            status=TradeStatus.OPEN.value,
        )
        
        db.add(db_trade)
        await db.commit()
        await db.refresh(db_trade)
        
        # Log to JSONL
        log_entry = {
            "timestamp": now.isoformat(),
            "action": "paper_trade_executed",
            "trade_id": trade_id,
            "strategy": opportunity.strategy,
            "market_id": opportunity.market.market_id,
            "side": opportunity.recommended_side,
            "amount": opportunity.recommended_amount,
            "entry_price": entry_price,
            "shares": shares,
            "reasoning": opportunity.reasoning,
        }
        
        settings.log_path.mkdir(parents=True, exist_ok=True)
        with open(settings.trade_log_path, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
        
        # Convert to Trade model
        trade = Trade(
            id=db_trade.id,
            created_at=db_trade.created_at,
            updated_at=db_trade.updated_at,
            platform=db_trade.platform,
            market_id=db_trade.market_id,
            market_question=db_trade.market_question,
            market_category=db_trade.market_category,
            market_end_date=db_trade.market_end_date,
            side=TradeSide(db_trade.side),
            entry_price=db_trade.entry_price,
            amount=db_trade.amount,
            shares=db_trade.shares,
            strategy=db_trade.strategy,
            entry_context=json.loads(db_trade.entry_context) if db_trade.entry_context else None,
            status=TradeStatus(db_trade.status),
        )
        
        return TradeResult(
            success=True,
            trade=trade,
            paper_trade=True,
        )


class LiveTrader:
    """Real trading using platform adapters. Stub for now."""
    
    async def execute_trade(
        self,
        opportunity: MarketOpportunity,
        db: AsyncSession,
    ) -> TradeResult:
        """Execute a live trade using platform adapters."""
        raise NotImplementedError(
            "Live trading not yet implemented. "
            "Platform adapters for Polymarket/Kalshi need to be integrated. "
            "Use paper_trading=True in config for now."
        )


class TradingEngine:
    """Main trading engine that orchestrates trades."""
    
    def __init__(self, paper_trading: bool = settings.paper_trading):
        self.paper_trading = paper_trading
        self.risk_manager = RiskManager()
        self.position_manager = PositionManager()
        
        if paper_trading:
            self.trader = PaperTrader()
        else:
            self.trader = LiveTrader()
    
    async def execute_opportunity(
        self,
        opportunity: MarketOpportunity,
        db: AsyncSession,
        force: bool = False,
    ) -> TradeResult:
        """
        Execute a trading opportunity.
        
        Args:
            opportunity: The market opportunity to trade
            db: Database session
            force: If True, skip risk checks (use with caution!)
        
        Returns:
            TradeResult with success status and trade details
        """
        
        # Get current state
        positions = await self.position_manager.get_positions(db)
        exposure = await self.position_manager.get_exposure(db)
        
        # Run risk checks unless forced
        if not force:
            risk_check = await self.risk_manager.check_limits(
                opportunity=opportunity,
                current_exposure=exposure,
                existing_positions=positions,
                db=db,
            )
            
            if not risk_check.allowed:
                return TradeResult(
                    success=False,
                    error=risk_check.reason,
                    paper_trade=self.paper_trading,
                )
        
        # Execute the trade
        result = await self.trader.execute_trade(opportunity, db)
        
        return result
    
    async def check_risk_limits(
        self,
        opportunity: MarketOpportunity,
        db: AsyncSession,
    ) -> RiskCheckResult:
        """Check if an opportunity passes risk limits without executing."""
        
        positions = await self.position_manager.get_positions(db)
        exposure = await self.position_manager.get_exposure(db)
        
        return await self.risk_manager.check_limits(
            opportunity=opportunity,
            current_exposure=exposure,
            existing_positions=positions,
            db=db,
        )
    
    async def get_positions(self, db: AsyncSession) -> list[Position]:
        """Get all open positions."""
        return await self.position_manager.get_positions(db)
    
    async def get_exposure(self, db: AsyncSession) -> ExposureReport:
        """Get current exposure report."""
        return await self.position_manager.get_exposure(db)
    
    def get_status(self) -> dict:
        """Get trading engine status."""
        return {
            "paper_trading": self.paper_trading,
            "max_position_size": self.risk_manager.max_position_size,
            "max_total_exposure": self.risk_manager.max_total_exposure,
            "max_daily_volume": self.risk_manager.max_daily_volume,
        }


# Singleton instance
trading_engine = TradingEngine()
