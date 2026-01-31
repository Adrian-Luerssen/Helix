"""Base strategy class."""

from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel
from ..models.market import Market, MarketOpportunity
from ..models.trade import TradeCreate


class StrategyConfig(BaseModel):
    """Base configuration for strategies."""
    enabled: bool = True
    max_position_size: float = 50.0
    max_positions: int = 10
    min_volume: float = 1000.0
    excluded_categories: list[str] = []


class BaseStrategy(ABC):
    """Abstract base class for trading strategies."""
    
    name: str = "base"
    description: str = "Base strategy"
    
    def __init__(self, config: Optional[dict] = None):
        self.config = self.get_default_config()
        if config:
            self.config = self.config.model_copy(update=config)
    
    @classmethod
    @abstractmethod
    def get_default_config(cls) -> StrategyConfig:
        """Return default configuration."""
        pass
    
    @abstractmethod
    async def scan_markets(self, markets: list[Market]) -> list[MarketOpportunity]:
        """Scan markets for opportunities matching this strategy."""
        pass
    
    @abstractmethod
    def should_bet(self, market: Market) -> tuple[bool, str]:
        """
        Check if we should bet on this market.
        Returns (should_bet, reason).
        """
        pass
    
    @abstractmethod
    def create_trade(self, opportunity: MarketOpportunity) -> TradeCreate:
        """Create a trade from an opportunity."""
        pass
    
    def calculate_position_size(self, opportunity: MarketOpportunity) -> float:
        """Calculate position size based on Kelly criterion or fixed."""
        # Simple fixed sizing for now
        return min(
            self.config.max_position_size,
            opportunity.recommended_amount
        )
    
    def is_excluded(self, market: Market) -> bool:
        """Check if market category is excluded."""
        if not market.category:
            return False
        return market.category.lower() in [c.lower() for c in self.config.excluded_categories]
