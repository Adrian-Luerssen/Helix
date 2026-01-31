"""Yield Farming strategy - bet NO on absurd predictions for steady returns."""

from typing import Optional
from .base import BaseStrategy, StrategyConfig
from ..models.market import Market, MarketOpportunity
from ..models.trade import TradeCreate, TradeSide


class YieldConfig(StrategyConfig):
    """Configuration for Yield Farming strategy."""
    min_no_price: float = 0.95  # Very high probability NO
    absurdity_keywords: list[str] = [
        "alien", "jesus", "god", "rapture", "apocalypse", "end of world",
        "zombie", "vampire", "time travel", "faster than light",
        "perpetual motion", "free energy", "flat earth",
        "moon landing fake", "simulation", "multiverse portal"
    ]
    position_size: float = 100.0  # Larger positions for near-certain bets
    max_positions: int = 20


class YieldFarmingStrategy(BaseStrategy):
    """
    Strategy: Bet NO on absurd predictions for yield-like returns.
    
    Examples: "Jesus returns in 2026", "Aliens make contact", "USD collapses to zero"
    These are near-certain NO bets that provide 5-10% APR-equivalent returns.
    """
    
    name = "yield_farming"
    description = "Bet NO on absurd predictions for steady, yield-like returns"
    
    def __init__(self, config: Optional[dict] = None):
        super().__init__(config)
        self.config: YieldConfig
    
    @classmethod
    def get_default_config(cls) -> YieldConfig:
        return YieldConfig()
    
    def is_absurd(self, question: str) -> tuple[bool, list[str]]:
        """Check if question is absurd/impossible."""
        question_lower = question.lower()
        found_keywords = []
        for keyword in self.config.absurdity_keywords:
            if keyword in question_lower:
                found_keywords.append(keyword)
        return len(found_keywords) > 0, found_keywords
    
    def should_bet(self, market: Market) -> tuple[bool, str]:
        """Check if this market fits yield farming."""
        
        if self.is_excluded(market):
            return False, f"Category {market.category} excluded"
        
        if market.no_price is None:
            return False, "Missing NO price"
        
        # We want very high NO prices (near-certain outcomes)
        if market.no_price < self.config.min_no_price:
            return False, f"NO price {market.no_price} below {self.config.min_no_price}"
        
        # Check for absurdity
        is_absurd, keywords = self.is_absurd(market.question)
        if not is_absurd:
            return False, "No absurdity keywords found"
        
        return True, f"Absurd prediction: {', '.join(keywords)}"
    
    async def scan_markets(self, markets: list[Market]) -> list[MarketOpportunity]:
        """Scan for yield farming opportunities."""
        opportunities = []
        
        for market in markets:
            should_bet, reason = self.should_bet(market)
            if not should_bet:
                continue
            
            # Calculate yield
            # Betting $100 on NO at 0.97 = get 100/0.97 = 103.09 shares
            # If NO wins (99.9% likely), return is 103.09, profit = $3.09 = 3.09%
            implied_yield = (1 / market.no_price - 1) * 100
            
            opportunities.append(MarketOpportunity(
                market=market,
                strategy=self.name,
                signal_strength=min(1.0, market.no_price),
                recommended_side="no",
                recommended_amount=self.config.position_size,
                expected_value=implied_yield / 100,
                reasoning=f"Yield: {reason}. NO at {market.no_price:.1%} = {implied_yield:.1f}% yield if it resolves NO."
            ))
        
        return opportunities
    
    def create_trade(self, opportunity: MarketOpportunity) -> TradeCreate:
        """Create a trade."""
        return TradeCreate(
            platform=opportunity.market.platform,
            market_id=opportunity.market.market_id,
            market_question=opportunity.market.question,
            market_category=opportunity.market.category,
            market_end_date=opportunity.market.end_date,
            side=TradeSide.NO,
            entry_price=opportunity.market.no_price,
            amount=self.calculate_position_size(opportunity),
            strategy=self.name,
            entry_context={
                "signal_strength": opportunity.signal_strength,
                "expected_yield": opportunity.expected_value * 100,
                "reasoning": opportunity.reasoning,
            }
        )
