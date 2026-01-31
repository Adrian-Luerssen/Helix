import uuid
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.config import settings
from backend.models.market import Market, MarketOpportunity
from backend.models.trade import Base as TradeBase
from backend.models.trade import TradeDB, TradeStatus
from backend.trading import ExposureReport, PaperTrader, Position, PositionManager, RiskManager, TradingEngine


pytestmark = pytest.mark.asyncio(loop_scope="function")


def make_market(now: datetime | None = None) -> Market:
    if now is None:
        now = datetime.utcnow()
    return Market(
        id="polymarket:1",
        platform="polymarket",
        market_id="1",
        question="Will it rain tomorrow?",
        first_seen=now,
        last_updated=now,
        yes_price=0.6,
        no_price=0.4,
    )


def make_opportunity(amount: float = 10.0, side: str = "yes", market: Market | None = None) -> MarketOpportunity:
    if market is None:
        market = make_market()
    return MarketOpportunity(
        market=market,
        strategy="test-strategy",
        signal_strength=0.8,
        recommended_side=side,
        recommended_amount=amount,
        expected_value=0.12,
        reasoning="test reasoning",
    )


def make_exposure(total: float = 0.0, daily_traded: float = 0.0) -> ExposureReport:
    daily_limit = settings.max_total_exposure * 2
    return ExposureReport(
        total_exposure=total,
        available_capital=max(0.0, settings.max_total_exposure - total),
        position_count=0,
        by_platform={},
        by_strategy={},
        daily_traded=daily_traded,
        daily_limit=daily_limit,
        daily_remaining=max(0.0, daily_limit - daily_traded),
    )


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    db_url = f"sqlite+aiosqlite:///file:{uuid.uuid4().hex}?mode=memory&cache=shared"
    engine = create_async_engine(db_url, connect_args={"uri": True})

    async with engine.begin() as conn:
        await conn.run_sync(TradeBase.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session

    await engine.dispose()


async def insert_trade(
    session: AsyncSession,
    *,
    amount: float,
    platform: str,
    strategy: str,
    status: str,
    created_at: datetime,
) -> TradeDB:
    trade = TradeDB(
        id=str(uuid.uuid4()),
        created_at=created_at,
        updated_at=created_at,
        platform=platform,
        market_id="1",
        market_question="Will it rain tomorrow?",
        market_category="weather",
        market_end_date=None,
        side="yes",
        entry_price=0.6,
        amount=amount,
        shares=amount / 0.6,
        strategy=strategy,
        entry_context=None,
        status=status,
    )
    session.add(trade)
    await session.commit()
    await session.refresh(trade)
    return trade


async def test_trading_engine_initializes_in_paper_mode():
    engine = TradingEngine(paper_trading=True)

    assert engine.paper_trading is True
    assert isinstance(engine.trader, PaperTrader)
    assert engine.get_status()["paper_trading"] is True


async def test_risk_manager_check_limits_various_scenarios(db_session: AsyncSession):
    market = make_market()
    risk_manager = RiskManager(
        max_position_size=50.0,
        max_total_exposure=100.0,
        max_daily_volume=120.0,
        max_positions_per_market=1,
    )

    # Exceeds max position size
    opportunity = make_opportunity(amount=60.0, market=market)
    result = await risk_manager.check_limits(opportunity, make_exposure(), [], db_session)
    assert result.allowed is False
    assert result.details["limit"] == "max_position_size"

    # Exceeds total exposure (use amount within position limit but exceeds total)
    opportunity = make_opportunity(amount=40.0, market=market)
    exposure = make_exposure(total=70.0)  # 70 + 40 = 110 > 100 limit
    result = await risk_manager.check_limits(opportunity, exposure, [], db_session)
    assert result.allowed is False
    assert result.details["limit"] == "max_total_exposure"

    # Exceeds daily volume
    opportunity = make_opportunity(amount=30.0, market=market)
    exposure = make_exposure(daily_traded=100.0)
    result = await risk_manager.check_limits(opportunity, exposure, [], db_session)
    assert result.allowed is False
    assert result.details["limit"] == "daily_volume"

    # Exceeds positions per market
    opportunity = make_opportunity(amount=20.0, market=market)
    existing_positions = [
        Position(
            trade_id="t1",
            platform=market.platform,
            market_id=market.market_id,
            market_question=market.question,
            side="yes",
            entry_price=0.6,
            amount=10.0,
            shares=16.6,
            current_value=10.0,
            unrealized_pnl=0.0,
            strategy="test-strategy",
            opened_at=datetime.utcnow(),
        )
    ]
    result = await risk_manager.check_limits(opportunity, make_exposure(), existing_positions, db_session)
    assert result.allowed is False
    assert result.details["limit"] == "positions_per_market"

    # Allowed scenario
    opportunity = make_opportunity(amount=20.0, market=market)
    exposure = make_exposure(total=30.0, daily_traded=10.0)
    result = await risk_manager.check_limits(opportunity, exposure, [], db_session)
    assert result.allowed is True


async def test_position_manager_empty_positions(db_session: AsyncSession):
    manager = PositionManager()
    positions = await manager.get_positions(db_session)

    assert positions == []


async def test_exposure_report_calculation(db_session: AsyncSession):
    now = datetime.utcnow()
    yesterday = now - timedelta(days=1)

    await insert_trade(
        db_session,
        amount=100.0,
        platform="polymarket",
        strategy="strat-a",
        status=TradeStatus.OPEN.value,
        created_at=now,
    )
    await insert_trade(
        db_session,
        amount=200.0,
        platform="kalshi",
        strategy="strat-b",
        status=TradeStatus.OPEN.value,
        created_at=now,
    )
    await insert_trade(
        db_session,
        amount=50.0,
        platform="polymarket",
        strategy="old",
        status=TradeStatus.RESOLVED_WIN.value,
        created_at=yesterday,
    )

    manager = PositionManager()
    report = await manager.get_exposure(db_session)

    assert report.total_exposure == 300.0
    assert report.position_count == 2
    assert report.by_platform == {"polymarket": 100.0, "kalshi": 200.0}
    assert report.by_strategy == {"strat-a": 100.0, "strat-b": 200.0}
    assert report.daily_traded == 300.0

    daily_limit = settings.max_total_exposure * 2
    assert report.daily_limit == daily_limit
    assert report.daily_remaining == daily_limit - 300.0
    assert report.available_capital == settings.max_total_exposure - 300.0


async def test_paper_trader_executes_opportunity(db_session: AsyncSession, tmp_path, monkeypatch):
    log_path = tmp_path / "logs"
    trade_log_path = log_path / "trades.jsonl"
    monkeypatch.setattr(settings, "log_path", log_path)
    monkeypatch.setattr(settings, "trade_log_path", trade_log_path)

    trader = PaperTrader()
    opportunity = make_opportunity(amount=25.0, side="yes")

    result = await trader.execute_trade(opportunity, db_session)

    assert result.success is True
    assert result.paper_trade is True
    assert result.trade is not None
    assert result.trade.amount == 25.0
    assert result.trade.side.value == "yes"

    db_trade = (await db_session.execute(select(TradeDB))).scalar_one()
    assert db_trade.amount == 25.0
    assert db_trade.status == TradeStatus.OPEN.value
    assert db_trade.entry_context is not None

    assert trade_log_path.exists()
