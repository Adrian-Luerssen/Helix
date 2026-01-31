"""Database setup and session management."""

from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from ..config import settings
from ..models.trade import Base as TradeBase
from ..models.market import Base as MarketBase


# Ensure data directory exists
settings.db_path.parent.mkdir(parents=True, exist_ok=True)

# Create async engine
DATABASE_URL = f"sqlite+aiosqlite:///{settings.db_path}"
engine = create_async_engine(DATABASE_URL, echo=settings.debug)

# Session factory
AsyncSessionLocal = async_sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)


async def init_db():
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(TradeBase.metadata.create_all)
        await conn.run_sync(MarketBase.metadata.create_all)


async def get_db():
    """Dependency for FastAPI routes."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
