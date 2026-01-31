"""Trading strategies."""
from .base import BaseStrategy
from .nothing_ever_happens import NothingEverHappensStrategy
from .yield_farming import YieldFarmingStrategy

__all__ = ["BaseStrategy", "NothingEverHappensStrategy", "YieldFarmingStrategy"]
