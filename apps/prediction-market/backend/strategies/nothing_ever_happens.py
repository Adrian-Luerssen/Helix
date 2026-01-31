"""Nothing Ever Happens strategy - bet NO on dramatic predictions."""

from typing import Optional
from pydantic import BaseModel
from .base import BaseStrategy, StrategyConfig
from ..models.market import Market, MarketOpportunity
from ..models.trade import TradeCreate, TradeSide


class NEHConfig(StrategyConfig):
    """Configuration for Nothing Ever Happens strategy."""
    max_yes_price: float = 0.15  # Only bet NO when YES is cheap (dramatic unlikely events)
    min_no_price: float = 0.80   # NO should be reasonably priced
    sensational_keywords: list[str] = [
        "war", "collapse", "crash", "dies", "assassinated", "impeached",
        "resign", "arrested", "indicted", "nuclear", "invasion", "default",
        "bankruptcy", "scandal", "emergency", "crisis", "explosive"
    ]
    position_size: float = 50.0


class NothingEverHappensStrategy(BaseStrategy):
    """
    Strategy based on the academic finding that dramatic YES predictions
    rarely come true. Systematically bet NO on sensational events.
    
    Evidence: 78% of confident YES predictions fail.
    """
    
    name = "nothing_ever_happens"
    description = "Bet NO on dramatic/sensational predictions that rarely materialize"
    
    def __init__(self, config: Optional[dict] = None):
        super().__init__(config)
        self.config: NEHConfig
    
    @classmethod
    def get_default_config(cls) -> NEHConfig:
        return NEHConfig()
    
    def is_sensational(self, question: str) -> tuple[bool, list[str]]:
        """Check if question contains sensational language."""
        question_lower = question.lower()
        found_keywords = []
        for keyword in self.config.sensational_keywords:
            if keyword in question_lower:
                found_keywords.append(keyword)
        return len(found_keywords) > 0, found_keywords
    
    def should_bet(self, market: Market) -> tuple[bool, str]:
        """Check if this market fits the NEH strategy."""
        
        # Check exclusions
        if self.is_excluded(market):
            return False, f"Category {market.category} is excluded"
        
        # Check volume
        if market.volume and market.volume < self.config.min_volume:
            return False, f"Volume {market.volume} below minimum {self.config.min_volume}"
        
        # Check prices - we want cheap YES (expensive NO to sell)
        if market.yes_price is None or market.no_price is None:
            return False, "Missing price data"
        
        if market.yes_price > self.config.max_yes_price:
            return False, f"YES price {market.yes_price} above max {self.config.max_yes_price}"
        
        # Check for sensational language
        is_sensational, keywords = self.is_sensational(market.question)
        if not is_sensational:
            return False, "No sensational keywords found"
        
        return True, f"Sensational keywords: {', '.join(keywords)}"
    
    async def scan_markets(self, markets: list[Market]) -> list[MarketOpportunity]:
        """Scan markets for NEH opportunities."""
        opportunities = []
        
        for market in markets:
            should_bet, reason = self.should_bet(market)
            if not should_bet:
                continue
            
            # Calculate expected value
            # If YES is at 0.10, betting NO at 0.90 wins 0.10 when NO hits
            # Historical: ~78% of dramatic YES fail, so NO wins 78%
            implied_prob = market.no_price
            our_prob = 0.78  # Based on academic research
            ev = (our_prob * (1 - market.no_price)) - ((1 - our_prob) * market.no_price)
            
            # Clamp signal strength to valid 0-1 range
            signal = max(0.0, min(1.0, ev * 5))  # Scale EV to 0-1, clamp
            
            opportunities.append(MarketOpportunity(
                market=market,
                strategy=self.name,
                signal_strength=signal,
                recommended_side="no",
                recommended_amount=self.config.position_size,
                expected_value=ev,
                reasoning=f"NEH: {reason}. YES at {market.yes_price:.0%} implies unlikely event. Historical: 78% fail."
            ))
        
        return opportunities
    
    def create_trade(self, opportunity: MarketOpportunity) -> TradeCreate:
        """Create a trade from an opportunity."""
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
                "expected_value": opportunity.expected_value,
                "reasoning": opportunity.reasoning,
                "yes_price_at_entry": opportunity.market.yes_price,
            }
        )
